import logging
import os
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from datetime import datetime, timedelta

from ..config import BLOCKED_UPLOAD_MIME_PREFIXES, MAX_UPLOAD_SIZE_BYTES, MAX_UPLOAD_SIZE_MB
from ..database import get_db
from ..models import Clip, Task, Scenario, Speaker
from ..schemas import (
    ClipInitRequest, ClipInitResponse, ClipConfirmRequest, ClipConfirmResponse,
    ClipDiscardResponse, TaskResponse, SpeakerClipItem, SpeakerClipsResponse
)
from ..auth import get_current_speaker_with_consent, verify_device, get_current_speaker
from ..services.naming import generate_canonical_filename
from ..services.storage import get_raw_path
from ..services.audio_processor import process_clip_background
from ..services.clip_deletion import delete_clip_completely

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clips", tags=["Clips"])

@router.post("/init", response_model=ClipInitResponse, status_code=status.HTTP_201_CREATED)
async def init_clip(
    req: ClipInitRequest,
    speaker: Speaker = Depends(get_current_speaker_with_consent),
    x_device_id: str = Depends(verify_device),
    db: AsyncSession = Depends(get_db)
):
    """
    Initializes a clip recording slot. If a slot for this task is already in a pending state,
    it returns the existing slot (idempotency).
    """
    # 1. Fetch the task and verify ownership
    task_stmt = select(Task).where(Task.task_id == req.task_id)
    task_res = await db.execute(task_stmt)
    task = task_res.scalar()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "TASK_NOT_FOUND", "message": "Task not found"}
        )
        
    if task.speaker_id != speaker.speaker_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN", "message": "Task belongs to another speaker"}
        )
        
    if task.status == "recorded":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "ALREADY_RECORDED", "message": "Task is already recorded and confirmed"}
        )

    # 2. Check for an existing non-confirmed clip for this task
    existing_stmt = select(Clip).where(
        Clip.task_id == req.task_id,
        Clip.status.in_(["initiated", "uploaded"])
    )
    existing_res = await db.execute(existing_stmt)
    existing_clip = existing_res.scalar()
    
    if existing_clip:
        # Return existing clip to achieve idempotency
        upload_url = f"/api/clips/upload?clip_id={existing_clip.clip_id}"
        expires = existing_clip.created_at + timedelta(minutes=10)
        return ClipInitResponse(
            clip_id=existing_clip.clip_id,
            filename=existing_clip.filename or "",
            upload_url=upload_url,
            upload_expires_at=expires
        )

    # 3. Fetch scenario details to generate a canonical filename
    scen_stmt = select(Scenario).where(Scenario.scenario_id == task.scenario_id)
    scen_res = await db.execute(scen_stmt)
    scenario = scen_res.scalar()
    
    if not scenario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SCENARIO_NOT_FOUND", "message": "Associated scenario not found"}
        )

    # 4. Generate clip row
    import uuid
    clip_id = str(uuid.uuid4())
    filename = generate_canonical_filename(
        domain=task.domain,
        speaker_id=speaker.speaker_id,
        intent=task.intent,
        scenario_set=scenario.scenario_set,
        scenario_no=task.scenario_no,
        example_no=task.example_no,
        clip_id=clip_id,
        speaker_name=speaker.name or ""
    )
    raw_path = get_raw_path(clip_id, req.mime_type)
    
    new_clip = Clip(
        clip_id=clip_id,
        task_id=task.task_id,
        speaker_id=speaker.speaker_id,
        device_id=x_device_id,
        filename=filename,
        raw_path=raw_path,
        mime_type=req.mime_type,
        status="initiated"
    )
    db.add(new_clip)
    
    try:
        await db.commit()
        await db.refresh(new_clip)
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "DB_ERROR", "message": str(e)}
        )

    upload_url = f"/api/clips/upload?clip_id={clip_id}"
    expires = new_clip.created_at + timedelta(minutes=10)
    
    return ClipInitResponse(
        clip_id=clip_id,
        filename=filename,
        upload_url=upload_url,
        upload_expires_at=expires
    )

