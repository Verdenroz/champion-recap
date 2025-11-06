"""
F5-TTS Inference Script for AWS SageMaker PyTorch Endpoint

This script handles loading F5-TTS model, processing champion voice inputs,
and generating TTS audio on SageMaker using standard PyTorch (no TensorRT).

Performance: RTF ~0.15 (real-time, 3-4x slower than TensorRT but much simpler)
"""

import json
import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Any
import io
import base64

import torch
import torchaudio
import boto3
import numpy as np

# Setup logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Import F5-TTS (installed via requirements.txt)
try:
    from f5_tts.infer.utils_infer import infer_process, load_vocoder, load_model
    from f5_tts.model import DiT, UNetT
except ImportError as e:
    logger.error(f"Failed to import F5-TTS: {e}")
    logger.error("Make sure f5-tts is installed: pip install f5-tts")
    raise

# S3 client for downloading champion voice references
s3_client = boto3.client('s3')

# Global model cache
_model = None
_vocoder = None
_device = None


def model_fn(model_dir: str):
    """
    Load F5-TTS model from SageMaker model directory.

    This function is called once when the endpoint starts.

    Args:
        model_dir: Directory containing model artifacts (downloaded from S3)

    Returns:
        dict: Model components (model, vocoder, device, etc.)
    """
    global _model, _vocoder, _device

    logger.info(f"Loading F5-TTS model from {model_dir}")

    # Determine device
    _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info(f"Using device: {_device}")

    # Load model checkpoint
    checkpoint_path = os.path.join(model_dir, "model.safetensors")
    vocab_path = os.path.join(model_dir, "vocab.txt")

    if not os.path.exists(checkpoint_path):
        raise FileNotFoundError(f"Model checkpoint not found: {checkpoint_path}")
    if not os.path.exists(vocab_path):
        raise FileNotFoundError(f"Vocab file not found: {vocab_path}")

    logger.info("Loading F5-TTS model...")
    _model = load_model(
        model_cls=DiT,  # F5TTS uses DiT architecture
        model_cfg=None,  # Use default config
        ckpt_path=checkpoint_path,
        vocab_file=vocab_path,
        device=_device
    )

    logger.info("Loading Vocos vocoder...")
    _vocoder = load_vocoder(
        is_local=False,  # Download from HuggingFace
        device=_device
    )

    logger.info("Model loaded successfully!")

    return {
        "model": _model,
        "vocoder": _vocoder,
        "device": _device,
        "sample_rate": 24000  # F5-TTS uses 24kHz
    }


def input_fn(request_body: bytes, content_type: str = "application/json") -> Dict[str, Any]:
    """
    Parse and preprocess input request.

    Expected input format:
    {
        "champion_id": "yasuo",
        "text": "Your skills are impressive, Summoner.",
        "voice_bucket": "champion-recap-voices-123456789",
        "duration": 10.0  // optional, auto-calculated if not provided
    }

    Args:
        request_body: Raw request bytes
        content_type: Content type (application/json)

    Returns:
        dict: Preprocessed inputs ready for inference
    """
    if content_type != "application/json":
        raise ValueError(f"Unsupported content type: {content_type}")

    try:
        input_data = json.loads(request_body.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}")

    # Validate required fields
    required_fields = ["champion_id", "text", "voice_bucket"]
    for field in required_fields:
        if field not in input_data:
            raise ValueError(f"Missing required field: {field}")

    champion_id = input_data["champion_id"]
    text = input_data["text"]
    voice_bucket = input_data["voice_bucket"]
    duration = input_data.get("duration")  # Optional

    logger.info(f"Processing request for champion: {champion_id}, text length: {len(text)}")

    # Download champion reference voice from S3
    ref_audio_key = f"champion-voices/{champion_id}/reference.wav"
    ref_text_key = f"champion-voices/{champion_id}/reference.txt"

    try:
        # Download reference audio
        ref_audio_obj = s3_client.get_object(Bucket=voice_bucket, Key=ref_audio_key)
        ref_audio_bytes = ref_audio_obj['Body'].read()

        # Download reference text
        ref_text_obj = s3_client.get_object(Bucket=voice_bucket, Key=ref_text_key)
        ref_text = ref_text_obj['Body'].read().decode('utf-8').strip()

        logger.info(f"Downloaded reference voice for {champion_id}")

    except Exception as e:
        raise RuntimeError(f"Failed to download champion voice from S3: {e}")

    # Load reference audio with torchaudio
    ref_audio, ref_sr = torchaudio.load(io.BytesIO(ref_audio_bytes))

    # Resample to 24kHz if needed
    if ref_sr != 24000:
        resampler = torchaudio.transforms.Resample(ref_sr, 24000)
        ref_audio = resampler(ref_audio)

    # Convert to mono if stereo
    if ref_audio.shape[0] > 1:
        ref_audio = ref_audio.mean(dim=0, keepdim=True)

    # Save to temporary file (F5-TTS infer_process expects file path, not array)
    temp_ref_audio = tempfile.NamedTemporaryFile(suffix='.wav', delete=False, mode='wb')
    try:
        torchaudio.save(temp_ref_audio.name, ref_audio, 24000, format='wav')
        temp_ref_audio.close()
        logger.info(f"Saved reference audio to temporary file: {temp_ref_audio.name}")
    except Exception as e:
        logger.error(f"Failed to save reference audio: {e}")
        raise

    return {
        "ref_audio_path": temp_ref_audio.name,  # File path for infer_process
        "ref_text": ref_text,
        "gen_text": text,
        "fix_duration": duration,  # F5-TTS uses fix_duration parameter
        "champion_id": champion_id
    }


