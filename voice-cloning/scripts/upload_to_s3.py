#!/usr/bin/env python3
"""
S3 upload script for Champion Recap voice files.
Uploads generated audio files to AWS S3 with proper caching headers.
"""

import sys
from pathlib import Path
from typing import Optional

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
    from tqdm import tqdm
except ImportError as e:
    print("❌ Error importing dependencies!")
    print(f"   {e}")
    print("\nPlease install required packages:")
    print("   pip install boto3 tqdm")
    sys.exit(1)

class VoiceUploader:
    """Upload voice files to S3"""

    def __init__(self, audio_dir: str, bucket_name: str, region: str = 'us-east-1'):
        self.audio_dir = Path(audio_dir)
        self.bucket_name = bucket_name
        self.region = region

        # Initialize S3 client
        try:
            self.s3 = boto3.client('s3', region_name=region)
            print(f"✅ Connected to AWS (region: {region})")
        except NoCredentialsError:
            print("❌ AWS credentials not found!")
            print("\nPlease configure AWS credentials:")
            print("   aws configure")
            print("\nOr set environment variables:")
            print("   export AWS_ACCESS_KEY_ID=your_key_id")
            print("   export AWS_SECRET_ACCESS_KEY=your_secret_key")
            sys.exit(1)

    def verify_bucket_exists(self) -> bool:
        """Check if S3 bucket exists"""
        try:
            self.s3.head_bucket(Bucket=self.bucket_name)
            return True
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == '404':
                print(f"❌ Bucket '{self.bucket_name}' not found!")
                print("\nPlease create the bucket first:")
                print(f"   aws s3 mb s3://{self.bucket_name} --region {self.region}")
                print("\nOr deploy the CDK stack which creates the bucket:")
                print("   cd aws-cdk && make deploy")
            elif error_code == '403':
                print(f"❌ Access denied to bucket '{self.bucket_name}'")
                print("\nCheck your AWS permissions")
            else:
                print(f"❌ Error accessing bucket: {e}")
            return False

    def upload_all(self):
        """Upload all audio files to S3"""
        if not self.audio_dir.exists():
            print(f"❌ Audio directory not found: {self.audio_dir}")
            return

        # Verify bucket exists
        if not self.verify_bucket_exists():
            return

        # Find all audio files (MP3 and WAV)
        audio_files = list(self.audio_dir.rglob("*.mp3")) + list(self.audio_dir.rglob("*.wav"))
        metadata_file = self.audio_dir / "metadata.json"

        if not audio_files and not metadata_file.exists():
            print(f"❌ No audio files or metadata found in {self.audio_dir}")
            return

        print(f"\n{'='*60}")
        print(f"S3 Upload")
        print(f"{'='*60}")
        print(f"📁 Local directory: {self.audio_dir}")
        print(f"☁️  S3 bucket: s3://{self.bucket_name}")
        print(f"🌍 Region: {self.region}")
        print(f"📊 Files to upload: {len(audio_files) + (1 if metadata_file.exists() else 0)}")
        print(f"{'='*60}\n")

        uploaded_count = 0
        error_count = 0
        total_size = 0

        # Upload audio files
        for audio_file in tqdm(audio_files, desc="Uploading audio"):
            try:
                # Get relative path for S3 key
                relative_path = audio_file.relative_to(self.audio_dir)
                s3_key = f"voices/{relative_path}"

                # Determine content type
                content_type = "audio/mpeg" if audio_file.suffix == ".mp3" else "audio/wav"

                # Upload with metadata
                self.s3.upload_file(
                    str(audio_file),
                    self.bucket_name,
                    str(s3_key),
                    ExtraArgs={
                        'ContentType': content_type,
                        'CacheControl': 'public, max-age=31536000',  # 1 year cache
                        'ACL': 'public-read'  # Make publicly readable
                    }
                )

                file_size = audio_file.stat().st_size
                total_size += file_size
                uploaded_count += 1

            except Exception as e:
                print(f"\n   ❌ Error uploading {audio_file.name}: {e}")
                error_count += 1
                continue

        # Upload metadata.json
        if metadata_file.exists():
            try:
                self.s3.upload_file(
                    str(metadata_file),
                    self.bucket_name,
                    "voices/metadata.json",
                    ExtraArgs={
                        'ContentType': 'application/json',
                        'CacheControl': 'public, max-age=3600',  # 1 hour cache
                        'ACL': 'public-read'
                    }
                )
                print(f"\n✅ Uploaded metadata.json")
                uploaded_count += 1
            except Exception as e:
                print(f"\n❌ Error uploading metadata.json: {e}")
                error_count += 1

        # Get bucket location
        try:
            location = self.s3.get_bucket_location(Bucket=self.bucket_name)
            bucket_region = location['LocationConstraint'] or 'us-east-1'
            s3_url = f"https://{self.bucket_name}.s3.{bucket_region}.amazonaws.com/voices/"
        except:
            s3_url = f"https://{self.bucket_name}.s3.amazonaws.com/voices/"

        # Print summary
        print(f"\n{'='*60}")
        print(f"✅ Upload complete!")
        print(f"{'='*60}")
        print(f"📊 Statistics:")
        print(f"   Uploaded: {uploaded_count} files")
        print(f"   Errors: {error_count} files")
        print(f"   Total size: {total_size / (1024**2):.2f} MB")
        print(f"\n🌐 Access URLs:")
        print(f"   S3: {s3_url}")
        print(f"   Metadata: {s3_url}metadata.json")
        print(f"\n💡 Tips:")
        print(f"   - Files are cached for 1 year (audio) / 1 hour (metadata)")
        print(f"   - Use CloudFront for better performance and lower costs")
        print(f"   - Update API_BASE_URL in your frontend to point to S3 or CloudFront")
        print(f"{'='*60}")
        print("\nNext steps:")
        print("1. Verify files are accessible:")
        print(f"   curl {s3_url}metadata.json")
        print("2. Set up CloudFront distribution (optional but recommended)")
        print("3. Update frontend environment variables:")
        print(f"   VOICE_CDN_URL={s3_url}")
        print(f"{'='*60}")

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Upload champion voice files to AWS S3",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Upload to default bucket
  python upload_to_s3.py \\
    --audio-dir ../generated-audio-mp3 \\
    --bucket champion-recap-voices

  # Specify region
  python upload_to_s3.py \\
    --audio-dir ../generated-audio-mp3 \\
    --bucket champion-recap-voices \\
    --region us-west-2

Prerequisites:
  1. AWS credentials configured (aws configure)
  2. S3 bucket created
  3. IAM permissions: s3:PutObject, s3:GetObject
        """
    )

    parser.add_argument(
        "--audio-dir",
        required=True,
        help="Directory containing audio files to upload"
    )
    parser.add_argument(
        "--bucket",
        required=True,
        help="S3 bucket name"
    )
    parser.add_argument(
        "--region",
        default="us-east-1",
        help="AWS region (default: us-east-1)"
    )

    args = parser.parse_args()

    try:
        uploader = VoiceUploader(
            audio_dir=args.audio_dir,
            bucket_name=args.bucket,
            region=args.region
        )

        uploader.upload_all()

    except KeyboardInterrupt:
        print("\n\n⚠️  Upload interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
