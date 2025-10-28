"""CLI interface for champion audio crawler."""

import signal
import sys
from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .concatenator import AudioConcatenator
from .models import ChampionStatus
from .processor import AudioProcessor
from .scraper import WikiScraper
from .state_manager import StateManager

console = Console()


class CrawlerSession:
    """Manages crawler session with graceful shutdown."""

    def __init__(self, state_manager: StateManager):
        self.state = state_manager
        self.shutdown_requested = False

        # Register signal handlers
        signal.signal(signal.SIGINT, self.handle_shutdown)
        signal.signal(signal.SIGTERM, self.handle_shutdown)

    def handle_shutdown(self, signum, frame):
        """Handle Ctrl+C gracefully."""
        if self.shutdown_requested:
            # Force quit on second Ctrl+C
            console.print("\n\n[red]⚠️  Force quitting (progress may be lost)...")
            sys.exit(1)

        self.shutdown_requested = True
        console.print("\n\n[yellow]✋ Shutdown requested. Saving progress...")
        console.print("[yellow]Press Ctrl+C again to force quit.\n")

    def should_continue(self) -> bool:
        """Check if we should continue processing."""
        return not self.shutdown_requested


def process_champion(
    champion_name: str,
    audio_page_url: str,
    output_dir: Path,
    final_output_dir: Path,
    state: StateManager,
    session: CrawlerSession,
    sample_rate: int = 22050,
    target_rms: float = 0.1,
) -> bool:
    """
    Process a single champion through the complete pipeline.

    Args:
        champion_name: Champion name
        audio_page_url: URL to champion's audio page
        output_dir: Temporary output directory
        final_output_dir: Final output directory (voice-cloning/champion-voices/)
        state: State manager
        session: Crawler session for shutdown handling
        sample_rate: Target sample rate
        target_rms: Target RMS normalization level

    Returns:
        True if successful, False otherwise
    """
    if not session.should_continue():
        return False

    champion_id = champion_name.lower().replace("'", "").replace(" ", "")

    # Check if already completed
    checkpoint = state.get_champion_checkpoint(champion_id)
    if checkpoint and checkpoint.stage == ChampionStatus.COMPLETED:
        console.print(f"[green]✓ {champion_name} already completed, skipping...")
        return True

    # Initialize components
    scraper = WikiScraper(state, output_dir)
    processor = AudioProcessor(state, sample_rate, target_rms)
    concatenator = AudioConcatenator(state, sample_rate)

    # Step 1: Scrape audio files
    if not checkpoint or checkpoint.stage == ChampionStatus.PENDING:
        checkpoint = scraper.scrape_champion_audio(champion_name, audio_page_url)
        if not checkpoint or not session.should_continue():
            return False

    # Step 2: Download audio files
    checkpoint = state.get_champion_checkpoint(champion_id)
    if checkpoint and checkpoint.stage == ChampionStatus.DOWNLOADING:
        success = scraper.download_all_audio(champion_id, checkpoint)
        if not success or not session.should_continue():
            return False

    # Step 3: Process audio files
    raw_dir = output_dir / champion_id / "raw"
    processed_dir = output_dir / champion_id / "processed"

    checkpoint = state.get_champion_checkpoint(champion_id)
    if checkpoint and checkpoint.stage == ChampionStatus.PROCESSING:
        success = processor.process_champion_audio(
            champion_id, checkpoint, raw_dir, processed_dir
        )
        if not success or not session.should_continue():
            return False

    # Step 4: Concatenate and create reference files
    checkpoint = state.get_champion_checkpoint(champion_id)
    if checkpoint and checkpoint.stage == ChampionStatus.CONCATENATING:
        success = concatenator.concatenate_champion(
            champion_id, checkpoint, processed_dir, final_output_dir
        )
        if not success:
            return False

    return True


@click.group()
def cli():
    """League of Legends Champion Audio Crawler."""
    pass


