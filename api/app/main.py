import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import update

from . import config
from .database import engine, Base, AsyncSessionLocal
from .models import Clip
from .routers import devices, speakers, health, session, admin, clips
from .seed import seed_scenarios
from .services.audio_processor import ffmpeg_available
from .services.storage import init_storage

# Set up logging configuration
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
logger = logging.getLogger(__name__)


async def _run_startup() -> None:
    """Validate config, create the schema, prepare storage, and seed scenarios."""
    for warning in config.validate_config():
        logger.warning("Config: %s", warning)

    # Without ffmpeg no confirmed clip can ever be transcoded, QC'd or exported.
    # Volunteers would still be told "Recording saved" while the corpus stays
    # empty, so production refuses to start rather than collect unusable data.
    if not ffmpeg_available():
        message = (
            f"ffmpeg not found at '{config.FFMPEG_PATH}'. Confirmed recordings "
            "cannot be processed into the corpus. Install ffmpeg or set FFMPEG_PATH."
        )
        if config.IS_PRODUCTION:
            raise config.ConfigurationError(f"Refusing to start: {message}")
        logger.warning("Config: %s Clips will be kept for retry until it is installed.", message)

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

        # Transcoding runs in an in-process background task, so a restart or
        # crash mid-pipeline strands clips in 'processing' with nothing left
        # to finish them. Hand them back to 'confirmed' so the next confirm
        # cycle retries; the audio is already safely on disk.
        try:
            result = await db.execute(
                update(Clip)
                .where(Clip.status == "processing")
                .values(status="confirmed")
            )
            await db.commit()
            if result.rowcount:
                logger.warning(
                    "Recovered %d clip(s) left mid-processing by a previous run.",
                    result.rowcount,
                )
        except Exception as e:
            await db.rollback()
            logger.error(f"Could not recover interrupted clips: {e}")

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
    # The interactive docs enumerate every admin endpoint and schema. Useful in
    # development, needless attack surface on a public deployment.
    docs_url=None if config.IS_PRODUCTION else "/docs",
    redoc_url=None if config.IS_PRODUCTION else "/redoc",
    openapi_url=None if config.IS_PRODUCTION else "/openapi.json",
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Baseline hardening headers on every response."""
    response = await call_next(request)
    # Stop browsers second-guessing declared content types (audio, JSON).
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    if config.IS_PRODUCTION:
        # Only meaningful over HTTPS, and pointless to send in local dev.
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response

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
        # Do not advertise a docs URL that is disabled in production.
        "documentation": None if config.IS_PRODUCTION else "/docs",
        "health": "/api/health",
    }
