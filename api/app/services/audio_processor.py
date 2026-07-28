import os
import subprocess
import logging
from sqlalchemy import select
from ..database import AsyncSessionLocal
from ..models import Clip, Task
from .storage import get_raw_path, get_processed_path
from .qc import perform_qc_check
from .asr import get_asr_provider

logger = logging.getLogger(__name__)

def transcode_audio(input_path: str, output_path: str) -> bool:
    """
    Transcodes raw audio (webm/mp4) to 16kHz mono WAV using ffmpeg.
    Trims excess silence but leaves ~150ms padding at each end.
    """
    if not os.path.exists(input_path):
        logger.error(f"Raw input file not found: {input_path}")
        return False
        
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        # Trim silence from start and end using standard silence trim filter
        "-af", "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,"
               "areverse,"
               "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,"
               "areverse",
        output_path
    ]
    
    try:
        # Run subprocess with timeout to avoid hanging
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=30)
        return True
    except (subprocess.SubprocessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
        logger.error(f"FFmpeg transcoding failed for {input_path}: {e}")
        # In a real environment, if ffmpeg is missing we could log setup instructions.
        return False

async def process_clip_background(clip_id: str):
    """
    Background processing pipeline task for a confirmed clip:
    1. Transcode Raw -> 16kHz Mono WAV
    2. Perform QC Checks
    3. Run ASR Transcription (if QC passes)
    """
    logger.info(f"Starting background processing for clip: {clip_id}")
    
    async with AsyncSessionLocal() as db:
        # Fetch clip
        stmt = select(Clip).where(Clip.clip_id == clip_id)
        res = await db.execute(stmt)
        clip = res.scalar()
        
        if not clip:
            logger.error(f"Clip {clip_id} not found for background processing")
            return
            
        if clip.status != "confirmed":
            logger.warning(f"Clip {clip_id} status is '{clip.status}', expected 'confirmed'")
            return
            
        # Update status to processing
        clip.status = "processing"
        await db.commit()
        await db.refresh(clip)
        
        # Get raw path and output wav path
        raw_path = clip.raw_path
        if not raw_path:
            raw_path = get_raw_path(clip.clip_id, clip.mime_type)
            
        # Ensure we have the target filename
        if not clip.filename:
            logger.error(f"Clip {clip_id} has no filename assigned")
            clip.status = "rejected"
            clip.qc_flags = ["missing_filename"]
            await db.commit()
            return
            
        wav_path = get_processed_path(clip.filename)
        
        # 1. Transcode raw file to WAV
        success = transcode_audio(raw_path, wav_path)
        
        if success:
            clip.wav_path = wav_path
            
            # Get duration and update duration_s
            try:
                import soundfile as sf
                data, sr = sf.read(wav_path)
                clip.duration_s = len(data) / sr
            except Exception as e:
                logger.error(f"Failed to read WAV duration: {e}")
                clip.duration_s = 0.0
            
            # 2. Run QC checks
            qc_flags = perform_qc_check(wav_path)
            clip.qc_flags = qc_flags
            
            # Check for fatal QC failures (e.g. silent, corrupt)
            if "silent" in qc_flags or "corrupt" in qc_flags:
                clip.status = "rejected"
                logger.warning(f"Clip {clip_id} rejected due to fatal QC flags: {qc_flags}")
            else:
                # 3. Run ASR Transcription.
                # ASR never overwrites a human-sourced transcript: a speaker
                # edit or the prompted phrasing beats any ASR guess.
                try:
                    asr_provider = get_asr_provider()
                    asr_res = asr_provider.transcribe(wav_path)

                    if clip.transcript_source in ("speaker_edited", "human_verified"):
                        logger.info(
                            "Clip %s keeping %s transcript; ASR result recorded for reference only",
                            clip_id, clip.transcript_source,
                        )
                    elif not clip.transcript_final:
                        clip.transcript_final = asr_res.text
                        clip.transcript_source = "asr"
                    else:
                        # Prompt-derived text stands as the label; ASR is only
                        # a cross-check for reviewers.
                        logger.info("Clip %s keeping prompt-derived transcript", clip_id)

                    clip.status = "processed"
                    logger.info(f"Clip {clip_id} processed successfully.")
                except Exception as e:
                    logger.error(f"ASR transcription failed for clip {clip_id}: {e}")
                    # ASR failure shouldn't reject the clip, it stays processed but with provisional/empty transcript
                    clip.status = "processed"
        else:
            # Transcoding failed
            clip.status = "rejected"
            # Maintain a list of qc_flags
            flags = list(clip.qc_flags) if clip.qc_flags else []
            flags.append("transcode_failed")
            clip.qc_flags = flags
            logger.error(f"Clip {clip_id} rejected due to transcoding failure")
            
        await db.commit()