@cli.command()
@click.option(
    "--champion", "-c",
    help="Single champion name to scrape"
)
@click.option(
    "--champions-file", "-f",
    type=click.Path(exists=True),
    help="File with champion names (one per line)"
)
@click.option(
    "--output", "-o",
    type=click.Path(),
    default="./output",
    help="Temporary output directory (default: ./output)"
)
@click.option(
    "--final-output",
    type=click.Path(),
    help="Final output directory (default: ../voice-cloning/champion-voices)"
)
@click.option(
    "--sample-rate", "-sr",
    type=int,
    default=22050,
    help="WAV sample rate (default: 22050)"
)
@click.option(
    "--target-rms",
    type=float,
    default=-10.0,
    help="Normalization target in dB (default: -10)"
)
@click.option(
    "--skip-existing",
    is_flag=True,
    help="Skip if champion-voices/{id}/ already exists"
)
@click.option(
    "--reset",
    is_flag=True,
    help="Delete .crawlerstate/ and start fresh"
)
def scrape(
    champion: Optional[str],
    champions_file: Optional[str],
    output: str,
    final_output: Optional[str],
    sample_rate: int,
    target_rms: float,
    skip_existing: bool,
    reset: bool,
):
    """Start new scraping session or resume existing one."""
    output_dir = Path(output)

    # Determine final output directory
    if final_output:
        final_output_dir = Path(final_output)
    else:
        # Default to output/ directory in champion-audio-crawler
        final_output_dir = output_dir.parent / "output"

    console.print(Panel.fit(
        "[bold cyan]League of Legends Champion Audio Crawler[/bold cyan]\n"
        f"Output: {output_dir}\n"
        f"Final: {final_output_dir}\n"
        f"Sample Rate: {sample_rate} Hz",
        title="Configuration"
    ))

    # Initialize state manager
    state = StateManager()

    if reset:
        console.print("[yellow]Resetting progress...")
        state.reset()

    # Load or create progress
    progress = state.load_progress()

    # Check for existing session
    if progress.has_incomplete_session() and not reset:
        if click.confirm("Found incomplete session. Resume?", default=True):
            resume_session(output_dir, final_output_dir, state, sample_rate, target_rms)
            return

    # Initialize session
    session = CrawlerSession(state)

    # Determine champions to process
    champions_to_process = []

    if champion:
        # Single champion
        champions_to_process = [(champion, None)]

    elif champions_file:
        # Load from file
        with open(champions_file, 'r') as f:
            champion_names = [line.strip() for line in f if line.strip()]
        champions_to_process = [(name, None) for name in champion_names]

    else:
        # Scrape all champions from wiki
        scraper = WikiScraper(state, output_dir)
        champions_to_process = scraper.get_champion_list()

    if not champions_to_process:
        console.print("[red]No champions to process!")
        return

    # Add champions to state
    for champ_name, _ in champions_to_process:
        champ_id = champ_name.lower().replace("'", "").replace(" ", "")
        state.add_champion(champ_id)

    console.print(f"\n[cyan]Processing {len(champions_to_process)} champions...\n")

    # Convert target_rms from dB to linear
    target_rms_linear = 10 ** (target_rms / 20.0)

    # Process each champion
    for champion_name, audio_url in champions_to_process:
        if not session.should_continue():
            console.print("\n[yellow]Interrupted. Progress saved.")
            break

        # Skip if exists
        champion_id = champion_name.lower().replace("'", "").replace(" ", "")
        if skip_existing and (final_output_dir / champion_id).exists():
            console.print(f"[yellow]Skipping {champion_name} (already exists)")
            continue

        # Get audio URL if not provided
        if not audio_url:
            audio_url = f"https://wiki.leagueoflegends.com/en-us/{champion_name}/Audio"

        success = process_champion(
            champion_name,
            audio_url,
            output_dir,
            final_output_dir,
            state,
            session,
            sample_rate,
            target_rms_linear,
        )

        if not success and not session.should_continue():
            break

    # Final summary
    summary = state.get_status_summary()
    print_summary(summary)


@cli.command()
@click.option(
    "--output", "-o",
    type=click.Path(),
    help="Output directory (default: from previous session)"
)
@click.option(
    "--final-output",
    type=click.Path(),
    help="Final output directory (default: from previous session)"
)
@click.option(
    "--skip-failed",
    is_flag=True,
    help="Skip champions that previously failed"
)
@click.option(
    "--retry-failed",
    is_flag=True,
    help="Retry failed champions"
)
@click.option(
    "--sample-rate", "-sr",
    type=int,
    default=22050,
    help="WAV sample rate (default: 22050)"
)
@click.option(
    "--target-rms",
    type=float,
    default=-10.0,
    help="Normalization target in dB (default: -10)"
)
def resume(
    output: Optional[str],
    final_output: Optional[str],
    skip_failed: bool,
    retry_failed: bool,
    sample_rate: int,
    target_rms: float,
):
    """Resume interrupted scraping session."""
    state = StateManager()
    progress = state.load_progress()

    if not progress.has_incomplete_session():
        console.print("[yellow]No incomplete session found. Use 'scrape' to start new session.")
        return

    # Use provided directories or defaults
    output_dir = Path(output) if output else Path("./output")

    if final_output:
        final_output_dir = Path(final_output)
    else:
        # Default to output/ directory in champion-audio-crawler
        final_output_dir = output_dir.parent / "output"

    resume_session(output_dir, final_output_dir, state, sample_rate, 10 ** (target_rms / 20.0))


