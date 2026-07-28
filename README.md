# S2I Hinglish Recorder 🎙️

A comprehensive web-based speech data collection platform for building Hinglish (Hindi-English code-mixed) speech recognition models. This system enables volunteers to record high-quality speech samples across multiple domains with real-time quality control and admin management.

## ✨ Features

### 🎯 Core Functionality
- **Tap-to-Record Interface** - Intuitive recording with visual feedback
- **Multi-Domain Support** - Banking, Education, Travel, and Voice Assistant scenarios  
- **Real-time Audio Playback** - Immediate review of recorded clips
- **Offline-First Architecture** - IndexedDB persistence ensures recordings survive page refresh (Phase 5) ⭐
- **Quality Control** - Automated validation and admin review workflows

### 👥 User Management  
- **Speaker Onboarding** - Demographic collection with consent management
- **Multi-Speaker Devices** - Easy profile switching on shared devices
- **Anonymous Data Collection** - Privacy-focused design with speaker IDs

### 🔧 Admin Dashboard
- **Statistics Overview** - Real-time metrics and progress tracking
- **Audio Review Queue** - Manual quality control for flagged recordings
- **Coverage Heatmaps** - Intent and domain completion visualization
- **Data Export** - Speaker-disjoint dataset generation for ML training
- **Speaker Withdrawal** - GDPR-compliant data deletion

### 🏗️ Technical Architecture
- **Frontend**: React + TypeScript + IndexedDB for offline storage
- **Backend**: FastAPI + SQLite + async processing pipeline
- **Audio**: Web MediaRecorder API with multiple codec support
- **Auth**: JWT-based authentication with role separation

## 🚀 Quick Start

### Prerequisites
- Python 3.9+ with pip
- Node.js 16+ with npm  
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/s2i-hinglish-recorder.git
cd s2i-hinglish-recorder

# Terminal 1 - API Server
cd api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# The schema and all 198 scenarios are created automatically on first start.

# Terminal 2 - Web Server  
cd web
npm run dev
```

Visit `http://localhost:3000` to access the application.

### Admin Credentials
Set `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` (copy from `.env.example`).
Leave `ADMIN_PASSWORD` blank in development and it defaults to `admin123`.
In production the API refuses to start with a blank or well-known password.

## 🎯 Usage

### For Volunteers
1. **Onboard** - Provide basic demographics and consent
2. **Select Domain** - Choose from Banking, Education, Travel, or Assistant
3. **Record** - Tap microphone to start/stop recording
4. **Review** - Listen to playback and confirm or re-record
5. **Progress** - Track completion across scenarios and intents

### For Administrators  
1. **Monitor** - View real-time statistics and coverage metrics
2. **Review** - Approve or reject audio clips in the queue
3. **Export** - Generate training datasets with speaker-disjoint splits  
4. **Manage** - Handle speaker withdrawals and system configuration

## 📊 Data Pipeline

```mermaid
graph LR
    A[Voice Recording] --> B[IndexedDB Storage]
    B --> C[Client Validation]
    C --> D[Server Upload]
    D --> E[Audio Processing]
    E --> F[Quality Control]
    F --> G[Admin Review]
    G --> H[Dataset Export]
```

The system processes audio through multiple stages:
1. **Recording** - MediaRecorder API captures audio
2. **IndexedDB persistence** - Local storage ensures data safety (Phase 5) ⭐
3. **Client-side validation** - Duration and format checks
4. **Server upload** - Authenticated transmission (Phase 6+)
5. **Server processing** - Format conversion and metadata extraction
6. **Automated QC** - Technical quality assessment  
7. **Manual review** - Domain expert approval
8. **Export preparation** - Train/dev/test split generation

### 🎯 Phase 5 Complete: Offline Recording Persistence

**NEW in Phase 5** (July 2026):
- ✅ Recordings automatically save to IndexedDB after capture
- ✅ Survive page refresh, browser restart, device restart
- ✅ Recovery system detects existing recordings on task load
- ✅ Multiple recording attempts per task supported
- ✅ Proper speaker_id/device_id separation
- ✅ Works completely offline (no server required)

