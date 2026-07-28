from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from ..database import get_db
from ..models import Device
from ..schemas import DeviceCreate, DeviceResponse

router = APIRouter(prefix="/devices", tags=["Devices"])

@router.post("", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
async def register_device(
    device_in: DeviceCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Registers a new device, or returns the existing record with 200 OK."""
    # Check if device already exists
    stmt = select(Device).where(Device.device_id == device_in.device_id)
    res = await db.execute(stmt)
    existing_device = res.scalar()

    if existing_device:
        # The route-level status_code applies to every return, so this has to
        # be set explicitly for callers to tell "created" from "already known".
        response.status_code = status.HTTP_200_OK
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
    except IntegrityError:
        # Another concurrent request for the same device_id won the race
        # (e.g. a duplicate call fired before either had committed). That
        # request already created the row we were about to insert, so this
        # is the same idempotent "already registered" case, not a failure.
        await db.rollback()
        res = await db.execute(stmt)
        existing_device = res.scalar()
        if existing_device:
            response.status_code = status.HTTP_200_OK
            return existing_device
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "DB_ERROR", "message": "Device registration failed"}
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "DB_ERROR", "message": str(e)}
        )
    return new_device
