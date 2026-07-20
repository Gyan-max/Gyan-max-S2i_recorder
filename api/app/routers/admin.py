import csv
import io
import os
import random
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, update, distinct
from datetime import datetime

from ..database import get_db
from ..models import Speaker, Clip, Task, Scenario, DeviceSpeaker, WithdrawalAudit
from ..schemas import (
    AdminLoginRequest, AdminLoginResponse, AdminStatsResponse, AdminCoverageResponse,
    AdminCoverageItem, ClipReviewResponse, ClipReviewItem, ClipReviewActionRequest,
    QRGenerateResponse, QRItem
)
from ..auth import create_admin_token, verify_admin_credentials, get_current_admin
from ..services.storage import get_export_path

router = APIRouter(prefix="/admin", tags=["Admin"])

@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(req: AdminLoginRequest):
    """Authenticates admin credentials and returns a JWT token."""
    if not verify_admin_credentials(req.username, req.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    result = create_admin_token(req.username)
    return AdminLoginResponse(token=result["token"], expires_at=result["expires_at"])

@router.get("/stats", response_model=AdminStatsResponse)
async def get_admin_stats(
    admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves system-wide statistics for the admin dashboard."""
    # Total speakers (excluding withdrawn)
    stmt_spk = select(func.count(Speaker.speaker_id)).where(Speaker.withdrawn_at == None)
    res_spk = await db.execute(stmt_spk)
    total_speakers = res_spk.scalar() or 0
    
    # Total Clip rows
    stmt_clips = select(func.count(Clip.clip_id))
    res_clips = await db.execute(stmt_clips)
    total_recordings = res_clips.scalar() or 0
    
    # Confirmed / processing / processed clips
    stmt_confirmed = select(func.count(Clip.clip_id)).where(
        Clip.status.in_(["confirmed", "processing", "processed"])
    )
    res_confirmed = await db.execute(stmt_confirmed)
    confirmed_clips = res_confirmed.scalar() or 0
    
    # Redo count (sum of task.redo_count)
    stmt_redo = select(func.sum(Task.redo_count))
    res_redo = await db.execute(stmt_redo)
    redo_count = res_redo.scalar() or 0
    
    # QC passed (status is processed and has no critical qc_flags, or simply status='processed')
    stmt_qc_pass = select(func.count(Clip.clip_id)).where(Clip.status == "processed")
    res_qc_pass = await db.execute(stmt_qc_pass)
    qc_passed = res_qc_pass.scalar() or 0
    
    # QC failed (status is rejected)
    stmt_qc_fail = select(func.count(Clip.clip_id)).where(Clip.status == "rejected")
    res_qc_fail = await db.execute(stmt_qc_fail)
    qc_failed = res_qc_fail.scalar() or 0
    
    return AdminStatsResponse(
        total_speakers=total_speakers,
        total_recordings=total_recordings,
        confirmed_clips=confirmed_clips,
        redo_count=redo_count,
        qc_passed=qc_passed,
        qc_failed=qc_failed
    )

@router.get("/coverage", response_model=AdminCoverageResponse)
async def get_intent_coverage(
    admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves the intent coverage heatmap statistics."""
    # Get all scenarios
    scen_stmt = select(Scenario.domain, Scenario.intent)
    scen_res = await db.execute(scen_stmt)
    scenarios = scen_res.all()
    
    # Group into unique (domain, intent) keys
    unique_intents = sorted(list(set((s.domain, s.intent) for s in scenarios)))
    
    coverage_items = []
    for domain, intent in unique_intents:
        # Count processed clips for this intent
        clips_stmt = select(func.count(Clip.clip_id)).join(Task).where(
            Task.intent == intent,
            Clip.status == "processed"
        )
        clips_res = await db.execute(clips_stmt)
        clips_count = clips_res.scalar() or 0
        
        # Count unique speakers who contributed to this intent
        spk_stmt = select(func.count(distinct(Clip.speaker_id))).join(Task).where(
            Task.intent == intent,
            Clip.status == "processed"
        )
        spk_res = await db.execute(spk_stmt)
        spk_count = spk_res.scalar() or 0
        
        coverage_items.append(
            AdminCoverageItem(
                domain=domain,
                intent=intent,
                clips_processed=clips_count,
                speakers_count=spk_count
            )
        )
        
    return AdminCoverageResponse(coverage=coverage_items)

@router.get("/clips", response_model=ClipReviewResponse)
async def get_review_queue_clips(
    status_filter: Optional[str] = Query(None, description="Filter clips by status"),
    admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves clips for review, ordering by creation date descending."""
    stmt = select(Clip, Task).join(Task, Clip.task_id == Task.task_id)
    if status_filter:
        stmt = stmt.where(Clip.status == status_filter)
        
    stmt = stmt.order_by(Clip.created_at.desc())
    res = await db.execute(stmt)
    rows = res.all()
    
    items = []
    for clip, task in rows:
        items.append(
            ClipReviewItem(
                clip_id=clip.clip_id,
                task_id=clip.task_id,
                speaker_id=clip.speaker_id,
                device_id=clip.device_id,
                domain=task.domain,
                intent=task.intent,
                scenario_id=task.scenario_id,
                filename=clip.filename,
                duration_s=clip.duration_s,
                qc_flags=clip.qc_flags,
                status=clip.status,
                transcript_provisional=clip.transcript_provisional,
                transcript_final=clip.transcript_final,
                transcript_source=clip.transcript_source,
                created_at=clip.created_at
            )
        )
    return ClipReviewResponse(clips=items)

@router.post("/clips/{clip_id}/review")
async def review_clip_action(
    clip_id: str,
    req: ClipReviewActionRequest,
    admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Allows domain leads to accept, reject, or correct transcripts of clips."""
    stmt = select(Clip).where(Clip.clip_id == clip_id)
    res = await db.execute(stmt)
    clip = res.scalar()
    
    if not clip:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CLIP_NOT_FOUND", "message": "Clip not found"}
        )
        
    if req.action == "accept":
        clip.status = "processed"
    elif req.action == "reject":
        clip.status = "rejected"
    elif req.action == "edit_transcript":
        if not req.transcript_final:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "TRANSCRIPT_REQUIRED", "message": "transcript_final is required for edit_transcript"}
            )
        clip.transcript_final = req.transcript_final
        clip.transcript_source = "human_verified"
        clip.status = "processed"
        
    await db.commit()
    return {"message": "Clip review completed successfully", "clip_id": clip_id, "status": clip.status}

