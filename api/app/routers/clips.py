import os
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from datetime import datetime, timedelta
import shutil

from ..database import get_db
from ..models import Clip, Task, Scenario, Speaker
from ..schemas import (
    ClipInitRequest, ClipInitResponse, ClipConfirmRequest, ClipConfirmResponse,
    ClipDiscardResponse, TaskResponse
)
from ..auth import get_current_speaker_with_consent, verify_device
from ..services.naming import generate_canonical_filename
from ..services.storage import get_raw_path
from ..services.audio_processor import process_clip_background

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
        clip_id=clip_id
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
    x_device_id: str = Depends(verify_device),
    db: AsyncSession = Depends(get_db)
):
    """
    Saves the uploaded audio clip multipart file to storage/raw/ and marks the clip status
    as 'uploaded'.
    """
    stmt = select(Clip).where(Clip.clip_id == clip_id)
    res = await db.execute(stmt)
    clip = res.scalar()
    
    if not clip:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CLIP_NOT_FOUND", "message": "Clip slot not found"}
        )
        
    if clip.device_id != x_device_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN", "message": "Device mismatch for clip upload"}
        )

    # Save raw audio file to storage/raw/
    try:
        os.makedirs(os.path.dirname(clip.raw_path), exist_ok=True)
        with open(clip.raw_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "FILE_SAVE_ERROR", "message": f"Could not save file: {str(e)}"}
        )
        
    # Update clip status
    clip.status = "uploaded"
    await db.commit()
    
    return {"message": "Upload successful", "clip_id": clip_id, "status": "uploaded"}

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

    # 1. Update clip status and transcription properties
    clip.status = "confirmed"
    clip.prompted = req.prompted
    
    # Resolve scenario to populate provisional transcript (unedited seed phrase)
    task_stmt = select(Task).where(Task.task_id == clip.task_id)
    task_res = await db.execute(task_stmt)
    task = task_res.scalar()
    
    scen_stmt = select(Scenario).where(Scenario.scenario_id == task.scenario_id)
    scen_res = await db.execute(scen_stmt)
    scenario = scen_res.scalar()
    
    # Grab the first example phrasing as the provisional transcript
    provisional = scenario.examples[0] if scenario and scenario.examples else ""
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
