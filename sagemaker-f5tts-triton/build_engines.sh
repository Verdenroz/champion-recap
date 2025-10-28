#!/bin/bash
# Build TensorRT-LLM engines for F5-TTS
# Adapted from official F5-TTS run.sh for SageMaker MME deployment

set -e

MODEL=${F5TTS_MODEL:-F5TTS_Base}
CKPT_DIR=${CKPT_DIR:-/workspace/ckpts}
TRTLLM_CKPT_DIR=$CKPT_DIR/$MODEL/trtllm_ckpt
TRTLLM_ENGINE_DIR=$CKPT_DIR/$MODEL/trtllm_engine
VOCODER_ONNX_PATH=$CKPT_DIR/vocos_vocoder.onnx
VOCODER_TRT_ENGINE_PATH=$CKPT_DIR/vocos_vocoder.plan
MODEL_REPO=/workspace/model_repo

echo "========================================"
echo "Building TensorRT-LLM engines for F5-TTS"
echo "Model: $MODEL"
echo "Checkpoint directory: $CKPT_DIR"
echo "========================================"

# Stage 0: Download F5-TTS model from Hugging Face
echo "[Stage 0] Downloading F5-TTS model from HuggingFace..."
huggingface-cli download SWivid/F5-TTS $MODEL/model_*.* $MODEL/vocab.txt --local-dir $CKPT_DIR

ckpt_file=$(ls $CKPT_DIR/$MODEL/model_*.* 2>/dev/null | sort -V | tail -1)
vocab_file=$CKPT_DIR/$MODEL/vocab.txt

echo "Using checkpoint: $ckpt_file"
echo "Using vocab: $vocab_file"

# Stage 1: Convert PyTorch checkpoint to TensorRT-LLM format
echo "[Stage 1] Converting checkpoint to TensorRT-LLM format..."
python3 /workspace/scripts/convert_checkpoint.py \
    --pytorch_ckpt $ckpt_file \
    --output_dir $TRTLLM_CKPT_DIR \
    --model_name $MODEL

# Apply F5-TTS patches to TensorRT-LLM
python_package_path=/usr/local/lib/python3.12/dist-packages
cp -r /workspace/patch/* $python_package_path/tensorrt_llm/models

# Build TensorRT engine
echo "Building TensorRT engine (max_batch_size=8)..."
trtllm-build --checkpoint_dir $TRTLLM_CKPT_DIR \
    --max_batch_size 8 \
    --output_dir $TRTLLM_ENGINE_DIR \
    --remove_input_padding disable

# Stage 2: Export Vocos vocoder to ONNX and TensorRT
echo "[Stage 2] Exporting Vocos vocoder..."
python3 /workspace/scripts/export_vocoder_to_onnx.py \
    --vocoder vocos \
    --output-path $VOCODER_ONNX_PATH

bash /workspace/scripts/export_vocos_trt.sh $VOCODER_ONNX_PATH $VOCODER_TRT_ENGINE_PATH

# Stage 3: Populate model repository
echo "[Stage 3] Populating Triton model repository..."
rm -rf $MODEL_REPO
cp -r /workspace/model_repo_f5_tts $MODEL_REPO

# Fill in config template with actual paths
python3 /workspace/scripts/fill_template.py \
    -i $MODEL_REPO/f5_tts/config.pbtxt \
    vocab:$vocab_file,model:$ckpt_file,trtllm:$TRTLLM_ENGINE_DIR,vocoder:vocos

# Copy vocoder engine to model repository
cp $VOCODER_TRT_ENGINE_PATH $MODEL_REPO/vocoder/1/vocoder.plan

echo "========================================"
echo "✅ TensorRT-LLM engines built successfully"
echo "Model repository: $MODEL_REPO"
echo "========================================"
