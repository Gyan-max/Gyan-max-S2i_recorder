# Bug fixes, security hardening and setup notes

This document covers the changes in this branch: why recordings were not being
saved, the security issues found along the way, and how to run the project now.

---

## 1. The "data is not saving" bug

The report was that recordings did not persist, in both the volunteer app and
the admin dashboard. It turned out to be three separate problems.

### 1.1 The database path depended on the working directory

`api/app/database.py` defaulted to:

```python
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./s2i_recorder.db")
```

That path is relative, so the database file landed in a different place
depending on how the server was started:

| Command | Database used |
| --- | --- |
| `cd api && uvicorn app.main:app` | `api/s2i_recorder.db` |
| `uvicorn api.app.main:app` from the repo root | `s2i_recorder.db` at the root |
| Docker (`docker-compose.yml`) | `/app/data/s2i_recorder.db` |

Recording through the app and then opening the admin panel after restarting the
server a different way meant reading a completely different database. The repo
history shows both `api/s2i_recorder.db-wal` and `data/s2i_recorder.db-wal` were
committed, which are exactly the two working directories involved.

Storage had the same problem. `api/app/services/storage.py` derived its base
directory from `__file__` and resolved to `api/storage/`, but `docker-compose.yml`
mounts `./storage`. In Docker every uploaded file was written inside the
container layer and lost on the next restart.

**Fix:** all paths now resolve from a `PROJECT_ROOT` constant in
`api/app/config.py` and are absolute. `STORAGE_BASE_PATH` is configurable and
relative values are resolved against the project root, never the CWD.

### 1.2 The `.env` file was never read

`config.py` used bare `os.getenv` calls, and there was no `python-dotenv`
dependency and no `load_dotenv()` anywhere in the codebase. Every value in
`.env` was ignored, including `DATABASE_URL` and `STORAGE_BASE_PATH`.

Several keys referenced in the env file did not exist in the code at all:
`APP_ENV`, `MAX_UPLOAD_SIZE_MB`, `STORAGE_BASE_PATH`, `FFMPEG_PATH`,
`TARGET_SAMPLE_RATE`, `TARGET_CHANNELS`, `LOGIN_MAX_ATTEMPTS`.

**Fix:** added `python-dotenv`, loaded `.env` from the project root, and
implemented all of the above settings. Real environment variables still take
priority over the file so Docker and Render are unaffected.

### 1.3 Offline recordings were discarded permanently

In `web/src/pages/HomePage.tsx`, recording while offline generated a local
random `clipId` that the server had never issued, wrote the audio to IndexedDB
under that id, and never added it to the upload queue. Pressing **Keep** then
marked the task `recorded` in local state and moved on, so the task was never
offered again and the audio could never be uploaded.

Separately, `processUploadQueue` only replayed the upload step. Queued clips
reached status `uploaded` and stopped there, never confirmed and never
processed, so they never appeared in the admin dashboard.

**Fix:** offline takes are queued with their `task_id` and drained through the
full `init -> upload -> confirm` sequence. The local copy is only deleted once
the server has confirmed the clip.

### 1.4 Failures were invisible in the UI

Both surfaces swallowed errors, which is why the problem looked like "nothing
happens" rather than an error:

- Volunteer app: a non-OK response from `confirm` did nothing at all — no
  message, no state change.
- Admin dashboard: `handleReviewAction` and `handleSaveTranscript` only handled
  401, and the batch handler used `.catch(() => undefined)`, so a batch that
  saved nothing looked the same as one that saved everything.

**Fix:** the recorder shows inline errors and the admin dashboard has a
dismissible error banner. Failed saves no longer advance the task.

---

## 2. Other correctness bugs found

These were not reported but affect the quality of the collected dataset.

**Transcripts did not match the audio.** `confirm` always stored
`scenario.examples[0]` regardless of which example was recorded, so every
example 2 and 3 clip was labelled with example 1's text. Now uses
`examples[task.example_no - 1]`.

**ASR overwrote human transcripts.** `process_clip_background` unconditionally
replaced `transcript_final` with the ASR result. With the mock provider that
meant every clip in the corpus ended up with the same placeholder sentence, and
volunteers' own transcript edits were destroyed. ASR now only fills in a
transcript when there is no human or prompt-derived one.

**Speaker withdrawal always returned 500.** `get_current_admin` returns the
decoded JWT payload (a dict), but the parameter was annotated `str` on 13
handlers and `withdraw_speaker` passed the whole dict into `WithdrawalAudit.processed_by`,
a String column. SQLite refused to bind it, so the GDPR erasure endpoint failed
every time it was used.

**Dataset export splits were wrong.** With one speaker, `int(1 * 0.8) == 0` put
all data in `test` and left `train` empty; with two speakers `test` was empty.
The split is also meant to be reproducible via a fixed RNG seed, but it shuffled
a `set`, and Python randomises string hashing per process — the same speaker
could land in `train` in one export and `test` in the next. Now sorted before
shuffling, with split sizes that hold at any speaker count.

**A confirmed clip could have no audio.** If the upload failed but the client
still called `confirm`, the task was marked `recorded` permanently and the data
point was lost. `confirm` now returns 409 `AUDIO_MISSING` unless the audio is
actually on disk.

**`GET /api/clips/{clip_id}/download` crashed** with a `NameError` — the handler
returns `FileResponse` but never imported it.

