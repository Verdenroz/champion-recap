# F5-TTS SageMaker Multi-Model Endpoint with NVIDIA Triton Inference Server + TensorRT-LLM
# Based on official F5-TTS Triton runtime: https://github.com/SWivid/F5-TTS/tree/main/src/f5_tts/runtime/triton_trtllm

FROM nvcr.io/nvidia/tritonserver:24.12-py3

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    CUDA_VISIBLE_DEVICES=0

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    sox \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies for TensorRT-LLM and F5-TTS
RUN pip install --no-cache-dir \
    tritonclient[grpc] \
    tensorrt-llm==0.16.0 \
    torchaudio==2.5.1 \
    jieba \
    pypinyin \
    librosa \
    vocos \
    boto3 \
    huggingface_hub

# Set working directory
WORKDIR /workspace

# Copy Triton runtime files
COPY triton/model_repo_f5_tts /workspace/model_repo_f5_tts
COPY triton/scripts /workspace/scripts
COPY triton/patch /workspace/patch
COPY triton/run.sh /workspace/run.sh

# Copy our build and startup scripts
COPY build_engines.sh /workspace/build_engines.sh
COPY startup.sh /workspace/startup.sh

# Make scripts executable
RUN chmod +x /workspace/run.sh \
    /workspace/build_engines.sh \
    /workspace/startup.sh

# Create directories for checkpoints and models
RUN mkdir -p /workspace/ckpts \
    /workspace/model_repo \
    /opt/ml/models

# Set environment variables for model paths
ENV CKPT_DIR=/workspace/ckpts \
    MODEL_REPO=/workspace/model_repo \
    F5TTS_MODEL=F5TTS_Base \
    MODEL_BUCKET=champion-recap-models \
    VOICE_BUCKET=champion-recap-voices

# Required labels for SageMaker Multi-Model Endpoints
LABEL com.amazonaws.sagemaker.capabilities.multi-models=true
LABEL com.amazonaws.sagemaker.capabilities.accept-bind-to-port=true

# Expose Triton ports
# 8000: HTTP
# 8001: GRPC
# 8002: Metrics
EXPOSE 8000 8001 8002

# Download base model, build TensorRT engines, and start Triton server
CMD ["/workspace/startup.sh"]
