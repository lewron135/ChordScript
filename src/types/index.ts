export interface ChordEntry {
  start: number;
  end: number;
  chord: string;
  confidence: number;
}

export interface ChordResult {
  success: boolean;
  chords: ChordEntry[];
  total_chords: number;
  duration: number;
  model_used: string;
  chord_dict: string;
  error?: string;
}

export interface BeatResult {
  success: boolean;
  beats: number[];
  downbeats: number[];
  total_beats: number;
  total_downbeats: number;
  bpm: number;
  time_signature: string;
  error?: string;
}

export interface StemUrls {
  vocals: string;
  drums: string;
  bass: string;
  other: string;
}

export interface InstrumentalRegion {
  start: number;
  end: number;
}

export interface StemResult {
  success: boolean;
  job_id: string;
  stems: StemUrls;
  processing_time: number;
  instrumental_regions?: InstrumentalRegion[];
  error?: string;
}

export interface UploadResult {
  success: boolean;
  job_id: string;
  full_mix_path: string;
  harmonic_path: string | null;
}

export interface AnalysisResult {
  chords: ChordResult;
  beats: BeatResult;
  lyrics: string;
  firestoreId: string | null;
}

export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export interface StepsState {
  upload: StepStatus;
  chords: StepStatus;
  beats: StepStatus;
  stems: StepStatus;
  save: StepStatus;
}