@router.post("/upload")
async def upload_clip_audio(
    clip_id: str,
    file: UploadFile = File(...),
    speaker: Speaker = Depends(get_current_speaker_with_consent),
    x_device_id: str = Depends(verify_device),
    db: AsyncSession = Depends(get_db)
):
    """
    Saves the uploaded audio to storage/raw/ and marks the clip 'uploaded'.

    Requires the owning speaker's bearer token. The X-Device-ID header alone is
    not authentication - it is client-supplied and never verified.
    """
    stmt = select(Clip).where(Clip.clip_id == clip_id)
    res = await db.execute(stmt)
    clip = res.scalar()

    if not clip:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CLIP_NOT_FOUND", "message": "Clip slot not found"}
        )

    if clip.speaker_id != speaker.speaker_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN", "message": "Not authorized to upload to this clip"}
        )

    # Audio is immutable once kept, so a replayed request cannot swap out a
    # clip that already passed review.
    if clip.status in ("confirmed", "processing", "processed", "rejected"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "CLIP_LOCKED", "message": f"Clip is already {clip.status}"}
        )

    content_type = (file.content_type or "").lower()
    if content_type.startswith(BLOCKED_UPLOAD_MIME_PREFIXES):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={"code": "UNSUPPORTED_MEDIA_TYPE", "message": "Only audio recordings are accepted"}
        )

    # Stream to disk with a hard size cap; buffering the whole upload in memory
    # lets one request exhaust server RAM.
    bytes_written = 0
    try:
        os.makedirs(os.path.dirname(clip.raw_path), exist_ok=True)
        with open(clip.raw_path, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                bytes_written += len(chunk)
                if bytes_written > MAX_UPLOAD_SIZE_BYTES:
                    buffer.close()
                    os.remove(clip.raw_path)
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail={
                            "code": "FILE_TOO_LARGE",
                            "message": f"Audio exceeds the {MAX_UPLOAD_SIZE_MB}MB limit",
                        },
                    )
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to save upload for clip %s", clip_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "FILE_SAVE_ERROR", "message": "Could not save the uploaded audio"}
        )

    if bytes_written == 0:
        os.remove(clip.raw_path)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "EMPTY_UPLOAD", "message": "Uploaded audio was empty"}
        )

    # Update clip status
    clip.status = "uploaded"
    await db.commit()

    return {
        "message": "Upload successful",
        "clip_id": clip_id,
        "status": "uploaded",
        "bytes": bytes_written,
    }

