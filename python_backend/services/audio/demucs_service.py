"""
Demucs audio source separation service.

Separates audio into 4 stems (vocals, drums, bass, other) using the
htdemucs model. Stems are stored in /tmp/chordscript-stems/{job_id}/
and served via the stems blueprint.
"""

import os
import sys
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional

from utils.logging import log_info, log_error, log_debug

STEMS_BASE_DIR = Path('/tmp/chordscript-stems')

STEM_NAMES = ['vocals', 'drums', 'bass', 'other']


class DemucsService:
    """Service for 4-stem audio separation using Demucs htdemucs model."""

    def __init__(self):
        self._available: Optional[bool] = None

    def is_available(self) -> bool:
        if self._available is not None:
            return self._available
        try:
            import demucs  # noqa: F401
            self._available = True
        except ImportError:
            log_error("Demucs not installed. Run: pip install demucs")
            self._available = False
        return self._available

    def separate(self, audio_path: str) -> Dict[str, Any]:
        """
        Separate audio into 4 stems using htdemucs.

        Args:
            audio_path: Path to the input audio file.

        Returns:
            {
                "success": bool,
                "job_id": str,
                "stems": {"vocals": url, "drums": url, "bass": url, "other": url},
                "processing_time": float,
                "error": str  (only on failure)
            }
        """
        if not self.is_available():
            return {"success": False, "error": "Demucs is not installed"}

        start_time = time.time()
        job_id = str(uuid.uuid4())
        job_dir = STEMS_BASE_DIR / job_id
        demucs_out = job_dir / 'demucs_output'
        job_dir.mkdir(parents=True, exist_ok=True)

        try:
            log_info(f"Starting Demucs separation — job {job_id}, input: {audio_path}")

            result = subprocess.run(
                [sys.executable, '-m', 'demucs', '-n', 'htdemucs',
                 '--out', str(demucs_out), audio_path],
                capture_output=True, text=True, timeout=900
            )

            if result.returncode != 0:
                raise RuntimeError(f"Demucs exited {result.returncode}: {result.stderr[-500:]}")

            # demucs writes to: {out}/htdemucs/{track_stem}/vocals.wav etc.
            input_stem = Path(audio_path).stem
            stem_dir = demucs_out / 'htdemucs' / input_stem

            if not stem_dir.exists():
                # demucs sometimes sanitises the filename
                candidates = list((demucs_out / 'htdemucs').iterdir())
                if candidates:
                    stem_dir = candidates[0]
                else:
                    raise RuntimeError(f"Demucs output directory not found: {stem_dir}")

            # Move stems to flat job dir for easy serving
            stems: Dict[str, str] = {}
            for stem_name in STEM_NAMES:
                src = stem_dir / f'{stem_name}.wav'
                if src.exists():
                    dest = job_dir / f'{stem_name}.wav'
                    shutil.move(str(src), str(dest))
                    stems[stem_name] = f'/api/stems/{job_id}/{stem_name}'
                    log_debug(f"Saved stem '{stem_name}' → {dest}")
                else:
                    log_error(f"Expected stem not found: {src}")

            # Clean up demucs scratch directory
            shutil.rmtree(str(demucs_out), ignore_errors=True)

            processing_time = time.time() - start_time
            log_info(f"Demucs separation complete — job {job_id} in {processing_time:.1f}s")

            # Detect instrumental regions from vocal energy
            instrumental_regions: List[Dict[str, float]] = []
            vocals_path_local = job_dir / 'vocals.wav'
            if vocals_path_local.exists():
                instrumental_regions = self.detect_instrumental_regions(
                    str(vocals_path_local)
                )
                log_info(f"Detected {len(instrumental_regions)} instrumental region(s)")

            return {
                "success": True,
                "job_id": job_id,
                "stems": stems,
                "processing_time": processing_time,
                "instrumental_regions": instrumental_regions,
            }

        except subprocess.TimeoutExpired:
            shutil.rmtree(str(job_dir), ignore_errors=True)
            return {"success": False, "error": "Demucs timed out after 15 minutes", "job_id": job_id}
        except Exception as e:
            shutil.rmtree(str(job_dir), ignore_errors=True)
            error_msg = f"Demucs separation error: {str(e)}"
            log_error(error_msg)
            return {"success": False, "error": error_msg, "job_id": job_id}

    def detect_instrumental_regions(
        self,
        vocals_path: str,
        threshold: float = 0.01,
        window_s: float = 0.5,
        min_region_s: float = 4.0,
        merge_gap_s: float = 2.0,
    ) -> List[Dict[str, float]]:
        """
        Return time ranges where the vocals stem is silent (RMS < threshold).
        These correspond to instrumental intros, outros, and interludes.
        """
        try:
            import numpy as np
            import librosa

            y, sr = librosa.load(vocals_path, sr=None, mono=True)
            hop = int(window_s * sr)
            frame_len = hop * 2

            rms = librosa.feature.rms(y=y, frame_length=frame_len, hop_length=hop)[0]
            times = librosa.frames_to_time(
                range(len(rms)), sr=sr, hop_length=hop
            )
            duration = float(len(y)) / sr

            # Collect raw silent spans
            raw: List[Dict[str, float]] = []
            in_region = False
            region_start = 0.0
            for t, energy in zip(times, rms):
                if float(energy) < threshold and not in_region:
                    in_region = True
                    region_start = float(t)
                elif float(energy) >= threshold and in_region:
                    in_region = False
                    raw.append({"start": round(region_start, 2),
                                "end": round(float(t), 2)})
            if in_region:
                raw.append({"start": round(region_start, 2),
                            "end": round(duration, 2)})

            if not raw:
                return []

            # Merge nearby regions
            merged = [raw[0].copy()]
            for r in raw[1:]:
                if r["start"] - merged[-1]["end"] < merge_gap_s:
                    merged[-1]["end"] = r["end"]
                else:
                    merged.append(r.copy())

            # Drop regions shorter than minimum
            return [r for r in merged if r["end"] - r["start"] >= min_region_s]

        except Exception as e:
            log_error(f"Instrumental region detection failed: {e}")
            return []

    def get_stem_path(self, job_id: str, stem_name: str) -> Optional[str]:
        """Return the filesystem path for a completed stem, or None if missing."""
        if stem_name not in STEM_NAMES:
            return None
        path = STEMS_BASE_DIR / job_id / f'{stem_name}.wav'
        return str(path) if path.exists() else None
