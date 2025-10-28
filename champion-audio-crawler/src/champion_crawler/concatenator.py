"""Audio concatenation for creating reference files."""

from pathlib import Path
from typing import List, Optional

import librosa
import numpy as np
import soundfile as sf
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


class AudioConcatenator:
    """Concatenates processed audio files into reference file."""

    def __init__(
        self,
        state_manager: StateManager,
        sample_rate: int = 22050,
        silence_duration: float = 0.3,  # 300ms silence between clips
    ):
        self.state = state_manager
        self.sample_rate = sample_rate
        self.silence_duration = silence_duration

    def find_longest_clip_under_20s(
        self, wav_paths: List[Path], output_path: Path
    ) -> tuple[Path, Path]:
        """
        Find the longest audio clip under 20 seconds and copy it as reference.

        Args:
            wav_paths: List of WAV file paths to search
            output_path: Output path for reference WAV

        Returns:
            Tuple of (reference wav path, source wav path used)
        """
        console.print(f"[cyan]Finding longest audio clip under 20s from {len(wav_paths)} clips...")

        max_duration = 20.0  # Maximum 20 seconds
        longest_clip = None
        longest_duration = 0.0
        longest_audio = None
        longest_sr = None

        for wav_path in wav_paths:
            try:
                # Load audio
                audio, sr = librosa.load(str(wav_path), sr=self.sample_rate, mono=True)

                # Calculate duration
                duration = len(audio) / sr

                # Check if this is the longest clip under 20s
                if duration < max_duration and duration > longest_duration:
                    longest_duration = duration
                    longest_clip = wav_path
                    longest_audio = audio
                    longest_sr = sr

            except Exception as e:
                console.print(f"[yellow]Failed to load {wav_path.name}: {e}")
                continue

        if longest_clip is None:
            raise ValueError("No valid audio clips found under 20 seconds")

        # Ensure output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Save selected audio as reference
        sf.write(
            str(output_path),
            longest_audio,
            self.sample_rate,
            subtype='PCM_16'
        )

        console.print(f"[green]Selected reference audio: {longest_clip.name} ({longest_duration:.2f}s)")

        return output_path, longest_clip

    def concatenate_wav_files(
        self, wav_paths: List[Path], output_path: Path
    ) -> Path:
        """
        Concatenate multiple WAV files with silence padding between clips.

        Args:
            wav_paths: List of WAV file paths to concatenate
            output_path: Output path for concatenated WAV

        Returns:
            Path to concatenated WAV file
        """
        console.print(f"[cyan]Concatenating {len(wav_paths)} audio files...")

        audio_segments = []
        silence_samples = int(self.silence_duration * self.sample_rate)
        silence = np.zeros(silence_samples, dtype=np.float32)

        for wav_path in wav_paths:
            try:
                # Load audio
                audio, sr = librosa.load(str(wav_path), sr=self.sample_rate, mono=True)
                audio_segments.append(audio)
                audio_segments.append(silence)  # Add silence between clips
            except Exception as e:
                console.print(f"[yellow]Failed to load {wav_path.name}: {e}")
                continue

        if not audio_segments:
            raise ValueError("No valid audio files to concatenate")

        # Remove last silence
        if audio_segments:
            audio_segments.pop()

        # Concatenate all segments
        concatenated = np.concatenate(audio_segments)

        # Ensure output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Save concatenated audio
        sf.write(
            str(output_path),
            concatenated,
            self.sample_rate,
            subtype='PCM_16'
        )

        console.print(f"[green]✓ Concatenated audio saved ({len(concatenated) / self.sample_rate:.2f}s)")

        return output_path

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

    def generate_reference_txt(
        self, selected_clip: Path, audio_file_data: List[AudioFile], output_path: Path
    ) -> Path:
        """
        Generate reference transcription file from the selected clip's transcript.

        Args:
            selected_clip: The WAV file that was selected as reference
            audio_file_data: List of AudioFile objects with transcript data
            output_path: Output path for reference.txt

        Returns:
            Path to reference.txt file
        """
        console.print("[cyan]Generating reference transcription...")

        # Find the transcript for the selected clip
        clip_stem = selected_clip.stem

        for audio_data in audio_file_data:
            ogg_stem = Path(audio_data.filename).stem
            if ogg_stem == clip_stem:
                if is_valid_transcript(audio_data.transcript) and audio_data.transcript:
                    # Extract only quoted dialogue, removing sound effects
                    clean_transcript = self._extract_quoted_text(audio_data.transcript)

                    # Write to file
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    output_path.write_text(clean_transcript)

                    console.print(f"[green]✓ Generated reference.txt for {selected_clip.name}")
                    return output_path
                else:
                    raise ValueError(f"Selected clip {selected_clip.name} has invalid transcript")

        raise ValueError(f"No transcript found for selected clip {selected_clip.name}")

    def generate_train_txt(
        self, audio_files: List[Path], audio_file_data: List[AudioFile], output_path: Path
    ) -> Path:
        """
        Generate train transcription file from all voice line texts (concatenated).

        Args:
            audio_files: List of processed WAV file paths (in order)
            audio_file_data: List of AudioFile objects with transcript data
            output_path: Output path for train.txt

        Returns:
            Path to train.txt file
        """
        console.print("[cyan]Generating train transcription...")

        # Create filename -> transcript mapping from audio_file_data
        transcript_map = {}
        for audio_data in audio_file_data:
            ogg_stem = Path(audio_data.filename).stem
            if is_valid_transcript(audio_data.transcript) and audio_data.transcript:
                # Extract only quoted dialogue, removing sound effects
                clean_transcript = self._extract_quoted_text(audio_data.transcript)
                transcript_map[ogg_stem] = clean_transcript

        # Generate transcription lines (only for files that were passed in)
        transcription_lines = []

        for wav_path in audio_files:
            wav_stem = wav_path.stem

            if wav_stem in transcript_map:
                transcription_lines.append(transcript_map[wav_stem])

        # Write to file
        output_path.parent.mkdir(parents=True, exist_ok=True)
        transcription_text = '\n'.join(transcription_lines)
        output_path.write_text(transcription_text)

        console.print(f"[green]✓ Generated train.txt with {len(transcription_lines)} voice lines")

        return output_path


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
    ) -> bool:
        """
        Select longest audio clip under 20s for a champion and create reference files.

        Args:
            champion_id: Champion identifier
            checkpoint: Champion checkpoint
            processed_dir: Directory with processed WAV files
            final_output_dir: Base output directory (will create {champion_id}/ subdirectory)

        Returns:
            True if successful, False otherwise
        """
        console.print(f"\n[cyan]Creating reference files for {checkpoint.champion_name}...")

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

            # Filter out files with invalid transcripts (empty or placeholder)
            # Create mapping of filename -> AudioFile data
            audio_data_map = {Path(af.filename).stem: af for af in checkpoint.audio_files}

            wav_files = []
            skipped_count = 0

            for wav_path in all_wav_files:
                wav_stem = wav_path.stem
                audio_data = audio_data_map.get(wav_stem)

                if audio_data and is_valid_transcript(audio_data.transcript):
                    wav_files.append(wav_path)
                else:
                    skipped_count += 1

            console.print(f"[cyan]Using {len(wav_files)}/{len(all_wav_files)} files ({skipped_count} skipped due to missing transcripts)")

            if not wav_files:
                error = "No files with valid transcripts found"
                console.print(f"[red]{error}")
                self.state.mark_champion_failed(champion_id, error)
                return False

            # Ensure output directory exists ({champion_id}/)
            champion_output_dir = final_output_dir / champion_id
            champion_output_dir.mkdir(parents=True, exist_ok=True)

            # 1. Find longest clip under 20 seconds for reference
            reference_wav_path = champion_output_dir / "reference.wav"
            selected_wav, source_clip = self.find_longest_clip_under_20s(wav_files, reference_wav_path)

            # Calculate duration of selected clip
            audio, sr = librosa.load(str(selected_wav), sr=None, mono=True)
            reference_duration = len(audio) / sr

            # Generate reference.txt with transcript from selected clip
            reference_txt_path = champion_output_dir / "reference.txt"
            self.generate_reference_txt(source_clip, checkpoint.audio_files, reference_txt_path)

            # 2. Concatenate all clips for training
            train_wav_path = champion_output_dir / "train.wav"
            self.concatenate_wav_files(wav_files, train_wav_path)

            # Calculate total duration of concatenated training audio
            train_audio, train_sr = librosa.load(str(train_wav_path), sr=None, mono=True)
            train_duration = len(train_audio) / train_sr

            # Generate train.txt with all transcripts
            train_txt_path = champion_output_dir / "train.txt"
            self.generate_train_txt(wav_files, checkpoint.audio_files, train_txt_path)

            # Create metadata.json
            metadata_path = champion_output_dir / "metadata.json"
            self.create_metadata_json(
                champion_id=champion_id,
                champion_name=checkpoint.champion_name,
                total_clips=len(wav_files),
                total_duration=train_duration,
                output_path=metadata_path,
            )

            console.print(f"[green]✓ Successfully created reference and training files for {checkpoint.champion_name}")
            console.print(f"  - reference.wav: {reference_duration:.2f}s (from {source_clip.name})")
            console.print(f"  - reference.txt: single clip transcription")
            console.print(f"  - train.wav: {train_duration:.2f}s ({len(wav_files)} clips)")
            console.print(f"  - train.txt: {len(wav_files)} voice lines")
            console.print(f"  - metadata.json: champion metadata")

            # Mark champion as completed
            self.state.mark_champion_completed(champion_id)

            return True

        except Exception as e:
            error = f"Reference creation failed: {e}"
            console.print(f"[red]{error}")
            self.state.mark_champion_failed(champion_id, error)
            return False