@router.post("/{clip_id}/confirm", response_model=ClipConfirmResponse)
async def confirm_clip(
    clip_id: str,
    req: ClipConfirmRequest,
    background_tasks: BackgroundTasks,
    speaker: Speaker = Depends(get_current_speaker_with_consent),
    db: AsyncSession = Depends(get_db)
):
    """
    Volunteers click Keep. Sets status to 'confirmed', marks task as 'recorded',
    increments use_count on the scenario, and enqueues background processing.
    """
    # Use transactional lock on clip to prevent race conditions
    stmt = select(Clip).where(Clip.clip_id == clip_id).with_for_update()
    res = await db.execute(stmt)
    clip = res.scalar()
    
    if not clip:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CLIP_NOT_FOUND", "message": "Clip not found"}
        )
        
    if clip.speaker_id != speaker.speaker_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN", "message": "Not authorized to confirm this clip"}
        )
        
    # Handle Idempotency
    if clip.status in ["confirmed", "processing", "processed"]:
        # Return 200 OK directly, no state change
        return ClipConfirmResponse(clip_id=clip_id, status=clip.status, next_task=None)
        
    if clip.status == "discarded":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "CLIP_DISCARDED", "message": "Cannot confirm a discarded clip"}
        )

    # Refuse to confirm a clip whose audio never arrived, otherwise a failed
    # upload still marks the task recorded and the data point is lost.
    if clip.status != "uploaded" or not clip.raw_path or not os.path.exists(clip.raw_path):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "AUDIO_MISSING",
                "message": "Audio for this clip has not been uploaded yet. Please upload before confirming.",
            },
        )

    # 1. Claim the clip atomically.
    #
    # SELECT ... FOR UPDATE above is a no-op on SQLite, so two concurrent
    # confirms (a double-tapped Keep) could both pass the status checks and
    # each increment scenario.use_count, skewing coverage and scenario
    # balancing. This conditional UPDATE only succeeds for the first caller;
    # the loser sees zero rows and returns the idempotent response.
    claim = await db.execute(
        update(Clip)
        .where(Clip.clip_id == clip_id, Clip.status == "uploaded")
        .values(status="confirmed")
    )
    if claim.rowcount == 0:
        await db.rollback()
        current = (await db.execute(select(Clip).where(Clip.clip_id == clip_id))).scalar()
        if current and current.status in ("confirmed", "processing", "processed"):
            return ClipConfirmResponse(clip_id=clip_id, status=current.status, next_task=None)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "CLIP_NOT_CONFIRMABLE", "message": "Clip is no longer confirmable"},
        )

    clip.status = "confirmed"
    clip.prompted = req.prompted

    # Resolve scenario to populate provisional transcript (unedited seed phrase)
    task_stmt = select(Task).where(Task.task_id == clip.task_id)
    task_res = await db.execute(task_stmt)
    task = task_res.scalar()
    
    scen_stmt = select(Scenario).where(Scenario.scenario_id == task.scenario_id)
    scen_res = await db.execute(scen_stmt)
    scenario = scen_res.scalar()
    
    # Use the phrasing the volunteer was actually shown, not examples[0].
    provisional = ""
    if scenario and scenario.examples:
        example_index = max(0, min(task.example_no - 1, len(scenario.examples) - 1))
        provisional = scenario.examples[example_index]
    clip.transcript_provisional = provisional

    if req.transcript_edit:
        clip.transcript_final = req.transcript_edit
        clip.transcript_source = "speaker_edited"
    else:
        # Default to unedited example phrasing
        clip.transcript_final = provisional
        clip.transcript_source = "example_unedited"

    # 2. Mark task as recorded
    task.status = "recorded"
    
    # 3. Increment scenario use count
    if scenario:
        scenario.use_count += 1
        
    await db.commit()

    # 4. Trigger asynchronous background processing pipeline
    background_tasks.add_task(process_clip_background, clip_id)

    # 5. Look up next pending task in active batch to save a round-trip
    next_task_stmt = select(Task).where(
        Task.speaker_id == speaker.speaker_id,
        Task.domain == task.domain,
        Task.batch_no == task.batch_no,
        Task.status == "pending"
    ).order_by(Task.intent, Task.scenario_no, Task.example_no)
    next_task_res = await db.execute(next_task_stmt)
    next_task = next_task_res.scalar()
    
    next_task_resp = None
    if next_task:
        # Fetch its scenario text
        nt_scen_stmt = select(Scenario).where(Scenario.scenario_id == next_task.scenario_id)
        nt_scen_res = await db.execute(nt_scen_stmt)
        nt_scen = nt_scen_res.scalar()
        next_task_resp = TaskResponse(
            task_id=next_task.task_id,
            domain=next_task.domain,
            intent=next_task.intent,
            scenario_id=next_task.scenario_id,
            scenario_no=next_task.scenario_no,
            example_no=next_task.example_no,
            text_hi=nt_scen.text_hi if nt_scen else "",
            examples=nt_scen.examples if nt_scen else [],
            register=nt_scen.register if nt_scen else None,
            status=next_task.status,
            redo_count=next_task.redo_count
        )

    return ClipConfirmResponse(
        clip_id=clip_id,
        status="confirmed",
        next_task=next_task_resp
    )

@router.post("/{clip_id}/discard", response_model=ClipDiscardResponse)
async def discard_clip(
    clip_id: str,
    speaker: Speaker = Depends(get_current_speaker_with_consent),
    db: AsyncSession = Depends(get_db)
):
    """
    Volunteers click Redo. Discards clip, increments task redo_count, and deletes local raw file.
    Task status remains pending.
    """
    # Use transactional lock
    stmt = select(Clip).where(Clip.clip_id == clip_id).with_for_update()
    res = await db.execute(stmt)
    clip = res.scalar()
    
    if not clip:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CLIP_NOT_FOUND", "message": "Clip not found"}
        )
        
    if clip.speaker_id != speaker.speaker_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN", "message": "Not authorized to discard this clip"}
        )
        
    task_stmt = select(Task).where(Task.task_id == clip.task_id)
    task_res = await db.execute(task_stmt)
    task = task_res.scalar()
    
    # Handle Idempotency
    if clip.status == "discarded":
        # Load scenario info for TaskResponse
        scen_stmt = select(Scenario).where(Scenario.scenario_id == task.scenario_id)
        scen_res = await db.execute(scen_stmt)
        scenario = scen_res.scalar()
        task_resp = TaskResponse(
            task_id=task.task_id,
            domain=task.domain,
            intent=task.intent,
            scenario_id=task.scenario_id,
            scenario_no=task.scenario_no,
            example_no=task.example_no,
            text_hi=scenario.text_hi if scenario else "",
            examples=scenario.examples if scenario else [],
            register=scenario.register if scenario else None,
            status=task.status,
            redo_count=task.redo_count
        )
        return ClipDiscardResponse(clip_id=clip_id, status="discarded", task=task_resp)
        
    if clip.status in ["confirmed", "processing", "processed"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "CLIP_CONFIRMED", "message": "Cannot discard an already confirmed clip"}
        )

    # 1. Set status to discarded
    clip.status = "discarded"
    
    # 2. Increment task redo count
    task.redo_count += 1
    task.status = "pending"  # Ensure it remains pending
    
    # 3. Clean up the physical raw file from disk
    if clip.raw_path and os.path.exists(clip.raw_path):
        try:
            os.remove(clip.raw_path)
        except Exception as e:
            # Log cleanup error but don't fail transaction
            pass
            
    await db.commit()
    
    # Fetch scenario details for TaskResponse
    scen_stmt = select(Scenario).where(Scenario.scenario_id == task.scenario_id)
    scen_res = await db.execute(scen_stmt)
    scenario = scen_res.scalar()
    
    task_resp = TaskResponse(
        task_id=task.task_id,
        domain=task.domain,
        intent=task.intent,
        scenario_id=task.scenario_id,
        scenario_no=task.scenario_no,
        example_no=task.example_no,
        text_hi=scenario.text_hi if scenario else "",
        examples=scenario.examples if scenario else [],
        register=scenario.register if scenario else None,
        status=task.status,
        redo_count=task.redo_count
    )

    return ClipDiscardResponse(
        clip_id=clip_id,
        status="discarded",
        task=task_resp
    )

