# Complete System Architecture & Recording Flow

## 📊 Database Configuration

### ✅ NO MANUAL DATABASE SETUP REQUIRED!

The database is **automatically configured** and created when you start the API server.

**Database Location**: `/home/gyan-max/Desktop/S2i_recorder/api/s2i_recorder.db`

**Type**: SQLite with async support  
**Configuration**: `api/app/database.py`  
**Auto-initialization**: Database schema is created on API startup  
**Auto-seeding**: Scenarios are loaded from JSON files on first run  

### How It Works:

```python
# From api/app/database.py
DATABASE_URL = "sqlite+aiosqlite:///./s2i_recorder.db"

# From api/app/main.py - on startup:
@app.on_event("startup")
async def startup_event():
    # 1. Create all tables automatically
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # 2. Seed scenarios from JSON files
    async with AsyncSessionLocal() as db:
        await seed_scenarios(db)
```

**✅ You don't need to do anything!** Just start the API and the database is ready.

---

## 🎯 Complete Recording Flow

### Current Implementation (Phases 1-5)

```
┌─────────────────────────────────────────────────────────────────┐
│                    COMPLETE RECORDING FLOW                       │
└─────────────────────────────────────────────────────────────────┘

1. USER ONBOARDING
   ├─ Device ID generated (localStorage)
   │  └─ POST /api/devices → SQLite DB (devices table)
   ├─ Speaker creates profile
   │  └─ POST /api/speakers → SQLite DB (speakers table)
   └─ Consent accepted → speaker_token (JWT)

2. TASK ASSIGNMENT
   ├─ GET /api/session/next → Fetch task batch
   │  └─ SQLite DB (tasks table)
   └─ Tasks created for speaker's domain

3. RECORDING (Phase 4-5) ⭐ CURRENT PHASE
   ├─ User holds mic button
   ├─ MediaRecorder API captures audio
   ├─ Blob created in browser memory
   │
   ├─ Phase 5: IndexedDB Persistence ⭐ NEW!
   │  ├─ Recording saved to browser IndexedDB
   │  │  Database: "hinglish-s2i-recordings"
   │  │  Store: "recordings"
   │  │  Location: Browser's internal storage
   │  │  └─ Survives page refresh ✅
   │  │
   │  └─ Recording data:
   │     ├─ recordingId (UUID)
   │     ├─ taskId
   │     ├─ speakerId
   │     ├─ deviceId
   │     ├─ blob (audio data)
   │     ├─ mimeType
   │     ├─ durationMs
   │     ├─ createdAt
   │     └─ status: "LOCAL_ONLY"
   │
   └─ User can listen to playback in browser

4. UPLOAD TO SERVER (Phase 6 - NOT YET IMPLEMENTED)
   ├─ ❌ Not in Phase 5
   ├─ ❌ No server upload yet
   └─ Future: Will upload from IndexedDB to server

5. SERVER PROCESSING (Phase 6+ - NOT YET IMPLEMENTED)
   ├─ ❌ POST /api/clips/init
   ├─ ❌ POST /api/clips/upload
   ├─ ❌ POST /api/clips/{clip_id}/confirm
   └─ ❌ Save to storage/raw/ folder
```

---

## 💾 Where Are Recordings Saved?

### Phase 5 (CURRENT): Browser Only

```
BROWSER STORAGE (IndexedDB)
├─ Database: "hinglish-s2i-recordings"
├─ Store: "recordings"
├─ Location: Browser's internal storage
│   Chrome: ~/.config/google-chrome/Default/IndexedDB/
│   Firefox: ~/.mozilla/firefox/*/storage/default/
│
└─ Access via:
    - Chrome DevTools → Application → IndexedDB
    - Firefox DevTools → Storage → IndexedDB
```

**Key Points:**
- ✅ Recordings are stored in the **browser only**
- ✅ Persist across page refresh
- ✅ Survive browser restart
- ✅ Work completely offline
- ❌ **NOT on the server yet** (Phase 6)
- ❌ **NOT in filesystem yet** (Phase 6)

### Phase 6+ (FUTURE): Server Storage

```
SERVER STORAGE (Future)
└─ /api/storage/
    ├─ raw/          # Uploaded WebM files
    │   └─ clip_{uuid}.webm
    ├─ processed/    # Converted WAV files (16kHz mono)
    │   └─ {domain}_{speaker}_{intent}_*.wav
    └─ exports/      # Final datasets
        └─ train/dev/test splits
```

