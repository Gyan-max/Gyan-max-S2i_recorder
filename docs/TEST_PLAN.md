# TEST_PLAN.md — Hinglish S2I Testing Strategy

> **Version:** 1.0 · **Status:** Implementation-ready

---

## 1. Testing Layers

| Layer | Tool | Scope |
|-------|------|-------|
| Unit (Python) | pytest | Services, models, scenario assignment, naming |
| Unit (TypeScript) | Vitest | Hooks, state logic, IndexedDB wrapper |
| API Integration | pytest + httpx (AsyncClient) | Full endpoint testing with DB |
| Database | pytest + SQLAlchemy | Constraints, transactions, migrations |
| Frontend Component | Vitest + React Testing Library | Screen rendering, state transitions |
| E2E | Playwright | Full browser flow including audio mocking |
| Mobile Browser | Playwright + BrowserStack | Real device MediaRecorder behavior |
| Worker | pytest + mocked storage | Transcode, QC, ASR pipeline |
| Security | pytest + manual | Auth, consent enforcement, input validation |

---

## 2. Critical Workflow Tests

### 2.1 Mandatory Keep/Redo

| Test | Input | Expected Outcome |
|------|-------|-------------------|
| **Keep confirms clip** | Record → Keep | `clip.status = 'confirmed'`, `task.status = 'recorded'`, `scenario.use_count += 1` |
| **Redo discards clip** | Record → Redo | `clip.status = 'discarded'`, `task.status = 'pending'`, `task.redo_count += 1`, `scenario.use_count` unchanged |
| **Redo reissues same task** | Record → Redo | Same `task_id` returned, same scenario text displayed |
| **Keep advances to next task** | Record → Keep | Next task in batch returned |
| **No auto-confirm** | Record (no Keep/Redo) | Clip stays `initiated`, task stays `pending` |
| **Double Keep idempotent** | Keep → Keep | Second returns 200, no state change, `use_count` not double-incremented |
| **Double Redo idempotent** | Redo → Redo | Second returns 200, `redo_count` not double-incremented |
| **Keep after Redo** | Redo → Keep (same clip_id) | Returns 409 Conflict |
| **Redo after Keep** | Keep → Redo (same clip_id) | Returns 409 Conflict |

### 2.2 Upload Interactions

| Test | Scenario | Expected Outcome |
|------|----------|-------------------|
| **Keep during upload** | Upload in-flight → Keep clicked | Confirmation succeeds, upload continues to completion |
| **Redo during upload** | Upload in-flight → Redo clicked | AbortController cancels upload, clip discarded |
| **Redo before upload** | Immediate Redo before upload starts | Blob deleted from IndexedDB, no upload attempted |
| **Redo after upload** | Upload complete → Redo | Clip discarded server-side, raw object deleted async |
| **Upload completes during Redo** | Upload finishes between abort() and /discard | Discard still wins; raw object cleaned up |
| **Signed URL expired** | Wait >10min → upload | Client detects expiry, requests fresh URL, retries |
| **Upload retry on failure** | Network error during upload | Exponential backoff, max 5 retries |
| **Upload retry succeeds** | Fail once → succeed on retry | Clip uploaded, can be confirmed |
| **All retries exhausted** | 5 consecutive failures | Clip marked `abandoned` in IndexedDB |

### 2.3 Offline Scenarios

| Test | Scenario | Expected Outcome |
|------|----------|-------------------|
| **Record while offline** | No network → record → Keep | Blob saved to IndexedDB, upload queued |
| **Network returns** | Queue has pending uploads → network restored | Uploads drain automatically |
| **Browser refresh** | Record → refresh before confirm | IndexedDB blob survives, resumed on reload |
| **Multiple offline recordings** | Record 5 clips offline | All 5 in IndexedDB queue, uploaded on reconnect |
| **Offline Keep** | Record → Keep while offline | Decision stored locally, synced when online |
| **IndexedDB quota exceeded** | Fill storage → record | Error caught, user warned, upload queue prioritized |

### 2.4 Identity & Speaker Switching

