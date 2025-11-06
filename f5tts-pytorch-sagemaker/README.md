# F5-TTS PyTorch SageMaker Deployment

AWS SageMaker deployment for F5-TTS voice generation using PyTorch Deep Learning Containers. This implementation provides real-time voice cloning for League of Legends champion personalities with simple, managed infrastructure.

## Overview

This directory contains the infrastructure code for deploying F5-TTS (Flow Matching Text-to-Speech) on AWS SageMaker using standard PyTorch inference. The deployment uses AWS-managed containers, eliminating the need for custom Docker builds while maintaining real-time performance.

**Key Features:**
- Real-time voice generation (RTF ~0.15)
- Zero-shot voice cloning from champion reference audio
- AWS-managed PyTorch containers (no Docker builds required)
- S3 integration for champion voice references
- Auto-scaling GPU instances (ml.g4dn.xlarge)
- CloudWatch monitoring and alarms

## Architecture

```
+-----------+         +------------------+         +-----------+
|  Bedrock  | ------> |   SageMaker      | ------> |    S3     |
|   Agent   |         |   PyTorch        |         |  Voices   |
|           |         |   Endpoint       |         |  Bucket   |
+-----------+         +------------------+         +-----------+
      |                        |                         |
      |                        |                         |
      v                        v                         v
  Coaching               F5-TTS Model            Champion Reference
 Observations           (ml.g4dn.xlarge)            Audio Files
```

