"""
Authentication and authorization utilities for the S2I Recorder API.

Handles:
- Speaker token validation (Bearer tokens for volunteers)
- Admin JWT authentication
- Dependencies for protected endpoints
"""

from fastapi import Depends, HTTPException, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .database import get_db
from .models import Speaker, Device

# Security configuration
SECRET_KEY = "your-secret-key-change-in-production"  # TODO: Move to environment variable
ALGORITHM = "HS256"
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin123"  # TODO: Move to environment variable and hash
ACCESS_TOKEN_EXPIRE_HOURS = 8

security = HTTPBearer()


# ==================== Speaker Authentication ====================

async def get_current_speaker(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> Speaker:
    """
    Validates speaker token and returns the Speaker object.
    Used for volunteer endpoints that require authentication.
    """
    token = credentials.credentials
    
    # Query speaker by token
    result = await db.execute(
        select(Speaker).where(Speaker.token == token)
    )
    speaker = result.scalar_one_or_none()
    
    if not speaker:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )
    
    # Check if speaker has been withdrawn
    if speaker.withdrawn_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Speaker account has been withdrawn"
        )
    
    return speaker


async def get_optional_speaker(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> Optional[Speaker]:
    """
    Optional speaker authentication - returns None if no valid token provided.
    """
    if not credentials:
        return None
    
    try:
        return await get_current_speaker(credentials, db)
    except HTTPException:
        return None


async def verify_speaker_consent(speaker: Speaker) -> Speaker:
    """
    Ensures the speaker has provided valid consent before accepting recordings.
    P1 principle: consent is mandatory and enforced server-side.
    """
    if speaker.consent_at is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Consent required. Speaker must complete onboarding.",
            headers={"X-Error-Code": "CONSENT_REQUIRED"}
        )
    
    return speaker


async def get_authenticated_speaker_with_consent(
    speaker: Speaker = Depends(get_current_speaker)
) -> Speaker:
    """
    Combined dependency: validates speaker token AND consent.
    Use this for recording endpoints.
    """
    return await verify_speaker_consent(speaker)


# ==================== Device Validation ====================

async def get_device_id_from_header(
    x_device_id: Optional[str] = Header(None, alias="X-Device-ID")
) -> str:
    """
    Extracts and validates device ID from X-Device-ID header.
    """
    if not x_device_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-Device-ID header is required"
        )
    
    return x_device_id


async def verify_device_exists(
    device_id: str = Depends(get_device_id_from_header),
    db: AsyncSession = Depends(get_db)
) -> Device:
    """
    Verifies that the device exists in the database.
    """
    result = await db.execute(
        select(Device).where(Device.device_id == device_id)
    )
    device = result.scalar_one_or_none()
    
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found. Please register device first."
        )
    
    return device


# Convenience aliases for router dependencies
verify_device = get_device_id_from_header
get_current_speaker_with_consent = get_authenticated_speaker_with_consent


# ==================== Admin Authentication ====================

def create_admin_token(username: str) -> dict:
    """
    Creates a JWT token for admin authentication.
    Returns dict with token and expiration.
    """
    expires_at = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    
    payload = {
        "sub": username,
        "exp": expires_at,
        "type": "admin"
    }
    
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    
    return {
        "token": token,
        "expires_at": expires_at
    }


def verify_admin_credentials(username: str, password: str) -> bool:
    """
    Verifies admin username and password.
    In production, this should check against hashed passwords in database.
    """
    return username == ADMIN_USERNAME and password == ADMIN_PASSWORD


async def get_current_admin(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
    """
    Validates admin JWT token.
    Returns the token payload if valid.
    """
    token = credentials.credentials
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        
        # Verify token type
        if payload.get("type") != "admin":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type"
            )
        
        # Check expiration (jwt.decode already does this, but explicit check)
        exp = payload.get("exp")
        if exp and datetime.fromtimestamp(exp) < datetime.utcnow():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has expired"
            )
        
        return payload
        
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication credentials: {str(e)}"
        )


# ==================== Task Ownership Verification ====================

async def verify_task_ownership(
    task_id: str,
    speaker: Speaker,
    db: AsyncSession
) -> bool:
    """
    Verifies that a task belongs to the given speaker.
    Prevents cross-speaker access to tasks.
    """
    from .models import Task
    
    result = await db.execute(
        select(Task).where(
            Task.task_id == task_id,
            Task.speaker_id == speaker.speaker_id
        )
    )
    task = result.scalar_one_or_none()
    
    return task is not None


async def verify_clip_ownership(
    clip_id: str,
    speaker: Speaker,
    db: AsyncSession
) -> bool:
    """
    Verifies that a clip belongs to the given speaker.
    Prevents cross-speaker access to clips.
    """
    from .models import Clip
    
    result = await db.execute(
        select(Clip).where(
            Clip.clip_id == clip_id,
            Clip.speaker_id == speaker.speaker_id
        )
    )
    clip = result.scalar_one_or_none()
    
    return clip is not None
