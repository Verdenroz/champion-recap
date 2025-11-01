## F5-TTS with Triton Inference Server + TensorRT-LLM

### Deployment Options

#### Option 1: AWS SageMaker Deployment (Recommended for Production)

**Prerequisites:**
- AWS CLI configured with credentials
- Docker installed with GPU support
- Python 3.10+ with `huggingface-cli`

**1. Upload Champion Voice References to S3**
```sh
# Upload all champion voices from champion-audio-crawler/output/
python scripts/upload_voices_to_s3.py --bucket champion-recap-voices

# Verify upload
aws s3 ls s3://champion-recap-voices/champion-voices/ --recursive | head -10
```

**2. Build and Deploy to SageMaker**
```sh
# Build TensorRT engines, create model.tar.gz, and push Docker image to ECR
# This takes 30-45 minutes on a GPU instance
./build_for_sagemaker.sh F5TTS_v1_Base

# Upload model to S3
aws s3 cp model.tar.gz s3://champion-recap-models-$(aws sts get-caller-identity --query Account --output text)/f5tts-triton-trtllm/

# Deploy CDK stack (creates SageMaker endpoint)
cd ../aws-cdk && cdk deploy
```

**3. Test SageMaker Endpoint**
```sh
# Get endpoint name
aws sagemaker list-endpoints --name-contains f5tts

# Test with champion_id (Triton loads voice from S3 automatically)
python client_http_champion.py \
  --server-url <SAGEMAKER_ENDPOINT_URL> \
  --champion-id yasuo \
  --target-text "Your 67% win rate on Riven shows dedication, Summoner." \
  --output-audio test_yasuo.wav
```

**SageMaker Integration Details:**
- **Input**: `champion_id` + `target_text` (champion voice loaded from S3 automatically)
- **Output**: Float32 waveform array (converted to WAV by Lambda)
- **S3 Structure**: `s3://champion-recap-voices/champion-voices/{champion_id}/reference.wav`
- **Auto-scaling**: 1-4 instances (ml.g4dn.xlarge with NVIDIA T4 GPU)
- **Performance**: ~0.04 RTF (Real-Time Factor) with TensorRT-LLM

---

#### Option 2: Local Development (Docker)

**Quick Start:**
```sh
# Launch with docker compose
MODEL=F5TTS_v1_Base docker compose up
```

**Build from Scratch:**
```sh
# Build the docker image
docker build . -f Dockerfile.server -t soar97/triton-f5-tts:24.12

# Create Docker Container
your_mount_dir=/mnt:/mnt
docker run -it --name "f5-server" --gpus all --net host -v $your_mount_dir --shm-size=2g soar97/triton-f5-tts:24.12
```

**Build TensorRT-LLM Engines:**
```sh
# Inside docker container
# F5TTS_v1_Base | F5TTS_Base | F5TTS_v1_Small | F5TTS_Small
bash run.sh 0 4 F5TTS_v1_Base
```

> [!NOTE]
> If use custom checkpoint, set `ckpt_file` and `vocab_file` in `run.sh`.
> Remember to use matched model version (`F5TTS_v1_*` for v1, `F5TTS_*` for v0).
>
> If use checkpoint of different structure, see `scripts/convert_checkpoint.py`, and perform modification if necessary.

> [!IMPORTANT]
> If train or finetune with fp32, add `--dtype float32` flag when converting checkpoint in `run.sh` phase 1.

### HTTP Client
```sh
python3 client_http.py
```

### Benchmarking
#### Using Client-Server Mode
```sh
# bash run.sh 5 5 F5TTS_v1_Base
num_task=2
python3 client_grpc.py --num-tasks $num_task --huggingface-dataset yuekai/seed_tts --split-name wenetspeech4tts
```

#### Using Offline TRT-LLM Mode
```sh
# bash run.sh 7 7 F5TTS_v1_Base
batch_size=1
split_name=wenetspeech4tts
backend_type=trt
log_dir=./tests/benchmark_batch_size_${batch_size}_${split_name}_${backend_type}
rm -r $log_dir
torchrun --nproc_per_node=1 \
benchmark.py --output-dir $log_dir \
--batch-size $batch_size \
--enable-warmup \
--split-name $split_name \
--model-path $ckpt_file \
--vocab-file $vocab_file \
--vocoder-trt-engine-path $VOCODER_TRT_ENGINE_PATH \
--backend-type $backend_type \
--tllm-model-dir $TRTLLM_ENGINE_DIR || exit 1
```

### Benchmark Results
Decoding on a single L20 GPU, using 26 different prompt_audio & target_text pairs, 16 NFE.

| Model               | Concurrency    | Avg Latency | RTF    | Mode            |
|---------------------|----------------|-------------|--------|-----------------|
| F5-TTS Base (Vocos) | 2              | 253 ms      | 0.0394 | Client-Server   |
| F5-TTS Base (Vocos) | 1 (Batch_size) | -           | 0.0402 | Offline TRT-LLM |
| F5-TTS Base (Vocos) | 1 (Batch_size) | -           | 0.1467 | Offline Pytorch |

### Credits
1. [Yuekai Zhang](https://github.com/yuekaizhang)
2. [F5-TTS-TRTLLM](https://github.com/Bigfishering/f5-tts-trtllm)
