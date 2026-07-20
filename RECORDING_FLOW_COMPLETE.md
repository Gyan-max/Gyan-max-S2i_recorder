# Complete Recording Flow & Storage Guide

## 📊 Database Configuration

### ✅ NO MANUAL SETUP REQUIRED!

The database is **automatically configured** when you start the API server.

**Location**: `/home/gyan-max/Desktop/S2i_recorder/api/s2i_recorder.db`  
**Type**: SQLite with async support  
**Auto-created**: Yes, on first API startup  
**Auto-seeded**: Yes, scenarios loaded from JSON files  

### View Database

```bash
cd /home/gyan-max/Desktop/S2i_recorder/api
sqlite3 s2i_recorder.db

# Query examples:
.tables
SELECT COUNT(*) FROM speakers;
SELECT COUNT(*) FROM tasks;
SELECT COUNT(*) FROM scenarios;
SELECT * FROM speakers LIMIT 5;
.quit
```

---

## 🎯 Complete Recording Flow (Current Implementation)

```
┌─────────────────────────────────────────────────────────────────┐
│              PHASE 5: RECORDING FLOW                             │
└─────────────────────────────────────────────────────────────────┘

Step 1: USER ONBOARDING
├─ Device ID generated → localStorage (browser)
│  └─ POST /api/devices → Saved to SQLite (devices table)
│
├─ Speaker creates profile (name, age, gender, L1, region)
│  └─ POST /api/speakers → Saved to SQLite (speakers table)
│     Returns: speaker_id, token (JWT)
│
└─ Consent accepted → Stored in speakers table


Step 2: TASK ASSIGNMENT
├─ GET /api/session/next
│  └─ Backend creates 15 tasks for speaker
│     Saved to SQLite (tasks table)
│     Returns: batch of tasks with scenarios
│
└─ Tasks displayed in UI


Step 3: RECORDING (Current Phase 5)
├─ User holds mic button → MediaRecorder API starts
├─ Audio captured → Blob created in browser memory
├─ User releases → MediaRecorder stops
│
├─ Phase 5: IndexedDB Persistence ⭐
│  ├─ Recording automatically saved to browser IndexedDB
│  │  Database: "hinglish-s2i-recordings"
│  │  Store: "recordings"
│  │  Location: Browser internal storage
│  │
│  └─ Data saved:
│     ├─ recordingId (UUID)
│     ├─ taskId (links to task)
│     ├─ speakerId (links to speaker)
│     ├─ deviceId (links to device)
│     ├─ blob (actual audio data)
│     ├─ mimeType ("audio/webm;codecs=opus")
│     ├─ durationMs (length in milliseconds)
│     ├─ createdAt (ISO timestamp)
│     └─ status ("LOCAL_ONLY")
│
├─ User listens to playback → Audio player in browser
└─ Recording survives page refresh ✅


Step 4: UPLOAD TO SERVER (Phase 6 - NOT YET IMPLEMENTED)
├─ ❌ User clicks "Keep Recording"
├─ ❌ POST /api/clips/init
├─ ❌ POST /api/clips/upload (multipart/form-data)
├─ ❌ File saved to /api/storage/raw/
└─ ❌ POST /api/clips/{clip_id}/confirm


Step 5: SERVER PROCESSING (Phase 6+ - NOT YET IMPLEMENTED)
├─ ❌ Background task converts WebM → WAV
├─ ❌ Quality control checks
├─ ❌ Admin review
└─ ❌ Export to dataset
```

---

## 💾 Where Are Recordings Saved?

### Current State (Phase 5):

#### 1. Browser Storage (IndexedDB) ✅ WORKING

**Recordings Location:**
```
Browser Internal Storage:
└─ IndexedDB
   └─ hinglish-s2i-recordings (database)
      └─ recordings (store)
         ├─ Recording 1 (recordingId: uuid)
         ├─ Recording 2 (recordingId: uuid)
         └─ Recording 3 (recordingId: uuid)
```

**How to View:**
1. Open Chrome/Edge DevTools (F12)
2. Go to "Application" tab
3. Expand "IndexedDB"
4. Click "hinglish-s2i-recordings"
5. Click "recordings" store
6. See all recordings with metadata and audio blobs

