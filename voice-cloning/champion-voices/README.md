# Champion Voice Samples

This directory contains reference voice samples for each champion you want to clone.

## Adding a New Champion

For each champion, create a directory with three files:

### 1. `reference.wav`
- **Format**: WAV audio file
- **Duration**: 10-15 seconds
- **Sample Rate**: 24000 Hz (24kHz)
- **Channels**: Mono (1 channel)
- **Quality**: Clean speech, no background music/effects

### 2. `reference.txt`
- Plain text file containing the **exact transcription** of `reference.wav`
- Must match the audio perfectly (word-for-word)
- Include all words, pauses are optional

### 3. `metadata.json`
- JSON file with champion information
- Required fields: `championId`, `championName`, `voiceActor`, `sampleDuration`, `sampleRate`, `channels`, `sourceType`

## Example Directory Structure

```
champion-voices/
├── yasuo/
│   ├── reference.wav
│   ├── reference.txt
│   └── metadata.json
├── ahri/
│   ├── reference.wav
│   ├── reference.txt
│   └── metadata.json
└── zed/
    ├── reference.wav
    ├── reference.txt
    └── metadata.json
```

## How to Get Voice Samples

### Option 1: Extract from League of Legends Game Files

**Tools needed:**
- [Obsidian](https://github.com/Crauzer/Obsidian) - WAD file extractor

**Steps:**
1. Navigate to League installation:
   ```
   C:/Riot Games/League of Legends/Game/DATA/FINAL/Champions/
   ```

2. Extract champion WAD file:
   ```bash
   obsidian extract Yasuo.wad.client --output ./yasuo-voice
   ```

3. Find voice files in:
   ```
   yasuo-voice/assets/sounds/wwise2016/vo/en_us/characters/yasuo/
   ```

4. Use Audacity to:
   - Combine 2-3 voice lines
   - Add 0.5s silence between lines
   - Resample to 24000 Hz
   - Convert to mono
   - Export as WAV

### Option 2: Download from League Wiki

1. Visit [League of Legends Wiki](https://leagueoflegends.fandom.com/wiki/Champions)
2. Go to champion's voice page (e.g., "Yasuo/LoL/Audio")
3. Download select/move/attack voice lines
4. Combine in Audacity (10-15s total)

### Option 3: Record from Practice Tool

1. Launch League → Practice Tool
2. Settings:
   - Music: 0%
   - Sound Effects: 0%
   - Voice: 100%

3. Use [OBS Studio](https://obsproject.com/) to record:
   - Audio only
   - 24000 Hz sample rate
   - Mono channel

4. Trigger voice lines (move, attack, abilities)
5. Trim to 10-15 second clip

## Audio Quality Tips

### ✅ Good Quality
- Clear, crisp voice
- No background music
- No sound effects
- Consistent volume
- 24kHz sample rate
- Mono channel

### ❌ Poor Quality
- Background music/effects
- Low sample rate (<24kHz)
- Stereo/surround sound
- Clipping/distortion
- Multiple voices talking

## Editing Voice Files in Audacity

### 1. Import Audio
- File → Import → Audio
- Select your voice clips

### 2. Remove Noise
- Effect → Noise Reduction
- Select silent portion → Get Noise Profile
- Select all → Reduce noise

### 3. Normalize Volume
- Effect → Normalize
- Set to -3 dB

### 4. Convert to Mono
- Tracks → Mix → Mix Stereo Down to Mono

### 5. Resample to 24kHz
- Tracks → Resample
- New sample rate: 24000 Hz

### 6. Combine Clips
- Select multiple voice lines
- Use Generate → Silence (0.5s) between clips
- Total duration: 10-15 seconds

### 7. Export
- File → Export → Export as WAV
- Encoding: Signed 16-bit PCM
- Sample Rate: 24000 Hz

## Current Champions

The example directories include metadata templates for:
- **Yasuo** - Liam O'Brien
- **Ahri** - Laura Post
- **Zed** - Kaiji Tang

**Note:** You must add the `reference.wav` file yourself by following one of the methods above.

## Recommended Champions to Add

Popular champions with distinctive voices:
- Jinx (Sarah Williams)
- Thresh (Sean Schemmel)
- Ekko (Miles Brown)
- Jhin (Quinton Flynn)
- Morgana (Erica Lindbeck)
- Ezreal (Kyle Hebert)
- Lux (Carrie Keranen)
- Lee Sin (Vic Mignogna)

## Verification Checklist

Before using a voice sample, verify:

- [ ] `reference.wav` exists and plays correctly
- [ ] Duration is 10-15 seconds
- [ ] Sample rate is 24000 Hz (check in Audacity)
- [ ] Audio is mono (1 channel)
- [ ] `reference.txt` matches audio word-for-word
- [ ] `metadata.json` has all required fields
- [ ] No background music or sound effects
- [ ] Voice is clear and understandable
