#!/usr/bin/env python3
"""
Upload champion voice references to S3 bucket for Triton Inference Server.

This script uploads reference.wav, reference.txt, and metadata.json files
from champion-audio-crawler/output/ to S3 for use by the SageMaker endpoint.

Usage:
    python upload_voices_to_s3.py --bucket champion-recap-voices [--dry-run]
"""
import argparse
import json
import sys
from pathlib import Path

import boto3
from botocore.exceptions import ClientError


def upload_champion_voices(bucket_name: str, source_dir: Path, dry_run: bool = False):
    """Upload champion voices to S3."""
    if not source_dir.exists():
        print(f"Error: Source directory not found: {source_dir}")
        sys.exit(1)

    s3_client = boto3.client('s3')

    # Verify bucket exists
    try:
        s3_client.head_bucket(Bucket=bucket_name)
        print(f"✓ S3 bucket '{bucket_name}' is accessible")
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == '404':
            print(f"Error: S3 bucket '{bucket_name}' does not exist")
        else:
            print(f"Error accessing bucket '{bucket_name}': {e}")
        sys.exit(1)

    # Get all champion directories
    champion_dirs = [d for d in source_dir.iterdir() if d.is_dir()]
    print(f"\nFound {len(champion_dirs)} champion directories")

    uploaded = 0
    skipped = 0
    errors = 0

    for champion_dir in sorted(champion_dirs):
        champion_id = champion_dir.name
        s3_prefix = f"champion-voices/{champion_id}"

        # Files to upload
        files_to_upload = {
            'reference.wav': f"{s3_prefix}/reference.wav",
            'reference.txt': f"{s3_prefix}/reference.txt",
            'metadata.json': f"{s3_prefix}/metadata.json",
        }

        print(f"\n{champion_id}:")

        for local_file, s3_key in files_to_upload.items():
            local_path = champion_dir / local_file

            if not local_path.exists():
                print(f"  ⚠ {local_file} not found, skipping")
                skipped += 1
                continue

            if dry_run:
                print(f"  [DRY RUN] Would upload: {local_file} → s3://{bucket_name}/{s3_key}")
                continue

            try:
                # Upload with metadata
                extra_args = {}
                if local_file.endswith('.wav'):
                    extra_args['ContentType'] = 'audio/wav'
                elif local_file.endswith('.txt'):
                    extra_args['ContentType'] = 'text/plain'
                elif local_file.endswith('.json'):
                    extra_args['ContentType'] = 'application/json'

                s3_client.upload_file(
                    str(local_path),
                    bucket_name,
                    s3_key,
                    ExtraArgs=extra_args
                )

                file_size = local_path.stat().st_size
                print(f"  ✓ Uploaded {local_file} ({file_size:,} bytes)")
                uploaded += 1

            except ClientError as e:
                print(f"  ✗ Error uploading {local_file}: {e}")
                errors += 1

    # Print summary
    print("\n" + "=" * 60)
    print(f"Upload Summary:")
    print(f"  Champions processed: {len(champion_dirs)}")
    print(f"  Files uploaded: {uploaded}")
    print(f"  Files skipped: {skipped}")
    print(f"  Errors: {errors}")

    if dry_run:
        print(f"\n  (This was a DRY RUN - no files were actually uploaded)")

    return errors == 0


def main():
    parser = argparse.ArgumentParser(
        description="Upload champion voice references to S3 for SageMaker Triton endpoint"
    )
    parser.add_argument(
        '--bucket',
        default='champion-recap-voices',
        help='S3 bucket name (default: champion-recap-voices)'
    )
    parser.add_argument(
        '--source-dir',
        type=Path,
        default=Path(__file__).parent.parent.parent / 'champion-audio-crawler' / 'output',
        help='Source directory containing champion voices (default: ../champion-audio-crawler/output/)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be uploaded without actually uploading'
    )

    args = parser.parse_args()

    print("=" * 60)
    print("Champion Voice S3 Upload Script")
    print("=" * 60)
    print(f"Source directory: {args.source_dir}")
    print(f"S3 bucket: {args.bucket}")
    print(f"Dry run: {args.dry_run}")

    success = upload_champion_voices(args.bucket, args.source_dir, args.dry_run)
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
