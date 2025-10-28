#!/bin/bash
# Startup script for F5-TTS Triton server in SageMaker MME
set -e

echo "========================================"
echo "F5-TTS Triton Server Startup"
echo "========================================"

# Check if engines are already built
if [ ! -d "/workspace/model_repo" ] || [ ! -f "/workspace/model_repo/f5_tts/config.pbtxt" ]; then
    echo "TensorRT engines not found. Building engines..."
    /workspace/build_engines.sh
else
    echo "TensorRT engines found. Skipping build."
fi

# Start Triton server
echo "Starting Triton Inference Server..."
echo "Model repository: /workspace/model_repo"
echo "========================================"

exec tritonserver \
    --model-repository=/workspace/model_repo \
    --http-port=8000 \
    --grpc-port=8001 \
    --metrics-port=8002 \
    --log-verbose=1 \
    --allow-grpc=true \
    --allow-http=true \
    --allow-metrics=true
