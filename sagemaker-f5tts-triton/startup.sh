#!/bin/bash
# Startup script for F5-TTS Triton server in SageMaker with S3 engine caching
set -e

echo "========================================"
echo "F5-TTS Triton Server Startup"
echo "========================================"

# S3 cache configuration
ENGINE_CACHE_KEY="f5tts-triton/engines-cache.tar.gz"
MODEL_BUCKET=${MODEL_BUCKET:-champion-recap-models}
S3_CACHE_URI="s3://${MODEL_BUCKET}/${ENGINE_CACHE_KEY}"

# Check if engines are already built locally
if [ -d "/workspace/model_repo" ] && [ -f "/workspace/model_repo/f5_tts/config.pbtxt" ]; then
    echo "✅ TensorRT engines found locally. Skipping build."
else
    # Try to download cached engines from S3
    echo "🔍 Checking for cached engines in S3: ${S3_CACHE_URI}"
    if aws s3 ls "${S3_CACHE_URI}" 2>/dev/null; then
        echo "📦 Found cached engines! Downloading from S3..."
        aws s3 cp "${S3_CACHE_URI}" /tmp/engines-cache.tar.gz

        echo "📂 Extracting cached engines..."
        tar -xzf /tmp/engines-cache.tar.gz -C /workspace
        rm /tmp/engines-cache.tar.gz

        echo "✅ Cached engines restored successfully!"
    else
        echo "❌ No cache found in S3. Building engines from scratch..."
        /workspace/build_engines.sh

        # Cache the built engines to S3 for future deployments
        echo "💾 Caching engines to S3 for future deployments..."
        tar -czf /tmp/engines-cache.tar.gz -C /workspace ckpts/ model_repo/

        if aws s3 cp /tmp/engines-cache.tar.gz "${S3_CACHE_URI}"; then
            echo "✅ Engines cached successfully to S3!"
        fi

        rm -f /tmp/engines-cache.tar.gz
    fi
fi

# Start Triton server
echo "========================================"
echo "🚀 Starting Triton Inference Server..."
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
