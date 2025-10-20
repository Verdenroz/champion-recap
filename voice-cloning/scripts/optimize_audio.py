#!/usr/bin/env python3
"""
Audio optimization script for Champion Recap.
Converts WAV files to MP3 with compression for smaller file sizes.
"""

import sys
from pathlib import Path
from typing import Optional

try:
    from pydub import AudioSegment
    from tqdm import tqdm
except ImportError as e:
    print("❌ Error importing dependencies!")
    print(f"   {e}")
    print("\nPlease install required packages:")
    print("   pip install pydub tqdm")
    print("\nNote: pydub requires ffmpeg to be installed:")
    print("   Ubuntu/Debian: sudo apt-get install ffmpeg")
    print("   MacOS: brew install ffmpeg")
    print("   Windows: Download from https://ffmpeg.org/download.html")
    sys.exit(1)

def optimize_audio_files(
    input_dir: str,
    output_dir: str,
    bitrate: str = "64k",
    copy_metadata: bool = True
):
    """
    Convert WAV files to MP3 with compression

    Args:
        input_dir: Directory containing WAV files
        output_dir: Directory to save MP3 files
        bitrate: MP3 bitrate (e.g., "64k", "128k")
        copy_metadata: Whether to copy metadata.json
    """
    input_path = Path(input_dir)
    output_path = Path(output_dir)

    if not input_path.exists():
        print(f"❌ Input directory not found: {input_path}")
        return

    # Find all WAV files
    wav_files = list(input_path.rglob("*.wav"))

    if not wav_files:
        print(f"❌ No WAV files found in {input_path}")
        return

    print(f"{'='*60}")
    print(f"Audio Optimization")
    print(f"{'='*60}")
    print(f"📁 Input: {input_path}")
    print(f"📁 Output: {output_path}")
    print(f"🎵 Bitrate: {bitrate}")
    print(f"📊 Files to convert: {len(wav_files)}")
    print(f"{'='*60}\n")

    # Track statistics
    total_input_size = 0
    total_output_size = 0
    converted_count = 0
    error_count = 0

    # Convert files
    for wav_file in tqdm(wav_files, desc="Converting to MP3"):
        try:
            # Load WAV
            audio = AudioSegment.from_wav(str(wav_file))

            # Create output path (preserve directory structure)
            relative_path = wav_file.relative_to(input_path)
            mp3_file = output_path / relative_path.with_suffix('.mp3')
            mp3_file.parent.mkdir(parents=True, exist_ok=True)

            # Export as MP3
            audio.export(
                str(mp3_file),
                format="mp3",
                bitrate=bitrate,
                parameters=["-ac", "1"]  # Force mono
            )

            # Track sizes
            input_size = wav_file.stat().st_size
            output_size = mp3_file.stat().st_size
            total_input_size += input_size
            total_output_size += output_size
            converted_count += 1

        except Exception as e:
            print(f"\n   ❌ Error converting {wav_file.name}: {e}")
            error_count += 1
            continue

    # Copy metadata.json if requested
    if copy_metadata:
        metadata_file = input_path / "metadata.json"
        if metadata_file.exists():
            output_metadata = output_path / "metadata.json"

            # Read and update file paths to .mp3
            import json
            with open(metadata_file) as f:
                metadata = json.load(f)

            # Update file extensions in metadata
            for champion_id, champion_data in metadata.items():
                if "files" in champion_data:
                    for file_info in champion_data["files"]:
                        if "file" in file_info:
                            file_info["file"] = file_info["file"].replace(".wav", ".mp3")

            # Save updated metadata
            with open(output_metadata, "w") as f:
                json.dump(metadata, f, indent=2)

            print(f"\n✅ Copied and updated metadata.json")

    # Calculate compression ratio
    if total_input_size > 0:
        compression_ratio = (1 - total_output_size / total_input_size) * 100
        avg_input_kb = (total_input_size / converted_count) / 1024 if converted_count > 0 else 0
        avg_output_kb = (total_output_size / converted_count) / 1024 if converted_count > 0 else 0
    else:
        compression_ratio = 0
        avg_input_kb = 0
        avg_output_kb = 0

    # Print summary
    print(f"\n{'='*60}")
    print(f"✅ Optimization complete!")
    print(f"{'='*60}")
    print(f"📊 Statistics:")
    print(f"   Converted: {converted_count} files")
    print(f"   Errors: {error_count} files")
    print(f"\n💾 File sizes:")
    print(f"   Before (WAV): {total_input_size / (1024**2):.2f} MB")
    print(f"   After (MP3):  {total_output_size / (1024**2):.2f} MB")
    print(f"   Savings:      {compression_ratio:.1f}%")
    print(f"\n📏 Average file size:")
    print(f"   WAV: {avg_input_kb:.1f} KB")
    print(f"   MP3: {avg_output_kb:.1f} KB")
    print(f"\n📁 Output directory: {output_path}")
    print(f"{'='*60}")
    print("\nNext steps:")
    print("1. Verify audio quality by listening to a few MP3 files")
    print("2. Upload to S3:")
    print(f"   python upload_to_s3.py --audio-dir {output_path} --bucket champion-recap-voices")
    print(f"{'='*60}")

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Optimize audio files by converting WAV to MP3",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Convert with default settings (64kbps)
  python optimize_audio.py

  # Custom input/output directories
  python optimize_audio.py \\
    --input-dir ../generated-audio \\
    --output-dir ../generated-audio-mp3

  # Higher quality (128kbps)
  python optimize_audio.py --bitrate 128k

  # Don't copy metadata.json
  python optimize_audio.py --no-metadata
        """
    )

    parser.add_argument(
        "--input-dir",
        default="../generated-audio",
        help="Input directory containing WAV files"
    )
    parser.add_argument(
        "--output-dir",
        default="../generated-audio-mp3",
        help="Output directory for MP3 files"
    )
    parser.add_argument(
        "--bitrate",
        default="64k",
        help="MP3 bitrate (e.g., 64k, 96k, 128k)"
    )
    parser.add_argument(
        "--no-metadata",
        action="store_true",
        help="Don't copy metadata.json"
    )

    args = parser.parse_args()

    try:
        optimize_audio_files(
            input_dir=args.input_dir,
            output_dir=args.output_dir,
            bitrate=args.bitrate,
            copy_metadata=not args.no_metadata
        )
    except KeyboardInterrupt:
        print("\n\n⚠️  Optimization interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
