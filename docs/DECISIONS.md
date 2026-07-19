# DECISIONS.md — Architecture Decision Records

> **Version:** 1.0 · **Status:** Active

---

## ADR-001: PWA Architecture

**Context:** The app must work on Android Chrome, iOS Safari, and desktop browsers. Volunteers may have unreliable connectivity. The app should be installable without an app store.

**Problem:** Native app vs. web app vs. PWA?

**Decision:** React PWA with Vite and `vite-plugin-pwa` (Workbox).

**Alternatives:**
- Native apps (React Native, Flutter): Higher friction (app store), two codebases
- Plain web app (no PWA): No offline shell, no install prompt

**Tradeoffs:** PWA provides offline shell caching, install prompt, and home screen presence. Service worker caches app assets only — audio blobs live in IndexedDB, not the cache API.

**Risks:** iOS Safari has limited PWA support (no background sync, no push). Mitigation: core offline behavior uses IndexedDB + manual queue drain, not service worker background sync.

**Status:** Accepted.

---

## ADR-002: IndexedDB for Local Persistence

**Context:** Recordings must survive browser refresh, crash, and network outage. localStorage cannot hold blobs.

**Problem:** Where to store audio blobs client-side?

**Decision:** IndexedDB via the `idb` library.

**Alternatives:**
- localStorage: Cannot store blobs, 5–10MB limit
- Cache API: Designed for HTTP responses, awkward for arbitrary blobs
- OPFS (Origin Private File System): Better for large files but limited browser support (no Safari < 15.2)

**Tradeoffs:** IndexedDB has good browser support, handles blobs natively, and provides transactional guarantees. The `idb` library provides a Promise-based wrapper. Typical quota is 50%+ of disk space.

**Risks:** IndexedDB can be cleared by the browser under storage pressure. Mitigation: request `navigator.storage.persist()` in PWA context.

**Status:** Accepted.

---

## ADR-003: MediaRecorder MIME Type Strategy

**Context:** Different browsers produce different audio formats. Chrome produces WebM/Opus. Safari produces MP4/AAC.

**Problem:** Standardize format in-browser or accept heterogeneous formats?

**Decision:** Accept the browser's native format. Do NOT transcode in-browser. Worker handles both WebM and MP4.

**Alternatives:**
- In-browser WAV encoding: 6–8× upload size, high CPU, battery drain on mobile
- Force WebM everywhere: Safari doesn't support WebM recording
- Force MP4 everywhere: Chrome doesn't support MP4 recording

**Tradeoffs:** Accepting native format minimizes client-side complexity and upload size. Server-side FFmpeg handles format normalization trivially. The `mime_type` field on the clip row enables format-aware processing.

**Status:** Accepted.

---

## ADR-004: Signed Direct-to-Storage Upload

**Context:** Audio files must reach object storage. Proxying through FastAPI would bottleneck the API server.

**Problem:** Upload through API or directly to object storage?

**Decision:** Browser uploads directly to S3-compatible storage via signed PUT URLs. API generates the signed URL; the upload never touches FastAPI.

**Alternatives:**
- API proxy upload: Simpler, but creates bottleneck and increases latency
- Resumable uploads (tus protocol): Overkill for 50–200KB audio clips

**Tradeoffs:** Signed URLs keep the API fast regardless of audio volume. Requires S3-compatible storage with CORS configured. Signed URLs expire (10 min), requiring refresh logic.

**Risks:** CORS misconfiguration breaks uploads. Mitigation: explicit CORS setup in deployment docs.

**Status:** Accepted.

---

## ADR-005: S3-Compatible Object Storage (R2 Preferred)

**Context:** Raw audio and processed WAV files need durable, cost-effective storage.

**Problem:** Which object storage provider?

**Decision:** S3-compatible storage. Cloudflare R2 recommended as default; AWS S3 and DigitalOcean Spaces as alternatives.

**Alternatives:**
- AWS S3: Industry standard but egress fees add up
- Google Cloud Storage: S3-compatible via interop, but more complex
- Self-hosted MinIO: Full control but operational burden

