# Voice Cloning Setup for Champion Recap

This directory contains all scripts and data for generating champion voice clones using F5-TTS with **dynamic, context-aware generation**.

## 🎯 Dynamic Generation Approach

**NEW:** Instead of pre-generating preset phrases, this setup enables **real-time voice generation** where champions speak contextual, personalized coaching based on each player's unique stats while maintaining their authentic personality.

### How It Works:

1. **Collect Champion Voice Samples** - 10-15s reference audio (one-time setup)
2. **Define Champion Personalities** - Traits, speaking style, example lines
3. **AWS Bedrock Generates Coaching Text** - Personalized to player stats, stays in character
4. **F5-TTS Generates Audio** - Speaks the coaching text in champion's voice
5. **Cache in S3** - Reuse for similar coaching scenarios

### Benefits Over Preset Scripts:

- ✅ **Truly Personalized** - References player's specific champions, stats, and playstyle
- ✅ **Champion Personality Intact** - Yasuo sounds philosophical, Jinx sounds chaotic, Thresh sounds menacing
- ✅ **Infinite Variety** - Not limited to 30-40 preset phrases
- ✅ **Cost Effective** - ~$0.01-0.05 per unique coaching clip, free for cached clips
- ✅ **Contextual** - Adapts to any stat combination dynamically

## Directory Structure

```
voice-cloning/
├── champion-voices/               # Source voice samples (you create these)
│   ├── yasuo/
│   │   ├── reference.wav          # 10-15s clean audio, 24kHz, mono
│   │   ├── reference.txt          # Exact transcription
│   │   └── metadata.json          # Champion metadata
│   ├── ahri/
│   └── zed/
├── scripts/                       # Python scripts
│   ├── test_f5_tts.py            # Test voice generation
│   ├── generate_dynamic_voice.py  # 🆕 Generate voice from ANY text
│   ├── optimize_audio.py          # Convert WAV to MP3
│   └── upload_to_s3.py            # Upload to AWS S3
├── champion-personalities.json    # 🆕 Champion personality definitions
├── bedrock-coaching-prompts.json  # 🆕 AI coaching prompt templates
├── requirements.txt               # Python dependencies
├── README.md                      # This file
├── SETUP_GUIDE.md                 # Complete setup instructions
└── DYNAMIC_GENERATION_GUIDE.md    # 🆕 Guide for dynamic generation
```

## Setup Instructions

### 1. Create Python Environment

#### Option A: Using conda (recommended)
```bash
conda create -n voice-cloning python=3.10
conda activate voice-cloning
```

#### Option B: Using venv
```bash
python3.10 -m venv venv
source venv/bin/activate  # Linux/Mac
# OR
venv\Scripts\activate     # Windows
```

### 2. Install Dependencies

#### For GPU (NVIDIA with CUDA 11.8+)
```bash
# Install PyTorch with CUDA
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Install F5-TTS
pip install git+https://github.com/SWivid/F5-TTS.git

# Install other dependencies
pip install -r requirements.txt
```

#### For CPU Only
```bash
# Install PyTorch (CPU)
pip install torch torchvision torchaudio

# Install F5-TTS
pip install git+https://github.com/SWivid/F5-TTS.git

# Install other dependencies
pip install -r requirements.txt
```

### 3. Verify Installation

```bash
python -c "import torch; print(f'PyTorch: {torch.__version__}')"
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
```

Expected output:
```
PyTorch: 2.x.x
CUDA available: True  # (or False if CPU-only)
```

## Quick Start: Dynamic Generation

### Test Dynamic Voice Generation

Generate voice from ANY text (not just presets):

```bash
cd scripts

# Generate custom coaching text
python generate_dynamic_voice.py \
  --champion yasuo \
  --text "You played well, Summoner. Your 67 percent win rate on Riven shows dedication. But Darius still counters you. Learn his cooldowns." \
  --output ../test_yasuo_dynamic.wav

# Listen to the result
# The voice will sound like Yasuo speaking YOUR custom text!
```

**This is the key difference:** F5-TTS can speak **any text you provide**, not just preset phrases!

## Traditional Workflow (For Reference)

### Step 1: Prepare Champion Voice Samples

1. Create a directory for each champion in `champion-voices/`
2. Add three files per champion:
   - `reference.wav` - 10-15 seconds of clean voice audio (24kHz, mono)
   - `reference.txt` - Exact transcription of the audio
   - `metadata.json` - Champion information

**Example `yasuo/reference.txt`:**
```
Death is like the wind; always by my side. No cure for fools. My honor left a long time ago.
```

