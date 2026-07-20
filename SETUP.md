# Hinglish S2I Recorder - Setup Guide

## Quick Start (Local Development)

### Prerequisites

- **Python 3.10+** with pip
- **Node.js 18+** with npm
- **FFmpeg** (for audio processing)
- **Redis** (optional, for background workers)

### 1. Backend Setup (FastAPI)

```bash
cd api

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
cp ../.env.example .env
# Edit .env and set your SECRET_KEY, ADMIN_PASSWORD, etc.

# Run database migrations (auto-creates tables)
# The app will create SQLite database on first run

# Start the API server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`
- API docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/api/health`

### 2. Frontend Setup (React + Vite)

```bash
cd web

# Install dependencies
npm install

# Start development server
npm run dev
```

The web app will be available at `http://localhost:5173`

### 3. Test the System

1. Open `http://localhost:5173` in your browser
2. Complete onboarding (consent + demographics)
3. Start recording clips for a domain (Banking, Education, Travel, or Virtual Assistant)
4. Use spacebar or hold mouse button to record
5. Review and confirm/redo each clip
6. Switch to Admin panel to see statistics

## Docker Deployment (Recommended for Production)

### With Docker Compose

```bash
# Build and start all services
docker-compose up --build

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

Services:
- **API**: http://localhost:8000
- **Frontend**: http://localhost:5173
- **Redis**: localhost:6379

## Directory Structure

```
S2i_recorder/
├── api/                    # FastAPI backend
│   ├── app/
│   │   ├── main.py        # App entry point
│   │   ├── models.py      # SQLAlchemy models
│   │   ├── schemas.py     # Pydantic schemas
│   │   ├── auth.py        # Authentication
│   │   ├── database.py    # Database connection
│   │   ├── seed.py        # Scenario data seeding
│   │   ├── routers/       # API endpoints
│   │   └── services/      # Business logic
│   ├── storage/           # Audio file storage
│   │   ├── raw/          # Original recordings
│   │   ├── processed/    # 16kHz mono WAV files
│   │   └── exports/      # Dataset exports
│   ├── requirements.txt
│   └── s2i_recorder.db   # SQLite database (auto-created)
│
├── web/                   # React frontend
│   ├── src/
│   │   ├── App.tsx       # Main component
│   │   ├── types.ts      # TypeScript definitions
│   │   ├── db.ts         # IndexedDB wrapper
│   │   └── index.css     # Styles
│   ├── package.json
│   └── vite.config.ts
│
├── data/
│   └── scenarios/        # Scenario JSON files (seeded at startup)
│       ├── bnk_v1.json
│       ├── bnk_v2.json
│       ├── edu_v1.json
│       ├── edu_v2.json
│       ├── trv_v1.json
│       ├── trv_v2.json
│       ├── vas_v1.json
│       └── vas_v2.json
│
├── docs/                 # Documentation
│   ├── API_CONTRACT.md
│   ├── ARCHITECTURE.md
│   ├── AUDIO_PIPELINE.md
│   ├── DATABASE.md
│   └── DECISIONS.md
│
├── docker-compose.yml
├── .env.example
└── README.md
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Database
DATABASE_URL=sqlite+aiosqlite:///./s2i_recorder.db

# Security (CHANGE THESE IN PRODUCTION!)
SECRET_KEY=your-secret-key-change-in-production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123

# CORS (frontend URLs)
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# Optional: Redis for background workers
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0
```

## Running Background Workers (Optional)

For audio processing (transcoding, QC, ASR):

```bash
# Terminal 1: Start Redis
redis-server

# Terminal 2: Start Celery worker
cd api
celery -A app.worker.celery_app worker --loglevel=info
```

## Testing

```bash
# Backend tests
cd api
pytest

# Frontend build test
cd web
npm run build
```

## Production Deployment Checklist

- [ ] Change `SECRET_KEY` to a strong random value
- [ ] Change `ADMIN_PASSWORD` to a secure password
- [ ] Update `CORS_ORIGINS` to your production frontend URL
- [ ] Set up HTTPS (required for getUserMedia API)
- [ ] Configure S3/R2 for scalable storage (optional)
- [ ] Set up PostgreSQL for production database (optional, SQLite works for small deployments)
- [ ] Enable Redis and Celery workers for background processing
- [ ] Set up monitoring and logging
- [ ] Configure backups for database and storage

## Common Issues

### "Could not access microphone"
- Ensure the app is served over HTTPS (or localhost)
- Check browser microphone permissions
- Test on supported browsers: Chrome, Firefox, Safari 14.3+

### "Database not seeded"
- Check that JSON files exist in `data/scenarios/`
- Check API logs for seeding errors
- Delete `s2i_recorder.db` and restart to force re-seed

### "CORS errors"
- Add your frontend URL to `CORS_ORIGINS` in `.env`
- Restart the API server after changing environment variables

### "Audio upload failed"
- Check that `storage/raw/` directory exists and is writable
- Check API logs for error details
- Test with offline mode (IndexedDB queue)

## Admin Dashboard Access

1. Click "Admin Panel" in the top-right corner
2. Login with credentials from `.env`:
   - Username: `admin` (or your ADMIN_USERNAME)
   - Password: `admin123` (or your ADMIN_PASSWORD)

Admin features:
- View recording statistics
- Monitor intent coverage
- Review flagged clips
- Speaker management and withdrawal
- Export dataset manifest

## API Documentation

Interactive API documentation is available at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Support & Documentation

- Full architecture: `docs/ARCHITECTURE.md`
- API contract: `docs/API_CONTRACT.md`
- Design decisions: `docs/DECISIONS.md`
- Database schema: `docs/DATABASE.md`

## License

This project is for research purposes. Audio data collected is subject to the consent terms presented to volunteers during onboarding.