**Components:**
1. **inference.py** - SageMaker inference handler implementing model loading, S3 integration, and PyTorch inference
2. **deploy.sh** - Deployment script for packaging model artifacts and uploading to S3
3. **requirements.txt** - Python dependencies for F5-TTS and audio processing
4. **models/** - Downloaded F5-TTS checkpoints from HuggingFace

## Quick Start

### Prerequisites

- AWS CLI configured with appropriate credentials
- Hugging Face CLI installed (`curl -LsSf https://hf.co/cli/install.sh | bash`)
- AWS account with SageMaker permissions

### 1. Package and Deploy Model

```bash
# Make deployment script executable
chmod +x deploy.sh

# Download F5-TTS model and upload to S3
./deploy.sh F5TTS_v1_Base
```

This script will:
1. Download F5-TTS model from HuggingFace (~5 minutes, 1.3GB)
2. Package model with inference code into `model.tar.gz`
3. Upload to S3: `s3://champion-recap-models-{account}/f5tts-pytorch/model.tar.gz`

### 2. Deploy SageMaker Endpoint via CDK

The SageMaker endpoint is defined in `aws-cdk/lib/champion-recap-stack.ts` and deployed automatically:

```bash
cd ../aws-cdk
cdk deploy
```

The CDK stack creates:
- SageMaker Model with PyTorch 2.1.0 GPU container
- Endpoint Configuration (ml.g4dn.xlarge with auto-scaling 1-4 instances)
- CloudWatch alarms for errors, latency, and GPU utilization

## Request/Response Format

### Input

```json
{
  "champion_id": "yasuo",
  "text": "Your skills are impressive, Summoner.",
  "voice_bucket": "champion-recap-voices-{account}",
  "duration": 10.0  // Optional, auto-calculated if not provided
}
```

### Output (JSON)

```json
{
  "audio": "UklGRiQAAABXQVZFZm10IBAAAAABAAEA...",  // Base64-encoded WAV
  "sample_rate": 24000,
  "duration": 3.5,
  "format": "wav"
}
```

### Output (audio/wav)

Set `Accept: audio/wav` header to receive raw WAV bytes instead of JSON.

## Model Architecture

**F5-TTS (Flow Matching Text-to-Speech)**
- Architecture: DiT (Diffusion Transformer)
- Sample Rate: 24kHz
- Vocoder: Vocos (mel-spectrogram to waveform)
- Zero-shot capability: Clones voice from single reference audio

**Performance:**
- RTF (Real-Time Factor): ~0.15
- Example: 10 seconds of audio generates in ~1.5 seconds
- Still faster than playback (real-time for streaming use cases)

## S3 Integration

### Champion Voice References

The inference script expects champion voice references in S3:

```
s3://champion-recap-voices-{account}/
  +-- champion-voices/
      +-- {champion_id}/
          +-- reference.wav   # Voice sample for cloning
          +-- reference.txt   # Transcription of reference audio
```

### Inference Flow

1. **Input Received**: Lambda/Bedrock sends request with `champion_id`
2. **Download Reference**: `inference.py` downloads reference audio from S3
3. **Preprocess Audio**: Resample to 24kHz, convert to mono, save to temp file
4. **F5-TTS Inference**: Generate audio using reference voice and target text
5. **Encode Response**: Convert numpy array to WAV, base64 encode, return JSON
6. **Cleanup**: Delete temporary files

## File Descriptions

### inference.py

SageMaker inference handler with four required functions:

- `model_fn(model_dir)` - Loads F5-TTS model and Vocos vocoder on endpoint startup
- `input_fn(request_body, content_type)` - Downloads champion voice from S3, preprocesses audio
- `predict_fn(data, model_components)` - Runs F5-TTS inference with file path
- `output_fn(prediction, accept)` - Returns base64-encoded WAV or raw bytes

**Key Implementation Details:**
- F5-TTS `infer_process()` expects `ref_audio` as **file path string**, not numpy array
- Uses `tempfile.NamedTemporaryFile` for reference audio with cleanup in finally block
- Parameter name is `fix_duration` (not `duration`) for F5-TTS API

### deploy.sh

Deployment automation script:

```bash
./deploy.sh [MODEL_NAME]
```

**Steps:**
1. Download model from HuggingFace using `hf download`
2. Copy checkpoint and vocab to packaging directory
3. Include inference.py and requirements.txt
4. Create model.tar.gz archive
5. Upload to S3 models bucket
6. Output S3 URI for CDK deployment

**Environment Variables:**
- `AWS_REGION` - AWS region (default: us-east-1)
- `AWS_ACCOUNT` - AWS account ID (auto-detected from `aws sts get-caller-identity`)

### requirements.txt

Python dependencies installed in SageMaker container:

```
f5-tts>=0.1.0           # F5-TTS core library
boto3>=1.28.0           # AWS SDK for S3
librosa>=0.10.0         # Audio processing
soundfile>=0.12.0       # WAV file I/O
jieba>=0.42.1           # Chinese text processing
pypinyin>=0.49.0        # Chinese phonetics
vocos>=0.1.0            # Vocoder
```

## Testing

### Local Testing (Python)

```python
import boto3
import json
import base64

client = boto3.client('sagemaker-runtime', region_name='us-east-1')

payload = {
    "champion_id": "yasuo",
    "text": "Your skills are impressive, Summoner.",
    "voice_bucket": "champion-recap-voices-637423316050"
}

response = client.invoke_endpoint(
    EndpointName='f5tts-voice-generator',
    ContentType='application/json',
    Body=json.dumps(payload)
)

result = json.loads(response['Body'].read())
audio_bytes = base64.b64decode(result['audio'])

with open('output.wav', 'wb') as f:
    f.write(audio_bytes)
```

### Integration Testing

The endpoint is used by:
1. **Bedrock Coaching Agent** - Generates voice observations during match analysis
2. **API Gateway Proxy Lambda** - Provides REST API for voice generation

## Cost Estimation

**SageMaker Endpoint (ml.g4dn.xlarge):**
- Hourly Rate: ~$0.736/hour
- Monthly (24/7): ~$530/month
- **Recommendation**: Use auto-scaling to scale to 0 instances during idle periods

**S3 Storage:**
- F5-TTS Model: ~1.3 GB (~$0.03/month)
- Champion Voices: ~500 MB (~$0.01/month)
- Generated Audio Cache: Variable

**Data Transfer:**
- S3 -> SageMaker: Free (same region)
- SageMaker -> Lambda: Free (same region)

## Monitoring

### CloudWatch Metrics

Automatically tracked:
- `Invocations` - Total endpoint calls
- `ModelLatency` - Inference time (ms)
- `ModelInvocation4XXErrors` - Client errors
- `ModelInvocation5XXErrors` - Server errors
- `GPUUtilization` - GPU usage percentage

### CloudWatch Alarms

Pre-configured alarms:
1. **High Error Rate** - Triggers if 4XX errors > 5% over 5 minutes
2. **High Latency** - Triggers if p99 latency > 10 seconds
3. **High GPU Utilization** - Triggers if GPU > 90% for 5 minutes

### Logs

View inference logs:
```bash
aws logs tail /aws/sagemaker/Endpoints/f5tts-voice-generator --follow
```

## References

- [F5-TTS GitHub](https://github.com/SWivid/F5-TTS)
- [AWS SageMaker PyTorch Containers](https://github.com/aws/deep-learning-containers/blob/master/available_images.md)
- [SageMaker Inference Toolkit](https://github.com/aws/sagemaker-inference-toolkit)
- [AWS PyTorch Inference Guide](https://docs.aws.amazon.com/sagemaker/latest/dg/pytorch.html)
