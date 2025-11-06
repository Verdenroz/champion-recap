#!/bin/bash
# Build F5-TTS TensorRT-LLM model for AWS SageMaker deployment
#
# IMPORTANT: This script MUST be run on the same GPU architecture as your SageMaker endpoint!
#
# Target GPU: NVIDIA T4 (SageMaker ml.g4dn.xlarge instance)
# CUDA Compute Capability: 7.5
#
# WARNING: TensorRT engines are GPU-specific and NOT portable across architectures.
# Building on a different GPU (RTX 30xx, A100, etc.) will cause failures on SageMaker.
#
# Recommended Build Environment:
# - EC2 g4dn.xlarge instance (NVIDIA T4 GPU, same as SageMaker)
# - Ubuntu 22.04 with NVIDIA CUDA 12.x drivers
# - Docker with NVIDIA Container Toolkit
#
# This script:
# 1. Downloads F5-TTS base model from HuggingFace
# 2. Converts checkpoint to TensorRT-LLM format
# 3. Builds TensorRT engines optimized for T4 GPU with FP16 precision
# 4. Exports Vocos vocoder to TensorRT with FP16 optimization
# 5. Creates model.tar.gz for S3 upload (Triton model repository structure)
# 6. Builds and pushes Docker image to ECR (without baked-in models)
#
# Reference: https://aws.amazon.com/blogs/machine-learning/host-ml-models-on-amazon-sagemaker-using-triton-tensorrt-models/

set -e  # Exit on error

# Add Hugging Face CLI to PATH (standalone installer location)
export PATH="$HOME/.local/bin:$PATH"

# Configuration
MODEL=${1:-F5TTS_v1_Base}  # F5TTS_v1_Base | F5TTS_Base | F5TTS_v1_Small | F5TTS_Small
AWS_REGION=${AWS_REGION:-us-east-1}
AWS_ACCOUNT=${AWS_ACCOUNT:-$(aws sts get-caller-identity --query Account --output text)}
ECR_REPO="f5tts-triton-trtllm"
CKPT_DIR=./ckpts
TRTLLM_CKPT_DIR=$CKPT_DIR/$MODEL/trtllm_ckpt
TRTLLM_ENGINE_DIR=$CKPT_DIR/$MODEL/trtllm_engine
VOCODER_ONNX_PATH=$CKPT_DIR/vocos_vocoder.onnx
VOCODER_TRT_ENGINE_PATH=$CKPT_DIR/vocos_vocoder.plan
MODEL_REPO=./model_repo

# Validate required environment variables
if [ -z "$AWS_ACCOUNT" ]; then
    echo "ERROR: AWS_ACCOUNT not set. Run: export AWS_ACCOUNT=\$(aws sts get-caller-identity --query Account --output text)"
    exit 1
fi

if [ -z "$AWS_REGION" ]; then
    echo "ERROR: AWS_REGION not set. Run: export AWS_REGION=us-east-1"
    exit 1
fi

# Set default for S3 voice bucket (can be overridden)
S3_VOICE_BUCKET=${S3_VOICE_BUCKET:-champion-recap-voices-$AWS_ACCOUNT}

echo "=================================================="
echo "F5-TTS SageMaker Build Script"
echo "=================================================="
echo "Model: $MODEL"
echo "AWS Region: $AWS_REGION"
echo "AWS Account: $AWS_ACCOUNT"
echo "ECR Repository: $ECR_REPO"
echo "S3 Voice Bucket: $S3_VOICE_BUCKET"
echo "=================================================="

# Stage 0: Download F5-TTS model from HuggingFace
echo "[Stage 0] Downloading F5-TTS model from HuggingFace..."
if [ ! -d "$CKPT_DIR/$MODEL" ]; then
    hf download SWivid/F5-TTS $MODEL/model_*.* $MODEL/vocab.txt --local-dir $CKPT_DIR
else
    echo "Model already downloaded, skipping..."
fi

ckpt_file=$(ls $CKPT_DIR/$MODEL/model_*.* 2>/dev/null | sort -V | tail -1)
vocab_file=$CKPT_DIR/$MODEL/vocab.txt

echo "Using checkpoint: $ckpt_file"
echo "Using vocab: $vocab_file"

# Stage 1-2: Build TensorRT engines inside Docker container
# This avoids CUDA version mismatches on the host system
echo "[Stage 1-2] Building TensorRT-LLM Docker image..."
BUILDER_IMAGE="f5tts-tensorrt-builder:latest"

