# FEATURES.md — Hinglish S2I Volunteer Recording App

> **Purpose of this doc:** a single, complete, product-level tour of what the app
> actually does today — for anyone (contributor, volunteer coordinator, or a
> future version of an AI assistant) who needs to understand the feature set
> without reading the whole codebase. For the *why* behind design decisions,
> see [DECISIONS.md](DECISIONS.md). For deep technical specs, see
> [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md),
> [API_CONTRACT.md](API_CONTRACT.md), and [AUDIO_PIPELINE.md](AUDIO_PIPELINE.md).

---

## 1. What this project is

A browser-based tool for collecting a **Hinglish (Hindi-English code-mixed)
speech corpus**. Volunteers speak short prompts across everyday domains
(banking, education, travel, voice-assistant commands); their recordings,
plus derived metadata, become training data for speech-to-intent models.

Two apps live in one repo:

| App | Who uses it | Where |
|---|---|---|
| **Volunteer recorder** | Anonymous contributors, on phone or desktop | `/`, `/progress` |
| **Admin dashboard** | Researchers / data managers | `/admin` |

Both are served by the same React SPA (`web/`), backed by one FastAPI service
(`api/`) with a SQLite database by default.

---

## 2. Volunteer-facing features

### 2.1 Onboarding & consent
- First-time visitors fill in four fields: **age, gender, native language
  (L1), home region** — no name, email, or login required.
- A plain-language consent statement must be explicitly checked before
  "Continue to recording" is enabled; the button stays disabled until then.
- The backend issues an opaque **speaker_id** + bearer token; nothing links
  a recording back to a real name.

### 2.2 Multi-speaker device support
- A device (phone/laptop) can host multiple speaker profiles — useful when
  a volunteer coordinator hands one device around a group.
- Returning visitors see a **"Are you ready to continue?"** confirmation
  screen with an option to switch to a different registered profile
  ("Choose another profile") or register a new one.

### 2.3 Domain / topic selection
Four scenario domains, each with its own task set:

| Code | Domain |
|---|---|
| `BNK` | Banking |
| `EDU` | Education |
| `TRV` | Travel |
| `VAS` | Voice assistant |

Scenario prompts live in `data/scenarios/*_v1.json` / `*_v2.json` (two
balanced "versions" per domain, seeded into the DB at API startup — 198
scenarios total as shipped).

### 2.4 Task presentation
Each recording screen shows exactly one task at a time:
- **"Task N of M"** counter + a row of diamond progress markers (filled =
  recorded, highlighted = current, outline = pending); clicking a pending
  diamond jumps to that task.
