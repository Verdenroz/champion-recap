# League of Legends Champion Audio Crawler

Automated web scraper and audio processor for extracting League of Legends champion voice lines from the official wiki. Generates production-ready voice cloning reference files with resume capability.

## Features

- ✅ **Cloudflare Bypass** - Uses curl_cffi with browser impersonation to bypass bot detection
- ✅ **Automatic Champion Discovery** - Scrapes all champions from wiki category page
- ✅ **Original Skin Filtering** - Extracts only base champion voices (no skin variants)
- ✅ **Resume Capability** - Stop and restart at any time without losing progress
- ✅ **Complete Audio Pipeline** - OGG → WAV conversion, noise reduction, normalization
- ✅ **Production-Ready Output** - Matches `voice-cloning/champion-voices/` structure
- ✅ **Progress Tracking** - Real-time status display with checkpoints
- ✅ **Error Recovery** - Automatic retry with file integrity verification
- ✅ **Rate Limiting** - Respectful scraping with delays between requests

## Installation

### Prerequisites

- Python 3.10 or higher
- UV package manager (recommended) or pip

### Setup

```bash
cd champion-audio-crawler

# Using UV (recommended)
uv sync

# Or using pip
pip install -e .
```

### System Dependencies

For audio processing, you'll need ffmpeg:

```bash
# Ubuntu/Debian
sudo apt-get install ffmpeg

# macOS
brew install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

## Usage

### Quick Start - Single Champion

```bash
# Process a single champion (e.g., Aatrox)
uv run champion-crawler scrape --champion Aatrox
```

This will:
1. Scrape Aatrox's audio page
2. Download all Original skin voice lines
3. Convert OGG to WAV (22050 Hz, mono, 16-bit)
4. Apply noise reduction and normalization
5. Concatenate into `reference.wav`
6. Generate `metadata.json` and `reference.txt`
7. Save to `../voice-cloning/champion-voices/aatrox/`

### Process Multiple Champions

```bash
# Create a file with champion names
cat > champions.txt <<EOF
Aatrox
Yasuo
Ahri
Zed
Jinx
EOF

# Process all champions from file
uv run champion-crawler scrape --champions-file champions.txt
```

### Process All Champions

```bash
# Scrape and process every champion from wiki (167 champions)
uv run champion-crawler scrape

# Estimated time: 8-12 hours (depending on network speed)
```

### Resume Interrupted Session

The crawler automatically saves progress. If interrupted (Ctrl+C, network error, etc.):

```bash
# Resume from where you left off
uv run champion-crawler resume

# Or explicitly start fresh
uv run champion-crawler scrape --reset
```

### Check Progress

```bash
# Show summary
uv run champion-crawler status

# Show detailed per-champion breakdown
uv run champion-crawler status --detailed

# Export as JSON
uv run champion-crawler status --json > progress.json
```

## CLI Reference

### `scrape` - Start New Session

```
uv run champion-crawler scrape [OPTIONS]

Options:
  -c, --champion TEXT          Single champion name to scrape
  -f, --champions-file PATH    File with champion names (one per line)
  -o, --output PATH            Temporary output directory (default: ./output)
  --final-output PATH          Final output directory (default: ../voice-cloning/champion-voices)
  -sr, --sample-rate INTEGER   WAV sample rate (default: 22050)
  --target-rms FLOAT          Normalization target in dB (default: -10)
  --skip-existing             Skip if champion already exists in final output
  --reset                     Delete .crawlerstate/ and start fresh
```

### `resume` - Continue Interrupted Session

```
uv run champion-crawler resume [OPTIONS]

Options:
  -o, --output PATH          Output directory (default: from previous session)
  --final-output PATH        Final output directory (default: from previous session)
  --skip-failed              Skip champions that previously failed
  --retry-failed             Retry failed champions
  -sr, --sample-rate INTEGER WAV sample rate (default: 22050)
  --target-rms FLOAT        Normalization target in dB (default: -10)
```

### `status` - Check Progress

```
uv run champion-crawler status [OPTIONS]

Options:
  --detailed    Show per-champion breakdown
  --json        Output as JSON
```

## Output Structure

For each champion, the crawler generates:

```
voice-cloning/champion-voices/{championId}/
├── reference.wav              # Concatenated audio (22050 Hz, mono, 16-bit)
├── reference.txt              # Transcription (placeholder, needs manual cleanup)
├── metadata.json              # Champion metadata
└── raw_clips/                 # Individual processed clips
    ├── move_01.wav
    ├── attack_03.wav
    └── ...