**Characteristics:**
- ✅ Persists across page refresh
- ✅ Survives browser restart
- ✅ Works completely offline
- ✅ No server connection needed
- ❌ Local to this browser only
- ❌ Not synchronized to server (yet)

**Physical Location (Chrome):**
```
~/.config/google-chrome/Default/IndexedDB/
http_localhost_3000.indexeddb.leveldb/
```

**Physical Location (Firefox):**
```
~/.mozilla/firefox/{profile}/storage/default/
http+++localhost+3000/idb/
```

#### 2. Server Storage (SQLite) ✅ PARTIAL

**Metadata Location:**
```
/home/gyan-max/Desktop/S2i_recorder/api/s2i_recorder.db

Tables:
├─ devices       # Device registrations
├─ speakers      # Speaker profiles
├─ tasks         # Assigned tasks
├─ scenarios     # Scenario templates
└─ clips         # ❌ NOT USED YET (Phase 6)
```

**What's Stored:**
- ✅ Device IDs and user agents
- ✅ Speaker demographics
- ✅ Task assignments
- ✅ Scenario definitions
- ❌ Audio files (not yet)
- ❌ Clip metadata (not yet)

#### 3. Server Filesystem ❌ NOT YET IMPLEMENTED

**Future Location (Phase 6+):**
```
/home/gyan-max/Desktop/S2i_recorder/api/storage/
├─ raw/              # Uploaded WebM/Opus files
│   ├─ clip_uuid1.webm
│   ├─ clip_uuid2.webm
│   └─ ...
│
├─ processed/        # Converted WAV files
│   ├─ BNK_spk001_flight_v1_01_01_uuid.wav
│   ├─ EDU_spk002_course_v2_02_03_uuid.wav
│   └─ ...
│
└─ exports/          # Final datasets
    ├─ BNK_train.tar.gz
    ├─ BNK_dev.tar.gz
    └─ BNK_test.tar.gz
```

**Not Yet Available Because:**
- Phase 5 focused on offline persistence
- Server upload comes in Phase 6
- File processing comes in Phase 6

---

## 🗄️ Database Schema

### Current Tables (SQLite):

```sql
-- Devices Table
CREATE TABLE devices (
    device_id VARCHAR PRIMARY KEY,
    ua_class VARCHAR,              -- Browser type
    first_seen DATETIME,
    last_seen DATETIME
);

-- Speakers Table
CREATE TABLE speakers (
    speaker_id VARCHAR PRIMARY KEY,
    identifier VARCHAR UNIQUE,      -- Name/nickname
    age_band VARCHAR,               -- Age range
    gender VARCHAR,
    l1 VARCHAR,                     -- Native language
    region VARCHAR,
    consent_version VARCHAR,
    consent_at DATETIME,
    token VARCHAR,                  -- JWT token
    created_at DATETIME
);

-- Tasks Table
CREATE TABLE tasks (
    task_id VARCHAR PRIMARY KEY,
    speaker_id VARCHAR FOREIGN KEY,
    domain VARCHAR,                 -- BNK, EDU, TRV, VAS
    batch_no INTEGER,               -- 1, 2, or 3
    intent VARCHAR,                 -- e.g., "flight_booking"
    scenario_id VARCHAR FOREIGN KEY,
    scenario_no INTEGER,
    example_no INTEGER,             -- 1, 2, or 3
    status VARCHAR,                 -- "pending" or "recorded"
    redo_count INTEGER DEFAULT 0,
    created_at DATETIME
);

-- Scenarios Table
CREATE TABLE scenarios (
    scenario_id VARCHAR PRIMARY KEY,
    domain VARCHAR,
    intent VARCHAR,
    scenario_set VARCHAR,           -- "v1" or "v2"
    scenario_no INTEGER,
    text_hi TEXT,                   -- Hindi scenario text
    examples JSON,                  -- Array of example phrasings
    register VARCHAR,               -- formal/informal/mixed
    use_count INTEGER DEFAULT 0
);

-- Clips Table (Phase 6+ - exists but not used yet)
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
    status VARCHAR,
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

---

## 🔄 Data Flow Diagram

```
┌─────────────┐
│   Browser   │
│             │
│  IndexedDB  │ ← Recordings stored here (Phase 5) ✅
│             │
└──────┬──────┘
       │
       │ Future: Upload (Phase 6)
       ↓
