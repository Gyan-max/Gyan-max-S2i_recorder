# AUDIO_PIPELINE.md — Hinglish S2I Audio Processing Pipeline

> **Version:** 1.0 · **Status:** Implementation-ready · **Source of truth:** [README.md](../README.md) §12, §15

---

## 1. Pipeline Overview

```
Microphone
  │
  ▼
getUserMedia (mono, all processing OFF)
  │
  ▼
MediaRecorder (WebM/Opus or MP4/AAC)
  │
  ▼
ondataavailable → Blob
  │
  ├──▶ IndexedDB (durable, instant)
  ├──▶ Background upload (optimistic, via signed URL)
  └──▶ Auto-playback (confirm UI)
         │
    ┌────┴────┐
    Keep     Redo
    │         │
    ▼         ▼
 Confirmed  Discarded
    │
    ▼
Object Storage (raw/)
    │
    ▼
Worker: FFmpeg transcode → 16kHz mono WAV
    │
    ▼
Object Storage (wav/)
    │
    ▼
Worker: QC checks
    │
    ▼
Worker: ASR transcription
    │
    ▼
Admin: Human review (flagged clips)
    │
    ▼
Export: manifest.jsonl + HuggingFace datasets
```

---

## 2. Browser Audio Capture

### 2.1 getUserMedia Configuration

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    echoCancellation: false,   // OFF — damages acoustic fidelity
    noiseSuppression: false,   // OFF — alters spectra for ASR
    autoGainControl: false     // OFF — preserves true amplitude
  }
});
```

**Rationale:** Browser speech-enhancement algorithms are tuned for telephony, not corpus fidelity. They alter spectra in ways that contaminate acoustic analysis and ASR training.

**Stream lifecycle:** Single `getUserMedia` call per session. Stream held open across recordings to avoid repeated permission prompts (§13 friction budget).

### 2.2 MIME Type Negotiation

```javascript
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',    // Chrome, Firefox, Edge
  'audio/webm',                // fallback Chrome
  'audio/mp4',                 // Safari iOS
  'audio/mp4;codecs=aac',     // Safari explicit
];

