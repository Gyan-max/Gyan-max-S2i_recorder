"""
Central configuration for the S2I Recorder API.

All paths are absolute and anchored to the project root so that the database
and storage locations do not change with the working directory.
"""

import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

# ==================== Paths ====================
# config.py lives at <root>/api/app/config.py, so the project root is 3 levels up.
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
ENV_FILE = PROJECT_ROOT / ".env"

# override=False so real env vars (Docker, systemd, Render) beat the .env file.
load_dotenv(ENV_FILE, override=False)


def _get_path(name: str, default: Path) -> Path:
    """Resolves a path setting, treating relative values as project-root relative."""
    raw = os.getenv(name)
    if not raw:
        return default
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = PROJECT_ROOT / candidate
    return candidate.resolve()


# ==================== Environment ====================
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV == "production"

# ==================== Database ====================
# Absolute by default so the database never depends on the working directory.
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "s2i_recorder.db"
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
if not DATABASE_URL:
    DEFAULT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Four slashes total: sqlite+aiosqlite:/// + /absolute/path
    DATABASE_URL = f"sqlite+aiosqlite:///{DEFAULT_DB_PATH}"

# ==================== Storage ====================
# Project root, not api/, so it matches the ./storage mount in docker-compose.
STORAGE_BASE_PATH = _get_path("STORAGE_BASE_PATH", PROJECT_ROOT / "storage")
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "25"))
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024

# A denylist, not an allowlist: MediaRecorder does not reliably report audio/*.
# Chrome emits video/webm for audio-only tracks, and some clients send
# application/octet-stream. Auth, ownership and the size cap do the real work.
BLOCKED_UPLOAD_MIME_PREFIXES = (
    "text/",
    "image/",
    "application/json",
    "application/javascript",
    "application/x-httpd-php",
    "application/xml",
)

# ==================== Security & Auth ====================
_DEFAULT_DEV_SECRET = "dev-only-insecure-secret-do-not-use-in-production"
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "").strip()
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("ACCESS_TOKEN_EXPIRE_HOURS", "8"))

# Brute-force protection on the admin login endpoint.
LOGIN_MAX_ATTEMPTS = int(os.getenv("LOGIN_MAX_ATTEMPTS", "10"))
LOGIN_LOCKOUT_SECONDS = int(os.getenv("LOGIN_LOCKOUT_SECONDS", "300"))

# ==================== CORS ====================
_cors_raw = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173",
)
CORS_ORIGINS = [origin.strip() for origin in _cors_raw.split(",") if origin.strip()]

# ==================== Audio Quality Control ====================
QC_MIN_DURATION_S = float(os.getenv("QC_MIN_DURATION_S", "0.8"))
QC_MAX_DURATION_S = float(os.getenv("QC_MAX_DURATION_S", "15.0"))
QC_MIN_SNR_DB = float(os.getenv("QC_MIN_SNR_DB", "12.0"))

# ==================== Audio Processing ====================
FFMPEG_PATH = os.getenv("FFMPEG_PATH", "ffmpeg")
TARGET_SAMPLE_RATE = int(os.getenv("TARGET_SAMPLE_RATE", "16000"))
TARGET_CHANNELS = int(os.getenv("TARGET_CHANNELS", "1"))
ASR_PROVIDER = os.getenv("ASR_PROVIDER", "mock").strip().lower()


class ConfigurationError(RuntimeError):
    """Raised when the process is unsafe to start with the given settings."""


def validate_config() -> list[str]:
    """
    Applies environment-appropriate safety rules.

    Production fails hard on missing or default credentials. Development fills
    in safe values and returns warnings so local setup stays frictionless.
    """
    global SECRET_KEY, ADMIN_PASSWORD

    warnings: list[str] = []
    errors: list[str] = []

    if not SECRET_KEY or SECRET_KEY == _DEFAULT_DEV_SECRET:
        if IS_PRODUCTION:
            errors.append(
                "JWT_SECRET_KEY must be set to a strong random value in production "
                "(generate one with: openssl rand -hex 32)."
            )
        else:
            # Per-process random key, so no weak key is baked into the source.
            SECRET_KEY = secrets.token_hex(32)
            warnings.append(
                "JWT_SECRET_KEY not set - generated an ephemeral development key. "
                "Admin sessions will end when the server restarts."
            )
    elif len(SECRET_KEY) < 32 and IS_PRODUCTION:
        errors.append("JWT_SECRET_KEY must be at least 32 characters in production.")

    if not ADMIN_PASSWORD:
        if IS_PRODUCTION:
            errors.append("ADMIN_PASSWORD must be set in production.")
        else:
            ADMIN_PASSWORD = "admin123"
            warnings.append(
                "ADMIN_PASSWORD not set - using the development default 'admin123'. "
                "Never deploy with this."
            )
    elif IS_PRODUCTION and ADMIN_PASSWORD in {"admin123", "admin", "password", "changeme"}:
        errors.append("ADMIN_PASSWORD is a well-known default and cannot be used in production.")

    if IS_PRODUCTION and not CORS_ORIGINS:
        errors.append("CORS_ORIGINS must list explicit origins in production.")

    if errors:
        raise ConfigurationError(
            "Refusing to start due to unsafe configuration:\n  - " + "\n  - ".join(errors)
        )

    return warnings
