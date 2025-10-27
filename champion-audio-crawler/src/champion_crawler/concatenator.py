"""Audio dataset creation for voice cloning."""

from pathlib import Path
from typing import List, Optional
import csv
import shutil

import librosa
from rich.console import Console

from .models import ChampionMetadata, ChampionCheckpoint, ChampionStatus, AudioFile
from .state_manager import StateManager

console = Console()


def is_valid_transcript(transcript: Optional[str]) -> bool:
    """
    Check if transcript is valid (not empty or placeholder).

    Args:
        transcript: Transcript text to validate

    Returns:
        True if transcript is valid, False if empty/placeholder
    """
    if not transcript:
        return False
    transcript_clean = transcript.strip()
    return transcript_clean and transcript_clean != '[]'


def get_audio_duration(audio_path: Path, sample_rate: int = 22050) -> float:
    """
    Get audio duration in seconds.

    Args:
        audio_path: Path to audio file
        sample_rate: Target sample rate for loading

    Returns:
        Duration in seconds
    """
    audio, sr = librosa.load(str(audio_path), sr=sample_rate, mono=True)
    return len(audio) / sr


class AudioConcatenator:
    """Creates datasets with individual audio files and metadata for voice cloning."""

    def __init__(
        self,
        state_manager: StateManager,
        sample_rate: int = 22050,
    ):
        self.state = state_manager
        self.sample_rate = sample_rate

    def _extract_quoted_text(self, text: str) -> str:
        """
        Extract only text within quotation marks from transcript.

        This removes sound effect descriptions and narrator text, keeping only
        the actual spoken dialogue.

        Example:
            Input:  'Come!" Aatrox grunts. "Destiny awaits!'
            Output: 'Come! Destiny awaits!'

        Args:
            text: Raw transcript text with possible sound effects and narration

        Returns:
            Only the quoted dialogue parts, joined with spaces
        """
        import re

        # Find all text within double quotes
        double_quoted = re.findall(r'"([^"]*)"', text)

        # Find all text within single quotes (fallback)
        single_quoted = re.findall(r"'([^']*)'", text)

        # Prefer double quotes, fallback to single quotes
        quoted_parts = double_quoted if double_quoted else single_quoted

        if quoted_parts:
            # Join all quoted parts with a space
            return ' '.join(quoted_parts).strip()

        # If no quotes found, return original (shouldn't happen with our filters)
        return text

    def create_metadata_json(
        self,
        champion_id: str,
        champion_name: str,
        total_clips: int,
        total_duration: float,
        output_path: Path,
    ) -> Path:
        """
        Create metadata.json file.

        Args:
            champion_id: Champion identifier
            champion_name: Champion display name
            total_clips: Number of audio clips
            total_duration: Total duration in seconds
            output_path: Output path for metadata.json

        Returns:
            Path to metadata.json file
        """
        metadata = ChampionMetadata(
            champion_id=champion_id,
            name=champion_name,
            total_clips=total_clips,
            total_duration=total_duration,
            sample_rate=self.sample_rate,
        )

        metadata.save(output_path.parent)

        console.print(f"[green]Created metadata.json")

        return output_path.parent / "metadata.json"

    def concatenate_champion(
        self,
        champion_id: str,
        checkpoint: ChampionCheckpoint,
        processed_dir: Path,
        final_output_dir: Path,
        min_duration: float = 0.0,
        max_duration: float = 12.0,
    ) -> bool:
        """
        Create dataset for a champion with individual audio files and metadata.csv.

        Creates this structure:
        /champion_id/
        |-- metadata.csv
        |-- wavs/
        |   |-- audio_0001.wav
        |   |-- audio_0002.wav
        |   `-- ...

        metadata.csv format:
        audio_file|text
        wavs/audio_0001.wav|Transcript text here
        wavs/audio_0002.wav|Another transcript

        Args:
            champion_id: Champion identifier
            checkpoint: Champion checkpoint
            processed_dir: Directory with processed WAV files
            final_output_dir: Final output directory (e.g., voice-cloning/champion-voices/)
            min_duration: Minimum audio duration in seconds (default: 3.0)
            max_duration: Maximum audio duration in seconds (default: 12.0)

        Returns:
            True if successful, False otherwise
        """
        console.print(f"\n[cyan]Creating dataset for {checkpoint.champion_name}...")

        # Update stage
        self.state.update_champion_stage(champion_id, ChampionStatus.CONCATENATING)

        try:
            # Get all processed WAV files
            all_wav_files = sorted(processed_dir.glob("*.wav"))

            if not all_wav_files:
                error = "No processed WAV files found"
                console.print(f"[red]{error}")
                self.state.mark_champion_failed(champion_id, error)
                return False

            # Create filename -> transcript mapping from audio_file_data
            audio_data_map = {Path(af.filename).stem: af for af in checkpoint.audio_files}

            # Filter files by duration and valid transcript
            valid_files = []  # (wav_path, duration, transcript)
            
            for wav_path in all_wav_files:
                wav_stem = wav_path.stem
                audio_data = audio_data_map.get(wav_stem)

                # Check if file has valid transcript
                if not audio_data or not is_valid_transcript(audio_data.transcript):
                    continue

                # Check duration
                duration = get_audio_duration(wav_path, self.sample_rate)
                
                if min_duration <= duration <= max_duration:
                    # audio_data.transcript is guaranteed to be valid here
                    if audio_data.transcript:  # Type narrowing for mypy
                        clean_transcript = self._extract_quoted_text(audio_data.transcript)
                        valid_files.append((wav_path, duration, clean_transcript))

            if not valid_files:
                error = f"No clips found with duration {min_duration}-{max_duration}s and valid transcript"
                console.print(f"[red]{error}")
                self.state.mark_champion_failed(champion_id, error)
                return False

            console.print(f"[cyan]✓ Found {len(valid_files)} valid audio clips ({min_duration}-{max_duration}s)")

            # Ensure final output directory exists
            champion_output_dir = final_output_dir / champion_id
            wavs_dir = champion_output_dir / "wavs"
            wavs_dir.mkdir(parents=True, exist_ok=True)

            # Copy files to wavs/ directory with sequential naming
            metadata_rows = []
            total_duration = 0.0

            for idx, (wav_path, duration, transcript) in enumerate(valid_files, start=1):
                # Create sequential filename
                new_filename = f"audio_{idx:04d}.wav"
                new_path = wavs_dir / new_filename

                # Copy file
                shutil.copy2(wav_path, new_path)

                # Add to metadata
                relative_path = f"wavs/{new_filename}"
                metadata_rows.append({
                    "audio_file": relative_path,
                    "text": transcript
                })

                total_duration += duration

            # Write metadata.csv
            metadata_csv_path = champion_output_dir / "metadata.csv"
            with open(metadata_csv_path, 'w', newline='', encoding='utf-8') as csvfile:
                writer = csv.DictWriter(csvfile, fieldnames=['audio_file', 'text'], delimiter='|')
                writer.writeheader()
                writer.writerows(metadata_rows)

            console.print(f"[green]✓ Successfully created dataset for {checkpoint.champion_name}")
            console.print(f"  - {len(valid_files)} audio files in wavs/")
            console.print(f"  - Total duration: {total_duration:.2f}s")
            console.print(f"  - Average duration: {total_duration/len(valid_files):.2f}s")
            console.print(f"  - metadata.csv created")

            # Create metadata.json for backwards compatibility
            metadata_path = champion_output_dir / "metadata.json"
            self.create_metadata_json(
                champion_id=champion_id,
                champion_name=checkpoint.champion_name,
                total_clips=len(valid_files),
                total_duration=total_duration,
                output_path=metadata_path,
            )

            # Mark champion as completed
            self.state.mark_champion_completed(champion_id)

            return True

        except Exception as e:
            error = f"Dataset creation failed: {e}"
            console.print(f"[red]{error}")
            import traceback
            console.print(f"[red]{traceback.format_exc()}")
            self.state.mark_champion_failed(champion_id, error)
            return False
