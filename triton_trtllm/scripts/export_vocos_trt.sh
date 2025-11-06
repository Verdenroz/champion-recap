#!/bin/bash
# Copyright (c) 2025, NVIDIA CORPORATION.  All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Manual installation of TensorRT, in case not using NVIDIA NGC:
# https://docs.nvidia.com/deeplearning/tensorrt/latest/installing-tensorrt/installing.html#downloading-tensorrt
TRTEXEC="/usr/src/tensorrt/bin/trtexec"

ONNX_PATH=$1
ENGINE_PATH=$2
echo "ONNX_PATH: $ONNX_PATH"
echo "ENGINE_PATH: $ENGINE_PATH"

# TensorRT Precision and Optimization Settings
# - FP16: Enables half-precision inference (~2x faster on T4 GPUs with minimal accuracy loss)
# - Workspace: Memory allocation for TensorRT optimization (MB)
PRECISION="fp16"
WORKSPACE_SIZE=4096  # 4GB workspace for optimization

# Batch size optimization profiles
# OPT_BATCH_SIZE should match your most common use case for best performance
MIN_BATCH_SIZE=1
OPT_BATCH_SIZE=2  # Optimized for typical 2-request batches (matches Triton preferred_batch_size)
MAX_BATCH_SIZE=8

MIN_INPUT_LENGTH=1
OPT_INPUT_LENGTH=1000  # Typical voice generation length
MAX_INPUT_LENGTH=3000  # Maximum supported length

MEL_MIN_SHAPE="${MIN_BATCH_SIZE}x100x${MIN_INPUT_LENGTH}"
MEL_OPT_SHAPE="${OPT_BATCH_SIZE}x100x${OPT_INPUT_LENGTH}"
MEL_MAX_SHAPE="${MAX_BATCH_SIZE}x100x${MAX_INPUT_LENGTH}"

echo "Building TensorRT engine with FP16 precision for NVIDIA T4 (ml.g4dn.xlarge)"
echo "Optimization profile: min=${MEL_MIN_SHAPE}, opt=${MEL_OPT_SHAPE}, max=${MEL_MAX_SHAPE}"

${TRTEXEC} \
    --minShapes="mel:${MEL_MIN_SHAPE}" \
    --optShapes="mel:${MEL_OPT_SHAPE}" \
    --maxShapes="mel:${MEL_MAX_SHAPE}" \
    --onnx=${ONNX_PATH} \
    --saveEngine=${ENGINE_PATH} \
    --fp16 \
    --workspace=${WORKSPACE_SIZE} \
    --verbose
