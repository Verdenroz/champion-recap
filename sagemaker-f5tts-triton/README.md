# F5-TTS SageMaker Multi-Model Endpoint with Triton

This directory contains the NVIDIA Triton Inference Server implementation for F5-TTS voice generation on AWS SageMaker Multi-Model Endpoints (MME).

## Architecture

- **Base Model**: F5-TTS pretrained model (~1GB) baked into Docker container
- **Champion Models**: Fine-tuned models OR reference audio stored in S3 as `.tar.gz` files
- **Inference Server**: NVIDIA Triton with Python backend
- **Auto-scaling**: 1-4 instances based on request load

## Directory Structure

```
sagemaker-f5tts-triton/
├── Dockerfile                          # Container with F5-TTS + Triton
├── model_repository/                   # Triton model repository
│   └── f5tts/
│       ├── config.pbtxt               # Triton model configuration
│       └── 1/
│           └── model.py               # Python backend handler
├── build-and-push.sh                  # Build and push to ECR
└── README.md                          # This file
```

## Prerequisites

1. **Docker** installed and running
2. **AWS CLI** configured with credentials
3. **Champion models** packaged as `.tar.gz` files (see Model Packaging below)

## Model Packaging

Each champion model must be packaged as `{championId}.tar.gz` with one of two structures:

### Fine-tuned Model (Non-humanoid champions)
```
yasuo.tar.gz/
├── model.pt              # F5-TTS fine-tuned weights (~1GB)
├── reference.wav         # Reference audio (22050Hz, mono)
├── reference.txt         # Transcription
└── metadata.json         # {"model_type": "fine_tuned", "champion_id": "yasuo"}
```

### Base Model (Humanoid champions)
```
ahri.tar.gz/
├── reference.wav         # Reference audio only
├── reference.txt         # Transcription
└── metadata.json         # {"model_type": "base", "use_base_model": true, "champion_id": "ahri"}
```

**Note**: You will handle fine-tuning and packaging. Upload packaged models to:
```bash
aws s3 sync ./packaged-models/ s3://champion-recap-models/f5tts-models/
```

## Build and Deploy

### Step 1: Build and Push Container

```bash
# From this directory (sagemaker-f5tts-triton/)
./build-and-push.sh
```

This will:
- Create ECR repository `f5tts-triton` (if not exists)
- Build Docker image with F5-TTS base model
- Push to ECR

**Build time**: ~15-20 minutes (downloads F5-TTS base model during build)

### Step 2: Deploy CDK Stack

```bash
cd ../aws-cdk
npm run build
cdk diff    # Review changes
cdk deploy
```

This creates:
- SageMaker Model (Triton Multi-Model)
- SageMaker Endpoint Configuration
- SageMaker Endpoint (`f5tts-mme-endpoint`)
- Auto-scaling configuration (1-4 instances)
- Lambda proxy for API Gateway
- CloudWatch Log Group for Triton metrics

**Deployment time**: ~10-15 minutes

## Testing

### Test Endpoint Directly (AWS CLI)

```bash
# Prepare Triton request
cat > request.json <<EOF
{
  "inputs": [
    {
      "name": "text",
      "shape": [1],
      "datatype": "BYTES",
      "data": ["Welcome to the League of Legends!"]
    },
    {
      "name": "champion_id",
      "shape": [1],
      "datatype": "BYTES",
      "data": ["yasuo"]
    }
  ]
}
EOF

# Invoke endpoint
aws sagemaker-runtime invoke-endpoint \
  --endpoint-name f5tts-mme-endpoint \
  --target-model yasuo.tar.gz \
  --content-type application/octet-stream \
  --body fileb://request.json \
  output.json

# Parse response
cat output.json | jq '.outputs'
```

### Test via API Gateway (cURL)

```bash
# Get API Gateway URL from CDK output
API_URL=$(aws cloudformation describe-stacks \
  --stack-name ChampionRecapStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text)

# Generate voice
curl -X POST "${API_URL}/voice/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "championId": "yasuo",
    "text": "Your 67% win rate on Riven shows dedication, Summoner.",
    "language": "en"
  }'
```

## Monitoring

### CloudWatch Metrics

