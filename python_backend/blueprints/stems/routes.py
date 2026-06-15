"""
Stem separation routes for ChordScript.

POST /api/separate-stems        — run Demucs on a file upload or a server-side path.
GET  /api/stems/<job_id>/<stem> — serve a separated stem WAV file.
"""

import os
import re
import tempfile
import traceback
from flask import Blueprint, request, jsonify, send_file, current_app
from extensions import limiter
from config import get_config
from utils.logging import log_info, log_error

stems_bp = Blueprint('stems', __name__)
config = get_config()

ALLOWED_STEMS = {'vocals', 'drums', 'bass', 'other'}
ALLOWED_EXTENSIONS = {'.wav', '.mp3', '.flac', '.aiff', '.aif', '.m4a', '.ogg'}


@stems_bp.route('/api/separate-stems', methods=['POST'])
@limiter.limit(config.get_rate_limit('heavy_processing'))
def separate_stems():
    """
    Separate a full-mix audio file into 4 stems using Demucs htdemucs.

    Accepts either:
    - audio_path (form field) — path to a file already on the server
    - file       (multipart)  — a direct file upload

    Returns:
    {
        "success": true,
        "job_id": "<uuid>",
        "stems": {
            "vocals": "/api/stems/<job_id>/vocals",
            "drums":  "/api/stems/<job_id>/drums",
            "bass":   "/api/stems/<job_id>/bass",
            "other":  "/api/stems/<job_id>/other"
        },
        "processing_time": 42.3
    }
    """
    demucs_service = current_app.extensions['services'].get('demucs')
    if demucs_service is None:
        return jsonify({"success": False, "error": "Demucs service not available"}), 503

    audio_path = request.form.get('audio_path')

    if audio_path:
        # ── Path-based (preferred) ─────────────────────────────────────────
        if not os.path.exists(audio_path):
            return jsonify({"success": False,
                            "error": f"Audio file not found: {audio_path}"}), 404

        log_info(f"Stem separation from server path: {audio_path} "
                 f"({os.path.getsize(audio_path) / 1024 / 1024:.1f} MB)")

        try:
            result = demucs_service.separate(audio_path)
            return jsonify(result), (200 if result.get('success') else 500)
        except Exception as e:
            log_error(f"separate_stems (path) error: {e}\n{traceback.format_exc()}")
            return jsonify({"success": False, "error": str(e)}), 500

    elif 'file' in request.files:
        # ── File upload fallback ───────────────────────────────────────────
        file = request.files['file']
        if not file.filename:
            return jsonify({"success": False, "error": "Empty filename"}), 400

        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            return jsonify({"success": False,
                            "error": f"Unsupported file type: {ext}"}), 400

        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
                file.save(tmp.name)
                temp_path = tmp.name

            log_info(f"Stem separation from upload: {file.filename} "
                     f"({os.path.getsize(temp_path) / 1024 / 1024:.1f} MB)")

            result = demucs_service.separate(temp_path)
            return jsonify(result), (200 if result.get('success') else 500)

        except Exception as e:
            log_error(f"separate_stems (upload) error: {e}\n{traceback.format_exc()}")
            return jsonify({"success": False, "error": str(e)}), 500
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except Exception:
                    pass

    else:
        return jsonify({"success": False,
                        "error": "Provide either audio_path or a file upload"}), 400


@stems_bp.route('/api/stems/<job_id>/<stem_name>', methods=['GET'])
def serve_stem(job_id: str, stem_name: str):
    """Serve a separated stem WAV file by job_id and stem_name."""
    if stem_name not in ALLOWED_STEMS:
        return jsonify({"error": f"Unknown stem: {stem_name}"}), 404

    if not re.fullmatch(r'[0-9a-f-]{36}', job_id):
        return jsonify({"error": "Invalid job_id"}), 400

    demucs_service = current_app.extensions['services'].get('demucs')
    if demucs_service is None:
        return jsonify({"error": "Demucs service not available"}), 503

    stem_path = demucs_service.get_stem_path(job_id, stem_name)
    if stem_path is None:
        return jsonify({"error": "Stem not found — job may have expired or failed"}), 404

    return send_file(stem_path, mimetype='audio/wav',
                     as_attachment=False,
                     download_name=f'{stem_name}.wav')
