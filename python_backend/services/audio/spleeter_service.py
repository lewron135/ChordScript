"""
Spleeter service stub — Spleeter has been removed; Demucs is used instead.
This module exists only so existing imports do not break.
"""

from typing import Dict, Any, List, Optional
from utils.logging import log_debug


class SpleeterService:
    """Stub service — always reports unavailable. Use DemucsService instead."""

    def __init__(self):
        pass

    def is_available(self) -> bool:
        log_debug("SpleeterService.is_available: Spleeter has been removed; returning False")
        return False

    def separate_audio(self, audio_path: str, model_name: str = '2stems-16kHz',
                       output_dir: Optional[str] = None) -> Dict[str, Any]:
        return {"success": False, "error": "Spleeter has been removed. Use Demucs instead."}

    def extract_vocals(self, audio_path: str, output_dir: Optional[str] = None) -> Dict[str, Any]:
        return {"success": False, "error": "Spleeter has been removed. Use Demucs instead."}

    def cleanup_stems(self, stems_info: Dict[str, Any]) -> bool:
        return True

    def get_available_models(self) -> List[str]:
        return []

    def get_model_info(self) -> Dict[str, Any]:
        return {"available": False, "models": {}}
