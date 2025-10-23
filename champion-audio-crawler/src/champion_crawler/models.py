"""Data models for champion audio crawler."""

from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import List, Dict, Optional
import json


class ChampionStatus(str, Enum):
    """Status of champion processing."""
    PENDING = "pending"
    SCRAPING = "scraping"
    DOWNLOADING = "downloading"
    PROCESSING = "processing"
    CONCATENATING = "concatenating"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class AudioFile:
    """Represents a single audio file to be downloaded/processed."""
    url: str
    filename: str
    transcript: Optional[str] = None  # Voice line text from <i> tag
    downloaded: bool = False
    processed: bool = False
    file_size: Optional[int] = None
    checksum: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> 'AudioFile':
        return cls(**data)


@dataclass
class ChampionCheckpoint:
    """Checkpoint data for a single champion."""
    champion_id: str
    champion_name: str
    stage: ChampionStatus
    audio_files: List[AudioFile] = field(default_factory=list)
    stats: Dict[str, int] = field(default_factory=dict)
    last_checkpoint: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    error: Optional[str] = None

    def __post_init__(self):
        # Ensure stage is ChampionStatus enum
        if isinstance(self.stage, str):
            self.stage = ChampionStatus(self.stage)

        # Convert audio_files dicts to AudioFile objects
        if self.audio_files and isinstance(self.audio_files[0], dict):
            self.audio_files = [AudioFile.from_dict(af) for af in self.audio_files]

        # Initialize stats if empty
        if not self.stats:
            self.stats = {
                "total_files": 0,
                "downloaded_files": 0,
                "processed_files": 0,
                "failed_downloads": 0,
            }

    def to_dict(self) -> dict:
        return {
            "champion_id": self.champion_id,
            "champion_name": self.champion_name,
            "stage": self.stage.value,
            "audio_files": [af.to_dict() for af in self.audio_files],
            "stats": self.stats,
            "last_checkpoint": self.last_checkpoint,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict) -> 'ChampionCheckpoint':
        return cls(**data)

    def save(self, checkpoint_dir: Path):
        """Save checkpoint to file."""
        checkpoint_file = checkpoint_dir / f"{self.champion_id}.json"
        checkpoint_file.write_text(json.dumps(self.to_dict(), indent=2))

    @classmethod
    def load(cls, champion_id: str, checkpoint_dir: Path) -> Optional['ChampionCheckpoint']:
        """Load checkpoint from file."""
        checkpoint_file = checkpoint_dir / f"{champion_id}.json"
        if not checkpoint_file.exists():
            return None

        data = json.loads(checkpoint_file.read_text())
        return cls.from_dict(data)


@dataclass
class ProgressState:
    """Overall progress state for the crawling session."""
    session_id: str
    start_time: str
    last_update: str
    total_champions: int = 0
    completed_champions: int = 0
    failed_champions: List[str] = field(default_factory=list)
    in_progress_champion: Optional[str] = None
    champions: Dict[str, str] = field(default_factory=dict)  # champion_id -> status

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> 'ProgressState':
        return cls(**data)

    def has_incomplete_session(self) -> bool:
        """Check if there's an incomplete session."""
        return (
            self.in_progress_champion is not None or
            any(status == ChampionStatus.PENDING.value for status in self.champions.values())
        )

    def update_champion_status(self, champion_id: str, status: ChampionStatus):
        """Update status for a champion."""
        self.champions[champion_id] = status.value
        self.last_update = datetime.utcnow().isoformat()

        if status == ChampionStatus.COMPLETED:
            self.completed_champions += 1
            if self.in_progress_champion == champion_id:
                self.in_progress_champion = None
        elif status == ChampionStatus.FAILED:
            if champion_id not in self.failed_champions:
                self.failed_champions.append(champion_id)
            if self.in_progress_champion == champion_id:
                self.in_progress_champion = None
        elif status in [ChampionStatus.SCRAPING, ChampionStatus.DOWNLOADING,
                        ChampionStatus.PROCESSING, ChampionStatus.CONCATENATING]:
            self.in_progress_champion = champion_id


@dataclass
class ChampionMetadata:
    """Metadata for a processed champion."""
    champion_id: str
    name: str
    title: str = ""
    total_clips: int = 0
    total_duration: float = 0.0
    sample_rate: int = 22050
    processing_date: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> dict:
        return asdict(self)

    def save(self, output_dir: Path):
        """Save metadata to metadata.json."""
        metadata_file = output_dir / "metadata.json"
        metadata_file.write_text(json.dumps(self.to_dict(), indent=2))


@dataclass
class ProcessingResult:
    """Result of audio file processing."""
    success: bool
    input_path: Path
    output_path: Optional[Path] = None
    duration: float = 0.0
    error: Optional[str] = None