- A **Scenario** badge, the scenario name, a **"Your task"** prompt in large
  readable type, and — when present — a **Tone** hint (e.g. "curious,
  first-time") describing how to deliver the line.
- No database IDs, speaker IDs, or device IDs are shown on this screen.

### 2.5 Recording
- Tap **Start recording** → live timer → **Stop recording**.
- Captures mono audio via `getUserMedia` with echo cancellation, noise
  suppression, and auto-gain **all explicitly disabled** — browser
  speech-enhancement DSP is tuned for calls, not corpus fidelity, and would
  contaminate the acoustic signal.
- MIME type is negotiated per-browser (Opus/WebM on Chrome & Firefox,
  AAC/MP4 on Safari) — see [AUDIO_PIPELINE.md](AUDIO_PIPELINE.md) §2.2.
- Clips under ~0.4s are treated as accidental taps and rejected with a
  friendly message asking the volunteer to try again.
- If the tab is backgrounded mid-recording (phone locks, app-switch), the
  recorder stops cleanly instead of hanging.

### 2.6 Mandatory listen-before-Keep
This is the app's core data-quality guarantee:
- After stopping, the clip **auto-plays** for review in a custom audio
  player (play/pause, seek bar, elapsed/total time).
- **Keep recording** stays disabled (shown with a lock icon) until the
  recording has been played through to the end.
- Scrubbing the seek bar past the furthest point actually listened to is
  **silently clamped back** — you cannot fast-forward past unheard audio to
  unlock Keep early.
- Once listened, the badge flips to "Reviewed" and Keep becomes the primary
  action.

### 2.7 Keep / Record again
- **Keep recording** — confirms the take server-side, advances to the next
  pending task, shows a brief "Recording saved" notice.
- **Record again** — discards the current attempt and restarts the same
  task (the previous local attempt isn't force-deleted client-side unless
  the server's discard flow removes it).
- An optional free-text box lets a volunteer type what they actually said,
  if it differed from the prompt.

### 2.8 Offline-first behavior
- **Online/offline indicator** in the header ("Ready to sync" / "Offline
  mode") — never styled as an error, since recording still works fine
  offline.
- Recordings are written to **IndexedDB** immediately after capture — this
  happens before any network call, so a dropped connection never loses a
  take.
- While offline, "Keep" advances local task state optimistically; once
  connectivity returns, queued uploads drain in the background and the
  device automatically resyncs the pending queue.
- Local-only state is described honestly — **"Saved on this device"**, never
  "Uploaded", since Phase 6+ (server confirmation) is a separate step.

### 2.9 Progress tracking
- A dedicated **/progress** page shows completion per domain → intent →
  scenario → example, with clear recorded/pending status per item.

### 2.10 Accessibility & responsiveness
- Full keyboard navigation, visible focus rings, semantic buttons/labels,
  `aria-live` regions for state changes (recording start/stop, save,
  listen-required → reviewed), and `prefers-reduced-motion` support.
- Mobile-first layout: single column, large touch targets, no horizontal
  scroll; verified at mobile-portrait, tablet, and desktop widths.

---

## 3. Admin-facing features (`/admin`)

Reachable via username/password login (`admin` / `admin123` by default —
**change this in any real deployment**, see §6).

### 3.1 Statistics dashboard
Six at-a-glance tonal stat cards: total speakers, total recordings,
confirmed clips, QC passed, QC failed, redo attempts.

### 3.2 Recordings review queue
- Search/filter by speaker, domain, intent, or clip status (confirmed /
  processing / processed / rejected / discarded).
- Each clip card shows the provisional transcript, any QC flags (e.g.
  `too_short`, `clipped`, `silent`, `noisy`), an inline audio player, and
  **Approve** / **Reject** actions.

### 3.3 Coverage heatmap
- Per-intent progress toward the collection floor (40 clips/intent by
  default), with a fill bar and a "complete" state once the floor is met,
  plus the count of distinct speakers who've contributed to that intent.

### 3.4 Speaker management
- Per-speaker card: demographics (native language, region, age band,
  gender), clip counts (total / processed / rejected), average clip
  duration, registration & consent dates.
- **Withdraw Speaker** — a GDPR-style right-to-erasure action (confirmation
  required) that removes a speaker's data.

### 3.5 Dataset export
Three export formats, generated on demand:
- **CSV manifest** — the raw dataset manifest.
- **Excel report** (`.xlsx`) — a formatted workbook.
- **Research ZIP** — processed WAV files, the Excel workbook, CSV
  manifests, task prompts, speaker metadata, QC data, checksums, and a
  local-use README, bundled together.

---

## 4. Cross-cutting design principles

These hold across both the volunteer and admin surfaces (see
[ARCHITECTURE.md](ARCHITECTURE.md) §1.1 for the full list):

- **The client is never authoritative** for domain, intent, scenario,
  filename, or speaker identity — all of that is server-issued. The
  volunteer's browser can only supply the audio blob, the keep/redo
  decision, and an optional transcript edit.
- **Bad data must never reach the corpus silently** — hence the mandatory
  listen-before-Keep gate.
- **One human = one speaker ID, always** — `device_id` and `speaker_id` are
  kept strictly separate so a shared device never conflates two people's
  voices.
- **Never block on the network** — offline-first with local persistence.

---

## 5. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript, Vite, React Router 7 |
| Frontend state | Local component state + `localStorage`/IndexedDB (no Redux/Context store) |
| Icons | lucide-react |
| Audio capture | `MediaRecorder` + `getUserMedia` (native browser APIs, no third-party recorder lib) |
| Local persistence | IndexedDB (`web/src/db.ts`) |
| Backend | FastAPI (Python), SQLAlchemy 2.x async ORM |
| Database | SQLite by default (`sqlite+aiosqlite`); swappable via `DATABASE_URL` |
| Auth | Speaker bearer tokens (volunteer side) + JWT (admin side) |
| Data export | openpyxl (Excel), CSV, zip bundling |

The [ARCHITECTURE.md](ARCHITECTURE.md) doc additionally describes an
aspirational production topology (PostgreSQL, Redis/Celery workers, S3-style
object storage, FFmpeg transcoding, ASR). **The code as shipped here is the
simpler, self-contained version** — FastAPI + SQLite, audio stored directly
via the API, no background worker pipeline yet. Treat ARCHITECTURE.md as the
target design, and this document as what's actually running.

---

## 6. Running it locally

```bash
# Backend (from api/)
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # .venv/bin/pip on macOS/Linux
.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (from web/, in a second terminal)
npm install
npm run dev
```

- Frontend dev server: **http://localhost:3000** (Vite proxies `/api` →
  `http://localhost:8000` automatically — see `web/vite.config.ts`).
- Backend: **http://localhost:8000** (docs at `/docs`, health check at
  `/api/health`).
- No `.env` file is required for local dev — `DATABASE_URL`,
  `SECRET_KEY`, and `ADMIN_PASSWORD` all have working defaults baked in
  (see `.env.example` for what to override in a real deployment). The
  database schema and all 198 scenarios are (re-)created automatically on
  first startup.
- Admin login: `admin` / `admin123`.

---

## 7. Known gaps / things not yet built

Called out explicitly so nobody assumes they exist:

- **No real upload pipeline yet** — clips are stored by the API directly;
  the S3/signed-URL/Celery/FFmpeg/ASR pipeline described in
  [ARCHITECTURE.md](ARCHITECTURE.md) and [AUDIO_PIPELINE.md](AUDIO_PIPELINE.md)
  is a target design, not current behavior.
- **Admin dashboard has no equivalent design-system pass on every pixel** —
  the panel now shares the app's tokens/components (fixed in this session,
  see §8), but it hasn't had the same level of UX polish as the volunteer
  flow, since volunteers are the primary audience.