**Registering an existing device returned 201 Created** instead of 200 OK, so
clients could not tell "created" from "already known".

**Docker never copied `data/scenarios/`**, so a container starting from a clean
volume seeded zero scenarios and every volunteer saw "No scenarios found".

---

## 3. Security fixes

| Area | Issue | Fix |
| --- | --- | --- |
| `POST /api/clips/upload` | No authentication. The `X-Device-ID` header is client-supplied and never verified, so anyone with a `clip_id` could overwrite that clip's audio. | Requires the owning speaker's bearer token plus an ownership check; audio is immutable once confirmed. |
| `api/app/config.py` | Admin username and password hardcoded as fallback defaults and committed to the repo. | Removed. Credentials come from the environment. Production refuses to start on a blank or well-known password. |
| `GET /api/speakers/{id}/consent` | Unauthenticated, so speaker IDs could be enumerated to read consent records. | Requires the speaker's own token. |
| Admin login | Password compared with `==`, which short-circuits and leaks the shared prefix length through timing. | `hmac.compare_digest`. |
| Admin login | No rate limiting. | Per-IP throttle returning 429 with `Retry-After`. |
| Upload size | Unbounded and buffered fully in memory. | Streamed to disk with a configurable cap (default 25 MB), returning 413. |
| CORS | Fell back to `allow_origins=["*"]` with `allow_credentials=True` when the origin list was empty. | Never widens; explicit method and header lists. |
| JWT errors | The underlying parse error was returned to the caller. | Generic message. |
| Docker | Container ran as root. | Non-root `appuser`, plus a healthcheck. |

`api/app/config.py` now validates configuration at startup. In production it
refuses to boot with a missing or weak `JWT_SECRET_KEY`, a default
`ADMIN_PASSWORD`, or an empty `CORS_ORIGINS`. In development it generates an
ephemeral signing key and warns instead.

---

## 4. Tests and tooling

The test suite did not run at all: 0 passing, 24 collection errors. It is now
**26 passing**.

- Added `api/pytest.ini` with `asyncio_mode = auto`. `pytest-asyncio` was
  installed but never configured, so every async fixture failed with
  "requested an async fixture 'db_session', with no plugin or hook that handled it".
- Added `api/conftest.py` to point the app at a temporary database and storage
  directory. This matters beyond tidiness: `test_phase2.py` and `test_phase3.py`
  call `Base.metadata.drop_all` on the real engine, and only the alphabetical
  import order of `test_api.py` was preventing the suite from wiping the
  development database.
- Migrated the tests to `httpx.ASGITransport`; the `AsyncClient(app=...)`
  shortcut was removed in httpx 0.28.
- Updated stale test data: device IDs must be valid UUIDs, and the consent
  version is `consent-v1`.
- Tests now upload a real generated WAV instead of a placeholder byte string.

`build.sh` called `from app.database import init_db`, a function that does not
exist, and `seed_scenarios()` without its required session argument, so the
script always failed partway through. Both calls were removed — the schema and
all 198 scenarios are created by the API's startup lifespan. `DEPLOYMENT.md`
contains the same two dead calls and is left for a separate pass.

`.gitignore` did not cover `*.db-wal` / `*.db-shm`, so SQLite write-ahead logs
were committed. Those files are now ignored and removed from tracking.

---

## 5. Running the project

### Requirements

- Python 3.9+
- Node.js 16+
- ffmpeg (used to transcode uploads to 16 kHz mono WAV)

### Setup

```bash
cp .env.example .env
```

No edits are needed for local development. Leave `JWT_SECRET_KEY` and
`ADMIN_PASSWORD` blank and the API generates a per-process signing key and falls
back to the `admin123` development password.

### Backend

```bash
cd api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The database schema and all 198 scenarios are created automatically on first
start. Do not run `build.sh` for this.

### Frontend

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000. Vite proxies `/api` to port 8000, so no CORS
configuration is needed locally.

- API docs: http://localhost:8000/docs
- Health check: http://localhost:8000/api/health

### Tests

```bash
cd api && .venv/bin/python -m pytest
```

### Docker

```bash
docker compose up --build
```

`docker-compose.yml` now requires `JWT_SECRET_KEY`, `ADMIN_USERNAME` and
`ADMIN_PASSWORD` to be set in `.env` and fails fast if they are missing.

### Production

Set `APP_ENV=production` and provide:

```bash
JWT_SECRET_KEY=$(openssl rand -hex 32)
ADMIN_PASSWORD=<a real password>
CORS_ORIGINS=https://your-frontend-domain
```

Startup aborts with a clear message if any of these are missing or weak.

---

## 6. Known limitations

- **ASR is a mock.** `api/app/services/asr.py` returns a fixed placeholder
  string for every clip. It no longer overwrites real transcripts, but there is
  no actual speech recognition. Any `transcript_source = "asr"` value in an
  export is placeholder text.
- **Login rate limiting is per-process.** It is keyed by client IP in memory,
  which is fine for the single-worker deployment this ships with. A multi-worker
  or multi-instance setup needs a shared store.
- **The admin password is compared against a single environment value.** There
  is no admin user table, password hashing, or account management.
- **`DEPLOYMENT.md` still documents the removed `init_db` calls** and needs a
  separate update.
- If you previously ran the app and had data in `api/s2i_recorder.db`, note that
  the database now lives at `data/s2i_recorder.db`. Move the old file across if
  you need to keep those recordings.
