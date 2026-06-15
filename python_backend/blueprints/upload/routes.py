"""
Audio upload endpoint for ChordScript.

POST /api/upload-audio
  Accepts full_mix (required) and harmonic_stem (optional) as multipart files.
  Saves them to /tmp/chordscript-audio/<job_id>/ and returns their server-side
  paths so downstream ML endpoints can reference them via audio_path without
  re-uploading the raw bytes.

Files in /tmp are cleaned up by the OS on reboot; no explicit cleanup is needed
for this local-dev use case.
"""

import os
import shutil
import uuid
from pathlib import Path

from flask import Blueprint, request, jsonify
from extensions import limiter
from config import get_config
from utils.logging import log_info, log_error

upload_bp = Blueprint('upload', __name__)
config = get_config()

AUDIO_BASE_DIR = Path('/tmp/chordscript-audio')
ALLOWED_EXTENSIONS = {'.wav', '.mp3', '.flac', '.aiff', '.aif', '.m4a', '.ogg'}


@upload_bp.route('/api/upload-audio', methods=['POST'])
@limiter.limit(config.get_rate_limit('moderate_processing'))
def upload_audio():
    """
    Receive audio files from the browser and persist them server-side.

    Form fields:
    - full_mix      (file, required)
    - harmonic_stem (file, optional)

    Returns:
    {
        "success": true,
        "job_id": "<uuid>",
        "full_mix_path": "/tmp/chordscript-audio/<job_id>/full_mix.<ext>",
        "harmonic_path": "/tmp/chordscript-audio/<job_id>/harmonic_stem.<ext>" | null
    }
    """
    full_mix = request.files.get('full_mix')
    if not full_mix or not full_mix.filename:
        return jsonify({'success': False, 'error': 'full_mix file is required'}), 400

    full_mix_ext = os.path.splitext(full_mix.filename)[1].lower()
    if full_mix_ext not in ALLOWED_EXTENSIONS:
        return jsonify({'success': False,
                        'error': f'Unsupported file type: {full_mix_ext}'}), 400

    job_id = str(uuid.uuid4())
    job_dir = AUDIO_BASE_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    try:
        full_mix_path = str(job_dir / f'full_mix{full_mix_ext}')
        full_mix.save(full_mix_path)
        log_info(f"Saved full_mix → {full_mix_path} "
                 f"({os.path.getsize(full_mix_path) / 1024 / 1024:.1f} MB)")

        harmonic_path = None
        harmonic_stem = request.files.get('harmonic_stem')
        if harmonic_stem and harmonic_stem.filename:
            harmonic_ext = os.path.splitext(harmonic_stem.filename)[1].lower()
            if harmonic_ext in ALLOWED_EXTENSIONS:
                harmonic_path = str(job_dir / f'harmonic_stem{harmonic_ext}')
                harmonic_stem.save(harmonic_path)
                log_info(f"Saved harmonic_stem → {harmonic_path} "
                         f"({os.path.getsize(harmonic_path) / 1024 / 1024:.1f} MB)")

        return jsonify({
            'success': True,
            'job_id': job_id,
            'full_mix_path': full_mix_path,
            'harmonic_path': harmonic_path,
        })

    except Exception as e:
        shutil.rmtree(str(job_dir), ignore_errors=True)
        log_error(f"upload_audio error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
