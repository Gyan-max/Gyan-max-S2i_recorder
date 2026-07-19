# API_CONTRACT.md — Hinglish S2I API Specification

> **Version:** 1.0 · **Status:** Implementation-ready · **Source of truth:** [README.md](../README.md) §18

---

## 1. General Conventions

### 1.1 Base URL

```
https://<api-host>/api
```

### 1.2 Authentication

| Context | Mechanism | Header |
|---------|-----------|--------|
| Volunteer | Speaker token (UUID) | `Authorization: Bearer <speaker_token>` |
| Device | Device ID (UUID) | `X-Device-ID: <device_id>` |
| Admin | JWT (short-lived) | `Authorization: Bearer <jwt>` |

### 1.3 Error Format

All errors return JSON:

```json
{
  "error": {
    "code": "CONSENT_REQUIRED",
    "message": "Speaker has not provided consent",
    "details": {}
  }
}
```

### 1.4 Timestamps

All timestamps in ISO 8601 with timezone: `2026-07-19T14:00:00Z`

---

## 2. Endpoints

### 2.1 `POST /api/devices`

**Purpose:** Register a new device or acknowledge an existing one.

| Field | Value |
|-------|-------|
| Auth | None (first contact) |
| Idempotent | Yes — returns existing device if `device_id` matches |

**Request:**
```json
{
  "device_id": "uuid",         // client-generated, from localStorage
  "ua_class": "Android Chrome" // sanitized device class
}
```

**Response `201 Created` / `200 OK`:**
```json
{
  "device_id": "uuid",
  "first_seen": "2026-07-19T14:00:00Z"
}
```

**Status codes:** `201` new device · `200` existing device · `400` invalid UUID

---

### 2.2 `POST /api/speakers`

**Purpose:** Create a new speaker with consent. Returns speaker_id + token. Adds speaker to device roster.

| Field | Value |
|-------|-------|
| Auth | `X-Device-ID` required |
| Idempotent | No — always creates a new speaker |

**Request:**
```json
{
  "age": 24,
  "gender": "female",
  "l1": "Hindi",
  "region": "Bihar",
  "consent_version": "v1.0"
}
```

**Validation:**
- `age`: integer, 10–100
- `gender`: one of `male`, `female`, `other`, `prefer_not_say`
- `l1`: non-empty string
- `region`: non-empty string
- `consent_version`: non-empty string

**Server actions:**
1. Generate sequential `speaker_id` (`SPK_NNNN`)
2. Set `consent_at = now()`
3. Create `device_speakers` row

**Response `201 Created`:**
```json
{
  "speaker_id": "SPK_0042",
  "token": "uuid",
  "age_band": "18-25",
  "consent_at": "2026-07-19T14:00:00Z"
}
```

**Status codes:** `201` created · `400` validation error · `404` device not found

---

### 2.3 `GET /api/devices/:device_id/speakers`

**Purpose:** Return the speaker roster for a device (speaker-switch UI).

| Field | Value |
|-------|-------|
| Auth | `X-Device-ID` must match `:device_id` |
| Idempotent | Yes |

**Response `200 OK`:**
```json
{
  "speakers": [
    {
      "speaker_id": "SPK_0042",
      "age_band": "18-25",
      "gender": "female",
      "last_used_at": "2026-07-19T14:00:00Z"
    }
  ]
}
```

**Note:** Returns `age_band`, never `age`. Token is NOT returned in roster — the client must already have it from speaker creation.

---

### 2.4 `GET /api/session/next`

**Purpose:** Issue the next task batch for the authenticated speaker. Returns assigned scenarios with task metadata.

| Field | Value |
|-------|-------|
| Auth | `Authorization: Bearer <speaker_token>` + `X-Device-ID` |
| Idempotent | Yes — returns existing pending batch if one exists |

**Query parameters:**
- `domain` (optional): `BNK`, `EDU`, `TRV`, `VAS`. If omitted, server picks the domain with lowest coverage.

**Server actions:**
1. Check speaker has valid consent (`consent_at IS NOT NULL`)
2. Check for existing pending batch → return it if found (no duplicate batches)
3. If no pending batch: run scenario assignment algorithm (§10 of README)
4. Create task rows for the batch
5. Return batch

**Response `200 OK`:**
```json
{
  "batch": {
    "domain": "BNK",
    "batch_no": 1,
    "tasks": [
      {
        "task_id": "uuid",
        "intent": "BNK.block_card",
        "scenario_id": "BNK.block_card.v1.s1",
        "scenario_no": 1,
        "example_no": 1,
        "text_hi": "Aapka card kho gaya hai...",
        "examples": ["Example 1", "Example 2", "Example 3"],
        "register": "urgent, alarmed",
        "status": "pending"
      }
    ],
    "progress": {
      "intents_total": 12,
      "intents_done": 6,
      "current_intent": "BNK.block_card",
      "scenarios_in_intent": 2,
      "scenarios_done": 0,
      "examples_in_scenario": 3,
      "examples_done": 0
    }
  }
}
```

