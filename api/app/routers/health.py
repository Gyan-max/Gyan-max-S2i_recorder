"""
Health check endpoint for Phase 3.
Provides simple system status for testing and monitoring.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, func
from ..database import get_db
from ..services.consent import get_current_consent_version
from ..models import Scenario

router = APIRouter(tags=["Health"])

@router.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    """
    Health check for Phase 3.
    
    Returns:
        - System status
        - Database connectivity
        - Current consent version
        - Scenario count
    """
    
    try:
        # Test database connection
        await db.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)}"
    
    # Count scenarios
    try:
        stmt = select(func.count(Scenario.scenario_id))
        result = await db.execute(stmt)
        scenario_count = result.scalar() or 0
    except Exception:
        scenario_count = 0
    
    return {
        "status": "healthy" if db_status == "connected" else "unhealthy",
        "phase": "Phase 3: Scenario and Task Assignment",
        "database": db_status,
        "consent_version": get_current_consent_version(),
        "scenarios_loaded": scenario_count,
        "version": "3.0.0"
    }