@router.post("/speakers/{speaker_id}/withdraw")
async def withdraw_speaker(
    speaker_id: str,
    admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Voluntary speaker withdrawal endpoint. Soft-deletes speaker, deletes raw/processed
    audio files, deletes clips and tasks, and writes to withdrawal_audits.
    """
    # 1. Check if speaker exists
    spk_stmt = select(Speaker).where(Speaker.speaker_id == speaker_id)
    spk_res = await db.execute(spk_stmt)
    speaker = spk_res.scalar()
    
    if not speaker:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SPEAKER_NOT_FOUND", "message": "Speaker profile not found"}
        )
        
    if speaker.withdrawn_at is not None:
        return {"message": "Speaker is already withdrawn", "speaker_id": speaker_id}

    # 2. Get counts and file paths for deletion
    clips_stmt = select(Clip).where(Clip.speaker_id == speaker_id)
    clips_res = await db.execute(clips_stmt)
    clips = list(clips_res.scalars().all())
    
    tasks_stmt = select(Task).where(Task.speaker_id == speaker_id)
    tasks_res = await db.execute(tasks_stmt)
    tasks = list(tasks_res.scalars().all())
    
    clips_deleted = len(clips)
    tasks_deleted = len(tasks)
    
    # 3. Physically delete the audio files from storage
    for clip in clips:
        # Delete raw file
        if clip.raw_path and os.path.exists(clip.raw_path):
            try:
                os.remove(clip.raw_path)
            except Exception:
                pass
        # Delete processed WAV file
        if clip.wav_path and os.path.exists(clip.wav_path):
            try:
                os.remove(clip.wav_path)
            except Exception:
                pass
                
    # 4. Perform database deletions and audit logging in a transaction block
    async with db.begin_nested():
        # Soft-delete speaker by setting withdrawn_at
        speaker.withdrawn_at = datetime.utcnow()
        
        # Delete associated records
        await db.execute(delete(Clip).where(Clip.speaker_id == speaker_id))
        await db.execute(delete(Task).where(Task.speaker_id == speaker_id))
        await db.execute(delete(DeviceSpeaker).where(DeviceSpeaker.speaker_id == speaker_id))
        
        # Insert audit log
        audit = WithdrawalAudit(
            speaker_id=speaker_id,
            clips_deleted=clips_deleted,
            tasks_deleted=tasks_deleted,
            processed_by=admin,
            notes="Speaker voluntary withdrawal request"
        )
        db.add(audit)
        
    await db.commit()
    return {
        "message": "Speaker withdrawal completed",
        "speaker_id": speaker_id,
        "clips_deleted": clips_deleted,
        "tasks_deleted": tasks_deleted
    }

@router.get("/export")
async def export_dataset(
    admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Generates a speaker-disjoint dataset split (80/10/10 ratio) and returns a CSV manifest.
    Ensures that no speaker's recordings appear in multiple splits.
    """
    # 1. Fetch all processed clips with metadata
    stmt = (
        select(Clip, Speaker, Task)
        .join(Speaker, Clip.speaker_id == Speaker.speaker_id)
        .join(Task, Clip.task_id == Task.task_id)
        .where(
            Clip.status == "processed",
            Speaker.withdrawn_at == None
        )
    )
    res = await db.execute(stmt)
    rows = res.all()
    
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NO_DATA", "message": "No processed clips available for export"}
        )
        
    # 2. Assign speaker-disjoint splits
    # Extract unique speakers
    speakers = list(set(r.Speaker.speaker_id for r in rows))
    
    # Shuffle speaker list (reproducible split for tests by setting a fixed seed)
    random.Random(42).shuffle(speakers)
    
    n_speakers = len(speakers)
    train_end = int(n_speakers * 0.8)
    dev_end = train_end + max(1, int(n_speakers * 0.1)) if n_speakers > 1 else train_end
    
    speaker_splits = {}
    for idx, spk in enumerate(speakers):
        if idx < train_end:
            speaker_splits[spk] = "train"
        elif idx < dev_end:
            speaker_splits[spk] = "dev"
        else:
            speaker_splits[spk] = "test"
            
    # Double check no speaker in multiple splits constraint
    # (By definition of dictionary partitioning, speaker_splits maps one speaker to exactly one split label)
    
    # 3. Create in-memory CSV
    output = io.StringIO()
    writer = csv.writer(output)
    
    # CSV Header
    writer.writerow([
        "clip_id", "filename", "speaker_id", "gender", "age_band", 
        "l1", "region", "domain", "intent", "scenario_id", 
        "scenario_no", "example_no", "prompted", "duration_s", 
        "transcript_final", "transcript_source", "qc_flags", "split"
    ])
    
    for clip, speaker, task in rows:
        split = speaker_splits.get(speaker.speaker_id, "train")
        qc_flags_str = ",".join(clip.qc_flags) if clip.qc_flags else ""
        writer.writerow([
            clip.clip_id,
            clip.filename or "",
            speaker.speaker_id,
            speaker.gender,
            speaker.age_band,
            speaker.l1,
            speaker.region,
            task.domain,
            task.intent,
            task.scenario_id,
            task.scenario_no,
            task.example_no,
            clip.prompted,
            clip.duration_s or 0.0,
            clip.transcript_final or "",
            clip.transcript_source or "",
            qc_flags_str,
            split
        ])
        
    csv_content = output.getvalue()
    output.close()
    
    # Save the manifest.csv locally in storage/exports
    os.makedirs(os.path.dirname(get_export_path("manifest.csv")), exist_ok=True)
    with open(get_export_path("manifest.csv"), "w") as f:
        f.write(csv_content)
        
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=manifest.csv"}
    )
