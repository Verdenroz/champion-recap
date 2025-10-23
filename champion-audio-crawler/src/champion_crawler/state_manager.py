"""State management for resume capability."""

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict

from .models import (
    ProgressState,
    ChampionCheckpoint,
    ChampionStatus,
    AudioFile,
)


class StateManager:
    """Manages crawler state for resume capability."""

    def __init__(self, state_dir: Path = Path(".crawlerstate")):
        self.state_dir = Path(state_dir)
        self.checkpoint_dir = self.state_dir / "checkpoints"
        self.progress_file = self.state_dir / "progress.json"

        # Ensure directories exist
        self.state_dir.mkdir(exist_ok=True)
        self.checkpoint_dir.mkdir(exist_ok=True)

        self.progress: Optional[ProgressState] = None

    def load_progress(self) -> ProgressState:
        """Load existing progress or create new session."""
        if self.progress_file.exists():
            data = json.loads(self.progress_file.read_text())
            self.progress = ProgressState.from_dict(data)
        else:
            # Create new session
            session_id = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            self.progress = ProgressState(
                session_id=session_id,
                start_time=datetime.utcnow().isoformat(),
                last_update=datetime.utcnow().isoformat(),
            )
            self._save_progress()

        return self.progress

    def _save_progress(self):
        """Save progress state to disk."""
        if self.progress:
            self.progress.last_update = datetime.utcnow().isoformat()
            self.progress_file.write_text(json.dumps(self.progress.to_dict(), indent=2))

    def save_checkpoint(self, champion_id: str, checkpoint: ChampionCheckpoint):
        """Save champion-specific checkpoint."""
        checkpoint.last_checkpoint = datetime.utcnow().isoformat()
        checkpoint.save(self.checkpoint_dir)

        # Update progress state
        if self.progress:
            self.progress.update_champion_status(champion_id, checkpoint.stage)
            self._save_progress()

    def get_champion_checkpoint(self, champion_id: str) -> Optional[ChampionCheckpoint]:
        """Get current checkpoint for a champion."""
        return ChampionCheckpoint.load(champion_id, self.checkpoint_dir)

    def create_champion_checkpoint(
        self, champion_id: str, champion_name: str
    ) -> ChampionCheckpoint:
        """Create new checkpoint for a champion."""
        checkpoint = ChampionCheckpoint(
            champion_id=champion_id,
            champion_name=champion_name,
            stage=ChampionStatus.PENDING,
        )
        self.save_checkpoint(champion_id, checkpoint)
        return checkpoint

    def mark_file_downloaded(
        self, champion_id: str, filename: str, file_path: Path, file_size: int
    ):
        """Mark individual file as downloaded with verification."""
        checkpoint = self.get_champion_checkpoint(champion_id)
        if not checkpoint:
            return

        # Calculate checksum
        checksum = self._calculate_checksum(file_path)

        # Update audio file status
        for audio_file in checkpoint.audio_files:
            if audio_file.filename == filename:
                audio_file.downloaded = True
                audio_file.checksum = checksum
                audio_file.file_size = file_size
                break

        # Update stats
        checkpoint.stats["downloaded_files"] = sum(
            1 for af in checkpoint.audio_files if af.downloaded
        )

        self.save_checkpoint(champion_id, checkpoint)

    def mark_file_processed(self, champion_id: str, filename: str):
        """Mark individual file as processed to WAV."""
        checkpoint = self.get_champion_checkpoint(champion_id)
        if not checkpoint:
            return

        # Update audio file status
        for audio_file in checkpoint.audio_files:
            if audio_file.filename == filename:
                audio_file.processed = True
                break

        # Update stats
        checkpoint.stats["processed_files"] = sum(
            1 for af in checkpoint.audio_files if af.processed
        )

        self.save_checkpoint(champion_id, checkpoint)

    def mark_file_failed(self, champion_id: str, filename: str, error: str):
        """Mark file as failed with error details."""
        checkpoint = self.get_champion_checkpoint(champion_id)
        if not checkpoint:
            return

        # Update audio file status
        for audio_file in checkpoint.audio_files:
            if audio_file.filename == filename:
                audio_file.error = error
                break

        # Update stats
        checkpoint.stats["failed_downloads"] = sum(
            1 for af in checkpoint.audio_files if af.error is not None
        )

        self.save_checkpoint(champion_id, checkpoint)

    def mark_champion_completed(self, champion_id: str):
        """Mark champion as fully completed."""
        checkpoint = self.get_champion_checkpoint(champion_id)
        if checkpoint:
            checkpoint.stage = ChampionStatus.COMPLETED
            self.save_checkpoint(champion_id, checkpoint)

    def mark_champion_failed(self, champion_id: str, error: str):
        """Mark champion as failed with error details."""
        checkpoint = self.get_champion_checkpoint(champion_id)
        if checkpoint:
            checkpoint.stage = ChampionStatus.FAILED
            checkpoint.error = error
            self.save_checkpoint(champion_id, checkpoint)

    def update_champion_stage(self, champion_id: str, stage: ChampionStatus):
        """Update the current processing stage for a champion."""
        checkpoint = self.get_champion_checkpoint(champion_id)
        if checkpoint:
            checkpoint.stage = stage
            self.save_checkpoint(champion_id, checkpoint)

    def get_pending_champions(self) -> List[str]:
        """Get list of champions not yet started."""
        if not self.progress:
            return []

        return [
            champ_id
            for champ_id, status in self.progress.champions.items()
            if status == ChampionStatus.PENDING.value
        ]

    def get_incomplete_champion(self) -> Optional[str]:
        """Get champion that was in-progress when interrupted."""
        if not self.progress:
            return None

        return self.progress.in_progress_champion

    def verify_file_integrity(self, filepath: Path, expected_checksum: str) -> bool:
        """Verify downloaded file hasn't been corrupted."""
        if not filepath.exists():
            return False

        current_checksum = self._calculate_checksum(filepath)
        return current_checksum == expected_checksum

    def verify_downloads(self, champion_id: str, output_dir: Path) -> List[str]:
        """Returns list of files needing re-download."""
        checkpoint = self.get_champion_checkpoint(champion_id)
        if not checkpoint:
            return []

        needs_redownload = []

        for audio_file in checkpoint.audio_files:
            if not audio_file.downloaded:
                continue

            filepath = output_dir / champion_id / "raw" / audio_file.filename

            # Check file exists
            if not filepath.exists():
                needs_redownload.append(audio_file.filename)
                continue

            # Verify checksum if available
            if audio_file.checksum:
                if not self.verify_file_integrity(filepath, audio_file.checksum):
                    needs_redownload.append(audio_file.filename)

        return needs_redownload

    def add_champion(self, champion_id: str, champion_name: str):
        """Add champion to progress tracking."""
        if not self.progress:
            self.load_progress()

        if champion_id not in self.progress.champions:
            self.progress.champions[champion_id] = ChampionStatus.PENDING.value
            self.progress.total_champions += 1
            self._save_progress()

    def reset(self):
        """Delete all state and start fresh."""
        import shutil

        if self.state_dir.exists():
            shutil.rmtree(self.state_dir)

        # Recreate directories
        self.state_dir.mkdir(exist_ok=True)
        self.checkpoint_dir.mkdir(exist_ok=True)
        self.progress = None

    def get_status_summary(self) -> Dict:
        """Get summary of current progress."""
        if not self.progress:
            return {"status": "No active session"}

        completed = sum(
            1
            for status in self.progress.champions.values()
            if status == ChampionStatus.COMPLETED.value
        )
        failed = len(self.progress.failed_champions)
        in_progress = self.progress.in_progress_champion
        pending = sum(
            1
            for status in self.progress.champions.values()
            if status == ChampionStatus.PENDING.value
        )

        return {
            "session_id": self.progress.session_id,
            "start_time": self.progress.start_time,
            "total_champions": self.progress.total_champions,
            "completed": completed,
            "failed": failed,
            "pending": pending,
            "in_progress": in_progress,
            "completion_percentage": (
                (completed / self.progress.total_champions * 100)
                if self.progress.total_champions > 0
                else 0
            ),
        }

    @staticmethod
    def _calculate_checksum(filepath: Path) -> str:
        """Calculate MD5 checksum of a file."""
        md5_hash = hashlib.md5()
        with open(filepath, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                md5_hash.update(chunk)
        return md5_hash.hexdigest()
