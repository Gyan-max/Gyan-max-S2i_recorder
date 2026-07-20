import numpy as np
import soundfile as sf
import logging

logger = logging.getLogger(__name__)

def perform_qc_check(wav_path: str) -> list[str]:
    """
    Performs basic audio Quality Control checks on a WAV file.
    Returns a list of flags: 'too_short', 'too_long', 'clipped', 'silent', 'noisy', 'corrupt'.
    """
    flags = []
    try:
        data, sr = sf.read(wav_path)
        
        # 1. Duration check
        duration = len(data) / sr
        if duration < 0.8:
            flags.append("too_short")
        elif duration > 15.0:
            flags.append("too_long")
            
        # 2. Peak amplitude (clipping)
        if len(data) > 0:
            peak = np.max(np.abs(data))
            if peak >= 0.99:
                # Count sample counts near clipping threshold
                clipped_samples = np.sum(np.abs(data) >= 0.99)
                if (clipped_samples / sr) > 0.01:  # More than 10ms of clipping
                    flags.append("clipped")
            
            # 3. RMS energy (silence)
            rms = np.sqrt(np.mean(data**2))
            if rms < 1e-4:
                flags.append("silent")
                
            # 4. SNR estimation (simplified: signal RMS vs noise floor)
            if rms > 0:
                noise_floor = np.percentile(np.abs(data), 5)
                if noise_floor > 0:
                    snr_estimate = 20 * np.log10(rms / noise_floor)
                    if snr_estimate < 10.0:
                        flags.append("noisy")
                else:
                    # If noise floor is 0, SNR is very high
                    pass
        else:
            flags.append("silent")
            
    except Exception as e:
        logger.error(f"QC check failed to read audio {wav_path}: {e}")
        flags.append("corrupt")
        
    return flags