**Tradeoffs:** R2 has no egress fees, which matters for worker-heavy read patterns (transcode, QC, ASR). S3-compatible API means switching providers requires only endpoint/credential changes.

**Status:** Accepted.

---

## ADR-006: PostgreSQL as Primary Database

**Context:** The data model requires relational integrity: speaker → device → task → clip provenance chain, generated columns, array types, partial unique indexes.

**Problem:** Which database?

**Decision:** PostgreSQL with SQLAlchemy 2.x ORM and Alembic migrations.

**Alternatives:**
- SQLite: Insufficient for concurrent writes, no generated columns in older versions
- MongoDB: No relational integrity, no foreign keys
- MySQL: Lacks generated columns (pre-8.0), no array types, no partial indexes

**Tradeoffs:** PostgreSQL provides all required features natively: `GENERATED ALWAYS AS` for `age_band`, `TEXT[]` for QC flags and examples, partial unique indexes for "one confirmed clip per task", and `SELECT ... FOR UPDATE` for race condition handling.

**Status:** Accepted.

---

## ADR-007: SQLAlchemy 2.x with Async

**Context:** FastAPI is async-native. The ORM should support async operations.

**Decision:** SQLAlchemy 2.x with `asyncpg` driver. Async session management via FastAPI dependency injection.

**Alternatives:**
- SQLAlchemy 1.x: No native async
- Tortoise ORM: Less mature, smaller ecosystem
- Raw asyncpg: No ORM, more boilerplate

**Status:** Accepted.

---

## ADR-008: Celery over RQ for Background Processing

**Context:** Background worker handles FFmpeg transcoding, QC, ASR. Needs task chaining, retries, and reliable delivery.

**Problem:** Celery or RQ?

**Decision:** Celery with Redis broker and Redis result backend.

**Alternatives:**
- RQ (Redis Queue): Simpler but lacks task chaining (chains), `acks_late`, rate limiting, and periodic tasks
- Dramatiq: Good alternative but smaller ecosystem
- Arq: Async-native but less battle-tested

**Tradeoffs:**
- **Celery wins on:** Task chaining (`chain(transcode → qc → asr)`), `acks_late` for crash recovery, deterministic task IDs for idempotency, mature monitoring (Flower), periodic task support for cleanup jobs
- **RQ wins on:** Simplicity, lower memory footprint
- For this project, task chaining and crash recovery are critical requirements that justify Celery's added complexity.

**Risks:** Celery's complexity. Mitigation: use only chains and basic retry; avoid Canvas primitives beyond `chain`.

**Status:** Accepted.

---

## ADR-009: Scenario Assignment Algorithm

**Context:** Scenario assignment must balance v1/v2 usage globally while alternating versions per speaker (README §10).

**Problem:** Random vs. deterministic vs. balanced assignment?

**Decision:** Weighted argmin algorithm as specified in README §10. Assigns at task-issue time, increments `use_count` at confirmation time only.

**Key properties:**
1. `use_count_version[intent][v]` — global balance
2. `2.0 × already_used_by(speaker, v)` — strong alternation per speaker
3. `uniform(0, 0.1)` — jitter for tie-breaking

**Alternatives:**
- Pure random: Over-samples some scenarios, starves others
- Round-robin: Too rigid, doesn't adapt to abandoned sessions
- Pre-assigned full batches: Wasted assignments when sessions are abandoned

**Status:** Accepted.

---

## ADR-010: Lazy Task Assignment

**Context:** Tasks should only be created when needed. Pre-creating full batches wastes resources when sessions are abandoned.

**Decision:** Tasks are created when `/api/session/next` is called. If a pending batch exists, it is returned (idempotent). Tasks for abandoned sessions stay `pending` indefinitely and are cleaned up by a periodic job.

**Alternatives:**
- Eager batch creation (create all tasks for all speakers upfront): Wastes resources, inflates counters
- Dynamic single-task issuing: More complex, harder to show progress

