"""Audio processing pipeline for champion voice lines."""

from pathlib import Path
from typing import Optional

import librosa
import numpy as np
import soundfile as sf
from pydub import AudioSegment
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from scipy.signal import wiener

from .models import ProcessingResult, ChampionCheckpoint, ChampionStatus
from .state_manager import StateManager

console = Console()


class AudioProcessor:
    """Processes audio files for voice cloning."""

    def __init__(
        self,
        state_manager: StateManager,
        sample_rate: int = 22050,
        target_rms: float = 0.1,  # -10 dB
    ):
        self.state = state_manager
        self.sample_rate = sample_rate
        self.target_rms = target_rms

    def convert_ogg_to_wav(
        self, ogg_path: Path, wav_path: Path
    ) -> Optional[Path]:
        """
        Convert OGG file to WAV format.

        Args:
            ogg_path: Path to input OGG file
            wav_path: Path to output WAV file

        Returns:
            Path to WAV file if successful, None otherwise
        """
        try:
            # Use pydub for OGG to WAV conversion
            audio = AudioSegment.from_ogg(str(ogg_path))

            # Convert to mono if stereo
            if audio.channels > 1:
                audio = audio.set_channels(1)

            # Set sample rate
            audio = audio.set_frame_rate(self.sample_rate)

            # Export as WAV
            wav_path.parent.mkdir(parents=True, exist_ok=True)
            audio.export(
                str(wav_path),
                format="wav",
                parameters=["-ac", "1", "-ar", str(self.sample_rate)]
            )

            return wav_path

        except Exception as e:
            console.print(f"[red]Failed to convert {ogg_path.name}: {e}")
            return None

    def apply_noise_reduction(self, audio: np.ndarray) -> np.ndarray:
        """
        Apply noise reduction using Wiener filter.

        Args:
            audio: Audio signal as numpy array

        Returns:
            Filtered audio signal
        """
        try:
            # Apply Wiener filter for noise reduction
            audio_filtered = wiener(audio)
            return audio_filtered
        except Exception as e:
            console.print(f"[yellow]Noise reduction failed: {e}, using original audio")
            return audio

    def normalize_audio(
        self, audio: np.ndarray, target_rms: Optional[float] = None
    ) -> np.ndarray:
        """
        Normalize audio to target RMS level.

        Args:
            audio: Audio signal as numpy array
            target_rms: Target RMS level (defaults to self.target_rms)

        Returns:
            Normalized audio signal
        """
        if target_rms is None:
            target_rms = self.target_rms

        # Calculate current RMS
        current_rms = np.sqrt(np.mean(audio ** 2))

        if current_rms < 1e-6:  # Avoid division by zero
            return audio

        # Normalize to target RMS
        audio_normalized = audio * (target_rms / current_rms)

        # Clip to prevent distortion
        audio_normalized = np.clip(audio_normalized, -1.0, 1.0)

        return audio_normalized

    def process_audio_file(
        self, input_path: Path, output_path: Path
    ) -> ProcessingResult:
        """
        Process a single audio file through the complete pipeline.

        Pipeline steps:
        1. Load audio (convert from OGG to WAV if needed)
        2. Apply noise reduction (Wiener filter)
        3. Normalize volume to target RMS level
        4. Save as WAV (22.05kHz, mono, 16-bit PCM)

        Args:
            input_path: Path to input audio file (OGG or WAV)
            output_path: Path where output WAV file will be saved

        Returns:
            ProcessingResult with success status, duration, and error details if failed
        """
        try:
            # Convert OGG to WAV first if needed
            if input_path.suffix.lower() == '.ogg':
                temp_wav = input_path.parent / f"{input_path.stem}_temp.wav"
                converted_path = self.convert_ogg_to_wav(input_path, temp_wav)

                if not converted_path:
                    return ProcessingResult(
                        success=False,
                        input_path=input_path,
                        error="OGG to WAV conversion failed"
                    )

                load_path = converted_path
            else:
                load_path = input_path

            # Load audio
            audio, sr = librosa.load(str(load_path), sr=self.sample_rate, mono=True)

            # Clean up temp file if OGG conversion was used
            if load_path != input_path and load_path.exists():
                load_path.unlink()

            # Apply noise reduction
            audio_filtered = self.apply_noise_reduction(audio)

            # Normalize volume
            audio_normalized = self.normalize_audio(audio_filtered)

            # Ensure output directory exists
            output_path.parent.mkdir(parents=True, exist_ok=True)

            # Save as WAV (22.05kHz, mono, 16-bit PCM)
            sf.write(
                str(output_path),
                audio_normalized,
                sr,
                subtype='PCM_16'
            )

            duration = len(audio_normalized) / sr

            return ProcessingResult(
                success=True,
                input_path=input_path,
                output_path=output_path,
                duration=duration,
            )

        except Exception as e:
            return ProcessingResult(
                success=False,
                input_path=input_path,
                error=str(e)
            )

    def process_champion_audio(
        self,
        champion_id: str,
        checkpoint: ChampionCheckpoint,
        raw_dir: Path,
        processed_dir: Path,
    ) -> bool:
        """
        Process all audio files for a champion.

        Args:
            champion_id: Champion identifier
            checkpoint: Champion checkpoint
            raw_dir: Directory with raw OGG files
            processed_dir: Directory for processed WAV files

        Returns:
            True if at least 50% succeeded, False otherwise
        """
        console.print(f"\n[cyan]Processing audio files for {checkpoint.champion_name}...")

        # Update stage
        self.state.update_champion_stage(champion_id, ChampionStatus.PROCESSING)

        processed_dir.mkdir(parents=True, exist_ok=True)

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task(
                f"Processing...",
                total=len(checkpoint.audio_files)
            )

            for audio_file in checkpoint.audio_files:
                # Skip if already processed
                if audio_file.processed:
                    progress.update(task, advance=1)
                    continue

                # Skip if not downloaded
                if not audio_file.downloaded:
                    progress.update(task, advance=1)
                    continue

                input_path = raw_dir / audio_file.filename
                output_filename = input_path.stem + ".wav"
                output_path = processed_dir / output_filename

                # Process file
                result = self.process_audio_file(input_path, output_path)

                if result.success:
                    self.state.mark_file_processed(champion_id, audio_file.filename)
                else:
                    console.print(f"[yellow]Failed to process {audio_file.filename}: {result.error}")

                progress.update(task, advance=1)

        # Check success rate
        checkpoint = self.state.get_champion_checkpoint(champion_id)
        if not checkpoint:
            return False

        processed = checkpoint.stats.get("processed_files", 0)
        total = checkpoint.stats.get("total_files", 1)
        success_rate = processed / total

        if success_rate < 0.5:
            error = f"Only {processed}/{total} files processed ({success_rate*100:.1f}%)"
            console.print(f"[red]{error}")
            self.state.mark_champion_failed(champion_id, error)
            return False

        console.print(f"[green]Processed {processed}/{total} files ({success_rate*100:.1f}%)")

        # Update stage to CONCATENATING
        self.state.update_champion_stage(champion_id, ChampionStatus.CONCATENATING)

        return True