@router.get("/my", response_model=SpeakerClipsResponse)
async def get_my_clips(
    speaker: Speaker = Depends(get_current_speaker_with_consent),
    db: AsyncSession = Depends(get_db)
):
    """Returns all clips for the authenticated speaker."""
    stmt = (
        select(Clip, Task)
        .join(Task, Clip.task_id == Task.task_id)
        .where(Clip.speaker_id == speaker.speaker_id)
        .order_by(Clip.created_at.desc())
    )
    res = await db.execute(stmt)
    rows = res.all()

    items = []
    for clip, task in rows:
        items.append(
            SpeakerClipItem(
                clip_id=clip.clip_id,
                task_id=clip.task_id,
                domain=task.domain,
                intent=task.intent,
                scenario_id=task.scenario_id,
                filename=clip.filename,
                duration_s=clip.duration_s,
                transcript_final=clip.transcript_final or clip.transcript_provisional,
                status=clip.status,
                created_at=clip.created_at
            )
        )

    return SpeakerClipsResponse(clips=items)

@router.delete("/{clip_id}")
async def delete_my_clip(
    clip_id: str,
    speaker: Speaker = Depends(get_current_speaker_with_consent),
    db: AsyncSession = Depends(get_db)
):
    """
    Permanently deletes one of the speaker's own recordings.

    Recordings are kept indefinitely until either the speaker or an admin
    removes them - this is the speaker-initiated half of that.
    """
    stmt = select(Clip).where(Clip.clip_id == clip_id)
    res = await db.execute(stmt)
    clip = res.scalar()

    if not clip:
        # Already gone: deleting twice is not an error.
        return {"clip_id": clip_id, "deleted": True}

    if clip.speaker_id != speaker.speaker_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN", "message": "Not authorized to delete this clip"}
        )

    try:
        await delete_clip_completely(db, clip)
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to delete clip %s", clip_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "DELETE_FAILED", "message": "The recording could not be deleted"}
        )

    return {"clip_id": clip_id, "deleted": True}

@router.get("/{clip_id}/download")
async def download_my_clip(
    clip_id: str,
    speaker: Speaker = Depends(get_current_speaker_with_consent),
    db: AsyncSession = Depends(get_db)
):
    """Download a specific clip's audio file. Only the owning speaker can download."""
    stmt = select(Clip).where(Clip.clip_id == clip_id)
    res = await db.execute(stmt)
    clip = res.scalar()

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    if clip.speaker_id != speaker.speaker_id:
        raise HTTPException(status_code=403, detail="Not authorized to download this clip")

    # Try processed WAV first, then raw
    audio_path = None
    if clip.wav_path and os.path.exists(clip.wav_path):
        audio_path = clip.wav_path
    elif clip.raw_path and os.path.exists(clip.raw_path):
        audio_path = clip.raw_path

    if not audio_path:
        raise HTTPException(status_code=404, detail="Audio file not found")

    filename = clip.filename or f"{clip_id}.wav"
    return FileResponse(
        audio_path,
        media_type="audio/wav" if audio_path.endswith(".wav") else "audio/webm",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
