"""
Filesystem layout for raw uploads, processed WAVs, and generated exports.

All paths derive from config.STORAGE_BASE_PATH, which is absolute and anchored
to the project root so it matches the ./storage mount used in Docker.
"""

import os

from ..config import STORAGE_BASE_PATH

STORAGE_DIR = str(STORAGE_BASE_PATH)
RAW_DIR = os.path.join(STORAGE_DIR, "raw")
PROCESSED_DIR = os.path.join(STORAGE_DIR, "processed")
EXPORTS_DIR = os.path.join(STORAGE_DIR, "exports")


def init_storage():
    """Ensure all storage directories exist."""
    os.makedirs(RAW_DIR, exist_ok=True)
    os.makedirs(PROCESSED_DIR, exist_ok=True)
    os.makedirs(EXPORTS_DIR, exist_ok=True)


def get_raw_path(clip_id: str, mime_type: str) -> str:
    """Returns the absolute path where the raw clip should be saved."""
    # Determine extension from mime_type
    ext = "webm"
    if "mp4" in mime_type:
        ext = "mp4"
    elif "wav" in mime_type:
        ext = "wav"
    elif "ogg" in mime_type:
        ext = "ogg"

    return os.path.join(RAW_DIR, f"clip_{clip_id}.{ext}")


def get_processed_path(filename: str) -> str:
    """Returns the absolute path where the processed WAV file should be saved."""
    # basename() keeps a crafted filename from escaping the directory.
    return os.path.join(PROCESSED_DIR, os.path.basename(filename))


def get_export_path(filename: str) -> str:
    """Returns the absolute path where exported files should be placed."""
    return os.path.join(EXPORTS_DIR, os.path.basename(filename))