```

### `metadata.json` Example

```json
{
  "champion_id": "aatrox",
  "name": "Aatrox",
  "title": "",
  "total_clips": 87,
  "total_duration": 342.5,
  "sample_rate": 22050,
  "processing_date": "2025-01-23T14:30:22Z"
}
```

## Audio Processing Pipeline

Each audio file goes through:

1. **Download** - Fetches OGG from wiki (`/en-us/images/*.ogg`)
2. **Convert** - OGG → WAV (22050 Hz, mono, 16-bit PCM)
3. **Noise Reduction** - Wiener filter to remove background noise
4. **Normalization** - RMS normalization to -10 dB
5. **Concatenation** - Combines clips with 300ms silence padding
6. **Verification** - MD5 checksum for file integrity

## Resume & State Management

The crawler maintains state in `.crawlerstate/`:

```
.crawlerstate/
├── progress.json              # Overall session state
└── checkpoints/               # Per-champion checkpoints
    ├── aatrox.json
    ├── yasuo.json
    └── ...
```

### Checkpoint Structure

Each champion checkpoint tracks:
- **Stage**: `pending` → `scraping` → `downloading` → `processing` → `concatenating` → `completed`
- **Audio Files**: URLs, download status, checksums
- **Statistics**: Total/downloaded/processed file counts
- **Errors**: Failure details if any

### Graceful Shutdown

Press **Ctrl+C** once to gracefully stop:
- Current file finishes downloading/processing
- Checkpoint is saved
- Can resume later with `resume` command

Press **Ctrl+C** twice to force quit (may lose current file progress).

## Examples

### Example 1: Test with Single Champion

```bash
# Test the crawler with Aatrox
uv run champion-crawler scrape --champion Aatrox --output ./test-output

# Check results
ls -lh test-output/aatrox/
ls -lh ../voice-cloning/champion-voices/aatrox/
```

### Example 2: Process Specific Sample Rate

```bash
# Generate at 24kHz instead of default 22.05kHz
uv run champion-crawler scrape \
  --champion Yasuo \
  --sample-rate 24000 \
  --target-rms -12
```

### Example 3: Batch Processing with Resume

```bash
# Start processing all champions
uv run champion-crawler scrape

# ... interrupt with Ctrl+C after 10 champions ...

# Later, resume
uv run champion-crawler resume

# Check progress
uv run champion-crawler status --detailed
```

### Example 4: Custom Output Directory

```bash
# Save to custom location
uv run champion-crawler scrape \
  --champion Ahri \
  --final-output /path/to/custom/output
```

## Troubleshooting

### Download Failures

**Symptom**: HTTP 404 or connection errors

**Solutions**:
- Check internet connection
- Verify champion name spelling (case-sensitive)
- Some champions may have broken wiki links (will be marked as failed)
- Resume will automatically retry failed downloads

### Conversion Errors

**Symptom**: "Failed to convert OGG"

**Solutions**:
- Ensure ffmpeg is installed: `ffmpeg -version`
- Check disk space (each champion ~50-100 MB)
- Corrupted downloads will be automatically re-downloaded on resume

### Memory Issues

**Symptom**: "MemoryError" or slow processing

**Solutions**:
- Process one champion at a time: `--champion ChampionName`
- Reduce sample rate: `--sample-rate 16000`
- Close other applications

### State Corruption

**Symptom**: "Failed to load checkpoint"

**Solutions**:
- Reset state: `uv run champion-crawler scrape --reset`
- Manually delete `.crawlerstate/` directory

## Performance

**Single Champion** (e.g., Aatrox with ~87 voice lines):
- Scraping: ~10 seconds
- Downloading: ~30-60 seconds
- Processing: ~45 seconds
- Concatenating: ~5 seconds
- **Total**: ~2 minutes

**All Champions** (167 champions):
- **Estimated**: 8-12 hours (with rate limiting)
- **Network**: ~2-3 GB download
- **Disk Space**: ~5-8 GB (temporary + final)

## Rate Limiting & Ethics

This crawler includes:
- **500ms delay** between requests (respectful to wiki servers)
- **User-Agent** header for identification
- **Automatic retry** with exponential backoff on errors
- **Checkpoint system** to avoid re-downloading on failures

Please use responsibly and follow League of Legends' terms of service.

## Development

### Project Structure

```
champion-audio-crawler/
├── src/champion_crawler/
│   ├── cli.py              # Command-line interface
│   ├── scraper.py          # Wiki scraping logic
│   ├── processor.py        # Audio processing pipeline
│   ├── concatenator.py     # WAV concatenation
│   ├── state_manager.py    # Progress tracking & resume
│   └── models.py           # Data classes
├── tests/                  # Unit tests
├── pyproject.toml          # Dependencies
└── README.md              # This file
```

### Running Tests

```bash
# Install dev dependencies
uv sync --all-extras

# Run tests
uv run pytest
```

### Adding New Features

1. Edit source files in `src/champion_crawler/`
2. Re-install: `uv sync`
3. Test with single champion: `uv run champion-crawler scrape --champion TestChampion`

## Integration with Voice Cloning

This crawler outputs directly to the `voice-cloning/champion-voices/` structure:

```bash
# After running crawler
cd ../voice-cloning

# Test with generated reference
python scripts/generate_dynamic_voice.py \
  --champion aatrox \
  --text "Your enemies approach!" \
  --output test_aatrox.wav

# Listen to test_aatrox.wav
```

**Note**: `reference.txt` contains placeholder transcriptions. For best voice cloning results, manually transcribe the audio files.

## FAQ

**Q: Can I scrape only specific categories of voice lines (e.g., attacks, movements)?**
A: Currently, the crawler extracts all Original skin audio. You can manually filter from `raw_clips/` after processing.

**Q: What about champion skins (Justicar, Mecha, etc.)?**
A: This crawler only extracts Original skin voices. Skin variants are intentionally filtered out.

**Q: Can I pause and resume on different machines?**
A: No, `.crawlerstate/` is local. To resume on another machine, copy the entire `champion-audio-crawler/` directory including `.crawlerstate/` and `output/`.

**Q: Why are some audio files missing?**
A: Some champions have fewer voice lines, or wiki pages may have broken links. Check the detailed status for specific failures.

**Q: Can I customize the audio processing?**
A: Yes! Adjust `--sample-rate` (default 22050) and `--target-rms` (default -10 dB) when running `scrape` or `resume`.

## License

This tool is for educational and personal use only. League of Legends, champion names, and audio content are © Riot Games.

## Acknowledgments

- League of Legends Wiki: https://wiki.leagueoflegends.com/
- BeautifulSoup: HTML parsing
- librosa & soundfile: Audio processing
- Rich: Beautiful CLI output