**Tradeoffs:** Batch creation on demand means counters only reflect sessions that were actually started. Abandoned batches have no effect on scenario usage (since `use_count` only increments on confirm).

**Status:** Accepted.

---

## ADR-011: Keep/Redo State Machine

**Context:** The confirm/discard lifecycle has race conditions between upload, keep, and redo.

**Decision:** Server-authoritative state machine with idempotent transitions:
- `initiated → confirmed` (Keep)
- `initiated → discarded` (Redo)
- `uploaded → confirmed` (Keep)
- `uploaded → discarded` (Redo)
- `confirmed → confirmed` (idempotent Keep, 200)
- `discarded → discarded` (idempotent Redo, 200)
- `confirmed → discarded` (REJECTED, 409)
- `discarded → confirmed` (REJECTED, 409)

**Implementation:** `SELECT ... FOR UPDATE` on clip row serializes concurrent confirm/discard requests. First writer wins.

**Status:** Accepted.

---

## ADR-012: Idempotency Strategy

**Context:** Network retries, browser refreshes, and race conditions mean operations may be repeated.

**Decision:**
- Device registration: idempotent by `device_id`
- Clip init: idempotent by `task_id` (returns existing pending clip)
- Confirm: idempotent by `clip_id` (200 if already confirmed)
- Discard: idempotent by `clip_id` (200 if already discarded)
- Session/next: idempotent by speaker (returns existing pending batch)

**Status:** Accepted.

---

## ADR-013: Device/Speaker Identity Separation

**Context:** README §4 is the "most important correctness mechanism in the app." Devices are shared; one device ≠ one speaker.

**Decision:**
- `device_id` (UUID) stored in localStorage, represents the browser installation
- `speaker_id` (SPK_NNNN) represents the human, assigned by server
- `device_speakers` join table tracks the roster
- Every clip records BOTH `device_id` AND `speaker_id`
- Session-start identity confirmation
- Idle timeout re-confirmation (10 minutes)

**Alternatives:**
- Assume one device = one speaker: REJECTED — breaks speaker-disjoint splits

**Status:** Accepted. Non-negotiable.

---

## ADR-014: Consent Enforcement

**Context:** No clip can enter the corpus without explicit, versioned consent. This must be enforced server-side, not just in the UI.

**Decision:**
- `consent_at` and `consent_version` on `speakers` table
- API checks `speaker.consent_at IS NOT NULL` before accepting clip init or confirmation
- Consent version is immutable per speaker — if consent text changes, new speakers get the new version; existing speakers retain their original version
- Speaker withdrawal supported from day one

**Status:** Accepted.

---

## ADR-015: Speaker Withdrawal

**Context:** README §16 requires withdrawal support. Must be implementable from day one.

**Decision:**
- Soft-delete: `speakers.withdrawn_at = NOW()`
- Async worker: deletes raw objects, WAV objects, clip rows, task rows, device_speakers entries
- Audit record retained: `withdrawal_audit` table with anonymized counts
- Scenario `use_count` is NOT decremented (reflects historical state)

**Alternatives:**
- Hard-delete only: Loses audit trail
- Decrement use_count: Creates inconsistency if scenarios were reassigned based on old counts

**Status:** Accepted.

---

## ADR-016: Quality Control Pipeline

**Context:** README §15 defines four QC layers: speaker confirmation, client-side min-duration, async worker checks, and human review.

**Decision:**
- Layer 1 (Speaker): Mandatory keep/redo — architectural, not a check
- Layer 2 (Client): < 0.4s rejected as mis-tap, task re-queued silently
- Layer 3 (Worker): Duration, clipping, silence, SNR checks → `qc_flags[]`
- Layer 4 (Human): Flagged clips enter admin review queue

**Fatal flag:** `silent` → auto-reject. All others are advisory.

**Status:** Accepted.

---

## ADR-017: ASR Abstraction

**Context:** ASR technology evolves. The system should not be tightly coupled to one provider.

