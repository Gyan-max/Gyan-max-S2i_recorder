from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Device
from ..schemas import DeviceCreate, DeviceResponse

router = APIRouter(prefix="/devices", tags=["Devices"])

@router.post("", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
async def register_device(device_in: DeviceCreate, db: AsyncSession = Depends(get_db)):
    """Registers a new device or returns an existing device record."""
    # Check if device already exists
    stmt = select(Device).where(Device.device_id == device_in.device_id)
    res = await db.execute(stmt)
    existing_device = res.scalar()
    
    if existing_device:
        # Return existing device (Status 200 OK)
        return existing_device
        
    # Create new device
    new_device = Device(
        device_id=device_in.device_id,
        ua_class=device_in.ua_class
    )
    db.add(new_device)
    try:
        await db.commit()
        await db.refresh(new_device)
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "DB_ERROR", "message": str(e)}
        )
    return new_device
