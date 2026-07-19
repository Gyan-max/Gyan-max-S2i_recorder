# ARCHITECTURE.md — Hinglish S2I Volunteer Recording Web App

> **Version:** 1.0 · **Status:** Implementation-ready · **Source of truth:** [README.md](../README.md)

---

## 1. System Overview

The Hinglish S2I Recording Web App is a browser-based tool for collecting multi-domain Hinglish Speech-to-Intent corpus data. Volunteers open a link, record utterances against server-assigned scenarios, confirm each take, and move on. The system handles speaker IDs, filenames, metadata, domain/intent tagging, scenario assignment, and provenance automatically.

### 1.1 Architecture Principles

| # | Principle | Architectural consequence |
|---|-----------|--------------------------|
| P1 | Bad data must never reach the corpus silently | Mandatory listen-and-confirm; backend-authoritative clip status |
| P2 | One human = one speaker ID, always | `device_id ≠ speaker_id`; explicit separation at every layer |
| P3 | The speaker never types if avoidable | No login; dropdowns; transcript prefilled |
| P4 | Metadata is derived, never asked | Server-assigned IDs, filenames, domain, intent, scenario |
| P5 | Never block on the network | Offline-first; IndexedDB queue; background upload |
| P6 | Corrupt data must be impossible | Domain/intent from server-issued task; client cannot override |

### 1.2 High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER (React PWA)                                            │
│                                                                 │
│  MediaRecorder ──▶ IndexedDB queue ──▶ Background Uploader      │
│       │                    ▲                     │              │
│  Live waveform       Survives offline/           │ Signed URL   │
│  (AnalyserNode)      refresh/crash               │ PUT          │
└──────────────────────────────────────────────────┼──────────────┘
                                                   │ HTTPS
                          ┌────────────────────────▼──────────────┐
                          │  API (FastAPI)                        │
                          │  • Issues tasks (domain+intent+scen)  │
                          │  • Signs upload URLs                  │
                          │  • Records metadata                   │
                          │  • Enforces consent server-side       │
                          └──────┬──────────────────┬─────────────┘
                                 │                  │
                    ┌────────────▼────────┐  ┌──────▼─────────────┐
                    │  Object Storage     │  │  PostgreSQL        │
                    │  (S3-compat / R2)   │  │  speakers, devices │
                    │  raw/ + wav/        │  │  clips, tasks,     │
                    └────────────┬────────┘  │  scenarios, consent│
                                 │          └────────────────────┘
                    ┌────────────▼────────────────────────────────┐
                    │  Redis                                      │
                    │  Task queue + result backend                │
                    └────────────┬────────────────────────────────┘
                                 │
                    ┌────────────▼────────────────────────────────┐
                    │  Worker (Celery)                            │
                    │  FFmpeg → 16kHz WAV → QC → ASR → manifest  │
                    └─────────────────────────────────────────────┘
