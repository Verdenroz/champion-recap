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

## CDK Stack Integration

The SageMaker endpoint is deployed via AWS CDK stack (`aws-cdk/lib/champion-recap-stack.ts`).

### Key Configuration

**Endpoint Details:**
- **Endpoint Name**: `f5tts-voice-generator`
- **Model Name**: `f5_tts` (set via `SAGEMAKER_TRITON_DEFAULT_MODEL_NAME`)
- **Instance Type**: ml.g4dn.xlarge (NVIDIA T4 GPU, 16GB VRAM)
- **Auto-scaling**: 1-4 instances based on invocations per instance (target: 1000/instance)
- **S3 Voice Bucket**: Configured via `S3_VOICE_BUCKET` environment variable

**Environment Variables in SageMaker Container:**
```bash
SAGEMAKER_TRITON_DEFAULT_MODEL_NAME=f5_tts          # Triton model to load
S3_VOICE_BUCKET=champion-recap-voices-{account-id}  # S3 bucket for champion voices
SAGEMAKER_TRITON_LOG_VERBOSE=1                      # Enable verbose logging
SAGEMAKER_TRITON_BUFFER_MANAGER_THREAD_COUNT=2      # Triton performance tuning
```

### IAM Permissions Required

The SageMaker execution role needs:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::champion-recap-models-{account}",
        "arn:aws:s3:::champion-recap-models-{account}/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::champion-recap-voices-{account}",
        "arn:aws:s3:::champion-recap-voices-{account}/*"
      ]
    }
  ]
}
```

### Invocation from Lambda

See `lambda/bedrock-coaching-orchestrator/voice_generator.py` for production usage:

```python
import boto3
import json

sagemaker_runtime = boto3.client('sagemaker-runtime')

# Prepare Triton inference request
# IMPORTANT: Use "BYTES" datatype for client API (maps to TYPE_STRING in config.pbtxt)
payload = {
    "inputs": [
        {
            "name": "champion_id",
            "shape": [1],
            "datatype": "BYTES",  # Not TYPE_STRING!
            "data": ["yasuo"]
        },
        {
            "name": "target_text",
            "shape": [1],
            "datatype": "BYTES",
            "data": ["Your 67% win rate on Riven shows mastery"]
        }
    ]
}

# Invoke endpoint
response = sagemaker_runtime.invoke_endpoint(
    EndpointName='f5tts-voice-generator',
    ContentType='application/json',
    Body=json.dumps(payload)
)

# Parse response
result = json.loads(response['Body'].read())
waveform = result['outputs'][0]['data']  # Float32 array at 24kHz
```

### CloudWatch Monitoring

The CDK stack automatically creates CloudWatch alarms for:

1. **High Error Rate**: Triggers when 4XX errors > 5 in 5 minutes
2. **High Latency**: Triggers when p99 latency > 10 seconds
3. **High GPU Utilization**: Triggers when GPU usage > 90%

**View Logs:**
```bash
aws logs tail /aws/sagemaker/Endpoints/f5tts-voice-generator --follow
```

**View Metrics:**
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/SageMaker \
  --metric-name ModelLatency \
  --dimensions Name=EndpointName,Value=f5tts-voice-generator \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum
```

### Troubleshooting

**Problem: Endpoint fails to start**
- Check CloudWatch Logs: `/aws/sagemaker/Endpoints/f5tts-voice-generator`
- Verify model.tar.gz exists in S3: `aws s3 ls s3://champion-recap-models-{account}/f5tts-triton-trtllm/`
- Ensure Docker image exists in ECR: `aws ecr describe-images --repository-name f5tts-triton-trtllm`

**Problem: "Model not found" errors**
- Check `SAGEMAKER_TRITON_DEFAULT_MODEL_NAME` matches config.pbtxt model name (`f5_tts`)
- Verify model directory structure in model.tar.gz: `tar -tzf model.tar.gz | head -20`

**Problem: "Champion voice not found" errors**
- Verify S3 voice references exist: `aws s3 ls s3://champion-recap-voices-{account}/champion-voices/`
- Check S3 bucket name in config.pbtxt matches: `grep S3_VOICE_BUCKET model_repo/f5_tts/config.pbtxt`

**Problem: High latency (> 10s)**
- Check GPU utilization: May need to scale up instances
- Verify TensorRT engines are being used (not falling back to PyTorch)
- Review Triton logs for performance warnings

**Best Practice: Test Locally First**
```bash
# Test with Docker before deploying to SageMaker
cd triton_trtllm
MODEL=F5TTS_v1_Base docker compose up

# In another terminal
python client_http_champion.py \
  --server-url http://localhost:8000 \
  --champion-id yasuo \
  --target-text "Test voice generation locally" \
  --output-audio test.wav
```

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