**Status codes:** `200` batch issued · `401` invalid token · `403` consent required · `404` speaker not found

**Race condition:** If called from two tabs simultaneously, both get the same batch (idempotent).

---

### 2.5 `POST /api/clips/init`

**Purpose:** Reserve a clip_id, generate canonical filename, return signed upload URL.

| Field | Value |
|-------|-------|
| Auth | `Authorization: Bearer <speaker_token>` + `X-Device-ID` |
| Idempotent | Yes — if pending clip exists for this task, returns it |

**Request:**
```json
{
  "task_id": "uuid",
  "mime_type": "audio/webm;codecs=opus"
}
```

**Server actions:**
1. Verify task belongs to authenticated speaker
2. Verify task.status == 'pending'
3. Verify speaker has valid consent
4. Check for existing `initiated` clip for this task → return it if found
5. Create clip row (`status: 'initiated'`)
6. Generate canonical filename (§8 of README)
7. Generate raw_path: `raw/<domain>/<speaker_id>/<clip_id>.<ext>`
8. Generate signed PUT URL (10 min expiry)

**Response `201 Created` / `200 OK`:**
```json
{
  "clip_id": "uuid",
  "filename": "bnk_SPK0042_block_card_v2_s2e1_9f3a1c.wav",
  "upload_url": "https://r2.example.com/corpus/raw/BNK/SPK_0042/...?signature=...",
  "upload_expires_at": "2026-07-19T14:10:00Z"
}
```

**Status codes:** `201` new clip · `200` existing pending clip · `400` invalid request · `401` unauthorized · `403` consent required or task not owned · `409` task already recorded

---

### 2.6 `PUT <signed_url>`

**Purpose:** Direct browser-to-object-storage upload. **This is NOT an API endpoint** — it is a presigned URL targeting object storage directly.

| Field | Value |
|-------|-------|
| Auth | Embedded in signed URL |
| Content-Type | As negotiated in `/clips/init` |
| Body | Raw audio blob |

**The API never proxies audio uploads.** This is a core architectural decision.

---

### 2.7 `POST /api/clips/:clip_id/confirm`

**Purpose:** Speaker confirms (Keep). Commits the clip as corpus data. This is the ONLY way a recording enters the confirmed corpus.

| Field | Value |
|-------|-------|
| Auth | `Authorization: Bearer <speaker_token>` |
| Idempotent | Yes — confirming an already-confirmed clip returns 200 |

**Request:**
```json
{
  "transcript_edit": "Mera card kho gaya hai, band karo",  // optional
  "prompted": false
}
```

**Server actions (single transaction):**
1. `SELECT ... FOR UPDATE` on clip row
2. Verify `clip.speaker_id == authenticated speaker`
3. Verify `speaker.consent_at IS NOT NULL`
4. If `clip.status == 'confirmed'`: return 200 (idempotent, no changes)
5. If `clip.status == 'discarded'`: return 409 Conflict
6. Set `clip.status = 'confirmed'`
7. Set `clip.transcript_provisional` (from edit or example text)
8. Set `clip.transcript_source` = `speaker_edited` if edit provided, else `example_unedited`
9. Set `clip.prompted` = request.prompted
10. Set `task.status = 'recorded'`
11. `UPDATE scenarios SET use_count = use_count + 1` (with `FOR UPDATE` on scenario)
12. COMMIT
13. Dispatch Celery processing chain

**Response `200 OK`:**
```json
{
  "clip_id": "uuid",
  "status": "confirmed",
  "next_task": {
    "task_id": "uuid",
    "intent": "BNK.check_balance",
    "text_hi": "..."
  }
}
```

**Status codes:** `200` confirmed (or already confirmed) · `401` unauthorized · `403` not speaker's clip or no consent · `409` clip already discarded · `404` clip not found

---

### 2.8 `POST /api/clips/:clip_id/discard`

**Purpose:** Speaker clicks Redo. Discards the recording. The same task is reissued.

| Field | Value |
|-------|-------|
| Auth | `Authorization: Bearer <speaker_token>` |
| Idempotent | Yes — discarding an already-discarded clip returns 200 |

**Request:** Empty body or `{}`