**Example `yasuo/metadata.json`:**
```json
{
  "championId": "Yasuo",
  "championName": "Yasuo",
  "voiceActor": "Liam O'Brien",
  "sampleDuration": 12.5,
  "sampleRate": 24000,
  "channels": 1,
  "sourceType": "game_files",
  "notes": "Clean voice lines from select/move commands"
}
```

### Step 2: Test Voice Generation

Test with a single champion first:

```bash
cd scripts
python test_f5_tts.py
```

This will generate `test_yasuo_greeting.wav` to verify everything works.

### Step 3: Batch Generate All Voices

Generate audio for all champions in `coaching-scripts.json`:

```bash
cd scripts
python generate_all_voices.py \
  --champions-dir ../champion-voices \
  --scripts ../coaching-scripts.json \
  --output-dir ../generated-audio \
  --model f5-tts
```

**Generation time estimates:**
- CPU: ~5-10 seconds per phrase (hours for full dataset)
- GPU (GTX 1660+): ~0.5-1 second per phrase (30-60 minutes for full dataset)

### Step 4: Optimize Audio Files

Convert WAV to MP3 for smaller file sizes:

```bash
cd scripts
python optimize_audio.py
```

**File size reduction:**
- Before: ~500KB per WAV file
- After: ~30-50KB per MP3 file (64kbps)
- Total savings: ~90% reduction

### Step 5: Upload to S3

Upload optimized files to AWS S3:

```bash
cd scripts
python upload_to_s3.py \
  --audio-dir ../generated-audio-mp3 \
  --bucket champion-recap-voices \
  --region us-east-1
```

## Hardware Requirements

### Minimum (CPU only)
- CPU: 4+ cores
- RAM: 8GB+
- Disk: 10GB free space
- Generation time: ~5-10s per phrase

### Recommended (GPU)
- GPU: NVIDIA with 4GB+ VRAM (GTX 1660 or better)
- CUDA: 11.8+
- Generation time: ~0.5-1s per phrase (10-20x faster)

## Coaching Scripts

The `coaching-scripts.json` file contains template phrases organized by category:

- **greeting**: Welcome messages
- **topChampion**: Praise for most-played champions
- **nemesis**: Advice for countering problem champions
- **favorite**: Comments on favorite teammate champions
- **hated**: Analysis of problematic enemy champions
- **improvement**: General gameplay tips
- **encouragement**: Motivational messages
- **stats**: Statistical summaries

Each category has 3-8 variations. Total: ~40-50 phrases per champion.

## Troubleshooting

### CUDA Out of Memory
```bash
# Force CPU usage
export CUDA_VISIBLE_DEVICES=-1
python generate_all_voices.py ...
```

### Generated Audio is Robotic
- Ensure reference audio is 24kHz, mono
- Use 10-15 seconds of clean speech
- Remove background noise with Audacity
- Try different voice line combinations

### S3 Upload Access Denied
```bash
# Check AWS credentials
aws sts get-caller-identity
aws configure list

# Ensure IAM user has s3:PutObject permission
```

## Cost Estimates

**One-time generation costs:** FREE (local processing)

**Storage costs (AWS):**
- S3 Storage: ~5GB @ $0.023/GB = $0.12/month
- CloudFront: 100GB transfer @ $0.085/GB = $8.50/month
- **Total: ~$9/month** for serving 10,000 users

**Compare to:**
- Amazon Polly: $4 per 1M characters = $40/month
- **Savings: 77%**

## Next Steps After Setup

1. ✅ Install F5-TTS and dependencies
2. ✅ Collect 5+ champion voice samples
3. ✅ Test generation with one champion
4. ✅ Generate full voice library
5. ✅ Optimize to MP3 format
6. ✅ Upload to S3 bucket
7. ⏭️ Integrate into frontend (see main VOICE_CLONING_GUIDE.md)

## Support

For issues:
- Check main `VOICE_CLONING_GUIDE.md` troubleshooting section
- Review [F5-TTS GitHub](https://github.com/SWivid/F5-TTS)
- Check CloudWatch logs for AWS errors
- Verify audio quality with Audacity

## Champion Voice Sources

### Option A: Extract from Game Files
1. Use [Obsidian](https://github.com/Crauzer/Obsidian) to extract WAD files
2. Find voice files in `assets/sounds/wwise2016/vo/en_us/characters/`

### Option B: League Wiki
1. Visit champion voice pages on League of Legends Wiki
2. Download voice lines
3. Combine in Audacity (10-15s total)

### Option C: Record from Practice Tool
1. Launch Practice Tool with voice at 100%
2. Use OBS Studio to record audio only
3. Trigger various voice lines
4. Edit to 10-15s clean clip
