"""
Authentication and authorization utilities for the S2I Recorder API.

Handles:
- Speaker token validation (Bearer tokens for volunteers)
- Admin JWT authentication
- Dependencies for protected endpoints
"""

import hmac
import logging
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from . import config
from .database import get_db
from .models import Speaker, Device

logger = logging.getLogger(__name__)

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
    expires_at = datetime.now(timezone.utc) + timedelta(hours=config.ACCESS_TOKEN_EXPIRE_HOURS)

    payload = {
        "sub": username,
        "exp": expires_at,
        "type": "admin"
    }

    token = jwt.encode(payload, config.SECRET_KEY, algorithm=config.ALGORITHM)

    return {
        "token": token,
        "expires_at": expires_at
    }


def verify_admin_credentials(username: str, password: str) -> bool:
    """
    Verifies admin username and password.

    Uses hmac.compare_digest to avoid leaking the shared prefix length through
    timing. Both fields are always compared so the work is constant.
    """
    username_ok = hmac.compare_digest(username.encode(), config.ADMIN_USERNAME.encode())
    password_ok = hmac.compare_digest(password.encode(), config.ADMIN_PASSWORD.encode())
    return username_ok and password_ok


# ==================== Login Rate Limiting ====================
# In-process counter keyed by client IP. A multi-worker deployment would need
# a shared store (Redis) for this to hold globally.
_login_attempts: dict[str, list[float]] = defaultdict(list)


def check_login_rate_limit(client_ip: str) -> None:
    """
    Raises 429 once a client exceeds LOGIN_MAX_ATTEMPTS within the lockout
    window.
    """
    now = time.monotonic()
    window_start = now - config.LOGIN_LOCKOUT_SECONDS

    attempts = [t for t in _login_attempts[client_ip] if t > window_start]
    _login_attempts[client_ip] = attempts

    if len(attempts) >= config.LOGIN_MAX_ATTEMPTS:
        retry_after = int(attempts[0] + config.LOGIN_LOCKOUT_SECONDS - now) + 1
        logger.warning("Admin login rate limit hit for %s", client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "TOO_MANY_ATTEMPTS",
                "message": f"Too many failed login attempts. Try again in {retry_after}s.",
            },
            headers={"Retry-After": str(retry_after)},
        )


def record_failed_login(client_ip: str) -> None:
    """Records a failed attempt against the rate-limit window."""
    _login_attempts[client_ip].append(time.monotonic())


def clear_login_attempts(client_ip: str) -> None:
    """Clears the counter after a successful login."""
    _login_attempts.pop(client_ip, None)


async def get_current_admin(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
    """
    Validates admin JWT token.
    Returns the token payload if valid.
    """
    token = credentials.credentials

    try:
        # jwt.decode verifies both the signature and the exp claim.
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=[config.ALGORITHM])
    except JWTError:
        # Do not echo the library's parse error back to the caller.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication credentials",
        )

    if payload.get("type") != "admin":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )

    return payload


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