┌─────────────┐
│   Server    │
│             │
│   SQLite    │ ← Metadata stored here ✅
│  Database   │   (speakers, tasks, devices)
│             │
└──────┬──────┘
       │
       │ Future: File save (Phase 6)
       ↓
┌─────────────┐
│ Filesystem  │
│             │
│ storage/    │ ← Audio files will go here ❌
│   raw/      │   (not yet implemented)
│   processed/│
│   exports/  │
└─────────────┘
```

---

## 📱 How to Access Your Recordings

### Option 1: Browser DevTools (Phase 5 - Current)

1. Open http://localhost:3000
2. Record some audio
3. Open DevTools (F12)
4. Application tab → IndexedDB → hinglish-s2i-recordings
5. Click "recordings" store
6. See your recordings!

**What you'll see:**
- recordingId: UUID
- blob: Blob object (actual audio)
- mimeType: audio/webm
- durationMs: length
- createdAt: timestamp
- taskId, speakerId, deviceId

### Option 2: Admin Panel (Current)

1. Open http://localhost:3000
2. Click "Admin Access" button
3. See statistics:
   - Total speakers
   - Total recordings (currently shows 0 since clips table not used)
4. Access API endpoints

### Option 3: SQLite Database (Current)

```bash
cd /home/gyan-max/Desktop/S2i_recorder/api
sqlite3 s2i_recorder.db

-- See all speakers
SELECT * FROM speakers;

-- See all tasks
SELECT * FROM tasks;

-- Count recordings per speaker
SELECT speaker_id, COUNT(*) 
FROM tasks 
WHERE status = 'recorded' 
GROUP BY speaker_id;
```

### Option 4: API Endpoints (Future - Phase 6)

```bash
# Get all clips (will work in Phase 6)
curl -H "Authorization: Bearer {token}" \
  http://localhost:8000/api/admin/clips

# Download recording (Phase 6)
curl -H "Authorization: Bearer {token}" \
  http://localhost:8000/api/clips/{clip_id}/download \
  -o recording.webm
```

---

## 🎯 Phase Comparison

### Phase 5 (CURRENT) ✅
- ✅ Recording in browser
- ✅ Save to IndexedDB
- ✅ Survive page refresh
- ✅ Multiple attempts per task
- ✅ Speaker/device separation
- ✅ Works offline
- ❌ No server upload
- ❌ No file storage

### Phase 6 (FUTURE) 🔜
- ✅ Everything from Phase 5
- ✅ Upload to server
- ✅ Save to filesystem
- ✅ Quality control
- ✅ Admin review
- ✅ Processing pipeline
- ✅ Dataset export

---

## 🔑 Key Points

1. **Database is automatic** - No setup needed, created on first run
2. **Recordings are in browser** - IndexedDB, not server (Phase 5)
3. **Metadata is in SQLite** - Speakers, tasks, devices tracked
4. **Server storage comes later** - Phase 6 will add file uploads
5. **Admin panel works** - Click "Admin Access" on welcome screen
6. **Everything is local** - No cloud, no external services

---

## ❓ FAQ

**Q: Do I need to configure the database?**  
A: No! It's automatic. Just start the API and it's ready.

**Q: Where are my recordings?**  
A: In your browser's IndexedDB. Check DevTools → Application → IndexedDB.

**Q: Can I see recordings in the filesystem?**  
A: Not yet. Phase 6 will add file storage.

**Q: How do I access the admin panel?**  
A: Click "Admin Access" button on the welcome screen.

**Q: What's in the SQLite database?**  
A: Speaker info, tasks, devices, scenarios. Not audio files (yet).

**Q: Do recordings sync between browsers?**  
A: No. IndexedDB is local to each browser.

**Q: What happens if I clear browser data?**  
A: IndexedDB recordings are deleted. Phase 6 will add server backup.

**Q: Can I export recordings?**  
A: Not yet. Phase 6 will add export functionality.

---

## 📚 Related Documentation

- **ADMIN_PANEL_GUIDE.md** - How to use admin panel
- **PHASE5_COMPLETE.md** - Phase 5 implementation
- **SYSTEM_ARCHITECTURE.md** - Complete system design

---

**Status**: Phase 5 Complete ✅  
**Database**: Auto-configured ✅  
**Admin Panel**: Working ✅  
**Recordings**: Browser only (IndexedDB) ✅
