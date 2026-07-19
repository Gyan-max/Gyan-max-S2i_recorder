# DATABASE.md — Hinglish S2I PostgreSQL Data Model

> **Version:** 1.0 · **Status:** Implementation-ready · **Source of truth:** [README.md](../README.md) §6

---

## 1. Design Principles

- **Relational integrity enforced at the database level** — not the application
- **Generated columns** for derived data (`age_band`)
- **Enum types** for fixed vocabularies
- **Foreign keys with appropriate ON DELETE** behavior
- **Indexes on all query-hot columns**
- **Timestamps in `timestamptz`** — always UTC-aware

---

## 2. Enum Types

```sql
CREATE TYPE domain_enum AS ENUM ('BNK', 'EDU', 'TRV', 'VAS');

CREATE TYPE gender_enum AS ENUM ('male', 'female', 'other', 'prefer_not_say');

CREATE TYPE task_status_enum AS ENUM ('pending', 'recorded', 'skipped');

CREATE TYPE clip_status_enum AS ENUM (
    'initiated', 'uploaded', 'confirmed',
    'discarded', 'processing', 'processed', 'rejected'
);

CREATE TYPE transcript_source_enum AS ENUM (
    'example_unedited', 'speaker_edited', 'asr', 'human_verified'
);

CREATE TYPE scenario_set_enum AS ENUM ('v1', 'v2');
```

---

## 3. Tables

### 3.1 `speakers`

**Purpose:** One row per human volunteer. The fundamental identity unit for corpus provenance and speaker-disjoint splitting.

```sql
CREATE TABLE speakers (
    speaker_id       TEXT PRIMARY KEY,              -- 'SPK_0042', server-assigned sequential
    token            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,  -- secret resume key
    age              INT NOT NULL CHECK (age >= 10 AND age <= 100),
    age_band         TEXT GENERATED ALWAYS AS (
                         CASE WHEN age < 26 THEN '18-25'
                              WHEN age < 36 THEN '26-35'
                              WHEN age < 51 THEN '36-50'
                              ELSE '50+' END
                     ) STORED,
    gender           gender_enum NOT NULL,
    l1               TEXT NOT NULL,                 -- native language
    region           TEXT NOT NULL,                 -- state/region
    consent_at       TIMESTAMPTZ,                   -- non-null required before any clip accepted
    consent_version  TEXT,                          -- which licence text was agreed to
    withdrawn_at     TIMESTAMPTZ,                   -- set on speaker withdrawal
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- For speaker ID sequence generation
CREATE SEQUENCE speaker_id_seq START 1;

CREATE INDEX idx_speakers_token ON speakers (token);
CREATE INDEX idx_speakers_withdrawn ON speakers (withdrawn_at) WHERE withdrawn_at IS NOT NULL;
```

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `speaker_id` | TEXT PK | `SPK_NNNN` format | Server-assigned, sequential, opaque |
| `token` | UUID UNIQUE | NOT NULL | Secret resume key, stored in browser localStorage |
| `age` | INT | CHECK 10–100 | **Internal only** — never published |
| `age_band` | TEXT GENERATED | Derived from `age` | **Published** — quasi-anonymization |
| `gender` | gender_enum | NOT NULL | |
| `l1` | TEXT | NOT NULL | Native language |
| `region` | TEXT | NOT NULL | State |
| `consent_at` | TIMESTAMPTZ | | Must be non-null before clips accepted |
| `consent_version` | TEXT | | Which licence text version |
| `withdrawn_at` | TIMESTAMPTZ | | Non-null = speaker has been withdrawn |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | DEFAULT now() | |

**Delete behavior:** Soft-delete via `withdrawn_at`. Hard delete of related data (clips, tasks) happens asynchronously in the withdrawal worker.

---

### 3.2 `devices`

**Purpose:** One row per browser installation. Device identity is separate from speaker identity (§4 of README).

```sql
CREATE TABLE devices (
    device_id    UUID PRIMARY KEY,                 -- generated client-side, stored in localStorage
    ua_class     TEXT,                              -- device class from user-agent (not full UA)
    first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `device_id` | UUID PK | Client-generated | One per browser installation |
| `ua_class` | TEXT | | Sanitized device class (e.g., "Android Chrome", "iOS Safari") |
| `first_seen` | TIMESTAMPTZ | DEFAULT now() | |
| `last_seen` | TIMESTAMPTZ | DEFAULT now() | Updated on each API interaction |

**Delete behavior:** No cascade. Devices are permanent records for provenance.

---

### 3.3 `device_speakers`

**Purpose:** Join table — the roster of speakers who have used a device. Enables the speaker-switch UI and contamination detection.

```sql
CREATE TABLE device_speakers (
    device_id    UUID NOT NULL REFERENCES devices(device_id),
    speaker_id   TEXT NOT NULL REFERENCES speakers(speaker_id),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, speaker_id)
);