- **No automated test run in CI captured here** — see `docs/TEST_PLAN.md`
  for the intended test strategy; `api/tests/` holds the backend test
  suite.

---

## 8. Recent work (this session)

A UI/UX pass plus a follow-up bug hunt turned up and fixed a few real
issues worth recording here, since they weren't obvious from reading the
code in isolation:

1. **Custom audio player** — replaced the native `<audio controls>` element
   in the volunteer review step with a purpose-built play/pause + seek-bar
   + time-display component (`web/src/components/AudioPlayer.tsx`), reused
   for admin clip review too (`AdminAudioPlayer.tsx`). All mandatory-listen
   and anti-seek-bypass logic stayed exactly where it was — the component
   only forwards raw playback events.
2. **Admin dashboard theme bug** — `AdminPanel.tsx` was styled almost
   entirely with inline styles referencing stale dark-theme CSS variables
   (`--bg-tertiary`, `--border-glass`, `--color-*-glow`) that were never
   updated when the app moved to its current light theme, producing dark
   navy cards with low-contrast text. Rewired onto the app's real design
   tokens and the already-defined (but previously unused) `.stat-card`,
   `.clip-card`, `.speaker-card`, `.coverage-item` classes in
   `responsive.css`.
3. **Task-header layout bug** — a leftover `.task-header { display: flex }`
   rule in `index.css` (from an older, unrelated layout) bled through the
   cascade and turned the main recording screen's scenario/prompt/tone
   block into an overlapping horizontal row instead of a stacked layout.
   Fixed by an explicit `display: block` in the current rule.
4. **`/api/devices` race condition** — registering a brand-new device
   twice in quick succession (e.g. React StrictMode's double-effect in
   dev, or a flaky double-submit) caused a primary-key violation and a raw
   500 on the second request. Now caught specifically and treated as the
   idempotent "already registered" case.
5. **Dead CSS** — a redundant, actually-conflicting
   `@media (prefers-color-scheme: light)` block at the end of
   `responsive.css` silently changed the page background only for
   OS-light-mode users; removed in favor of the single unconditional theme.
6. **`.animate-spin` was undefined** — three loading spinners (Keep/Redo
   buttons, admin Refresh) referenced a CSS class that was never declared,
   so "in progress" icons sat frozen instead of spinning.

All of the above were verified visually (desktop + mobile viewports,
Chromium via Playwright with a fake microphone device to exercise a full
record → review → keep flow) since a UI change isn't confirmed by code
review alone.
