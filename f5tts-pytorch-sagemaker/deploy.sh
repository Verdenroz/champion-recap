#!/bin/bash
# Deploy F5-TTS to AWS SageMaker using PyTorch

set -e  # Exit on error

# Configuration
MODEL=${1:-F5TTS_v1_Base}  # F5TTS_v1_Base | F5TTS_Base
AWS_REGION=${AWS_REGION:-us-east-1}
AWS_ACCOUNT=${AWS_ACCOUNT:-$(aws sts get-caller-identity --query Account --output text)}
S3_MODEL_BUCKET="champion-recap-models-${AWS_ACCOUNT}"
S3_MODEL_PREFIX="f5tts-pytorch"
CKPT_DIR=./models

echo "=================================================="
echo "F5-TTS PyTorch SageMaker Deployment"
echo "=================================================="
echo "Model: $MODEL"
echo "AWS Region: $AWS_REGION"
echo "AWS Account: $AWS_ACCOUNT"
echo "S3 Bucket: $S3_MODEL_BUCKET"
echo "=================================================="

# Step 1: Download F5-TTS model from HuggingFace
echo ""
echo "[Step 1] Downloading F5-TTS model from HuggingFace..."
if [ ! -d "$CKPT_DIR/$MODEL" ]; then
    mkdir -p $CKPT_DIR
    hf download SWivid/F5-TTS $MODEL/model_*.* $MODEL/vocab.txt --local-dir $CKPT_DIR
else
    echo "Model already downloaded, skipping..."
fi

ckpt_file=$(ls $CKPT_DIR/$MODEL/model_*.* 2>/dev/null | sort -V | tail -1)
vocab_file=$CKPT_DIR/$MODEL/vocab.txt

echo "Using checkpoint: $ckpt_file"
echo "Using vocab: $vocab_file"

# Step 2: Package model artifacts for SageMaker
echo ""
echo "[Step 2] Packaging model for SageMaker..."
MODEL_DIR="./model"
rm -rf $MODEL_DIR
mkdir -p $MODEL_DIR

# Copy model files
cp $ckpt_file $MODEL_DIR/model.safetensors
cp $vocab_file $MODEL_DIR/vocab.txt

# Copy inference code
cp inference.py $MODEL_DIR/
cp requirements.txt $MODEL_DIR/

# Create model.tar.gz
tar -czf model.tar.gz -C $MODEL_DIR .

echo "Created model.tar.gz ($(du -h model.tar.gz | cut -f1))"

# Verify archive
echo ""
echo "[Step 2] Verifying model archive..."
tar -tzf model.tar.gz

# Step 3: Upload to S3
echo ""
echo "[Step 3] Uploading model to S3..."

# Create S3 bucket if it doesn't exist
aws s3 mb s3://$S3_MODEL_BUCKET --region $AWS_REGION 2>/dev/null || echo "Bucket already exists"

# Upload model
aws s3 cp model.tar.gz s3://$S3_MODEL_BUCKET/$S3_MODEL_PREFIX/model.tar.gz

MODEL_S3_URI="s3://$S3_MODEL_BUCKET/$S3_MODEL_PREFIX/model.tar.gz"

echo "=================================================="
echo "Packaging Complete!"
echo "=================================================="
echo "Model S3 URI: $MODEL_S3_URI"
echo ""
