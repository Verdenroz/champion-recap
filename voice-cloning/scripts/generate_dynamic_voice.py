#!/usr/bin/env python3
"""
Dynamic voice generation script for Champion Recap.
Generates champion voice from ANY arbitrary text using F5-TTS.
"""

import json
import sys
from pathlib import Path
from typing import Optional

try:
    from f5_tts.api import F5TTS
    import soundfile as sf
except ImportError as e:
    print("❌ Error importing dependencies!")
    print(f"   {e}")
    print("\nPlease install required packages:")
    print("   pip install git+https://github.com/SWivid/F5-TTS.git")
    print("   pip install soundfile")
    sys.exit(1)

class DynamicVoiceGenerator:
    """Generate champion voice from arbitrary text dynamically"""

    def __init__(self, champions_dir: str, personalities_file: str):
        self.champions_dir = Path(champions_dir)
        self.personalities_file = Path(personalities_file)

        # Load champion personalities
        if self.personalities_file.exists():
            with open(self.personalities_file) as f:
                config = json.load(f)
                self.personalities = config.get("championPersonalities", {})
                self.voice_config = config.get("voice_generation_config", {})
        else:
            print(f"⚠️  Warning: Personalities file not found at {self.personalities_file}")
            self.personalities = {}
            self.voice_config = {}

        # Initialize F5-TTS model
        print("🔧 Loading F5-TTS model...")
        self.model = F5TTS()
        print("✅ Model loaded successfully!")

    def get_champion_reference(self, champion_id: str) -> Optional[dict]:
        """Get reference audio and text for a champion"""
        champ_dir = self.champions_dir / champion_id
        ref_audio = champ_dir / "reference.wav"
        ref_text_file = champ_dir / "reference.txt"

        if not ref_audio.exists():
            print(f"❌ Reference audio not found: {ref_audio}")
            return None

        if not ref_text_file.exists():
            print(f"❌ Reference text not found: {ref_text_file}")
            return None

        with open(ref_text_file) as f:
            ref_text = f.read().strip()

        return {
            "audio_path": str(ref_audio),
            "ref_text": ref_text,
            "champion_id": champion_id
        }

    def validate_text(self, text: str) -> bool:
        """Validate generation text meets requirements"""
        min_length = self.voice_config.get("min_text_length", 20)
        max_length = self.voice_config.get("max_text_length", 200)

        if len(text) < min_length:
            print(f"⚠️  Text too short (min {min_length} characters)")
            return False

        if len(text) > max_length:
            print(f"⚠️  Text too long (max {max_length} characters, got {len(text)})")
            print("    Consider splitting into multiple generations")
            return False

        return True

    def generate(
        self,
        champion_id: str,
        generation_text: str,
        output_file: str,
        remove_silence: bool = True
    ) -> Optional[str]:
        """
        Generate voice audio for arbitrary text

        Args:
            champion_id: Champion to use (e.g., 'yasuo', 'ahri')
            generation_text: Text to generate voice for (any text!)
            output_file: Where to save the audio
            remove_silence: Whether to remove silence from output

        Returns:
            Path to generated audio file, or None on error
        """
        # Get champion personality info (optional, for display)
        personality = self.personalities.get(champion_id, {})
        champion_name = personality.get("name", champion_id.title())

        print(f"\n{'='*60}")
        print(f"Dynamic Voice Generation")
        print(f"{'='*60}")
        print(f"🎤 Champion: {champion_name}")
        print(f"📝 Text to generate ({len(generation_text)} chars):")
        print(f"   {generation_text}")
        print(f"{'='*60}\n")

        # Validate text
        if not self.validate_text(generation_text):
            return None

        # Get reference audio
        reference = self.get_champion_reference(champion_id)
        if not reference:
            return None

        try:
            print("🎙️  Generating audio...")

            # Prepare output path
            output_path = Path(output_file)
            output_path.parent.mkdir(parents=True, exist_ok=True)

            # Generate audio with F5-TTS
            # Returns: (wav_array, sample_rate, spectrogram)
            wav, sr, spec = self.model.infer(
                ref_file=reference["audio_path"],
                ref_text=reference["ref_text"],
                gen_text=generation_text,
                file_wave=str(output_path),
                remove_silence=remove_silence
            )

            duration = len(wav) / sr
            file_size = output_path.stat().st_size / 1024

            print(f"\n✅ Generation complete!")
            print(f"📊 Duration: {duration:.2f}s")
            print(f"📊 Sample rate: {sr} Hz")
            print(f"📏 File size: {file_size:.1f} KB")
            print(f"💾 Saved to: {output_path}")

            return str(output_path)

        except Exception as e:
            print(f"\n❌ Error during generation: {e}")
            import traceback
            traceback.print_exc()
            return None

    def generate_batch(
        self,
        champion_id: str,
        texts: list[str],
        output_dir: str,
        prefix: str = "dynamic"
    ) -> list[str]:
        """
        Generate multiple voice clips for a champion

        Args:
            champion_id: Champion to use
            texts: List of texts to generate
            output_dir: Directory to save audio files
            prefix: Prefix for output filenames

        Returns:
            List of paths to generated audio files
        """
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        generated_files = []

        print(f"\n{'='*60}")
        print(f"Batch Dynamic Voice Generation")
        print(f"{'='*60}")
        print(f"🎤 Champion: {champion_id}")
        print(f"📊 Texts to generate: {len(texts)}")
        print(f"{'='*60}\n")

        for idx, text in enumerate(texts, 1):
            output_file = output_path / f"{prefix}_{idx}.wav"

            print(f"\n[{idx}/{len(texts)}] Generating...")
            result = self.generate(
                champion_id=champion_id,
                generation_text=text,
                output_file=str(output_file)
            )

            if result:
                generated_files.append(result)
            else:
                print(f"⚠️  Skipping failed generation")

        print(f"\n{'='*60}")
        print(f"✅ Batch generation complete!")
        print(f"📊 Successfully generated: {len(generated_files)}/{len(texts)} files")
        print(f"{'='*60}")

        return generated_files

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Generate champion voice from arbitrary text dynamically",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate single voice line
  python generate_dynamic_voice.py \\
    --champion yasuo \\
    --text "You played well, Summoner. Your dedication to Yasuo shows in your 67 percent win rate." \\
    --output ../test_dynamic_yasuo.wav

  # Generate from file
  python generate_dynamic_voice.py \\
    --champion ahri \\
    --text-file coaching_text.txt \\
    --output ../ahri_coaching.wav

  # Batch generation
  python generate_dynamic_voice.py \\
    --champion zed \\
    --batch-file coaching_lines.json \\
    --output-dir ../dynamic_audio/zed

