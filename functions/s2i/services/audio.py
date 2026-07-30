"""
Transcode + QC pipeline.

Runs in a Storage-triggered function after a raw upload lands. Mirrors the
FastAPI worker: WebM/MP4 in, 16 kHz mono WAV out, silence trimmed with padding
left at both ends, then QC.

ffmpeg is not present in the Cloud Functions Python runtime and there is no
apt layer to add it, so the binary ships via imageio-ffmpeg.
"""

import logging
import os
import subprocess
import tempfile
from typing import Optional, Tuple

from .. import config

logger = logging.getLogger(__name__)

FFMPEG_TIMEOUT_S = 120


class TranscodeUnavailableError(RuntimeError):
    """
    ffmpeg could not be run at all.

    Deliberately distinct from "ffmpeg ran and rejected the file". A missing or
    hung binary is an infrastructure fault and must never mark a volunteer's
    clip rejected - the recording is fine and deserves a retry.
    """


def ffmpeg_path() -> str:
    """Resolves the bundled ffmpeg binary."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:
        raise TranscodeUnavailableError(f"No ffmpeg binary available: {e}") from e


def transcode_to_wav(input_path: str, output_path: str) -> bool:
    """
    16 kHz mono PCM, silence trimmed with ~150ms padding retained.

    Returns False when ffmpeg ran but could not decode the input (a genuinely
    unusable recording). Raises TranscodeUnavailableError when ffmpeg itself
    could not run, so the caller can keep the clip for a later retry.
    """
    if not os.path.exists(input_path):
        logger.error("Raw input missing: %s", input_path)
        return False

    binary = ffmpeg_path()
    cmd = [
        binary, "-y", "-i", input_path,
        "-ar", str(config.TARGET_SAMPLE_RATE),
        "-ac", str(config.TARGET_CHANNELS),
        "-c:a", "pcm_s16le",
        # Trim leading and trailing silence but leave ~150ms at each end:
        # clipping the first syllable of a 1.5s command destroys the clip.
        "-af",
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,"
        "areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,"
        "areverse",
        output_path,
    ]

    try:
        subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            timeout=FFMPEG_TIMEOUT_S,
        )
        return True
    except FileNotFoundError as e:
        raise TranscodeUnavailableError(f"ffmpeg not executable at {binary}") from e
    except subprocess.TimeoutExpired as e:
        raise TranscodeUnavailableError(
            f"ffmpeg timed out after {FFMPEG_TIMEOUT_S}s on {input_path}"
        ) from e
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or b"").decode("utf-8", "replace")[-500:]
        logger.error("ffmpeg could not decode %s: %s", input_path, stderr)
        return False


def process_bytes(raw: bytes, suffix: str = ".webm") -> Tuple[Optional[bytes], list, float]:
    """
    Transcodes raw audio in memory and returns (wav_bytes, qc_flags, duration).

    wav_bytes is None when the input was undecodable. Temp files are used
    because ffmpeg and soundfile both want real paths; /tmp is the writable
    tmpfs a Cloud Function gets.
    """
    from .qc import duration_of, perform_qc_check

    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, f"input{suffix}")
        out_path = os.path.join(tmp, "output.wav")

        with open(in_path, "wb") as fh:
            fh.write(raw)

        # A TranscodeUnavailableError propagates on purpose: the caller keeps
        # the clip retryable instead of recording a verdict on the audio.
        if not transcode_to_wav(in_path, out_path):
            return None, ["corrupt"], 0.0

        with open(out_path, "rb") as fh:
            wav_bytes = fh.read()

        return wav_bytes, perform_qc_check(out_path), duration_of(out_path)
