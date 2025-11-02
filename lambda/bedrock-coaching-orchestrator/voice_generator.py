"""
SageMaker voice generator with S3 presigned URLs.

Handles:
- Invoking SageMaker F5-TTS Triton endpoint
- Converting Triton float32 waveform to WAV format
- Saving generated audio to S3
- Generating presigned URLs for frontend access
"""
import os
import json
import io
import boto3
import hashlib
import numpy as np
import soundfile as sf
from typing import Dict, Any

sagemaker_runtime = boto3.client('sagemaker-runtime')
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

    # Invoke SageMaker Triton endpoint
    payload = {
        "inputs": [
            {
                "name": "champion_id",
                "shape": [1],
                "datatype": "TYPE_STRING",
                "data": [champion_id]
            },
            {
                "name": "target_text",
                "shape": [1],
                "datatype": "TYPE_STRING",
                "data": [target_text]
            }
        ]
    }

    print(f"Invoking SageMaker Triton endpoint for {champion_id}: {target_text[:50]}...")

    response = sagemaker_runtime.invoke_endpoint(
        EndpointName=SAGEMAKER_ENDPOINT,
        ContentType='application/json',
        Body=json.dumps(payload)
    )

    # Parse Triton response
    result = json.loads(response['Body'].read().decode())

    # Extract float32 waveform from Triton response
    if 'outputs' not in result or len(result['outputs']) == 0:
        raise ValueError(f"No outputs in Triton response: {result}")

    output = result['outputs'][0]
    if output['name'] != 'waveform':
        raise ValueError(f"Expected 'waveform' output, got: {output['name']}")

    # Convert float32 array to numpy array
    waveform = np.array(output['data'], dtype=np.float32)

    print(f"Generated waveform: {len(waveform)} samples ({len(waveform)/24000:.2f} seconds)")

    # Convert waveform to WAV bytes
    wav_buffer = io.BytesIO()
    sf.write(wav_buffer, waveform, 24000, format='WAV', subtype='PCM_16')
    audio_bytes = wav_buffer.getvalue()

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