| Test | Scenario | Expected Outcome |
|------|----------|-------------------|
| **New speaker creation** | Onboarding form submit | `speaker_id` assigned, token returned, added to device roster |
| **Speaker switch** | Switch from SPK_0042 to SPK_0043 | New session, tasks for SPK_0043 |
| **Session-start confirm** | Start new batch | "Recording as SPK_0042 — is this you?" shown |
| **Idle timeout** | 10 min inactivity → resume | Identity re-confirmation shown |
| **Multiple speakers on device** | SPK_0042 + SPK_0043 on same device | Both in roster, each gets own tasks |
| **Device audit flag** | Two speakers record within short window | Dashboard flags device for contamination review |
| **Task belongs to another speaker** | SPK_0043 tries to confirm SPK_0042's clip | 403 Forbidden |

### 2.5 Task Integrity

| Test | Scenario | Expected Outcome |
|------|----------|-------------------|
| **Client sends wrong domain** | Modify request to change domain | Server ignores — domain from task_id lookup |
| **Client sends wrong intent** | Modify request to change intent | Server ignores — intent from task_id lookup |
| **Wrong task_id** | Random UUID as task_id | 404 Not Found |
| **Task for another speaker** | Use another speaker's task_id | 403 Forbidden |
| **Already confirmed task** | Init clip for recorded task | 409 Conflict |
| **Already discarded task** | Init clip for skipped task | 409 Conflict |
| **Duplicate task creation** | Call /session/next twice | Returns same pending batch (idempotent) |

### 2.6 Scenario Coverage

| Test | Scenario | Expected Outcome |
|------|----------|-------------------|
| **use_count on confirm** | Confirm clip | `scenario.use_count += 1` |
| **use_count NOT on redo** | Redo clip | `scenario.use_count` unchanged |
| **use_count NOT on discard** | Discard clip | `scenario.use_count` unchanged |
| **use_count NOT on init** | Init clip (no confirm) | `scenario.use_count` unchanged |
| **Abandoned task** | Init → never confirm | `scenario.use_count` unchanged, task stays `pending` |
| **Version balancing** | Multiple speakers | v1 and v2 usage roughly balanced |
| **Speaker alternation** | Same speaker, batch 1 → batch 2 | Different version assigned (v1 then v2 or vice versa) |
| **Stable shuffle** | Resume session | Same scenario order for same speaker |

### 2.7 Consent & Privacy

| Test | Scenario | Expected Outcome |
|------|----------|-------------------|
| **No consent → record** | Skip consent → try to init clip | 403 `CONSENT_REQUIRED` |
| **Consent version stored** | Complete onboarding | `consent_version` matches current text |
| **Consent version preserved** | Update consent text, old speaker records | Old speaker retains original `consent_version` |
| **Withdrawal deletes clips** | Admin withdraws speaker | All clips, tasks, raw/wav objects deleted |
| **Withdrawal audit** | Process withdrawal | `withdrawal_audit` row created with counts |
| **Withdrawn speaker cannot record** | Withdrawn speaker tries to init | 403 Forbidden |
| **Export excludes age** | Generate manifest | `age` column absent, `age_band` present |
| **Export excludes withdrawn** | Withdrawn speaker's clips | Not in manifest |

### 2.8 Dataset Splitting

| Test | Scenario | Expected Outcome |
|------|----------|-------------------|
| **Speaker-disjoint splits** | Export with 10 speakers | Each speaker in exactly one split |
| **No speaker in multiple splits** | Verify all clips per speaker | All clips share the same split label |
| **Split ratios** | 10+ speakers | ~80/10/10 distribution |
| **Withdrawn speaker excluded** | Withdrawn after processing | Clips not in any split |

---

## 3. API Tests

### 3.1 Per-Endpoint Coverage

Each endpoint tested for:
- ✅ Happy path (200/201)
- ✅ Authentication failure (401)
- ✅ Authorization failure (403)
- ✅ Not found (404)
- ✅ Conflict (409)
- ✅ Validation error (400)
- ✅ Idempotency (repeat same request)

### 3.2 Concurrency Tests

| Test | Method |
|------|--------|
| Concurrent confirm + discard | Two threads, same clip_id |
| Concurrent double confirm | Two threads, same clip_id |
| Concurrent session/next | Two threads, same speaker |
| Concurrent speaker creation | Two threads, same device |

---

## 4. Database Tests

| Test | Purpose |
|------|---------|
| `idx_clips_confirmed_per_task` | Cannot INSERT two confirmed clips for same task |
| `age_band` generated column | Verify correct derivation for all age ranges |
| `speaker_id_seq` | Sequential IDs: SPK_0001, SPK_0002, ... |
| FK constraints | Clip with non-existent task_id fails |
| Check constraints | `age < 10` fails, `example_no = 4` fails |
| Withdrawal cascade | Deleting speaker cascades properly |
| Migration up/down | Alembic upgrade + downgrade round-trip |

