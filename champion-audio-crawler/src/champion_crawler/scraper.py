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

        console.print(f"[green]Found {len(audio_files)} audio files")

        # Rate limiting
        time.sleep(REQUEST_DELAY)

        return checkpoint

    def _extract_original_audio(self, soup: BeautifulSoup, champion_name: str) -> List[AudioFile]:
        """
        Extract audio URLs from page.

        Strategy: Scrape ALL <li> elements from the entire page, then filter for:
        - Champions WITHOUT skins: Download ALL audio in each <li>
        - Champions WITH skins: Download ONLY data-skin="Original" audio
        - Must have quotation marks (dialogue only, excludes SFX/non-dialogue)

        Args:
            soup: BeautifulSoup object of the champion's audio page

        Returns:
            List of AudioFile objects matching the filter criteria
        """
        audio_files = []

        # This ensures we have complete skin list for filtering
        all_skin_spans = soup.find_all('span', {'data-skin': True})
        non_original_skins = []
        for span in all_skin_spans:
            skin_name = span.get('data-skin', '')
            if skin_name and skin_name != 'Original':
                non_original_skins.append(skin_name)
        # Deduplicate skin names
        non_original_skins = list(set(non_original_skins))

        # Find ALL <li> elements on the page
        all_li_elements = soup.find_all('li')

        for li in all_li_elements:
            # Pass page-level skin list to ensure consistent filtering
            files_from_li = self._extract_audio_from_li(li, champion_name, non_original_skins)
            audio_files.extend(files_from_li)

        return audio_files

    def _extract_audio_from_li(self, li, champion_name: str, non_original_skins: List[str]) -> List[AudioFile]:
        """
        Extract audio files from a single <li> element.

        Filtering criteria (must meet ALL):
        1. Contains <audio> tag(s) with valid source URL
        2. Has quotation marks in text (dialogue only, excludes SFX)
        3. Champion name in filename (prevents cross-champion audio)
        4. Skin handling:
           - If NO data-skin spans found: Extract ALL audio (champion has no skin variations)
           - If data-skin spans found: Extract ONLY audio adjacent to data-skin="Original"
        5. Defensive: Filename doesn't contain non-Original skin names

        Args:
            li: BeautifulSoup <li> element to check
            champion_name: Name of the champion being scraped
            non_original_skins: List of all non-Original skin names from entire page

        Returns:
            List of AudioFile objects (may be empty, or contain multiple files)
        """
        audio_files = []
        champion_id = champion_name.lower().replace("'", "").replace(" ", "")

        # MUST have quotation marks (dialogue only)
        li_text = li.get_text()
        if '"' not in li_text and "'" not in li_text:
            return audio_files

        # Check if this li has ANY data-skin spans
        skin_spans = li.find_all('span', {'data-skin': True})
        has_skins = len(skin_spans) > 0

        # Extract transcript from <i> tag for reference text generation
        transcript = None
        i_tag = li.find('i')
        if i_tag:
            transcript = i_tag.get_text(strip=True)

        # Find all audio elements in this li
        audio_tags = li.find_all('audio')

        if not has_skins:
            # NO SKIN VARIATIONS: Download ALL audio in this li
            for audio_tag in audio_tags:
                source = audio_tag.find('source')
                if not source or not source.get('src'):
                    continue

                audio_url = source.get('src')
                full_url = urljoin(BASE_URL, audio_url)
                filename = audio_url.split('/')[-1].split('?')[0]
                filename_lower = filename.lower()

                # (Prevents cross-champion audio AND announcer files like "Announcer_ahri...")
                if not filename_lower.startswith(champion_id):
                    continue

                # Ensure filename doesn't contain non-Original skin names
                # Extract the part after champion_id for skin name checking
                filename_suffix = filename_lower[len(champion_id):]
                # Remove "_original_" from the suffix to avoid false positives
                filename_for_check = filename_suffix.replace('_original_', '_').replace('original', '')

                has_wrong_skin = any(
                    skin_name.lower().replace(' ', '').replace('-', '') in filename_for_check.replace('_', '').replace('-', '')
                    for skin_name in non_original_skins
                )
                if has_wrong_skin:
                    continue

                audio_files.append(AudioFile(
                    url=full_url,
                    filename=filename,
                    transcript=transcript,
                ))
        else:
            # HAS SKIN VARIATIONS: Download ONLY Original skin audio
            # Strategy: Find all inline-audio spans, check if next skin-play-button sibling has data-skin="Original"
            inline_audio_spans = li.find_all('span', class_='inline-audio')

            for inline_span in inline_audio_spans:
                # Get the next sibling that's specifically a skin-play-button span
                next_sibling = inline_span.find_next_sibling('span', class_='skin-play-button')

                # Only proceed if this skin button is specifically "Original"
                if next_sibling and next_sibling.get('data-skin') == 'Original':
                    # This audio belongs to Original skin
                    audio_tag = inline_span.find('audio')
                    if not audio_tag:
                        continue

                    source = audio_tag.find('source')
                    if not source or not source.get('src'):
                        continue

                    audio_url = source.get('src')
                    full_url = urljoin(BASE_URL, audio_url)
                    filename = audio_url.split('/')[-1].split('?')[0]
                    filename_lower = filename.lower()

                    # Prevents cross-champion audio AND announcer files like "Announcer_ahri..."
                    if not filename_lower.startswith(champion_id):
                        continue

                    # Ensure filename doesn't contain non-Original skin names
                    # Extract the part after champion_id for skin name checking
                    # e.g., "Irelia_Original_Move_0.ogg" -> "Original_Move_0.ogg"
                    filename_suffix = filename_lower[len(champion_id):]  # Remove champion prefix
                    # Remove "_original_" from the suffix to avoid false positives
                    # e.g., "Original_Move_0.ogg" -> "Move_0.ogg" (for checking against other skins)
                    filename_for_check = filename_suffix.replace('_original_', '_').replace('original', '')

                    has_wrong_skin = any(
                        skin_name.lower().replace(' ', '').replace('-', '') in filename_for_check.replace('_', '').replace('-', '')
                        for skin_name in non_original_skins
                    )
                    if has_wrong_skin:
                        continue

                    audio_files.append(AudioFile(
                        url=full_url,
                        filename=filename,
                        transcript=transcript,
                    ))

        return audio_files

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
                self.download_audio_file(audio_file, output_path, champion_id)

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