if [ ! -d "$TRTLLM_ENGINE_DIR" ] || [ ! -f "$VOCODER_TRT_ENGINE_PATH" ]; then
    # Build the Docker image with TensorRT-LLM environment
    docker build -t $BUILDER_IMAGE -f Dockerfile.server .

    echo "[Stage 1-2] Running TensorRT engine build inside Docker container..."
    echo "This will:"
    echo "  - Convert F5-TTS checkpoint to TensorRT-LLM format"
    echo "  - Build TensorRT engines optimized for T4 GPU"
    echo "  - Export Vocos vocoder to TensorRT"
    echo ""

    # Run the build inside the container with GPU access
    # Mount volumes:
    #   - Current directory to /workspace (scripts, patch, model_repo_f5_tts)
    #   - ckpts to /workspace/ckpts (persists downloaded models and built engines)
    docker run --rm --gpus all \
        -v "$(pwd):/workspace" \
        -w /workspace \
        $BUILDER_IMAGE \
        bash -c "
            set -e

            # Stage 1: Convert checkpoint and build TensorRT-LLM engine
            if [ ! -d '$TRTLLM_ENGINE_DIR' ]; then
                echo '[Container Stage 1] Converting checkpoint to TensorRT-LLM...'
                python3 scripts/convert_checkpoint.py \
                    --pytorch_ckpt $ckpt_file \
                    --output_dir $TRTLLM_CKPT_DIR \
                    --model_name $MODEL

                echo '[Container Stage 1] Copying patched F5TTS model...'
                cp -r patch/* /usr/local/lib/python3.12/dist-packages/tensorrt_llm/models/

                echo '[Container Stage 1] Building TensorRT-LLM engine...'
                trtllm-build --checkpoint_dir $TRTLLM_CKPT_DIR \
                    --max_batch_size 8 \
                    --output_dir $TRTLLM_ENGINE_DIR \
                    --remove_input_padding disable
            else
                echo '[Container Stage 1] TensorRT-LLM engine already built, skipping...'
            fi

            # Stage 2: Export Vocos vocoder to TensorRT
            if [ ! -f '$VOCODER_TRT_ENGINE_PATH' ]; then
                echo '[Container Stage 2] Exporting Vocos vocoder to ONNX...'
                python3 scripts/export_vocoder_to_onnx.py \
                    --vocoder vocos \
                    --output-path $VOCODER_ONNX_PATH

                echo '[Container Stage 2] Converting Vocos to TensorRT...'
                bash scripts/export_vocos_trt.sh $VOCODER_ONNX_PATH $VOCODER_TRT_ENGINE_PATH
            else
                echo '[Container Stage 2] Vocoder TensorRT engine already exists, skipping...'
            fi

            echo '[Container] Build stages complete!'
        "

    echo "[Stage 1-2] Docker container build complete!"
else
    echo "[Stage 1-2] TensorRT engines already built, skipping Docker build..."
fi

# Stage 3: Build Triton model repository
echo "[Stage 3] Building Triton model repository..."
rm -rf $MODEL_REPO
cp -r ./model_repo_f5_tts $MODEL_REPO

# Fill config.pbtxt template with paths
python3 scripts/fill_template.py \
    -i $MODEL_REPO/f5_tts/config.pbtxt \
    vocab:$vocab_file,model:$ckpt_file,trtllm:$TRTLLM_ENGINE_DIR,vocoder:vocos,S3_VOICE_BUCKET:$S3_VOICE_BUCKET

# Copy vocoder TensorRT engine
cp $VOCODER_TRT_ENGINE_PATH $MODEL_REPO/vocoder/1/vocoder.plan

echo "[Stage 3] Triton model repository built successfully"
ls -lR $MODEL_REPO

# Stage 4: Create model.tar.gz for S3 upload
echo "[Stage 4] Creating model.tar.gz for SageMaker..."
tar -czf model.tar.gz -C $MODEL_REPO .
echo "Created model.tar.gz ($(du -h model.tar.gz | cut -f1))"

# Verify tar.gz structure (critical for SageMaker deployment)
echo ""
echo "[Stage 4] Verifying model.tar.gz structure..."
echo "Expected structure:"
echo "  f5_tts/"
echo "    config.pbtxt"
echo "    1/"
echo "      model.py"
echo "      f5_tts_trtllm.py"
echo "      (TensorRT engine files)"
echo "  vocoder/"
echo "    config.pbtxt"
echo "    1/"
echo "      vocoder.plan"
echo ""
echo "Actual contents (first 30 files):"
tar -tzf model.tar.gz | head -30
echo ""
echo "Total files in archive: $(tar -tzf model.tar.gz | wc -l)"
echo ""

# Validate critical files are present
echo "[Stage 4] Validating critical files..."
REQUIRED_FILES=(
    "f5_tts/config.pbtxt"
    "f5_tts/1/model.py"
    "vocoder/config.pbtxt"
    "vocoder/1/vocoder.plan"
)

VALIDATION_FAILED=0
for file in "${REQUIRED_FILES[@]}"; do
    if tar -tzf model.tar.gz | grep -q "^${file}$"; then
        echo "  ✓ Found: $file"
    else
        echo "  ✗ MISSING: $file"
        VALIDATION_FAILED=1
    fi
done

if [ $VALIDATION_FAILED -eq 1 ]; then
    echo ""
    echo "ERROR: Model archive is missing required files!"
    echo "SageMaker deployment will fail. Please fix the model repository structure."
    exit 1
fi

echo ""
echo "✓ Model archive validation passed!"
echo ""

# Stage 5: Build and push Docker image to ECR
echo "[Stage 5] Building Docker image for SageMaker..."

# Create ECR repository if it doesn't exist
aws ecr describe-repositories --repository-names $ECR_REPO --region $AWS_REGION 2>/dev/null || \
    aws ecr create-repository --repository-name $ECR_REPO --region $AWS_REGION

# Get ECR login
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com

# Build Docker image
docker build -t $ECR_REPO:latest -f Dockerfile.sagemaker .

# Tag for ECR
docker tag $ECR_REPO:latest $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest

# Push to ECR
docker push $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest

echo "=================================================="
echo "Build Complete!"
echo "=================================================="
echo "Model archive: model.tar.gz"
echo "Docker image: $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest"
echo ""
echo "IMPORTANT: TensorRT engines built for NVIDIA T4 GPU (CUDA Compute 7.5)"
echo "These engines will ONLY work on SageMaker ml.g4dn.xlarge instances."
echo ""
echo "Next steps:"
echo "1. Upload model.tar.gz to S3:"
echo "   aws s3 cp model.tar.gz s3://champion-recap-models-$AWS_ACCOUNT/f5tts-triton-trtllm/"
echo ""
echo "2. Deploy CDK stack (will create ml.g4dn.xlarge endpoint):"
echo "   cd ../aws-cdk && cdk deploy"
echo ""
echo "3. Verify deployment:"
echo "   aws sagemaker describe-endpoint --endpoint-name f5tts-voice-generator"
echo "=================================================="