---

## 5. Worker Tests

| Test | Input | Expected |
|------|-------|----------|
| Transcode WebM | Valid WebM/Opus | 16kHz mono WAV produced |
| Transcode MP4 | Valid MP4/AAC | 16kHz mono WAV produced |
| Transcode corrupt | Truncated file | `rejected` status, `corrupt` flag |
| QC: too short | 0.5s WAV | `too_short` flag |
| QC: too long | 20s WAV | `too_long` flag |
| QC: clipped | Clipped audio | `clipped` flag |
| QC: silent | All-zero WAV | `silent` flag, clip rejected |
| QC: noisy | Low SNR | `noisy` flag |
| QC: normal | Clean 3s speech | No flags |
| ASR: normal | Clean speech WAV | `transcript_final` populated |
| ASR: provider swap | Different ASRProvider impl | Same interface, different output |
| Idempotent reprocess | Run transcode twice | WAV overwritten, no errors |
| Withdrawn speaker | Process clip for withdrawn speaker | Skip processing |

---

## 6. Security Tests

| Test | Attack | Expected |
|------|--------|----------|
| Token reuse across speakers | Use SPK_0042's token as SPK_0043 | 403 Forbidden |
| Forge speaker_id in request | Send fake speaker_id in body | Server uses token-resolved speaker |
| Modify domain in confirm | Add `domain: "EDU"` to confirm body | Ignored — domain from task |
| Admin route without JWT | GET /api/admin/coverage | 401 Unauthorized |
| Expired admin JWT | Use 25-hour-old JWT | 401 Unauthorized |
| SQL injection in speaker fields | `'; DROP TABLE speakers; --` in region | Parameterized query, no effect |
| XSS in transcript | `<script>` in transcript_edit | Stored as text, sanitized on display |
| Oversized audio upload | 500MB blob | Signed URL has content-length limit |

---

## 7. Mobile Browser Tests

| Test | Device | Browser | Focus |
|------|--------|---------|-------|
| MIME type detection | Android | Chrome | WebM/Opus selected |
| MIME type detection | iPhone | Safari | MP4/AAC selected |
| Hold-to-record | Android | Chrome | Touch events work |
| Hold-to-record | iPhone | Safari | Touch events work |
| Mic permission | Both | Both | Permission prompt appears |
| Background/foreground | Both | Both | Recording stops on background |
| Screen lock | Both | Both | Upload resumes on unlock |
| Slow network (3G) | Android | Chrome | Upload queues, retries work |
| PWA install | Android | Chrome | Installable, works offline |

---

## 8. E2E Test Scenarios (Playwright)

### 8.1 Complete Happy Path

```
1. Open app → Onboarding screen
2. Fill consent + 4 fields → Submit
3. "Recording as SPK_0001" confirmation → Confirm
4. Hold record button → Release
5. Auto-playback plays
6. Click Keep → Next task shown
7. Verify: clip confirmed in DB, task recorded, scenario.use_count incremented
```

### 8.2 Redo Flow

```
1. Record → Release
2. Click Redo
3. Verify: same task shown, redo_count = 1
4. Record again → Keep
5. Verify: clip confirmed, only one confirmed clip for task
```

### 8.3 Speaker Switch

```
1. Complete onboarding as SPK_0001
2. Click switch speaker
3. "New speaker" → onboarding
4. Verify: SPK_0002 created, roster shows both
5. Record as SPK_0002 → clip has speaker_id = SPK_0002
```

### 8.4 Offline Recovery

```
1. Record while online → Keep
2. Go offline (network interception)
3. Record → Keep (stored in IndexedDB)
4. Go online
5. Verify: queued clip uploaded and confirmed
```

---

## 9. Test Data & Fixtures

- **Scenario fixtures:** Minimal set of 4 scenarios (1 per domain, 2 versions)
- **Speaker fixtures:** 3 speakers with varying demographics
- **Device fixtures:** 2 devices, one shared
- **Audio fixtures:** Pre-recorded WebM and MP4 files for upload tests
- **WAV fixtures:** Pre-generated WAV files for QC tests (normal, silent, clipped, noisy, too-short, too-long)