Features:
  - Works with ANY text (not limited to presets!)
  - Maintains champion personality/voice
  - Real-time generation (~1-5s on GPU)
  - Validates text length automatically
        """
    )

    parser.add_argument(
        "--champion",
        required=True,
        help="Champion ID (e.g., yasuo, ahri, zed)"
    )
    parser.add_argument(
        "--text",
        help="Text to generate voice for"
    )
    parser.add_argument(
        "--text-file",
        help="File containing text to generate (alternative to --text)"
    )
    parser.add_argument(
        "--batch-file",
        help="JSON file with array of texts for batch generation"
    )
    parser.add_argument(
        "--output",
        help="Output file path (for single generation)"
    )
    parser.add_argument(
        "--output-dir",
        help="Output directory (for batch generation)"
    )
    parser.add_argument(
        "--champions-dir",
        default="../champion-voices",
        help="Directory with champion voice samples"
    )
    parser.add_argument(
        "--personalities",
        default="../champion-personalities.json",
        help="Champion personalities config file"
    )
    parser.add_argument(
        "--keep-silence",
        action="store_true",
        help="Don't remove silence from output"
    )

    args = parser.parse_args()

    # Validate arguments
    if not any([args.text, args.text_file, args.batch_file]):
        parser.error("Must provide --text, --text-file, or --batch-file")

    if args.batch_file and not args.output_dir:
        parser.error("--batch-file requires --output-dir")

    if (args.text or args.text_file) and not args.output:
        parser.error("--text or --text-file requires --output")

    # Initialize generator
    try:
        generator = DynamicVoiceGenerator(
            champions_dir=args.champions_dir,
            personalities_file=args.personalities
        )

        # Single generation
        if args.text or args.text_file:
            if args.text_file:
                with open(args.text_file) as f:
                    text = f.read().strip()
            else:
                text = args.text

            result = generator.generate(
                champion_id=args.champion,
                generation_text=text,
                output_file=args.output,
                remove_silence=not args.keep_silence
            )

            if result:
                print(f"\n✅ Success! Play the audio:")
                print(f"   {result}")
                sys.exit(0)
            else:
                sys.exit(1)

        # Batch generation
        elif args.batch_file:
            with open(args.batch_file) as f:
                texts = json.load(f)

            if not isinstance(texts, list):
                print("❌ Batch file must contain a JSON array of strings")
                sys.exit(1)

            results = generator.generate_batch(
                champion_id=args.champion,
                texts=texts,
                output_dir=args.output_dir,
                prefix=args.champion
            )

            if results:
                print(f"\n✅ Success! Generated {len(results)} files")
                sys.exit(0)
            else:
                sys.exit(1)

    except KeyboardInterrupt:
        print("\n\n⚠️  Generation interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