```

---

## 2. Component Architecture

### 2.1 Frontend — React PWA

| Concern | Technology | Notes |
|---------|-----------|-------|
| Framework | React 18+ with Vite | TypeScript throughout |
| PWA | Workbox via `vite-plugin-pwa` | Offline shell; service worker caches app assets only (not audio) |
| Audio capture | `navigator.mediaDevices.getUserMedia` + `MediaRecorder` | echoCancellation/noiseSuppression/autoGainControl all OFF |
| Live waveform | `AnalyserNode` from Web Audio API | Visual mic-works feedback |
| Local persistence | IndexedDB via `idb` library | Stores audio blobs + task metadata; survives refresh/crash |
| State management | React Context + `useReducer` | Session state (speaker, device, current task, upload queue) |
| Upload | `fetch()` with `PUT` to signed URLs | Abort controller for redo cancellation |

**Screen structure (single-page, no routing during recording):**

| Screen | Purpose | When shown |
|--------|---------|------------|
| `Onboarding` | Consent + 4 fields (age, gender, L1, region) | Once per new speaker |
| `SpeakerSwitch` | Pick from device roster or create new | Session start, idle timeout, manual switch |
| `Recorder` | Prompt state ↔ Confirm state | The core loop |
| `Complete` | Batch/domain complete | End of batch |

**Trust boundary:** The frontend is untrusted. It never defines domain, intent, scenario, filename, or speaker_id authoritatively. All metadata comes from server-issued tasks.

### 2.2 Backend — FastAPI

| Layer | Responsibility |
|-------|---------------|
| Routers | HTTP endpoints; input validation via Pydantic |
| Services | Business logic: task generation, scenario assignment, naming, storage signing |
| Models | SQLAlchemy 2.x ORM models |
| Dependencies | Auth injection, DB session, speaker/consent validation |

**Key services:**

- `task_generator.py` — Coverage-aware batch generation (§14 of README)
- `scenario_assign.py` — Version-balanced scenario assignment (§10 algorithm)
- `naming.py` — Canonical filename generation (§8)
- `storage.py` — Signed URL generation for S3-compatible storage
- `consent.py` — Server-side consent enforcement

**Startup:** Alembic manages schema migrations. Scenario seeding runs as a one-time management command.

### 2.3 Worker — Celery + Redis

**Choice: Celery over RQ.** See [DECISIONS.md](./DECISIONS.md) ADR-008.

| Task | Input | Output | Idempotency |
|------|-------|--------|-------------|
| `transcode` | Raw WebM/MP4 from object storage | 16kHz mono WAV written to `wav/` prefix | Re-run overwrites; DB status re-set |
| `qc_check` | WAV file | `qc_flags[]` on clip row | Flags overwritten on re-run |
| `asr_transcribe` | WAV file | `transcript_final` candidate | Overwrites previous ASR result |
| `export_manifest` | Triggered by admin | `manifest.jsonl` in `manifests/` prefix | Full regeneration |

**Pipeline chaining:** `transcode → qc_check → asr_transcribe` via Celery chains. Each step is independently retriable.

**Concurrency:** Prefork pool. CPU-bound FFmpeg and ASR tasks benefit from process isolation. Default 2 workers per core.

### 2.4 Database — PostgreSQL

See [DATABASE.md](./DATABASE.md) for full schema. PostgreSQL provides:

- Relational integrity for speaker → device → task → clip provenance chain
- Generated columns (`age_band` from `age`)
- Array types (`qc_flags text[]`, `examples text[]`)
- `GENERATED ALWAYS AS` for derived columns
- Row-level locking for confirmation race conditions

### 2.5 Object Storage — S3-Compatible (R2 recommended)

```
s3://corpus/
  raw/<domain>/<speaker_id>/<clip_id>.webm    ← immutable original
  wav/<domain>/<speaker_id>/<filename>.wav     ← 16kHz mono deliverable
  manifests/<date>/manifest.jsonl              ← export
```

- **Uploads:** Browser → signed PUT URL → object storage (never proxied through FastAPI)
- **Downloads:** Worker uses service-account credentials to read raw, write wav
- **Access control:** Signed URLs expire after 10 minutes. Raw audio is never publicly accessible.

### 2.6 Redis

- **Primary use:** Celery broker + result backend
- **Secondary use:** Rate limiting (optional)
- **NOT used for:** Durable state. All authoritative state lives in PostgreSQL.

---

## 3. Trust Boundaries

```
┌──────────────────────────┐
│  UNTRUSTED: Browser      │  Cannot define: domain, intent, scenario,
│  - device_id (self-gen)  │  filename, speaker_id, task metadata
│  - speaker token         │  Can provide: audio blob, prompted flag,
│  - audio blob            │  transcript edit, keep/redo decision
│  - UI state              │
└──────────┬───────────────┘
           │ HTTPS (TLS required)
┌──────────▼───────────────┐
│  TRUSTED: API            │  Authoritative for: task_id, domain, intent,
│  - Validates speaker     │  scenario, filename, speaker_id, clip_id,
│  - Enforces consent      │  consent, scenario usage
│  - Issues tasks          │
│  - Signs URLs            │
└──────────┬───────────────┘
           │
