"""
Configuration for the Firebase backend.

Firebase supplies project identity and credentials through the runtime, so
there is far less to configure than the FastAPI deployment needed: no database
URL, no JWT secret, no admin password. Admin access is a custom claim on a
Firebase Auth user instead of a shared password, which means it can be granted
and revoked per person and leaves an audit trail.
"""

import os

# ==================== Collections ====================
# Firestore has no schema, so these names are the contract. Keep them in one
# place: a typo elsewhere silently creates a second, empty collection rather
# than raising.
SPEAKERS = "speakers"
DEVICES = "devices"
DEVICE_SPEAKERS = "device_speakers"
SCENARIOS = "scenarios"
TASKS = "tasks"
CLIPS = "clips"
WITHDRAWAL_AUDITS = "withdrawal_audits"
COUNTERS = "counters"

# ==================== Storage layout ====================
# Mirrors the on-disk layout the FastAPI version used, so the export manifest
# and any existing tooling keep the same shape.
RAW_PREFIX = "raw"
PROCESSED_PREFIX = "processed"
EXPORTS_PREFIX = "exports"

# Bucket name. Projects created before ~Oct 2024 default to
# "<project>.appspot.com"; newer ones use "<project>.firebasestorage.app".
# The Admin SDK's implicit default still assumes the older form, so relying on
# it silently targets a bucket that does not exist. Resolve it explicitly.
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET", "").strip() or None

# ==================== Consent ====================
CONSENT_VERSION = os.getenv("CONSENT_VERSION", "consent-v1")

# ==================== Upload limits ====================
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "25"))
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024

# A denylist, not an allowlist: MediaRecorder does not reliably report audio/*.
# Chrome emits video/webm for audio-only tracks and some clients send
# application/octet-stream. Auth, ownership and the size cap do the real work.
BLOCKED_UPLOAD_MIME_PREFIXES = (
    "text/",
    "image/",
    "application/json",
    "application/javascript",
    "application/x-httpd-php",
    "application/xml",
)

# Clips shorter than this are mis-taps, not utterances.
MIN_DURATION_S = 0.4

# ==================== Audio processing ====================
TARGET_SAMPLE_RATE = int(os.getenv("TARGET_SAMPLE_RATE", "16000"))
TARGET_CHANNELS = int(os.getenv("TARGET_CHANNELS", "1"))

# ==================== Quality control ====================
QC_MIN_DURATION_S = float(os.getenv("QC_MIN_DURATION_S", "0.8"))
QC_MAX_DURATION_S = float(os.getenv("QC_MAX_DURATION_S", "15.0"))
QC_MIN_SNR_DB = float(os.getenv("QC_MIN_SNR_DB", "12.0"))

# ==================== Corpus targets ====================
COVERAGE_FLOOR = int(os.getenv("COVERAGE_FLOOR", "40"))
DOMAINS = ["BNK", "EDU", "TRV", "VAS"]

# ==================== CORS ====================
# Comma-separated exact origins. Credentials are not used (the client sends a
# bearer ID token, not cookies), but keeping this explicit avoids handing a
# blanket wildcard to a browser that is about to send an Authorization header.
_cors_raw = os.getenv("CORS_ORIGINS", "").strip()
CORS_ORIGINS = [o.strip() for o in _cors_raw.split(",") if o.strip()]
