import os
from typing import Tuple

# Define local storage paths at the workspace root
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
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
    
    return os.path.join(RAW_DIR, f"clip_{clip_id}.{ext}")

def get_processed_path(filename: str) -> str:
    """Returns the absolute path where the processed WAV file should be saved."""
    return os.path.join(PROCESSED_DIR, filename)

def get_export_path(filename: str) -> str:
    """Returns the absolute path where exported files should be placed."""
    return os.path.join(EXPORTS_DIR, filename)