**Decision:** Abstract `ASRProvider` interface. Default implementation: IndicWhisper-compatible. Swappable via configuration.

**Interface:**
```python
class ASRProvider:
    def transcribe(self, wav_path: str, language: str) -> ASRResult
```

**Status:** Accepted.

---

## ADR-018: Admin Authentication

**Context:** Admin dashboard needs authentication. The admin surface is small (one or two domain leads).

**Decision:** Username + password login, exchanged for short-lived JWT (8 hours). Single `admin` role, no fine-grained RBAC for v1.

**Alternatives:**
- OAuth/SSO: Overkill for 1-2 admins
- Session cookies: JWT is simpler for SPA
- API key: Less secure, no expiry

**Risks:** Single admin role may be insufficient if team grows. Mitigation: RBAC can be added later without architectural changes.

**Status:** Accepted.

---

## ADR-019: Speaker-Disjoint Dataset Splitting

**Context:** Train/dev/test splits must be speaker-disjoint to prevent benchmark contamination. README §14.2 explains why.

**Decision:** Splits are computed at the **speaker level** during export. All clips from one speaker go to the same split. Target ratio: 80/10/10.

**Implementation:** Shuffle speakers, partition by ratio. The split label is written to the manifest, not stored in the database (it's an export-time decision).

**Verification:** Export includes a validation step that asserts no speaker appears in multiple splits.

**Status:** Accepted.

---

## ADR-020: Deployment Architecture

**Context:** The system needs HTTPS (mandatory for getUserMedia), managed services for PostgreSQL and Redis, and cost-effective hosting for a research project.

**Decision:**
- Frontend: Vercel or Netlify (free tier, automatic HTTPS, CDN)
- API + Worker: Railway or Fly.io (free/low-cost tiers, Docker support)
- Database: Managed PostgreSQL (Railway, Supabase, or Neon)
- Redis: Managed Redis (Railway or Upstash)
- Storage: Cloudflare R2 (no egress fees)

**Alternatives:**
- Self-hosted: Higher operational burden, not justified for a research project
- AWS full stack: More expensive, more complex
- Kubernetes: Massive overkill

**Tradeoffs:** Managed services trade some control for zero-ops. Free tiers cover a one-month collection campaign. HTTPS is automatic with Vercel/Netlify.

**Status:** Accepted.

---

## Ambiguities Identified in README

### AMB-001: Idle Timeout Duration

**README says:** "After ~10 minutes of inactivity." The tilde implies approximate.

**Decision:** Use exactly 10 minutes. Configurable via environment variable `IDLE_TIMEOUT_MINUTES`.

### AMB-002: QR Code Pre-generation Details

**README says:** "Leads pre-generate speaker QR codes for supervised sessions."

**Decision:** QR contains `speaker_id + token` encoded as a URL (`https://<host>/?qr=<token>`). Scanning opens the app with identity pre-set. Pre-generation creates speaker rows with no demographic data — demographics collected on first recording.

### AMB-003: Coverage Floor Value

**README says:** "Floor of 40" for intent coverage in §14.3 and §17.

**Decision:** 40 processed clips per intent is the minimum. Configurable via `COVERAGE_FLOOR` environment variable.

### AMB-004: Skip Functionality

**README §2.3 mentions:** "Skip fills the current diamond in a muted colour."

**Decision:** Skip is a UI-only concept for the progress bar. Skipped tasks get `status = 'skipped'`. No clip is created. Scenario `use_count` is not affected. Skip is not prominently featured — it's a fallback for scenarios the speaker genuinely cannot attempt.

### AMB-005: Batch-Level Example Number

**README §14.1:** "A session batch is a horizontal slice — every intent × every scenario × example 1."

**Decision:** `batch_no` corresponds to `example_no`. Batch 1 = all example_no=1 tasks. Batch 2 = all example_no=2. Batch 3 = all example_no=3. This is consistent with the "28 recordings per batch for Banking" arithmetic (12 intents × ~2.3 scenarios × 1 example).