CREATE INDEX idx_device_speakers_device ON device_speakers (device_id);
CREATE INDEX idx_device_speakers_speaker ON device_speakers (speaker_id);
```

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `device_id` | UUID FK | REFERENCES devices | |
| `speaker_id` | TEXT FK | REFERENCES speakers | |
| `last_used_at` | TIMESTAMPTZ | DEFAULT now() | Updated each session; used for roster ordering |

**Composite PK:** `(device_id, speaker_id)` — a speaker appears at most once per device.

**Delete behavior:** ON DELETE CASCADE from speakers (withdrawal removes roster entries).

---

### 3.4 `scenarios`

**Purpose:** The scenario bank. 198 scenarios × 3 examples each = 594 phrasings. Seeded from JSON files.

```sql
CREATE TABLE scenarios (
    scenario_id   TEXT PRIMARY KEY,                -- 'BNK.block_card.v2.s1'
    domain        domain_enum NOT NULL,
    intent        TEXT NOT NULL,                   -- 'BNK.block_card'
    scenario_set  scenario_set_enum NOT NULL,      -- 'v1' or 'v2'
    text_hi       TEXT NOT NULL,                   -- scenario description shown to speaker
    examples      TEXT[] NOT NULL CHECK (array_length(examples, 1) = 3),  -- exactly 3 seed phrasings
    register      TEXT,                            -- delivery note ('urgent, alarmed')
    use_count     INT NOT NULL DEFAULT 0,          -- global counter, incremented on CONFIRM only
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenarios_intent ON scenarios (intent);
CREATE INDEX idx_scenarios_domain ON scenarios (domain);
CREATE INDEX idx_scenarios_intent_set ON scenarios (intent, scenario_set);
```

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `scenario_id` | TEXT PK | `BNK.block_card.v2.s1` | Globally unique |
| `domain` | domain_enum | NOT NULL | |
| `intent` | TEXT | NOT NULL | `BNK.block_card` |
| `scenario_set` | scenario_set_enum | NOT NULL | `v1` / `v2` |
| `text_hi` | TEXT | NOT NULL | Scenario shown to speaker |
| `examples` | TEXT[] | Exactly 3 elements | Seed phrasings — hidden by default |
| `register` | TEXT | | Delivery note |
| `use_count` | INT | DEFAULT 0 | **Incremented ONLY on confirmed Keep** |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |

**Update behavior:** `use_count` incremented inside the confirmation transaction. Never incremented on task issue, redo, or discard.

---

### 3.5 `tasks`

**Purpose:** One row per (speaker × intent × scenario × example). The unit the three progress bars count. Server-authoritative for domain, intent, scenario assignment.

```sql
CREATE TABLE tasks (
    task_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    speaker_id   TEXT NOT NULL REFERENCES speakers(speaker_id),
    domain       domain_enum NOT NULL,
    intent       TEXT NOT NULL,                    -- 'BNK.block_card' — server-side only
    scenario_id  TEXT NOT NULL REFERENCES scenarios(scenario_id),
    scenario_no  INT NOT NULL,                    -- position within intent (drives middle bar)
    example_no   INT NOT NULL CHECK (example_no BETWEEN 1 AND 3),
    batch_no     INT NOT NULL,                    -- horizontal slice number
    status       task_status_enum NOT NULL DEFAULT 'pending',
    redo_count   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique: one task per (speaker, scenario, example, batch)
CREATE UNIQUE INDEX idx_tasks_unique ON tasks (speaker_id, scenario_id, example_no, batch_no);

-- Progress query index
CREATE INDEX idx_tasks_progress ON tasks (speaker_id, domain, batch_no, intent, scenario_no, example_no);

-- Coverage query index
CREATE INDEX idx_tasks_coverage ON tasks (domain, intent, status);
```

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `task_id` | UUID PK | Auto-generated | |
| `speaker_id` | TEXT FK | REFERENCES speakers | |
| `domain` | domain_enum | NOT NULL | Server-assigned, never from client |
| `intent` | TEXT | NOT NULL | Server-assigned |
| `scenario_id` | TEXT FK | REFERENCES scenarios | Assigned by §10 algorithm |
| `scenario_no` | INT | NOT NULL | Drives middle progress bar |
| `example_no` | INT | 1–3 | Drives inner progress bar |
| `batch_no` | INT | NOT NULL | Horizontal slice number |
| `status` | task_status_enum | DEFAULT 'pending' | |
| `redo_count` | INT | DEFAULT 0 | Incremented on each Redo |

**Unique constraint:** `(speaker_id, scenario_id, example_no, batch_no)` prevents duplicate task creation.

**Progress query** (drives all three bars):
```sql
SELECT intent, scenario_no, example_no, status
FROM tasks
WHERE speaker_id = $1 AND domain = $2 AND batch_no = $3
ORDER BY intent, scenario_no, example_no;
```

---

### 3.6 `clips`

**Purpose:** One row per recording attempt. Multiple clips may exist per task (due to redos). Only one will be `confirmed`.

```sql
CREATE TABLE clips (
    clip_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id                UUID NOT NULL REFERENCES tasks(task_id),
    speaker_id             TEXT NOT NULL REFERENCES speakers(speaker_id),
    device_id              UUID NOT NULL REFERENCES devices(device_id),
    filename               TEXT,                       -- canonical, server-generated (§8)
    raw_path               TEXT,                       -- 'raw/BNK/SPK_0042/<clip_id>.webm'
    wav_path               TEXT,                       -- 'wav/BNK/SPK_0042/<filename>.wav'
    mime_type              TEXT,                       -- 'audio/webm;codecs=opus' or 'audio/mp4'
    duration_s             FLOAT,                      -- computed by worker
    transcript_provisional TEXT,                       -- prefilled example or speaker edit
    transcript_final       TEXT,                       -- ASR + human pass
    transcript_source      transcript_source_enum,
    prompted               BOOLEAN NOT NULL DEFAULT false,
    qc_flags               TEXT[],                     -- {'too_short', 'clipped', 'silent', 'noisy'}
    status                 clip_status_enum NOT NULL DEFAULT 'initiated',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one confirmed clip per task
CREATE UNIQUE INDEX idx_clips_confirmed_per_task
    ON clips (task_id) WHERE status = 'confirmed';

-- Worker queue: find confirmed clips needing processing
CREATE INDEX idx_clips_processing_queue
    ON clips (status) WHERE status = 'confirmed';

-- Admin review: flagged clips
CREATE INDEX idx_clips_flagged
    ON clips (status) WHERE qc_flags IS NOT NULL AND array_length(qc_flags, 1) > 0;

-- Speaker lookup
CREATE INDEX idx_clips_speaker ON clips (speaker_id);

-- Device audit
CREATE INDEX idx_clips_device ON clips (device_id);
```

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `clip_id` | UUID PK | Auto-generated | |
| `task_id` | UUID FK | REFERENCES tasks | Carries domain/intent/scenario provenance |
| `speaker_id` | TEXT FK | REFERENCES speakers | Redundant with task but enables direct queries |
| `device_id` | UUID FK | REFERENCES devices | **Contamination detection** |
| `filename` | TEXT | | Server-generated canonical name |
| `raw_path` | TEXT | | Object storage key for raw WebM/MP4 |
| `wav_path` | TEXT | | Object storage key for processed WAV |
| `mime_type` | TEXT | | Browser-reported MIME type |
| `duration_s` | FLOAT | | Computed by worker from WAV |
| `transcript_provisional` | TEXT | | Prefilled or speaker-edited |
| `transcript_final` | TEXT | | ASR or human-verified |
| `transcript_source` | transcript_source_enum | | Provenance of transcript |
| `prompted` | BOOLEAN | DEFAULT false | True if example was revealed |
| `qc_flags` | TEXT[] | | Worker-set flags |
| `status` | clip_status_enum | DEFAULT 'initiated' | See state machine in ARCHITECTURE.md |

**Critical constraint:** `idx_clips_confirmed_per_task` — partial unique index ensures at most ONE confirmed clip per task. This is the database-level guarantee that redo cannot leave duplicate confirmed clips.

---

### 3.7 `withdrawal_audit`

**Purpose:** Anonymized record of speaker withdrawals. Retained after all speaker data is deleted for compliance and audit.

```sql
CREATE TABLE withdrawal_audit (
    id                SERIAL PRIMARY KEY,
    speaker_id        TEXT NOT NULL,                -- kept for reference even after speaker deletion
    withdrawn_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    clips_deleted     INT NOT NULL DEFAULT 0,
    tasks_deleted     INT NOT NULL DEFAULT 0,
    processed_by      TEXT,                         -- admin who processed the withdrawal
    notes             TEXT
);
```

---

## 4. Transaction Boundaries

### 4.1 Clip Confirmation (Critical)

```sql
BEGIN;
  -- Lock the clip row
  SELECT * FROM clips WHERE clip_id = $1 FOR UPDATE;

  -- Verify preconditions
  -- clip.status IN ('initiated', 'uploaded')
  -- clip.speaker_id == authenticated speaker
  -- speaker.consent_at IS NOT NULL
  -- speaker.withdrawn_at IS NULL

  -- Update clip
  UPDATE clips SET
      status = 'confirmed',
      transcript_provisional = $2,
      prompted = $3,
      updated_at = now()
  WHERE clip_id = $1;

  -- Update task
  UPDATE tasks SET
      status = 'recorded',
      updated_at = now()
  WHERE task_id = (SELECT task_id FROM clips WHERE clip_id = $1);

  -- Increment scenario usage (with row lock)
  UPDATE scenarios SET use_count = use_count + 1
  WHERE scenario_id = (
      SELECT scenario_id FROM tasks
      WHERE task_id = (SELECT task_id FROM clips WHERE clip_id = $1)
  );

  -- Enqueue processing (Celery task dispatched after commit)
COMMIT;
```

### 4.2 Clip Discard (Critical)

```sql
BEGIN;
  SELECT * FROM clips WHERE clip_id = $1 FOR UPDATE;
  -- Verify clip belongs to speaker
  -- clip.status NOT IN ('confirmed', 'processing', 'processed')

  UPDATE clips SET status = 'discarded', updated_at = now()
  WHERE clip_id = $1;

  UPDATE tasks SET redo_count = redo_count + 1, updated_at = now()
  WHERE task_id = (SELECT task_id FROM clips WHERE clip_id = $1);

  -- DO NOT increment scenario.use_count
  -- DO NOT change task.status (remains 'pending')
COMMIT;
-- After commit: async delete raw object from storage (best-effort)
```

### 4.3 Speaker Creation

```sql
BEGIN;
  -- Generate next speaker_id
  SELECT 'SPK_' || lpad(nextval('speaker_id_seq')::text, 4, '0') AS speaker_id;

  INSERT INTO speakers (speaker_id, age, gender, l1, region, consent_at, consent_version)
  VALUES ($1, $2, $3, $4, $5, now(), $6);

  -- Add to device roster
  INSERT INTO device_speakers (device_id, speaker_id)
  VALUES ($7, $1);
COMMIT;
```

### 4.4 Speaker Withdrawal

```sql
BEGIN;
  -- Soft-delete speaker
  UPDATE speakers SET withdrawn_at = now() WHERE speaker_id = $1;

  -- Count for audit
  SELECT count(*) FROM clips WHERE speaker_id = $1;
  SELECT count(*) FROM tasks WHERE speaker_id = $1;

  -- Create audit record
  INSERT INTO withdrawal_audit (speaker_id, clips_deleted, tasks_deleted, processed_by)
  VALUES ($1, $clip_count, $task_count, $admin);
COMMIT;
-- After commit: queue async worker to delete objects and hard-delete rows
```

---

## 5. Relationships Diagram

```
speakers ─────────────┬────────────────────────────┐
  │                   │                            │
  │ 1:N               │ M:N (via device_speakers)  │ 1:N
  ▼                   ▼                            ▼
tasks              devices                       clips
  │                                                │
  │ N:1                                            │ N:1
  ▼                                                ▼
scenarios                                       devices
```

**Full chain:**
```
speaker → task → clip → raw audio → processed audio → transcript → export
            │
            └→ scenario → domain + intent provenance
```

---

## 6. Indexes Summary

| Table | Index | Purpose |
|-------|-------|---------|
| speakers | `token` | Token-based auth lookup |
| speakers | `withdrawn_at` (partial) | Withdrawal queries |
| device_speakers | `device_id` | Device roster query |
| device_speakers | `speaker_id` | Speaker device history |
| scenarios | `intent` | Scenario assignment |
| scenarios | `intent, scenario_set` | Version-balanced assignment |
| tasks | `(speaker_id, scenario_id, example_no, batch_no)` UNIQUE | Dedup |
| tasks | `(speaker_id, domain, batch_no, ...)` | Progress query |
| tasks | `(domain, intent, status)` | Coverage query |
| clips | `(task_id) WHERE confirmed` UNIQUE partial | One confirmed per task |
| clips | `status WHERE confirmed` | Worker queue |
| clips | `speaker_id` | Speaker lookup |
| clips | `device_id` | Device audit |

---

## 7. Migration Strategy

- **Tool:** Alembic with SQLAlchemy 2.x
- **Naming:** `YYYYMMDD_HHMM_description.py`
- **First migration:** Creates all enum types and tables
- **Scenario seeding:** Separate management command, not a migration (data, not schema)
- **Rollback:** Every migration includes a `downgrade()` function