See **[docs/FEATURES.md](docs/FEATURES.md)** for a complete tour of every volunteer and admin feature, plus local setup instructions.

## 🏗️ Architecture

### Backend Structure
```
api/
├── app/
│   ├── models.py          # SQLAlchemy database models
│   ├── schemas.py         # Pydantic request/response models  
│   ├── database.py        # Database configuration
│   ├── auth.py           # Authentication & authorization
│   ├── main.py           # FastAPI application entry
│   ├── routers/          # API endpoint definitions
│   └── services/         # Business logic services
├── requirements.txt       # Python dependencies
└── s2i_recorder.db       # SQLite database file
```

### Frontend Structure  
```
web/
├── src/
│   ├── App.tsx           # Main React application
│   ├── Phase3App.tsx     # Current production UI
│   ├── hooks/
│   │   └── useAudioRecorder.ts  # Recording state machine with persistence
│   ├── services/
│   │   └── recordingDB.ts       # IndexedDB service (Phase 5)
│   ├── types.ts          # TypeScript type definitions
│   ├── db.ts             # Legacy IndexedDB (deprecated)
│   └── index.css         # Styling and responsive design
├── package.json          # Node.js dependencies
└── dist/                 # Built production files
```

## 🔒 Security & Privacy

- **Data Anonymization** - No PII stored with audio recordings
- **Consent Management** - Explicit opt-in with withdrawal rights
- **Role-based Access** - Separate volunteer and admin interfaces
- **Secure Authentication** - JWT tokens with configurable expiration
- **Input Validation** - Comprehensive request sanitization
- **CORS Protection** - Origin-based access control

## 🚀 Production Deployment

The API requires **ffmpeg** to transcode confirmed recordings. With
`APP_ENV=production` it refuses to start without it, rather than accepting
clips it can never process. The Docker image installs ffmpeg for you.

### Using Docker (recommended)
```bash
# Configure environment first - the API will not start without real secrets
cp .env.example .env
# Set APP_ENV=production, JWT_SECRET_KEY, ADMIN_PASSWORD and CORS_ORIGINS

docker compose up --build
```

### Manual Deployment
```bash
# Install ffmpeg (required by the audio pipeline)
sudo apt-get install ffmpeg

# Configure environment
cp .env.example .env
# Edit .env with production settings

# Build the frontend
cd web && npm install && npm run build && cd ..

# Serve the API (put nginx or a similar reverse proxy in front for TLS)
cd api
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Hosted (Render + Vercel)
`render.yaml` deploys the API as a Docker service with a persistent disk, and
`vercel.json` builds the frontend from `web/`. After the first deploy, set
`CORS_ORIGINS` on Render to your Vercel URL, and `VITE_API_URL` on Vercel to
your Render URL — the two must point at each other or the browser will be
blocked by CORS.

See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive production setup instructions including nginx configuration, systemd services, and security hardening.

## 📈 Monitoring & Analytics

Track key metrics through the admin dashboard:
- **Collection Progress** - Scenarios completed per domain/intent
- **Quality Metrics** - Accept/reject rates and common issues  
- **Speaker Engagement** - Active contributors and session patterns
- **Technical Health** - API response times and error rates

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Setup
```bash
# Backend development
cd api
pip install -r requirements.txt
pip install -r requirements-dev.txt  # Additional dev tools

# Frontend development  
cd web
npm install
npm run dev

# Run tests
npm test                 # Frontend tests
cd api && pytest       # Backend tests
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for advancing Hinglish speech recognition research
- Inspired by Mozilla Common Voice and similar open speech datasets
- Thanks to all volunteer contributors who make this data collection possible

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/s2i-hinglish-recorder/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/s2i-hinglish-recorder/discussions)
- **Security**: Report security issues privately to [security@yourdomain.com]

---

**Made with ❤️ for the speech recognition community**