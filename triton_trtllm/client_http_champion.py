#!/usr/bin/env python3
"""
Champion-based HTTP client for F5-TTS Triton Inference Server.

This client uses champion_id to automatically load voice references from S3,
instead of manually providing reference audio files.

Usage:
    python client_http_champion.py --champion-id yasuo --target-text "Your skills are impressive"
"""
import argparse
import json
import os

import numpy as np
import requests
import soundfile as sf


def get_args():
    parser = argparse.ArgumentParser(
        description="Champion-based F5-TTS voice generation client",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )

    parser.add_argument(
        "--server-url",
        type=str,
        default="localhost:8000",
        help="Address of the Triton server"
    )

    parser.add_argument(
        "--champion-id",
        type=str,
        required=True,
        help="Champion ID (e.g., yasuo, ahri, jinx)"
    )

    parser.add_argument(
        "--target-text",
        type=str,
        required=True,
        help="Text to generate voice for"
    )

    parser.add_argument(
        "--model-name",
        type=str,
        default="f5_tts",
        help="Triton model name"
    )

    parser.add_argument(
        "--output-audio",
        type=str,
        default=None,
        help="Path to save the output audio (default: {champion_id}_output.wav)"
    )

    return parser.parse_args()


def prepare_request(champion_id: str, target_text: str):
    """
    Prepare Triton inference request using champion_id.

    The champion voice (reference.wav + reference.txt) will be loaded
    automatically from S3 by the Triton model.
    """
    data = {
        "inputs": [
            {
                "name": "champion_id",
                "shape": [1, 1],
                "datatype": "BYTES",
                "data": [champion_id]
            },
            {
                "name": "target_text",
                "shape": [1, 1],
                "datatype": "BYTES",
                "data": [target_text]
            }
        ]
    }

    return data


def main():
    args = get_args()

    # Default output filename
    if args.output_audio is None:
        args.output_audio = f"{args.champion_id}_output.wav"

    server_url = args.server_url
    if not server_url.startswith(("http://", "https://")):
        server_url = f"http://{server_url}"

    url = f"{server_url}/v2/models/{args.model_name}/infer"

    print("=" * 60)
    print("F5-TTS Champion Voice Generation")
    print("=" * 60)
    print(f"Champion ID: {args.champion_id}")
    print(f"Target text: {args.target_text}")
    print(f"Server: {server_url}")
    print(f"Output: {args.output_audio}")
    print("=" * 60)

    # Prepare request
    data = prepare_request(args.champion_id, args.target_text)

    print("\nSending request to Triton server...")
    print(f"Request payload: {json.dumps(data, indent=2)}")

    # Send request
    try:
        response = requests.post(
            url,
            headers={"Content-Type": "application/json"},
            json=data,
            verify=False,
            params={"request_id": "0"}
        )

        response.raise_for_status()

        # Parse response
        result = response.json()

        # Extract waveform from Triton response
        if "outputs" not in result or len(result["outputs"]) == 0:
            print(f"Error: No outputs in response: {result}")
            return 1

        output = result["outputs"][0]
        if output["name"] != "waveform":
            print(f"Error: Expected 'waveform' output, got: {output['name']}")
            return 1

        # Convert to numpy array
        audio = np.array(output["data"], dtype=np.float32)

        print(f"\nReceived waveform: {len(audio)} samples ({len(audio)/24000:.2f} seconds)")

        # Save as WAV file
        os.makedirs(os.path.dirname(os.path.abspath(args.output_audio)) if os.path.dirname(args.output_audio) else ".", exist_ok=True)
        sf.write(args.output_audio, audio, 24000, "PCM_16")

        print(f"✓ Saved audio to: {args.output_audio}")
        print("\nSuccess!")

        return 0

    except requests.exceptions.RequestException as e:
        print(f"✗ Error sending request: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response: {e.response.text}")
        return 1
    except Exception as e:
        print(f"✗ Error: {e}")
        return 1


if __name__ == "__main__":
    exit(main())