**When Phase 6 is implemented:**
1. User records → IndexedDB (Phase 5) ✅
2. Click "Keep" → Upload to server
3. POST /api/clips/init → Create clip entry in SQLite
4. POST /api/clips/upload → Save to storage/raw/
5. POST /api/clips/{clip_id}/confirm → Process and convert

---

## 🗄️ Database Tables (SQLite)

### Current Schema:

```sql
-- Devices table
CREATE TABLE devices (
    device_id VARCHAR PRIMARY KEY,
    ua_class VARCHAR,
    first_seen DATETIME,
    last_seen DATETIME
);

-- Speakers table  
CREATE TABLE speakers (
    speaker_id VARCHAR PRIMARY KEY,
    identifier VARCHAR UNIQUE,
    age_band VARCHAR,
    gender VARCHAR,
    l1 VARCHAR,
    region VARCHAR,
    consent_version VARCHAR,
    consent_at DATETIME,
    token VARCHAR,
    created_at DATETIME
);

-- Tasks table
CREATE TABLE tasks (
    task_id VARCHAR PRIMARY KEY,
    speaker_id VARCHAR FOREIGN KEY,
    domain VARCHAR,
    batch_no INTEGER,
    intent VARCHAR,
    scenario_id VARCHAR,
    scenario_no INTEGER,
    example_no INTEGER,
    status VARCHAR,  -- 'pending', 'recorded'
    redo_count INTEGER,
    created_at DATETIME
);

-- Scenarios table
CREATE TABLE scenarios (
    scenario_id VARCHAR PRIMARY KEY,
    domain VARCHAR,
    intent VARCHAR,
    scenario_set VARCHAR,  -- 'v1' or 'v2'
    scenario_no INTEGER,
    text_hi TEXT,
    examples JSON,
    register VARCHAR,
    use_count INTEGER
);

-- Clips table (Phase 6+)
CREATE TABLE clips (
    clip_id VARCHAR PRIMARY KEY,
    task_id VARCHAR FOREIGN KEY,
    speaker_id VARCHAR FOREIGN KEY,
    device_id VARCHAR FOREIGN KEY,
    filename VARCHAR,
    raw_path VARCHAR,
    processed_path VARCHAR,
    mime_type VARCHAR,
    duration_ms INTEGER,
    status VARCHAR,  -- 'initiated', 'uploaded', 'confirmed', 'processing', 'processed'
    transcript_provisional TEXT,
    transcript_final TEXT,
    transcript_source VARCHAR,
    prompted BOOLEAN,
    qc_pass BOOLEAN,
    qc_issues TEXT,
    created_at DATETIME,
    confirmed_at DATETIME
);
```

**View database:**
```bash
cd /home/gyan-max/Desktop/S2i_recorder/api
sqlite3 s2i_recorder.db

# Query examples:
SELECT COUNT(*) FROM speakers;
SELECT COUNT(*) FROM tasks;
SELECT COUNT(*) FROM scenarios;
```

---

## 🔐 Admin Panel Access

### Current Status: ❌ NOT ACCESSIBLE (Not Included in Routes)

The admin router exists in code but is **not included** in the API.

**Problem**: `api/app/main.py` doesn't include the admin router!

### 🔧 FIX: Add Admin Router

I'll fix this now:

```python
# api/app/main.py needs to add:
from .routers import devices, speakers, health, session, admin, clips

app.include_router(admin.router, prefix="/api")
app.include_router(clips.router, prefix="/api")
```

### Admin Credentials:

**Username**: `admin`  
**Password**: `admin123`

⚠️ **Change in production!**

### Admin Endpoints (After Fix):

```
POST   /api/admin/login          # Get JWT token
GET    /api/admin/stats          # Overall statistics
GET    /api/admin/coverage       # Domain/intent coverage
GET    /api/admin/review-queue   # Clips awaiting review
POST   /api/admin/review         # Approve/reject clips
POST   /api/admin/export         # Generate dataset export
POST   /api/admin/withdraw       # Handle speaker withdrawal
POST   /api/admin/qr-generate    # Generate QR codes
```

### Admin UI:

Currently there is **no admin UI**. The admin panel would need to be created as:
- A separate React app in `/admin` folder, OR
- Part of the main web app with admin routes

---

## 🛠️ Let Me Fix This Now

Let me add the missing routers to make the API complete:

