# ChordScript

Audio-driven chord chart generator and practice tool for worship teams.

Upload your multitrack stems, get a synchronized lead sheet with editable chords, and let your team rehearse with karaoke-style playback — all in one place.

---

## Overview

ChordScript is a self-hosted web app built for worship musicians who arrange their own songs in a DAW or sequencer. Instead of transcribing chord charts by ear, you export two mixes from your project: a clean harmonic stem for accurate chord detection, and your full mix for playback. ChordScript handles the rest.

It is built on top of [ChordMiniApp](https://github.com/ptnghia-j/ChordMiniApp) for chord and beat analysis, extended with a lyrics input system, an inline chord editor, and a karaoke sync mode for team practice.

---

## Features

- Dual audio input: harmonic stem for detection, full mix for playback
- Chord and beat detection powered by ChordMini CNN-LSTM (self-hosted)
- Manual lyrics input with optional Whisper STT verification
- Synchronized lyrics-to-chord alignment
- Inline chord chart editor — click any chord to change it
- Firebase-backed storage for songs and audio
- Karaoke sync mode: highlights current chord and lyric line as the song plays
- Exportable chord charts for printing or sharing

---

## How It Works

Most chord recognition tools struggle with full band mixes because drums, bass, and vocals obscure the harmonic content. ChordScript avoids this problem by splitting the input.

**Input 1 — Harmonic stem:** Export only your piano, strings, and guitar tracks from your DAW with minimal reverb. This clean signal is sent to the ChordMini backend for chord and beat analysis. Accuracy on a well-prepared stem typically reaches 88–95%.

**Input 2 — Full mix:** Your complete production export. This is stored in Firebase and streamed during karaoke playback so your team hears the real arrangement.

**Lyrics:** You paste the lyrics manually. Optionally, you can also export an isolated vocal track and run it through Whisper STT to auto-generate timestamps, which ChordScript then aligns to your pasted text.

The result is a timestamped chord chart that syncs chord changes to lyric lines, editable before saving.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (TypeScript) |
| Chord and beat detection | ChordMini (Python / Flask, self-hosted) |
| ML models | Chord-CNN-LSTM, Beat-Transformer, madmom |
| Speech-to-text (optional) | OpenAI Whisper (local) |
| Lyric alignment | whisperx / custom NLP alignment |
| Database and storage | Firebase Firestore + Firebase Storage |
| Audio playback sync | Web Audio API |
| Deployment | Docker |

---

## Prerequisites

- Node.js 18+
- Python 3.9–3.11
- Git with Git LFS
- Docker and Docker Compose (recommended for production)
- Firebase project (free tier is sufficient)
- A DAW or sequencer capable of exporting stems separately

---

## Getting Started

### 1. Clone the repository

```bash
git lfs install
git clone --recursive https://github.com/your-username/ChordScript.git
cd ChordScript
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` with your Firebase credentials and backend URL:

```env
NEXT_PUBLIC_PYTHON_API_URL=http://localhost:5001
NEXT_PUBLIC_FIREBASE_API_KEY=your_key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

### 3. Start the Python backend

```bash
cd python_backend
python -m venv env
source env/bin/activate       # Windows: env\Scripts\activate
pip install -r requirements.txt
python app.py
```

### 4. Start the frontend

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Preparing Your Audio in a DAW

For best chord detection results:

- Export your **harmonic stem** with piano, strings, and guitar only
- Keep effects light — avoid heavy reverb or delay on the stem export
- Supported formats: WAV, MP3, FLAC (up to 50 MB per file)
- Export your **full mix** separately as a second file — this is what plays during karaoke mode

---

## Project Structure

```
ChordScript/
├── src/                    # Next.js frontend
│   ├── components/
│   │   ├── ChordEditor/    # Inline chord chart editor
│   │   ├── KaraokePlayer/  # Sync playback with highlights
│   │   └── LyricsInput/    # Manual lyrics entry + alignment
│   └── pages/
├── python_backend/         # Flask API — chord and beat detection
│   ├── models/             # ChordMini, Beat-Transformer, madmom
│   └── app.py
├── firebase/               # Firestore rules and indexes
├── docker/
└── docs/
```

---

## Roadmap

- [ ] Harmonic stem + full mix dual upload UI
- [ ] Lyrics input with manual timestamp anchoring
- [ ] Whisper STT integration for optional auto-alignment
- [ ] Inline chord editor (click to change chord)
- [ ] Karaoke sync mode with beat-accurate highlights
- [ ] Song library with search
- [ ] Chord chart export to PDF
- [ ] Transpose support
- [ ] Mobile-friendly practice view

---

## Acknowledgements

ChordScript is built on top of [ChordMiniApp](https://github.com/ptnghia-j/ChordMiniApp) by Nghia Phan, which provides the chord recognition and beat detection engine. This project would not exist without that foundation.

---

## License

MIT
