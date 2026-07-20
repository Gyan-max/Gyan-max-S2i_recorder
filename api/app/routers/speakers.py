from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from datetime import datetime
from ..database import get_db
from ..models import Speaker, DeviceSpeaker, Device
from ..schemas import SpeakerCreate, SpeakerResponse, SpeakerRosterResponse, SpeakerRosterItem
from ..auth import verify_device
from ..services.consent import ConsentService, get_current_consent_version

router = APIRouter(tags=["Speakers"])

@router.post("/speakers", response_model=SpeakerResponse, status_code=status.HTTP_201_CREATED)
async def create_speaker(
    speaker_in: SpeakerCreate,
    x_device_id: str = Depends(verify_device),
    db: AsyncSession = Depends(get_db)
):
    """
    Creates a new speaker profile with consent for Phase 2.
    
    Phase 2 Focus:
    - Always creates a new speaker (no lookup by identifier)
    - Records consent immediately upon creation
    - Validates consent version
    - Adds speaker to device roster for shared device support
    """
    
    # Validate consent version
    if not ConsentService.validate_consent_version(speaker_in.consent_version):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_CONSENT_VERSION", 
                "message": f"Invalid consent version. Expected: {get_current_consent_version()}"
            }
        )
    
    # Verify device exists
    device_stmt = select(Device).where(Device.device_id == x_device_id)
    device_result = await db.execute(device_stmt)
    device = device_result.scalar_one_or_none()
    
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DEVICE_NOT_FOUND", "message": "Device must be registered first"}
        )
    
    # Start transaction for speaker creation
    async with db.begin_nested():
        # Generate sequential speaker ID
        stmt = select(Speaker.speaker_id)
        res = await db.execute(stmt)
        all_ids = res.scalars().all()
        
        next_num = 1
        if all_ids:
            # Extract number from IDs like 'SPK_0042'
            nums = []
            for spk_id in all_ids:
                if spk_id.startswith("SPK_"):
                    try:
                        nums.append(int(spk_id.split("_")[1]))
                    except (ValueError, IndexError):
                        pass
            if nums:
                next_num = max(nums) + 1
                
        speaker_id = f"SPK_{next_num:04d}"
        
        # Create speaker with consent
        new_speaker = Speaker(
            speaker_id=speaker_id,
            age=speaker_in.age,
            gender=speaker_in.gender,
            l1=speaker_in.l1,
            region=speaker_in.region,
            consent_at=datetime.utcnow(),  # Record consent immediately
            consent_version=speaker_in.consent_version
        )
        db.add(new_speaker)
        
        # Add to device roster (supports shared devices)
        device_roster = DeviceSpeaker(
            device_id=x_device_id,
            speaker_id=speaker_id
        )
        db.add(device_roster)
        
    try:
        await db.commit()
        await db.refresh(new_speaker)
        
        # Verify consent was recorded properly
        consent_valid = await ConsentService.has_valid_consent(speaker_id, db)
        if not consent_valid:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "CONSENT_RECORDING_FAILED", "message": "Failed to record consent"}
            )
            
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "DB_ERROR", "message": str(e)}
        )
        
    return new_speaker

@router.get("/devices/{device_id}/speakers", response_model=SpeakerRosterResponse)
async def get_device_speakers(
    device_id: str,
    x_device_id: str = Depends(verify_device),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves the speaker roster for a device.
    
    Phase 2 Focus:
    - Supports shared device functionality
    - Returns speakers ordered by last used timestamp
    - Excludes withdrawn speakers
    - Does not return speaker tokens (security)
    """
    # Security check: ensure device_id in path matches header device_id
    if device_id != x_device_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "ACCESS_DENIED", "message": "Cannot access roster for another device"}
        )
        
    # Query speakers for this device
    stmt = (
        select(Speaker.speaker_id, Speaker.age_band, Speaker.gender, DeviceSpeaker.last_used_at)
        .join(DeviceSpeaker, Speaker.speaker_id == DeviceSpeaker.speaker_id)
        .where(
            DeviceSpeaker.device_id == device_id,
            Speaker.withdrawn_at == None  # Exclude withdrawn speakers
        )
        .order_by(desc(DeviceSpeaker.last_used_at))
    )
    
    res = await db.execute(stmt)
    rows = res.all()
    
    speakers_list = []
    for r in rows:
        speakers_list.append(
            SpeakerRosterItem(
                speaker_id=r.speaker_id,
                age_band=r.age_band,
                gender=r.gender,
                last_used_at=r.last_used_at
            )
        )
        
    return SpeakerRosterResponse(speakers=speakers_list)

@router.get("/speakers/{speaker_id}/consent", status_code=status.HTTP_200_OK)
async def get_speaker_consent_status(
    speaker_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get consent status for a speaker (Phase 2 endpoint for testing).
    
    Returns detailed consent information for verification.
    """
    consent_status = await ConsentService.get_speaker_consent_status(speaker_id, db)
    
    if not consent_status:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SPEAKER_NOT_FOUND", "message": "Speaker not found"}
        )
    
    return consent_status