┌──────────▼───────────────┐
│  TRUSTED: Worker         │  Authoritative for: duration, QC flags,
│  - Processes audio       │  ASR transcript, WAV path
│  - Runs QC               │
│  - Runs ASR              │
└──────────────────────────┘
```

**Rule:** Any field that affects corpus integrity (domain, intent, scenario, speaker identity, consent) is server-authoritative. The client provides only audio data and non-authoritative metadata (transcript edits, prompted flag).

---

## 4. Data Flows & Lifecycles

### 4.1 Recording Lifecycle

```
[Volunteer taps & holds record button]
    │
    ▼
getUserMedia stream → MediaRecorder.start()
    │
[Volunteer releases button]
    │
    ▼
MediaRecorder.stop() → ondataavailable → Blob
    │
    ├──▶ 1. Write blob + task metadata to IndexedDB (DURABLE — instant)
    ├──▶ 2. Start optimistic upload (background, non-blocking)
    └──▶ 3. Auto-play blob for volunteer review
              │
    ┌─────────┴─────────┐
    ▼                   ▼
  [KEEP]              [REDO]
```

### 4.2 Keep Lifecycle

```
Volunteer clicks KEEP
    │
    ▼
POST /api/clips/:id/confirm
  Body: { transcript_edit?, prompted }
    │
    ▼
Server (in single transaction):
  1. Verify clip.status IN ('initiated', 'uploaded') — or already 'confirmed' (idempotent)
  2. Verify task.speaker_id == authenticated speaker
  3. Verify speaker has valid consent
  4. Set clip.status = 'confirmed'
  5. Set task.status = 'recorded'
  6. INCREMENT scenario.use_count (ONLY here, never on init/upload)
  7. Store transcript_provisional / transcript edit
  8. Return 200
    │
    ▼
Client:
  1. Remove blob from IndexedDB
  2. Advance to next task
  3. Fetch next task if not prefetched
```

### 4.3 Redo Lifecycle

```
Volunteer clicks REDO
    │
    ▼
POST /api/clips/:id/discard
    │
    ▼
Server (in single transaction):
  1. Verify clip belongs to speaker
  2. Set clip.status = 'discarded'
  3. INCREMENT task.redo_count
  4. Keep task.status = 'pending' (DO NOT advance)
  5. DO NOT increment scenario.use_count
  6. Issue DELETE for raw object (best-effort, async)
  7. Return 200 with same task reissued
    │
    ▼
Client:
  1. Abort in-flight upload (AbortController.abort())
  2. Delete blob from IndexedDB
  3. Reissue same task (same prompt displayed again)
```

### 4.4 Offline Lifecycle

```
[Network unavailable]
    │
    ▼
Recording proceeds normally:
  MediaRecorder → Blob → IndexedDB ✓
  Upload attempt fails → queued in IndexedDB with retry metadata
  Confirm UI works (local state)
    │
[Network returns]
    │
    ▼
Background uploader drains queue:
  For each pending upload in IndexedDB:
    1. Request fresh signed URL (old one may have expired)
    2. Upload blob
    3. Confirm/discard based on stored decision
    4. On success: remove from IndexedDB
    5. On failure: exponential backoff, max 5 retries
```

### 4.5 Upload Lifecycle

```
init (POST /api/clips/init)
  → Server creates clip row (status: 'initiated')
  → Returns clip_id + signed PUT URL + canonical filename
    │
    ▼
upload (PUT signed URL)
  → Browser uploads blob directly to object storage
  → On completion: clip is in storage (status conceptually 'uploaded')
    │
    ▼
confirm OR discard
  → Final state transition (server-authoritative)
```

### 4.6 Processing Lifecycle (Worker)

```
clip.status == 'confirmed'
    │
    ▼
[Celery task: transcode]
  → Download raw WebM/MP4 from object storage
  → FFmpeg: 16kHz mono WAV with silence trimming
  → Upload WAV to wav/ prefix
  → Update clip: wav_path, duration_s
  → clip.status = 'processing'
    │
    ▼
[Celery task: qc_check]
  → Analyze WAV: duration, clipping, silence, SNR
  → Update clip: qc_flags[]
  → If fatal flag (silent): clip.status = 'rejected'
  → Else: continue
    │
    ▼
[Celery task: asr_transcribe]
  → Run ASR model on WAV
  → Update clip: transcript_final, transcript_source = 'asr'
  → clip.status = 'processed'
