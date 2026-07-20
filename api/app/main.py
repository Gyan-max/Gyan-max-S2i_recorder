from fastapi import FastAPI, Depends, status
from fastapi.middleware.cors import CORSMiddleware
import logging
import os
from datetime import datetime

from .database import engine, Base, AsyncSessionLocal
from .routers import devices, speakers, health, session, admin, clips
from .seed import seed_scenarios

# Set up logging configuration
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Hinglish S2I Phase 5: Complete Recording System",
    description="Full system with IndexedDB persistence, clip management, and admin panel",
    version="5.0.0"
)

# Read CORS origins from environment (comma-separated)
cors_origins_env = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
)
ALLOWED_ORIGINS = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]

# Enable CORS for frontend web app access
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all routers
app.include_router(devices.router, prefix="/api")
app.include_router(speakers.router, prefix="/api")  
app.include_router(health.router, prefix="/api")
app.include_router(session.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(clips.router, prefix="/api")

@app.on_event("startup")
async def startup_event():
    """Application startup handler."""
    logger.info("Phase 5 Startup: Initializing database schema...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    logger.info("Phase 5 Startup: Seeding scenarios...")
    async with AsyncSessionLocal() as db:
        try:
            await seed_scenarios(db)
        except Exception as e:
            logger.error(f"Error seeding scenarios: {e}")
        
    logger.info("Phase 5 startup sequence complete. All endpoints ready.")

@app.get("/")
async def root():
    """Root endpoint - Full system information."""
    return {
        "project": "Hinglish S2I Recorder",
        "phase": "Phase 5: IndexedDB Offline Persistence",
        "status": "active",
        "version": "5.0.0",
        "volunteer_endpoints": [
            "POST /api/devices - Register device",
            "POST /api/speakers - Create speaker with consent", 
            "GET /api/devices/{device_id}/speakers - Get device roster",
            "GET /api/speakers/{speaker_id}/consent - Check consent status",
            "GET /api/session/next - Get next task batch",
            "GET /api/session/progress - Get detailed progress",
            "POST /api/clips/init - Initialize clip upload",
            "POST /api/clips/upload - Upload audio file",
            "POST /api/clips/{clip_id}/confirm - Confirm recording",
            "POST /api/clips/{clip_id}/discard - Discard recording",
            "GET /api/health - Health check"
        ],
        "admin_endpoints": [
            "POST /api/admin/login - Admin authentication",
            "GET /api/admin/stats - System statistics",
            "GET /api/admin/coverage - Domain/intent coverage",
            "GET /api/admin/review-queue - Clips awaiting review",
            "POST /api/admin/review - Review clip (approve/reject)",
            "POST /api/admin/export - Generate dataset export",
            "POST /api/admin/withdraw - Speaker withdrawal",
            "POST /api/admin/qr-generate - Generate QR codes"
        ],

        "documentation": "http://localhost:8000/docs"
    }
