import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .database import engine, Base, AsyncSessionLocal
from .routers import devices, speakers, health, session, admin, clips
from .seed import seed_scenarios
from .services.storage import init_storage

# Set up logging configuration
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
logger = logging.getLogger(__name__)


async def _run_startup() -> None:
    """Validate config, create the schema, prepare storage, and seed scenarios."""
    for warning in config.validate_config():
        logger.warning("Config: %s", warning)

    logger.info("Environment: %s", config.APP_ENV)
    logger.info("Database:    %s", config.DATABASE_URL)
    logger.info("Storage:     %s", config.STORAGE_BASE_PATH)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Migration: add assigned_domain column if missing
    try:
        from sqlalchemy import inspect, text as sa_text

        async with engine.begin() as conn:
            def _add_column(sync_conn):
                inspector = inspect(sync_conn)
                columns = [col["name"] for col in inspector.get_columns("speakers")]
                if "assigned_domain" not in columns:
                    sync_conn.execute(sa_text("ALTER TABLE speakers ADD COLUMN assigned_domain VARCHAR"))
                    logger.info("Migration: added assigned_domain column to speakers table")

            await conn.run_sync(_add_column)
    except Exception as e:
        logger.warning(f"Migration could not add assigned_domain column: {e}")

    # Create storage directories up front so the first upload cannot fail on a
    # missing parent directory.
    init_storage()

    async with AsyncSessionLocal() as db:
        try:
            await seed_scenarios(db)
        except Exception as e:
            logger.error(f"Error seeding scenarios: {e}")

    logger.info("Startup complete. All endpoints ready.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _run_startup()
    yield
    await engine.dispose()


app = FastAPI(
    title="Hinglish S2I Recorder",
    description="Speech data collection platform for Hinglish speech-to-intent models",
    version="5.0.0",
    lifespan=lifespan,
)

# An empty origin list must never widen to "*": combined with
# allow_credentials that would let any site drive the API with real credentials.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Device-ID"],
)

# Include all routers
app.include_router(devices.router, prefix="/api")
app.include_router(speakers.router, prefix="/api")  
app.include_router(health.router, prefix="/api")
app.include_router(session.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(clips.router, prefix="/api")

@app.get("/")
async def root():
    """Root endpoint - service metadata. Full API reference lives at /docs."""
    return {
        "project": "Hinglish S2I Recorder",
        "status": "active",
        "version": "5.0.0",
        "environment": config.APP_ENV,
        "documentation": "/docs",
        "health": "/api/health",
    }
