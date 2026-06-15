import type { ChordResult, BeatResult, StemResult, UploadResult } from '@/types';

const BACKEND = process.env.PYTHON_API_URL ?? 'http://localhost:5001';

// ── Internal helpers ──────────────────────────────────────────────────────────

async function post<T>(endpoint: string, body: FormData): Promise<T> {
  const res = await fetch(`${BACKEND}${endpoint}`, { method: 'POST', body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `${endpoint} returned ${res.status}`);
  }
  return res.json();
}

function pathForm(audioPath: string): FormData {
  const form = new FormData();
  form.append('audio_path', audioPath);
  return form;
}

function fileForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

// ── Upload (browser → backend) ────────────────────────────────────────────────

export async function uploadAudio(
  fullMix: File,
  harmonicStem: File | null
): Promise<UploadResult> {
  const form = new FormData();
  form.append('full_mix', fullMix);
  if (harmonicStem) form.append('harmonic_stem', harmonicStem);
  return post<UploadResult>('/api/upload-audio', form);
}

// ── ML calls (path-based, preferred after upload) ─────────────────────────────

export async function recognizeChordsFromPath(path: string): Promise<ChordResult> {
  return post<ChordResult>('/api/recognize-chords', pathForm(path));
}

export async function detectBeatsFromPath(path: string): Promise<BeatResult> {
  return post<BeatResult>('/api/detect-beats', pathForm(path));
}

export async function separateStemsFromPath(path: string): Promise<StemResult> {
  return post<StemResult>('/api/separate-stems', pathForm(path));
}

// ── ML calls (file-based fallback) ────────────────────────────────────────────

export async function recognizeChords(file: File): Promise<ChordResult> {
  return post<ChordResult>('/api/recognize-chords', fileForm(file));
}

export async function detectBeats(file: File): Promise<BeatResult> {
  return post<BeatResult>('/api/detect-beats', fileForm(file));
}

export async function separateStems(file: File): Promise<StemResult> {
  return post<StemResult>('/api/separate-stems', fileForm(file));
}

// ── Stem file serving ─────────────────────────────────────────────────────────

export function stemUrl(relativePath: string): string {
  return `${BACKEND}${relativePath}`;
}
