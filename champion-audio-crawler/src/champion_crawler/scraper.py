"""Web scraper for League of Legends wiki champion audio pages."""

import re
import time
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urljoin

from curl_cffi import requests
from bs4 import BeautifulSoup
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn

from .models import AudioFile, ChampionCheckpoint, ChampionStatus
from .state_manager import StateManager

console = Console()

BASE_URL = "https://wiki.leagueoflegends.com"
CATEGORY_URL = f"{BASE_URL}/en-us/Category:LoL_Champion_audio"
REQUEST_DELAY = 0.5  # Delay between requests to avoid overwhelming server


class WikiScraper:
    """Scraper for League of Legends wiki."""

    def __init__(self, state_manager: StateManager, output_dir: Path):
        self.state = state_manager
        self.output_dir = Path(output_dir)
        # curl_cffi Session with browser impersonation to bypass Cloudflare
        self.session = requests.Session(impersonate="chrome120")

    def get_champion_list(self) -> List[Tuple[str, str]]:
        """
        Scrape champion list from category page.

        Returns:
            List of (champion_name, audio_page_url) tuples
        """
        console.print(f"[cyan]Fetching champion list from {CATEGORY_URL}...")

        try:
            response = self.session.get(CATEGORY_URL, timeout=30)
            response.raise_for_status()
        except Exception as e:
            console.print(f"[red]Failed to fetch champion list: {e}")
            return []

        soup = BeautifulSoup(response.content, 'html.parser')

        # Find all links in the category page
        # Looking for: <a href="/en-us/Aatrox/Audio" title="Aatrox/Audio">Aatrox/Audio</a>
        champions = []

        # Find all links that match pattern /en-us/{Champion}/Audio
        for link in soup.find_all('a', href=re.compile(r'/en-us/.+/Audio$')):
            href = link.get('href')
            title = link.get('title', '')

            # Extract champion name from href
            # Example: /en-us/Aatrox/Audio -> Aatrox
            match = re.match(r'/en-us/([^/]+)/Audio', href)
            if match:
                champion_name = match.group(1)
                audio_url = urljoin(BASE_URL, href)
                champions.append((champion_name, audio_url))

        console.print(f"[green]Found {len(champions)} champions")
        return champions

    def scrape_champion_audio(
        self, champion_name: str, audio_page_url: str
    ) -> Optional[ChampionCheckpoint]:
        """
        Scrape audio files from champion's audio page.

        Args:
            champion_name: Name of the champion
            audio_page_url: URL to the champion's audio page

        Returns:
            ChampionCheckpoint with audio files, or None if failed
        """
        champion_id = champion_name.lower().replace("'", "").replace(" ", "")

        console.print(f"\n[cyan]Scraping audio for {champion_name}...")

        # Check if checkpoint already exists
        checkpoint = self.state.get_champion_checkpoint(champion_id)
        if checkpoint and checkpoint.stage != ChampionStatus.PENDING:
            console.print(f"[yellow]Checkpoint exists for {champion_name}, resuming...")
            return checkpoint

        # Create new checkpoint
        if not checkpoint:
            checkpoint = self.state.create_champion_checkpoint(champion_id, champion_name)

        # Update stage
        checkpoint.stage = ChampionStatus.SCRAPING
        self.state.save_checkpoint(champion_id, checkpoint)

        try:
            response = self.session.get(audio_page_url, timeout=30)
            response.raise_for_status()
        except Exception as e:
            error = f"Failed to fetch audio page: {e}"
            console.print(f"[red]{error}")
            self.state.mark_champion_failed(champion_id, error)
            return None

        soup = BeautifulSoup(response.content, 'html.parser')

        # Find all audio elements with Original skin designation
        audio_files = self._extract_original_audio(soup, champion_name)

        if not audio_files:
            error = "No Original skin audio files found"
            console.print(f"[yellow]{error}")
            self.state.mark_champion_failed(champion_id, error)
            return None

        # Update checkpoint with audio files
        checkpoint.audio_files = audio_files
        checkpoint.stats["total_files"] = len(audio_files)
        checkpoint.stage = ChampionStatus.DOWNLOADING
        self.state.save_checkpoint(champion_id, checkpoint)

        console.print(f"[green]Found {len(audio_files)} Original skin audio files")

        # Rate limiting
        time.sleep(REQUEST_DELAY)

        return checkpoint

    def _extract_original_audio(
        self, soup: BeautifulSoup, champion_name: str
    ) -> List[AudioFile]:
        """
        Extract Original skin audio URLs from page.

        Only extracts from voice line sections (Movement, Taunt, Joke, Attack, etc.)
        Excludes "Sound Effects" section.

        Strategy:
        1. Find all <h2> section headers
        2. For each voice line section (not "Sound Effects"):
           - Get all <li> elements until next <h2>
           - Extract audio with data-skin="Original"
        """
        audio_files = []

        # Voice line section IDs to include (exclude "Sound_Effects", "Co-op_vs._AI_Responses", etc.)
        voice_sections = {
            'Movement', 'First Encounter', 'Taunt', 'Joke', 'Attack', 'Kills and Objectives', 'Other Gameplay'
        }

        # Find all h2 section headers
        h2_tags = soup.find_all('h2')

        for h2 in h2_tags:
            # Get section ID from mw-headline span
            headline_span = h2.find('span', class_='mw-headline')
            if not headline_span:
                continue

            section_id = headline_span.get('id', '')

            # Skip if not a voice line section
            if section_id not in voice_sections:
                continue

            # Get all content between this h2 and the next h2
            current = h2.next_sibling
            while current:
                # Stop if we hit another h2
                if current.name == 'h2':
                    break

                # Process ul elements (which contain li with audio)
                if current.name == 'ul':
                    # Find all li with audio in this ul
                    for li in current.find_all('li'):
                        audio_file = self._extract_audio_from_li(li)
                        if audio_file:
                            audio_files.append(audio_file)

                current = current.next_sibling

        return audio_files

    def _extract_audio_from_li(self, li) -> Optional[AudioFile]:
        """
        Extract audio file from a single <li> element.

        Returns AudioFile if:
        - Contains <audio> tag with source
        - Has data-skin="Original"

        Returns None otherwise.
        """
        # Check if this li contains an audio element
        audio_tag = li.find('audio')
        if not audio_tag:
            return None

        # Get audio source
        source = audio_tag.find('source')
        if not source or not source.get('src'):
            return None

        audio_url = source.get('src')

        # Check if this li contains Original skin designation
        # Look for: <span data-skin="Original">
        skin_span = li.find('span', {'data-skin': 'Original'})
        if not skin_span:
            return None

        # Construct full URL
        full_url = urljoin(BASE_URL, audio_url)

        # Extract filename
        filename = audio_url.split('/')[-1].split('?')[0]  # Remove query params

        # Skip sound effects files (contain 'SFX' in filename)
        if 'SFX' in filename:
            return None

        # Extract transcript from <i> tag within the same <li>
        transcript = None
        i_tag = li.find('i')
        if i_tag:
            transcript_raw = i_tag.get_text(strip=True)
            # Only include audio files with actual dialogue (must contain quotes)
            if '"' not in transcript_raw and "'" not in transcript_raw:
                return None
            # Keep the raw transcript with quotes for later processing
            transcript = transcript_raw

        return AudioFile(
            url=full_url,
            filename=filename,
            transcript=transcript,
        )

    def download_audio_file(
        self, audio_file: AudioFile, output_path: Path, champion_id: str
    ) -> bool:
        """
        Download a single audio file.

        Args:
            audio_file: AudioFile object
            output_path: Where to save the file
            champion_id: Champion identifier for checkpoint updates

        Returns:
            True if successful, False otherwise
        """
        if audio_file.downloaded and output_path.exists():
            # Verify integrity if checksum available
            if audio_file.checksum:
                if self.state.verify_file_integrity(output_path, audio_file.checksum):
                    return True

        try:
            # curl_cffi doesn't have stream parameter, download directly
            response = self.session.get(audio_file.url, timeout=30)
            response.raise_for_status()

            # Ensure directory exists
            output_path.parent.mkdir(parents=True, exist_ok=True)

            # Download file
            with open(output_path, 'wb') as f:
                f.write(response.content)

            # Mark as downloaded with checksum
            file_size = output_path.stat().st_size
            self.state.mark_file_downloaded(
                champion_id, audio_file.filename, output_path, file_size
            )

            return True

        except Exception as e:
            error = f"Download failed: {e}"
            console.print(f"[red]{error} - {audio_file.filename}")
            self.state.mark_file_failed(champion_id, audio_file.filename, error)
            return False

    def download_all_audio(
        self, champion_id: str, checkpoint: ChampionCheckpoint
    ) -> bool:
        """
        Download all audio files for a champion.

        Args:
            champion_id: Champion identifier
            checkpoint: Champion checkpoint with audio files

        Returns:
            True if at least 50% succeeded, False otherwise
        """
        raw_dir = self.output_dir / champion_id / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)

        # Check for files needing redownload
        needs_redownload = self.state.verify_downloads(champion_id, self.output_dir)

        console.print(f"[cyan]Downloading {len(checkpoint.audio_files)} audio files...")

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task(
                f"Downloading...",
                total=len(checkpoint.audio_files)
            )

            for audio_file in checkpoint.audio_files:
                # Skip if already downloaded and not corrupted
                if (
                    audio_file.downloaded and
                    audio_file.filename not in needs_redownload
                ):
                    progress.update(task, advance=1)
                    continue

                output_path = raw_dir / audio_file.filename
                success = self.download_audio_file(audio_file, output_path, champion_id)

                progress.update(task, advance=1)

                # Rate limiting
                time.sleep(REQUEST_DELAY)

        # Reload checkpoint to get updated stats after downloads
        reloaded_checkpoint = self.state.get_champion_checkpoint(champion_id)
        if not reloaded_checkpoint:
            error = "Failed to reload checkpoint after downloads"
            console.print(f"[red]{error}")
            self.state.mark_champion_failed(champion_id, error)
            return False

        # Check success rate
        downloaded = reloaded_checkpoint.stats.get("downloaded_files", 0)
        total = reloaded_checkpoint.stats.get("total_files", 1)
        success_rate = downloaded / total

        if success_rate < 0.5:
            error = f"Only {downloaded}/{total} files downloaded ({success_rate*100:.1f}%)"
            console.print(f"[red]{error}")
            self.state.mark_champion_failed(champion_id, error)
            return False

        console.print(f"[green]Downloaded {downloaded}/{total} files ({success_rate*100:.1f}%)")

        # Update stage to PROCESSING
        reloaded_checkpoint.stage = ChampionStatus.PROCESSING
        self.state.save_checkpoint(champion_id, reloaded_checkpoint)

        return True