**Server actions (single transaction):**
1. `SELECT ... FOR UPDATE` on clip row
2. Verify `clip.speaker_id == authenticated speaker`
3. If `clip.status == 'discarded'`: return 200 (idempotent)
4. If `clip.status == 'confirmed'`: return 409 Conflict
5. Set `clip.status = 'discarded'`
6. `task.redo_count += 1`
7. Keep `task.status = 'pending'` (DO NOT advance)
8. **DO NOT** increment `scenario.use_count`
9. COMMIT
10. Async: delete raw object from storage (best-effort)

**Response `200 OK`:**
```json
{
  "clip_id": "uuid",
  "status": "discarded",
  "task": {
    "task_id": "uuid",
    "intent": "BNK.block_card",
    "text_hi": "...",
    "redo_count": 2
  }
}
```

**Status codes:** `200` discarded (or already discarded) · `401` unauthorized · `403` not speaker's clip · `409` clip already confirmed · `404` not found

---

### 2.9 `GET /api/progress`

**Purpose:** Return progress state for the current speaker's batch. Drives the three-level progress bars.

| Field | Value |
|-------|-------|
| Auth | `Authorization: Bearer <speaker_token>` |

**Query parameters:**
- `domain`: required
- `batch_no`: required

**Response `200 OK`:**
```json
{
  "domain": "BNK",
  "batch_no": 1,
  "intents": [
    {
      "intent": "BNK.block_card",
      "intent_no": 1,
      "total_intents": 12,
      "status": "in_progress",
      "scenarios": [
        {
          "scenario_no": 1,
          "total_scenarios": 2,
          "examples": [
            { "example_no": 1, "status": "recorded" },
            { "example_no": 2, "status": "pending" },
            { "example_no": 3, "status": "pending" }
          ]
        }
      ]
    }
  ]
}
```

---

### 2.10 Admin Endpoints

All admin endpoints require `Authorization: Bearer <admin_jwt>`.

#### `POST /api/admin/login`

**Request:**
```json
{
  "username": "admin",
  "password": "..."
}
```

**Response `200 OK`:**
```json
{
  "token": "<jwt>",
  "expires_at": "2026-07-19T22:00:00Z"
}
```

#### `GET /api/admin/coverage`

**Purpose:** Coverage heatmap data — domain × intent against the floor of 40.

**Response:** Array of `{ domain, intent, clips_processed, speakers_count, floor: 40 }`

#### `GET /api/admin/speakers`

**Purpose:** Speaker table — clips, completion rate, prompted ratio, QC reject rate.

#### `GET /api/admin/devices`

**Purpose:** Device audit — devices with multiple speakers, flagged for contamination review.

#### `GET /api/admin/review`

**Purpose:** Flagged clips queue with metadata for inline playback, accept/reject.

**Query params:** `status=processed&has_flags=true`

#### `POST /api/admin/clips/:clip_id/review`

**Purpose:** Accept, reject, or edit transcript of a flagged clip.

**Request:**
```json
{
  "action": "accept" | "reject" | "edit_transcript",
  "transcript_final": "...",    // required if action == "edit_transcript"
  "notes": "..."                // optional
}
```

#### `GET /api/admin/scenarios`

**Purpose:** Scenario usage view — `use_count` distribution.

#### `POST /api/admin/speakers/:speaker_id/withdraw`

**Purpose:** Process speaker withdrawal. Initiates cascade deletion.

#### `POST /api/admin/export`

**Purpose:** Trigger dataset export. Returns job ID.

#### `GET /api/admin/export/:job_id`

**Purpose:** Check export job status.

#### `POST /api/admin/qr/generate`

**Purpose:** Pre-generate speaker IDs with QR codes for in-person sessions.

**Request:**
```json
{
  "count": 10
}
```

**Response:** Array of `{ speaker_id, token, qr_data_url }`

---

### 2.11 `GET /api/health`

**Purpose:** Health check for monitoring.

**Auth:** None

**Response `200 OK`:**
```json
{
  "status": "healthy",
  "db": "connected",
  "redis": "connected",
  "storage": "connected",
  "version": "1.0.0"
}
```

---

## 3. Client vs. Server Data Ownership

| Data | Owner | Client can... |
|------|-------|---------------|
| `speaker_id` | **Server** | Read only |
| `speaker_token` | **Server** | Store + send as auth |
| `device_id` | **Client** | Generate + send |
| `task_id` | **Server** | Read only |
| `domain` | **Server** | Read only |
| `intent` | **Server** | Read only |
| `scenario_id` | **Server** | Read only |
| `filename` | **Server** | Read only |
| `clip_id` | **Server** | Read only (reference for confirm/discard) |
| `audio blob` | **Client** | Upload via signed URL |
| `transcript_edit` | **Client** | Provide optionally on confirm |
| `prompted` | **Client** | Report truthfully on confirm |
| `mime_type` | **Client** | Report on init (informational) |