function selectMimeType(): string {
  for (const type of PREFERRED_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  throw new Error('No supported audio MIME type found');
}
```

| Browser | Expected MIME | Container | Codec |
|---------|--------------|-----------|-------|
| Chrome Android | `audio/webm;codecs=opus` | WebM | Opus |
| Firefox | `audio/webm;codecs=opus` | WebM | Opus |
| Safari iOS 14.3+ | `audio/mp4` | MP4 | AAC |
| Desktop Chrome | `audio/webm;codecs=opus` | WebM | Opus |

**Rule:** Do NOT fight the browser's native format. No in-browser WAV encoding. Opus at 32+ kbps is transparent for 16kHz speech. Worker handles both formats.

### 2.3 MediaRecorder Configuration

```javascript
const recorder = new MediaRecorder(stream, {
  mimeType: selectedMimeType,
  audioBitsPerSecond: 32000,   // 32kbps — sufficient for speech
});
```

**Hold-to-record:** `MediaRecorder.start()` on button press, `MediaRecorder.stop()` on release. This makes the utterance boundary physical and eliminates forgotten-stop failures.

### 2.4 Client-Side Minimum Duration Check

```javascript
// Clips under 0.4s are mis-taps — reject silently and re-queue task
const MIN_DURATION_S = 0.4;
const recordingDuration = (Date.now() - recordStartTime) / 1000;
if (recordingDuration < MIN_DURATION_S) {
  // Discard silently, re-queue same task
  return;
}
```

### 2.5 Live Waveform

```javascript
const audioContext = new AudioContext();
const source = audioContext.createMediaStreamSource(stream);
const analyser = audioContext.createAnalyser();
analyser.fftSize = 256;
source.connect(analyser);
// Read analyser.getByteTimeDomainData() on requestAnimationFrame
```

Visual feedback that the microphone is working. Does not alter the recording.

---

## 3. Local Persistence (IndexedDB)

### 3.1 Schema

```
ObjectStore: "recordings"
  Key: clip_id (UUID)
  Value: {
    clip_id: string,
    task_id: string,
    blob: Blob,
    mime_type: string,
    upload_url: string,
    upload_status: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'discarded',
    decision: null | 'keep' | 'redo',
    retry_count: number,
    created_at: number (timestamp),
    last_attempt_at: number | null
  }
```

### 3.2 Write-First Guarantee

Recording blob is written to IndexedDB **before** any upload attempt or UI transition. This ensures durability across:

- Browser refresh
- Browser crash
- Network failure
- Device sleep

### 3.3 Storage Quota Management

```javascript
if (navigator.storage && navigator.storage.estimate) {
  const { usage, quota } = await navigator.storage.estimate();
  const available = quota - usage;
  const MIN_REQUIRED = 50 * 1024 * 1024; // 50MB
  if (available < MIN_REQUIRED) {
    // Alert user, prioritize upload queue drain
  }
}
```

On `QuotaExceededError`: prevent new recordings, show warning, prioritize uploading existing queue.

---

## 4. Upload Pipeline

### 4.1 Optimistic Upload Flow

```
Recording complete
  │
  ├──▶ IndexedDB write (blocking, must succeed)
  │
  ├──▶ Start upload (non-blocking)
  │     │
  │     ├── PUT blob to signed URL
  │     ├── On success: update IndexedDB status to 'uploaded'
  │     └── On failure: update IndexedDB status to 'failed', schedule retry
  │
  └──▶ Auto-play for confirmation (concurrent with upload)
```

### 4.2 Upload with AbortController

```javascript
const controller = new AbortController();

async function uploadClip(clip: PendingClip): Promise<void> {
  try {
    const response = await fetch(clip.upload_url, {
      method: 'PUT',
      body: clip.blob,
      headers: { 'Content-Type': clip.mime_type },
      signal: controller.signal,
    });
    if (response.ok) {
      await updateIndexedDB(clip.clip_id, { upload_status: 'uploaded' });
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // Redo was clicked — upload cancelled
      await updateIndexedDB(clip.clip_id, { upload_status: 'discarded' });
    } else {
      await updateIndexedDB(clip.clip_id, {
        upload_status: 'failed',
        retry_count: clip.retry_count + 1,
      });
    }
  }
}
```

### 4.3 Redo During Upload

1. `AbortController.abort()` cancels in-flight fetch
2. `POST /api/clips/:id/discard` sent to server
3. IndexedDB entry marked `discarded` and deleted
4. **If upload completed before abort:** server-side discard still wins — raw object deleted asynchronously

### 4.4 Keep During Upload

1. `POST /api/clips/:id/confirm` sent immediately
2. If upload hasn't finished yet: confirmation is queued; clip is confirmed server-side
3. Server accepts confirmation for clips in `initiated` status (upload not yet verified)
4. Worker will find the raw file when it arrives

### 4.5 Signed URL Expiry

- URLs expire after **10 minutes**
- If upload hasn't started within 10 minutes, client requests a new signed URL
- **Implementation:** store `upload_expires_at` in IndexedDB. Before upload attempt, check if expired. If so, call `/api/clips/init` again with same `task_id` to get fresh URL.

### 4.6 Retry Strategy

| Retry | Delay | Notes |
|-------|-------|-------|
| 1 | 2s | |
| 2 | 4s | |
| 3 | 8s | |
| 4 | 16s | |
| 5 | 32s | Max retries — mark `abandoned` |

**On retry:** Request fresh signed URL if expired. Then retry PUT.

### 4.7 Duplicate Upload Prevention

- Object storage key includes `clip_id` (UUID) — globally unique
- PUT is idempotent — re-uploading same key overwrites with identical content
- Confirmation is idempotent — double-confirm returns 200

### 4.8 Background Queue Drain (on page load)

```javascript
async function drainQueue(): Promise<void> {
  const pending = await getAllFromIndexedDB('recordings');
  for (const clip of pending) {
    if (clip.upload_status === 'discarded') {
      await deleteFromIndexedDB(clip.clip_id);
      continue;
    }
    if (clip.decision === 'redo') {
      await discardOnServer(clip.clip_id);
      await deleteFromIndexedDB(clip.clip_id);
      continue;
    }
    if (clip.upload_status !== 'uploaded') {
      await uploadClip(clip); // with fresh signed URL if needed
    }
    if (clip.decision === 'keep' && clip.upload_status === 'uploaded') {
      await confirmOnServer(clip.clip_id);
      await deleteFromIndexedDB(clip.clip_id);
    }
  }
}
```

---

## 5. Object Storage Layout

```
s3://corpus/
  raw/<domain>/<speaker_id>/<clip_id>.<ext>
    ← Immutable original (WebM or MP4)
    ← ext determined by mime_type: .webm or .mp4

  wav/<domain>/<speaker_id>/<filename>.wav
    ← 16kHz mono PCM deliverable
    ← filename is the canonical server-generated name

  manifests/<date>/manifest.jsonl
    ← One JSON line per processed clip
```

### 5.1 File Naming (§8 of README)

Generated server-side at task-issue time:

```
<domain>_<speaker_id>_<intent_short>_<scenario_set>_s<scenario_no>e<example_no>_<clip_short>.wav

Example: bnk_SPK0042_block_card_v2_s2e1_9f3a1c.wav
```

| Segment | Source | Purpose |
|---------|--------|---------|
| `domain` | task.domain | Human-scannable grouping |
| `speaker_id` | task.speaker_id | Speaker-disjoint splitting |
| `intent_short` | task.intent (domain prefix stripped) | Label |
| `scenario_set` | scenario.scenario_set | v1 vs v2 comparison |
| `s<n>e<n>` | task.scenario_no, task.example_no | Self-describing position |
| `clip_short` | clip_id first 6 hex chars | Uniqueness on retry |

---

## 6. Server-Side Processing (Worker)

### 6.1 Transcoding (FFmpeg)

```bash
ffmpeg -i input.webm \
  -ar 16000 \
  -ac 1 \
  -c:a pcm_s16le \
  -af "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15, \
       areverse, \
       silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15, \
       areverse" \
  output.wav
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Sample rate | 16000 Hz | Matches HiACC, IITG-HingCoS, wav2vec2/HuBERT |
| Channels | 1 (mono) | Standard for speech |
| Encoding | 16-bit PCM | Maximum compatibility |
| Silence trim | -50dB threshold, 0.15s padding | Removes excess silence but preserves ~150ms at each end |

**Padding rationale:** Field guides require 0.2–0.5s of silence at each end. Clipping the first syllable of a 1.5s command destroys the clip. The `start_silence=0.15` parameter leaves adequate padding.

**Both WebM/Opus and MP4/AAC are handled.** FFmpeg auto-detects the input format.

### 6.2 Quality Control Checks

| Check | Threshold | QC Flag | Action |
|-------|-----------|---------|--------|
| Duration (short) | < 0.8s | `too_short` | Flag |
| Duration (long) | > 15s | `too_long` | Flag |
| Peak amplitude | Sustained 0 dBFS | `clipped` | Flag |
| Speech energy | None detected | `silent` | Flag + **reject** |
| Estimated SNR | Below threshold (TBD, ~10dB) | `noisy` | Flag |

**Implementation (Python, using WAV file):**

```python
import numpy as np
import soundfile as sf

def qc_check(wav_path: str) -> list[str]:
    data, sr = sf.read(wav_path)
    flags = []
    duration = len(data) / sr

    if duration < 0.8:
        flags.append('too_short')
    if duration > 15.0:
        flags.append('too_long')

    peak = np.max(np.abs(data))
    if peak >= 0.99:  # near 0 dBFS
        clipped_samples = np.sum(np.abs(data) >= 0.99)
        if clipped_samples / sr > 0.01:  # >10ms of clipping
            flags.append('clipped')

    rms = np.sqrt(np.mean(data**2))
    if rms < 1e-4:  # effectively silent
        flags.append('silent')

    # SNR estimation (simplified: signal RMS vs noise floor)
    # More sophisticated: split into voiced/unvoiced segments
    if rms > 0:
        noise_floor = np.percentile(np.abs(data), 5)
        if noise_floor > 0:
            snr_estimate = 20 * np.log10(rms / noise_floor)
            if snr_estimate < 10:
                flags.append('noisy')

    return flags
```

**Fatal flags:** `silent` → clip.status = `rejected`. All others are advisory and enter the admin review queue.

### 6.3 ASR Integration

**Abstraction layer:** The system must not be tightly coupled to a single ASR provider.

```python
# Abstract interface
class ASRProvider:
    def transcribe(self, wav_path: str, language: str = "hi") -> ASRResult:
        ...

class ASRResult:
    text: str
    confidence: float
    language: str
    provider: str

# Default implementation: IndicWhisper
class IndicWhisperProvider(ASRProvider):
    def transcribe(self, wav_path: str, language: str = "hi") -> ASRResult:
        # Load model, run inference
        ...
```

**Transcript provenance chain:**

| Stage | Field | Source |
|-------|-------|--------|
| Recording | `transcript_provisional` | Example text (if unedited) or speaker edit |
| | `transcript_source` | `example_unedited` or `speaker_edited` |
| ASR | `transcript_final` | ASR output |
| | `transcript_source` | `asr` |
| Human review | `transcript_final` | Admin-corrected text |
| | `transcript_source` | `human_verified` |

**Rule from README:** Never display `transcript_provisional` as authoritative in the admin UI.

### 6.4 Worker Task Chain

```python
from celery import chain

def process_confirmed_clip(clip_id: str):
    workflow = chain(
        transcode_task.si(clip_id),
        qc_check_task.si(clip_id),
        asr_transcribe_task.si(clip_id),
    )
    workflow.apply_async()
```

Each step is independently retriable. If QC rejects, the chain stops (ASR is not run on rejected clips).

### 6.5 Worker Idempotency

- Task ID = `f"{task_name}-{clip_id}"` (deterministic)
- Before processing, check `clip.status` and `speaker.withdrawn_at`
- Transcode overwrites WAV if re-run
- QC flags overwrite on re-run
- ASR transcript overwrites on re-run

### 6.6 Corrupted File Handling

- FFmpeg returns non-zero exit code → clip.status = `rejected`, qc_flags = `['corrupt']`
- Zero-byte files detected before FFmpeg → same handling
- Incomplete uploads (truncated files) → FFmpeg will fail → same handling

---

## 7. Audio State Glossary

| Term | Definition | Storage location |
|------|-----------|-----------------|
| **Local recording** | Blob in browser memory, not yet persisted | JavaScript heap |
| **Persisted recording** | Blob in IndexedDB, durable | Browser IndexedDB |
| **Raw recording** | Original WebM/MP4 in object storage | `raw/<domain>/<speaker>/<clip_id>.<ext>` |
| **Confirmed clip** | Recording accepted by speaker via Keep | PostgreSQL `clips.status = 'confirmed'` |
| **Processed audio** | 16kHz mono WAV, transcoded by worker | `wav/<domain>/<speaker>/<filename>.wav` |
| **QC result** | Duration, clipping, silence, SNR checks | PostgreSQL `clips.qc_flags` |
| **ASR transcript** | Machine-generated transcript | PostgreSQL `clips.transcript_final` |
| **Human-verified transcript** | Admin-corrected transcript | PostgreSQL `clips.transcript_final` + `source = 'human_verified'` |
| **Discarded recording** | Redo'd clip — raw object deleted | PostgreSQL `clips.status = 'discarded'` |

---

## 8. Dataset Export

### 8.1 Manifest Format

```jsonl
{"filename":"bnk_SPK0042_block_card_v2_s2e1_9f3a1c.wav","wav_path":"wav/BNK/SPK_0042/bnk_SPK0042_block_card_v2_s2e1_9f3a1c.wav","domain":"BNK","intent":"BNK.block_card","scenario_id":"BNK.block_card.v2.s1","speaker_id":"SPK_0042","age_band":"18-25","gender":"female","l1":"Hindi","region":"Bihar","transcript":"Mera card kho gaya hai","transcript_source":"human_verified","prompted":false,"duration_s":2.4,"split":"train"}
```

**Critical:** `age` column is **never** in the export. Only `age_band`. This is a schema-level guarantee (§6 of README).

### 8.2 Speaker-Disjoint Splitting

```python
def compute_splits(speakers: list[str], ratios=(0.8, 0.1, 0.1)):
    """Assign speakers (not clips) to train/dev/test splits."""
    random.shuffle(speakers)
    n = len(speakers)
    train_end = int(n * ratios[0])
    dev_end = train_end + int(n * ratios[1])
    return {
        s: 'train' if i < train_end
           else 'dev' if i < dev_end
           else 'test'
        for i, s in enumerate(speakers)
    }
```

**Rule:** Splitting happens at the **speaker level**. All clips from one speaker go to the same split. This is the only way to ensure speaker-disjoint evaluation.
