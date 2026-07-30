"""
Audio quality control.

Same checks and thresholds as the FastAPI worker, reading from a local temp
file that the storage trigger has already downloaded. Thresholds come from
config so they can be tuned per deployment without a code change.
"""

import logging
from typing import List

import numpy as np
import soundfile as sf

from .. import config

logger = logging.getLogger(__name__)

# 'silent' and 'corrupt' mean the clip carries no usable speech at all.
# Everything else is advisory and only routes the clip to admin review.
FATAL_FLAGS = ("silent", "corrupt")


def perform_qc_check(wav_path: str) -> List[str]:
    """
    Returns flags from: too_short, too_long, clipped, silent, noisy, corrupt.
    An empty list means the clip passed.
    """
    flags: List[str] = []
    try:
        data, sr = sf.read(wav_path)

        if len(data) == 0:
            return ["silent"]

        duration = len(data) / sr
        if duration < config.QC_MIN_DURATION_S:
            flags.append("too_short")
        elif duration > config.QC_MAX_DURATION_S:
            flags.append("too_long")

        peak = np.max(np.abs(data))
        if peak >= 0.99:
            clipped_samples = np.sum(np.abs(data) >= 0.99)
            # More than 10ms hard against the ceiling is real clipping, not a
            # single loud sample.
            if (clipped_samples / sr) > 0.01:
                flags.append("clipped")

        rms = np.sqrt(np.mean(data ** 2))
        if rms < 1e-4:
            flags.append("silent")
        elif rms > 0:
            # Crude SNR proxy: overall energy against the 5th-percentile floor.
            noise_floor = np.percentile(np.abs(data), 5)
            if noise_floor > 0:
                snr_estimate = 20 * np.log10(rms / noise_floor)
                if snr_estimate < config.QC_MIN_SNR_DB:
                    flags.append("noisy")

    except Exception as e:
        logger.error("QC could not read %s: %s", wav_path, e)
        flags.append("corrupt")

    return flags


def duration_of(wav_path: str) -> float:
    """Duration in seconds, 0.0 if unreadable."""
    try:
        info = sf.info(wav_path)
        return float(info.frames) / float(info.samplerate)
    except Exception as e:
        logger.error("Could not read duration of %s: %s", wav_path, e)
        return 0.0