```

### 4.7 Review Lifecycle (Admin)

```
Admin views flagged clips in review queue
    │
    ├── Accept: clip remains 'processed', flags acknowledged
    ├── Reject: clip.status = 'rejected', task reissued to different speaker
    └── Edit transcript: transcript_final updated, transcript_source = 'human_verified'
```

### 4.8 Withdrawal Lifecycle

```
Speaker requests withdrawal (via admin or self-serve)
    │
    ▼
Server (single transaction):
  1. Mark speaker as withdrawn (withdrawn_at = NOW())
  2. Queue async deletion job
    │
    ▼
Worker:
  1. Delete all raw/ objects for speaker
  2. Delete all wav/ objects for speaker
  3. Delete all clip rows (CASCADE from speaker)
  4. Delete all task rows
  5. Remove from device_speakers
  6. Retain anonymized audit record: speaker_id, withdrawal_at, clip_count_deleted
```

### 4.9 Export Lifecycle

```
Admin triggers export
    │
    ▼
Worker:
  1. Query all clips WHERE status = 'processed' AND speaker NOT withdrawn
  2. Join with tasks, speakers, scenarios
  3. Compute speaker-disjoint splits (train/dev/test)
  4. Generate manifest.jsonl (one line per clip):
     - filename, wav_path, domain, intent, scenario_id, speaker_id,
       age_band (NOT age), gender, l1, region, transcript_final,
       transcript_source, prompted, duration_s, split
  5. Upload to manifests/<date>/
  6. Optionally generate HuggingFace datasets layout
