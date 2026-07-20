from fastapi import FastAPI, Depends, status
from fastapi.middleware.cors import CORSMiddleware
import logging
from datetime import datetime

from .database import engine, Base, AsyncSessionLocal
from .routers import devices, speakers, health, session
from .seed import seed_scenarios

# Set up logging configuration
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Hinglish S2I Phase 3: Scenario and Task Assignment",
    description="Minimal Testing Prototype - Phase 3 Implementation",
    version="3.0.0"
)

# Enable CORS for frontend web app access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For prototype, allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Phase 3 routers
app.include_router(devices.router, prefix="/api")
app.include_router(speakers.router, prefix="/api")  
app.include_router(health.router, prefix="/api")
app.include_router(session.router, prefix="/api")

@app.on_event("startup")
async def startup_event():
    """Application startup handler for Phase 3."""
    logger.info("Phase 3 Startup: Initializing database schema...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    logger.info("Phase 3 Startup: Seeding scenarios...")
    async with AsyncSessionLocal() as db:
        try:
            await seed_scenarios(db)
        except Exception as e:
            logger.error(f"Error seeding scenarios: {e}")
        
    logger.info("Phase 3 startup sequence complete.")

@app.get("/")
async def root():
    """Root endpoint - Phase 3 information."""
    return {
        "project": "Hinglish S2I Recorder",
        "phase": "Phase 3: Scenario and Task Assignment",
        "status": "active",
        "version": "3.0.0",
        "endpoints": [
            "POST /api/devices - Register device",
            "POST /api/speakers - Create speaker with consent", 
            "GET /api/devices/{device_id}/speakers - Get device roster",
            "GET /api/speakers/{speaker_id}/consent - Check consent status",
            "GET /api/session/next - Get next task batch",
            "GET /api/session/progress - Get detailed progress",
            "GET /api/health - Health check"
        ]
    }