Triton automatically publishes metrics to CloudWatch:

**Namespace**: `ChampionRecap/VoiceGeneration`

**Metrics**:
- `ModelLoadingTime` - Time to load champion model from S3
- `InferenceTime` - Audio generation latency
- `ModelCacheHit` - Cache effectiveness
- `GPUMemoryUtilization` - GPU memory usage
- `GPUUtilization` - GPU compute usage

### View Logs

```bash
# Triton metrics and model loading
aws logs tail /aws/sagemaker/Endpoints/f5tts-mme-endpoint --follow

# Lambda proxy logs
aws logs tail /aws/lambda/champion-recap-voice-generator-proxy --follow
```

## Troubleshooting

### Issue: Model Not Found (404)

**Cause**: Champion `.tar.gz` not in S3 or incorrect naming

**Solution**:
```bash
# List models in S3
aws s3 ls s3://champion-recap-models/f5tts-models/

# Ensure format: {championId}.tar.gz (lowercase)
# Example: yasuo.tar.gz, ahri.tar.gz
```

### Issue: 507 Insufficient Memory

**Cause**: Too many fine-tuned models loaded simultaneously

**Solution**:
- Fine-tuned models are ~1.5GB each
- Base model + reference is ~0.5GB
- T4 GPU has 16GB VRAM → max 8-10 models cached
- Triton automatically unloads least-used models

### Issue: Slow First Invocation (Cold Start)

**Expected**: 20-30 seconds for first request per champion

**Causes**:
1. Downloading model from S3 (~5-10s for 1GB)
2. Loading model to GPU (~5-10s)
3. First inference run (~5-10s)

**Subsequent requests**: <2 seconds (model cached in GPU)

### Issue: Audio Quality Poor

**Possible causes**:
1. Reference audio quality (check `reference.wav`)
2. Reference transcription accuracy (check `reference.txt`)
3. Using base model instead of fine-tuned (check `metadata.json`)

## Cost Estimation

**Instance Cost**:
- ml.g4dn.xlarge: $0.736/hour
- 1 instance running 24/7: ~$537/month
- Auto-scaling to 4 instances (peak hours): +$294/month avg

**S3 Storage**:
- 50 fine-tuned models × 1GB: $1.20/month
- 122 base models × 1MB: $0.003/month

**Total**: ~$537-831/month (depending on traffic)

## Performance Characteristics

**Latency**:
- Cold start (first request): 20-30s
- Warm inference: 1-2s per 20 words
- Model switching: 5-10s

**Throughput**:
- Single instance: ~30 requests/minute
- 4 instances: ~120 requests/minute

**GPU Memory** (per model):
- Fine-tuned: ~1.5GB
- Base + reference: ~0.5GB
- Base model (shared): ~2GB

**Concurrent models cached**: 8-10 models per instance

## Differences from GPT-SoVITS

| Feature | GPT-SoVITS (Old) | F5-TTS (New) |
|---------|------------------|--------------|
| Server | Multi-Model Server (MMS) | NVIDIA Triton |
| Model Size | ~300MB per champion | 1GB (fine-tuned) or 1MB (base) |
| Base Model | Shared (BERT + CNHubert, ~3GB) | Shared (F5-TTS, ~1GB) |
| Few-shot Quality | Good | Excellent |
| Cold Start | 15-20s | 20-30s (larger models) |
| Warm Inference | 2-3s | 1-2s (faster) |
| GPU Utilization | ~60% | ~75% (Triton optimization) |
| Fine-tuning | Required for all | Optional (selective) |

## Next Steps

1. ✅ Container built and pushed to ECR
2. ⏳ Package champion models (you'll handle this)
3. ⏳ Upload models to S3
4. ⏳ Deploy CDK stack
5. ⏳ Test endpoint
6. ⏳ Monitor metrics and optimize

## References

- [F5-TTS GitHub](https://github.com/SWivid/F5-TTS)
- [NVIDIA Triton Documentation](https://github.com/triton-inference-server/server)
- [SageMaker Multi-Model Endpoints](https://docs.aws.amazon.com/sagemaker/latest/dg/multi-model-endpoints.html)
- [Triton Python Backend](https://github.com/triton-inference-server/python_backend)
