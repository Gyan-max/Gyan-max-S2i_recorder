"""
Consent validation service for Phase 2.
Provides server-side consent enforcement as required by the project specification.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..models import Speaker
from datetime import datetime
from typing import Optional

# Configuration - single source of truth for consent version
CURRENT_CONSENT_VERSION = "consent-v1"


class ConsentService:
    """
    Service for managing and validating speaker consent.
    Implements server-side consent enforcement per P1 principle.
    """

    @staticmethod
    async def has_valid_consent(speaker_id: str, db: AsyncSession) -> bool:
        """
        Check if a speaker has valid consent.
        
        Args:
            speaker_id: The speaker ID to check
            db: Database session
            
        Returns:
            bool: True if speaker has valid consent, False otherwise
        """
        try:
            # Query speaker record
            stmt = select(Speaker).where(Speaker.speaker_id == speaker_id)
            result = await db.execute(stmt)
            speaker = result.scalar_one_or_none()
            
            if not speaker:
                return False
                
            # Check if speaker has been withdrawn
            if speaker.withdrawn_at is not None:
                return False
                
            # Check if consent has been provided
            if speaker.consent_at is None:
                return False
                
            # Check if consent version is recorded
            if not speaker.consent_version:
                return False
                
            return True
            
        except Exception:
            # On any error, default to no consent for safety
            return False

    @staticmethod
    async def get_speaker_consent_status(speaker_id: str, db: AsyncSession) -> Optional[dict]:
        """
        Get detailed consent status for a speaker.
        
        Args:
            speaker_id: The speaker ID to check
            db: Database session
            
        Returns:
            dict with consent details or None if speaker not found
        """
        try:
            stmt = select(Speaker).where(Speaker.speaker_id == speaker_id)
            result = await db.execute(stmt)
            speaker = result.scalar_one_or_none()
            
            if not speaker:
                return None
                
            return {
                "speaker_id": speaker.speaker_id,
                "has_consent": speaker.consent_at is not None,
                "consent_at": speaker.consent_at,
                "consent_version": speaker.consent_version,
                "is_withdrawn": speaker.withdrawn_at is not None,
                "withdrawn_at": speaker.withdrawn_at,
                "current_version": CURRENT_CONSENT_VERSION
            }
            
        except Exception:
            return None

    @staticmethod
    async def record_consent(
        speaker_id: str, 
        consent_version: str, 
        db: AsyncSession
    ) -> bool:
        """
        Record consent for a speaker.
        
        Args:
            speaker_id: The speaker ID
            consent_version: Version of consent agreed to
            db: Database session
            
        Returns:
            bool: True if consent was recorded successfully
        """
        try:
            # Find speaker
            stmt = select(Speaker).where(Speaker.speaker_id == speaker_id)
            result = await db.execute(stmt)
            speaker = result.scalar_one_or_none()
            
            if not speaker:
                return False
                
            # Check if already withdrawn
            if speaker.withdrawn_at is not None:
                return False
                
            # Update consent information
            speaker.consent_at = datetime.utcnow()
            speaker.consent_version = consent_version
            
            await db.commit()
            return True
            
        except Exception:
            await db.rollback()
            return False

    @staticmethod
    def validate_consent_version(consent_version: str) -> bool:
        """
        Validate that a consent version is acceptable.
        
        Args:
            consent_version: The consent version to validate
            
        Returns:
            bool: True if version is valid
        """
        # For Phase 2, we only accept the current version
        # In production, this might accept multiple versions for backward compatibility
        return consent_version == CURRENT_CONSENT_VERSION

    @staticmethod
    async def require_valid_consent(speaker_id: str, db: AsyncSession) -> None:
        """
        Ensure a speaker has valid consent or raise an exception.
        Use this in endpoints that require consent.
        
        Args:
            speaker_id: The speaker ID to check
            db: Database session
            
        Raises:
            ValueError: If consent is not valid
        """
        has_consent = await ConsentService.has_valid_consent(speaker_id, db)
        
        if not has_consent:
            # Get detailed status for error message
            status = await ConsentService.get_speaker_consent_status(speaker_id, db)
            
            if not status:
                raise ValueError("Speaker not found")
                
            if status["is_withdrawn"]:
                raise ValueError("Speaker has been withdrawn")
                
            if not status["has_consent"]:
                raise ValueError("Consent required. Speaker must complete onboarding.")
                
            # This shouldn't happen if has_valid_consent returned False
            raise ValueError("Invalid consent status")


# Convenience functions for direct use
async def has_valid_consent(speaker_id: str, db: AsyncSession) -> bool:
    """Convenience function for checking consent."""
    return await ConsentService.has_valid_consent(speaker_id, db)


async def require_consent(speaker_id: str, db: AsyncSession) -> None:
    """Convenience function for requiring consent."""
    await ConsentService.require_valid_consent(speaker_id, db)


def get_current_consent_version() -> str:
    """Get the current consent version."""
    return CURRENT_CONSENT_VERSION