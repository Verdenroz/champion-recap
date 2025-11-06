"""
SageMaker voice generator with S3 presigned URLs.

Handles:
- Invoking SageMaker F5-TTS PyTorch endpoint with retry logic
- Handling base64-encoded WAV audio from PyTorch inference
- Saving generated audio to S3
- Generating presigned URLs for frontend access
"""
import os
import json
import base64
import boto3
import hashlib
import time
import random
from typing import Dict, Any
from botocore.config import Config
from botocore.exceptions import ClientError

# Configure boto3 client with automatic retries
sagemaker_runtime = boto3.client(
    'sagemaker-runtime',
    config=Config(
        retries={
            'max_attempts': 3,
            'mode': 'adaptive'
        }
    )
)
s3_client = boto3.client('s3')

SAGEMAKER_ENDPOINT = os.environ['SAGEMAKER_ENDPOINT']
VOICE_BUCKET = os.environ['VOICE_BUCKET']


def generate_voice(
    champion_id: str,
    target_text: str,
    session_id: str
) -> Dict[str, Any]:
    """
    Generate voice using SageMaker F5-TTS endpoint.

    Args:
        champion_id: Champion ID for voice cloning
        target_text: Text to convert to speech
        session_id: Coaching session ID

    Returns:
        Dict with audio_url (presigned S3 URL) and metadata
    """
    # Create cache key based on champion and text
    text_hash = hashlib.md5(target_text.encode()).hexdigest()[:12]
    audio_key = f"generated/{champion_id}/{text_hash}.wav"

    # Check if audio already exists in S3 (cache hit)
    try:
        s3_client.head_object(Bucket=VOICE_BUCKET, Key=audio_key)
        print(f"Cache hit for {audio_key}")

        # Generate presigned URL (1 hour expiry)
        audio_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': VOICE_BUCKET, 'Key': audio_key},
            ExpiresIn=3600
        )

        return {
            'audio_url': audio_url,
            'champion_id': champion_id,
            'cache_hit': True
        }
    except s3_client.exceptions.ClientError:
        # Cache miss - generate new audio
        pass

    # Invoke SageMaker PyTorch endpoint
    # PyTorch endpoint expects simple JSON format (matches inference.py input_fn)
    payload = {
        "champion_id": champion_id,
        "text": target_text,
        "voice_bucket": VOICE_BUCKET
        # duration is optional - PyTorch endpoint auto-calculates if not provided
    }

    print(f"Invoking SageMaker PyTorch endpoint for {champion_id}: {target_text[:50]}...")

    # Invoke with exponential backoff for throttling/cold starts
    max_retries = 3
    response = None

    for attempt in range(max_retries):
        try:
            response = sagemaker_runtime.invoke_endpoint(
                EndpointName=SAGEMAKER_ENDPOINT,
                ContentType='application/json',
                Accept='application/json',  # Request JSON response with base64 audio
                Body=json.dumps(payload)
            )
            break  # Success - exit retry loop

        except ClientError as e:
            error_code = e.response['Error']['Code']

            # Retry on throttling or model loading errors
            if error_code in ['ThrottlingException', 'ModelError', 'ServiceUnavailable'] and attempt < max_retries - 1:
                wait_time = (2 ** attempt) + (random.randint(0, 1000) / 1000)
                print(f"Attempt {attempt + 1} failed ({error_code}), retrying in {wait_time:.2f}s...")
                time.sleep(wait_time)
            else:
                # Non-retryable error or max retries exceeded
                print(f"SageMaker invocation failed after {attempt + 1} attempts: {error_code}")
                raise

    if response is None:
        raise RuntimeError("Failed to invoke SageMaker endpoint after all retries")

    # Parse PyTorch response
    # PyTorch endpoint returns: { audio: base64, sample_rate: 24000, duration: X, format: "wav" }
    result = json.loads(response['Body'].read().decode())

    # Extract base64-encoded WAV audio
    if 'audio' not in result:
        raise ValueError(f"No 'audio' field in PyTorch response: {result}")

    audio_b64 = result['audio']
    sample_rate = result.get('sample_rate', 24000)
    duration = result.get('duration', 0)

    print(f"Generated audio: {duration:.2f} seconds at {sample_rate}Hz")

    # Decode base64 to WAV bytes
    audio_bytes = base64.b64decode(audio_b64)

    s3_client.put_object(
        Bucket=VOICE_BUCKET,
        Key=audio_key,
        Body=audio_bytes,
        ContentType='audio/wav'
    )

    print(f"Saved audio to s3://{VOICE_BUCKET}/{audio_key}")

    # Generate presigned URL (1 hour expiry)
    audio_url = s3_client.generate_presigned_url(
        'get_object',
        Params={'Bucket': VOICE_BUCKET, 'Key': audio_key},
        ExpiresIn=3600
    )

    return {
        'audio_url': audio_url,
        'champion_id': champion_id,
        'cache_hit': False
    }