```

---

## 5. State Machines

### 5.1 Task State Machine

| State | Meaning | Transitions |
|-------|---------|-------------|
| `pending` | Task issued, not yet completed | → `recorded` (on confirm) · → `skipped` (admin) |
| `recorded` | Clip confirmed by speaker | Terminal for volunteer flow |
| `skipped` | Administratively skipped | Terminal |

**On redo:** Task stays `pending`. `redo_count` increments. The associated clip is discarded.

### 5.2 Clip State Machine

| State | Meaning | Who sets it |
|-------|---------|-------------|
| `initiated` | Clip row created, signed URL issued | API on `/clips/init` |
| `uploaded` | Raw blob received in object storage | API notification |
| `confirmed` | Speaker clicked Keep | API on `/clips/:id/confirm` |
| `discarded` | Speaker clicked Redo, or abandoned | API on `/clips/:id/discard` |
| `processing` | Worker is transcoding/QC/ASR | Worker |
| `processed` | Pipeline complete, clip is corpus-ready | Worker |
| `rejected` | Failed QC or admin rejection | Worker or Admin |

**Idempotency:** Confirming an already-confirmed clip returns 200 (no-op). Discarding an already-discarded clip returns 200. Confirming a discarded clip returns 409 Conflict.

### 5.3 Upload Queue State Machine (Client-Side, IndexedDB)

| State | Meaning | Transitions |
|-------|---------|-------------|
| `pending` | Blob saved, not yet uploading | → `uploading` (start) · → `discarded` (redo) |
| `uploading` | Upload in progress | → `uploaded` (success) · → `failed` (error) · → `discarded` (redo+abort) |
| `uploaded` | Upload complete | → removed from IndexedDB on confirm |
| `failed` | Upload failed | → `uploading` (retry, max 5) · → `abandoned` (max retries) |
| `discarded` | Redo clicked | → removed from IndexedDB |
| `abandoned` | Max retries exceeded | Requires manual resolution |

---

## 6. Race Condition Analysis

### 6.1 Keep clicked twice

- **Mechanism:** `POST /api/clips/:id/confirm` is idempotent. First call transitions to `confirmed`. Second call detects `status == 'confirmed'` and returns 200 with no state change.
- **DB strategy:** `UPDATE clips SET status = 'confirmed' WHERE clip_id = $1 AND status IN ('initiated', 'uploaded') RETURNING *`. If no rows returned, check current status.

### 6.2 Redo during upload

- **Client:** `AbortController.abort()` cancels the in-flight fetch.
- **Server:** `POST /api/clips/:id/discard` sets `status = 'discarded'`. If upload completes between abort and discard call, the discard still wins — the raw object is deleted asynchronously.
- **Invariant:** A discarded clip can never become confirmed.

### 6.3 Keep and Redo arriving concurrently

- **DB strategy:** Both `/confirm` and `/discard` use `SELECT ... FOR UPDATE` on the clip row. First writer wins. Second gets either 200 (idempotent same-op) or 409 (conflicting transition).

### 6.4 Two browser tabs, same speaker

- **Prevention:** `/api/session/next` returns existing pending batch for speaker if one exists, rather than creating a new one.

### 6.5 Same task submitted from two devices

- **Prevention:** `task_id → speaker_id` FK checked. `/clips/init` verifies task belongs to authenticated speaker.

### 6.6 Confirmation retried after timeout

- Idempotent: same as 6.1.

### 6.7 Worker processing same clip twice

- Celery task ID is deterministic (`transcode-{clip_id}`). Worker checks `clip.status` before processing.

### 6.8 Scenario usage racing with confirmation

- `scenario.use_count` increment is inside the same DB transaction as confirmation, with `SELECT ... FOR UPDATE` on the scenario row.

### 6.9 Speaker withdrawal racing with processing

- Worker checks `speaker.withdrawn_at IS NULL` before processing. If withdrawn, worker skips.

### 6.10 Export racing with deletion

- Export query filters `WHERE speaker.withdrawn_at IS NULL`. Deletion is async and never outpaces the export snapshot.

---

## 7. Security Model

### 7.1 Volunteer Authentication

- **No login/password.** Speaker identity via `speaker_token` (UUID) in localStorage.
- **Token as `Authorization: Bearer <speaker_token>`** on all volunteer API calls.
- **Token scoped to speaker_id.** API resolves speaker from token; rejects cross-speaker access.
- **Device ID** sent as `X-Device-ID` header. Validated against `devices` table.

### 7.2 Admin Authentication

- Admin credentials (username + password) exchanged for short-lived JWT.
- JWT grants access to `/api/admin/*` routes.

### 7.3 HTTPS

- Mandatory. `getUserMedia` requires secure context.

### 7.4 Signed URLs

- Scoped to specific object key. Expires in 10 minutes. PUT-only.

### 7.5 Input Validation

- All request bodies validated via Pydantic with strict types.
- Enum fields validated against defined sets.

---

## 8. Deployment Architecture

### 8.1 Production Topology

```
[CDN / Vercel / Netlify]           [Railway / Fly.io]
  React PWA static assets           ┌─────────────────┐
  Service worker                    │  FastAPI (uvicorn)│
                                    └────┬────┬────────┘
                                         │    │
                               ┌─────────┘    └──────────┐
                               ▼                         ▼
                         ┌───────────┐            ┌───────────┐
                         │ PostgreSQL│            │   Redis   │
                         │ (managed) │            │ (managed) │
                         └───────────┘            └─────┬─────┘
                                                        │
                         ┌──────────────┐         ┌─────▼─────┐
                         │ R2 / S3      │         │  Celery   │
                         │ Object Store │         │  Worker   │
                         └──────────────┘         └───────────┘
```

### 8.2 Environment Configuration

All secrets via environment variables:

- `DATABASE_URL`, `REDIS_URL` — Service connections
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`
- `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET`
- `CORS_ORIGINS`

### 8.3 Logging & Observability

- **Structured JSON logging** via `structlog`
- **Key fields:** `speaker_id`, `device_id`, `task_id`, `clip_id`
- **Health endpoint:** `GET /api/health` — DB + Redis + S3 connectivity

---

## 9. Failure Recovery

| Failure | Recovery |
|---------|----------|
| Browser refresh mid-recording | Recording lost. IndexedDB retains completed-but-unuploaded clips. |
| Browser refresh after recording | Blob in IndexedDB. App resumes pending uploads on reload. |
| Browser crash | Same as refresh — IndexedDB is durable. |
| Device sleep during upload | Upload fails. Retries on wake. |
| Signed URL expired | Client requests fresh signed URL. |
| IndexedDB quota exceeded | Alert user. Prioritize uploading existing queue. |
| API server down | Client queues locally. Retries with backoff. |
| Worker crash | Celery `acks_late=True` redelivers task. Worker checks idempotency. |