def resume_session(
    output_dir: Path,
    final_output_dir: Path,
    state: StateManager,
    sample_rate: int,
    target_rms: float,
):
    """Resume incomplete session."""
    console.print("[cyan]Resuming previous session...\n")

    session = CrawlerSession(state)
    progress = state.load_progress()

    # Get champion list from wiki to map IDs to names
    console.print("[cyan]Fetching champion list from wiki...")
    scraper = WikiScraper(state, output_dir)
    all_champions = scraper.get_champion_list()

    # Create champion_id -> (champion_name, audio_url) mapping
    champion_map = {}
    for champ_name, audio_url in all_champions:
        champ_id = champ_name.lower().replace("'", "").replace(" ", "")
        champion_map[champ_id] = (champ_name, audio_url)

    # Handle incomplete champion
    incomplete_champ = state.get_incomplete_champion()

    console.print(f"[yellow]DEBUG: Incomplete champion: {incomplete_champ}")

    if incomplete_champ:
        checkpoint = state.get_champion_checkpoint(incomplete_champ)

        # Get champion info from map or checkpoint
        if incomplete_champ in champion_map:
            champ_name, audio_url = champion_map[incomplete_champ]
        elif checkpoint:
            champ_name = checkpoint.champion_name
            audio_url = f"https://wiki.leagueoflegends.com/en-us/{champ_name}/Audio"
        else:
            console.print(f"[red]Cannot resume {incomplete_champ}: no checkpoint or wiki entry found")
            champ_name = None

        if champ_name:
            if checkpoint:
                console.print(f"[cyan]Resuming {champ_name} (stage: {checkpoint.stage.value})...")
            else:
                console.print(f"[cyan]Starting {champ_name} from beginning...")

            console.print(f"[yellow]DEBUG: About to process {champ_name}...")
            result = process_champion(
                champ_name,
                audio_url,
                output_dir,
                final_output_dir,
                state,
                session,
                sample_rate,
                target_rms,
            )
            console.print(f"[yellow]DEBUG: Process result: {result}")

    # Process pending champions
    pending = state.get_pending_champions()

    console.print(f"[yellow]DEBUG: Found {len(pending) if pending else 0} pending champions")

    if pending:
        console.print(f"\n[cyan]Processing {len(pending)} pending champions...\n")

        for champion_id in pending:
            if not session.should_continue():
                console.print(f"[yellow]DEBUG: Session shutdown requested, stopping")
                break

            # Get champion name from map
            if champion_id in champion_map:
                champ_name, audio_url = champion_map[champion_id]
                console.print(f"[yellow]DEBUG: Processing {champ_name}...")

                result = process_champion(
                    champ_name,
                    audio_url,
                    output_dir,
                    final_output_dir,
                    state,
                    session,
                    sample_rate,
                    target_rms,
                )
                console.print(f"[yellow]DEBUG: {champ_name} result: {result}")
            else:
                console.print(f"[red]DEBUG: No wiki entry found for {champion_id}")

    # Final summary
    console.print(f"[yellow]DEBUG: Generating final summary...")
    summary = state.get_status_summary()
    print_summary(summary)


@cli.command()
@click.option(
    "--detailed",
    is_flag=True,
    help="Show per-champion breakdown"
)
@click.option(
    "--json",
    "output_json",
    is_flag=True,
    help="Output as JSON"
)
def status(detailed: bool, output_json: bool):
    """Show current progress status."""
    state = StateManager()
    progress = state.load_progress()

    if not progress:
        console.print("[yellow]No active session found.")
        return

    summary = state.get_status_summary()

    if output_json:
        import json
        click.echo(json.dumps(summary, indent=2))
        return

    print_summary(summary)

    if detailed:
        print_detailed_status(state, progress)


def print_summary(summary: dict):
    """Print progress summary."""
    table = Table(title="Progress Summary")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")

    table.add_row("Session ID", summary.get("session_id", "N/A"))
    table.add_row("Total Champions", str(summary.get("total_champions", 0)))
    table.add_row("Completed", str(summary.get("completed", 0)))
    table.add_row("Failed", str(summary.get("failed", 0)))
    table.add_row("Pending", str(summary.get("pending", 0)))
    table.add_row("In Progress", summary.get("in_progress") or "None")
    table.add_row(
        "Completion",
        f"{summary.get('completion_percentage', 0):.1f}%"
    )

    console.print(table)


def print_detailed_status(state: StateManager, progress):
    """Print detailed per-champion status."""
    console.print("\n[bold]Champion Status:[/bold]\n")

    for champ_id, status in sorted(progress.champions.items()):
        checkpoint = state.get_champion_checkpoint(champ_id)

        if checkpoint:
            downloaded = checkpoint.stats.get("downloaded_files", 0)
            processed = checkpoint.stats.get("processed_files", 0)
            total = checkpoint.stats.get("total_files", 0)

            status_icon = {
                "completed": "✓",
                "failed": "✗",
                "pending": "○",
                "scraping": "⋯",
                "downloading": "↓",
                "processing": "⚙",
                "concatenating": "⊕",
            }.get(status, "?")

            console.print(
                f"{status_icon} {checkpoint.champion_name:20s} "
                f"[{status:15s}] "
                f"Downloaded: {downloaded}/{total} "
                f"Processed: {processed}/{total}"
            )


if __name__ == "__main__":
    cli()