def predict_fn(data: Dict[str, Any], model_components: Dict) -> np.ndarray:
    """
    Run F5-TTS inference to generate audio.

    Args:
        data: Preprocessed input from input_fn
        model_components: Model components from model_fn

    Returns:
        np.ndarray: Generated audio waveform
    """
    model = model_components["model"]
    vocoder = model_components["vocoder"]
    device = model_components["device"]

    ref_audio_path = data["ref_audio_path"]  # File path (not numpy array)
    ref_text = data["ref_text"]
    gen_text = data["gen_text"]
    fix_duration = data.get("fix_duration")  # F5-TTS parameter name
    champion_id = data["champion_id"]

    logger.info(f"Generating audio for {champion_id}: '{gen_text[:50]}...'")

    try:
        # Run F5-TTS inference
        # infer_process expects ref_audio as file path string
        # Returns: (generated_waveform, sample_rate, spectrogram)
        generated_audio, sr, _ = infer_process(
            ref_audio=ref_audio_path,  # File path string
            ref_text=ref_text,
            gen_text=gen_text,
            model_obj=model,
            vocoder=vocoder,
            device=device,
            fix_duration=fix_duration,  # Auto-calculated if None
            speed=1.0
        )

        logger.info(f"Audio generation complete. Duration: {len(generated_audio)/sr:.2f}s")

        return generated_audio  # numpy array

    except Exception as e:
        logger.error(f"Inference failed: {e}", exc_info=True)
        raise RuntimeError(f"F5-TTS inference failed: {e}")
    finally:
        # Clean up temporary reference audio file
        try:
            if os.path.exists(ref_audio_path):
                os.unlink(ref_audio_path)
                logger.info(f"Cleaned up temporary file: {ref_audio_path}")
        except Exception as cleanup_error:
            logger.warning(f"Failed to clean up temporary file: {cleanup_error}")


def output_fn(prediction: np.ndarray, accept: str = "application/json") -> bytes:
    """
    Format output for response.

    Returns audio as base64-encoded WAV in JSON, or raw audio bytes.

    Args:
        prediction: Generated audio waveform (numpy array)
        accept: Requested response format

    Returns:
        bytes: Response body
    """
    sample_rate = 24000

    if accept == "audio/wav":
        # Return raw WAV bytes
        audio_tensor = torch.from_numpy(prediction).float().unsqueeze(0)  # [1, T]

        # Save to bytes buffer
        buffer = io.BytesIO()
        torchaudio.save(buffer, audio_tensor, sample_rate, format="wav")
        buffer.seek(0)

        return buffer.read()

    else:  # Default: application/json
        # Return base64-encoded WAV in JSON
        audio_tensor = torch.from_numpy(prediction).float().unsqueeze(0)  # [1, T]

        # Save to bytes buffer
        buffer = io.BytesIO()
        torchaudio.save(buffer, audio_tensor, sample_rate, format="wav")
        buffer.seek(0)

        # Base64 encode
        audio_b64 = base64.b64encode(buffer.read()).decode('utf-8')

        response = {
            "audio": audio_b64,
            "sample_rate": sample_rate,
            "duration": len(prediction) / sample_rate,
            "format": "wav"
        }

        return json.dumps(response).encode('utf-8')
