# Phase 5: Recording Persistence Flow

## State Machine Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Recording State Machine                       │
└─────────────────────────────────────────────────────────────────┘

User Action           State                    UI Display
════════════         ══════════               ════════════

                     IDLE                     "Ready to record"
                       │                       [Mic Button]
                       │
Press & Hold ────────►│
                       ▼
                 REQUESTING_                  "Requesting mic..."
                  PERMISSION                   [Loading...]
                       │
                       │
Mic Granted ─────────►│
                       ▼
                   RECORDING  ────────────►  "Recording: 0:03"
                       │                      [🔴 Timer]
                       │                      "Release to stop"
Release Button ───────►│
                       ▼
                   STOPPING  ────────────►   "Finalizing..."
                       │                      [Spinner]
                       │
                       │  MediaRecorder.onstop fires
                       │  1. Create Blob
                       │  2. Check duration >= 400ms
                       │  3. Create object URL
                       ▼
                  PERSISTING  ────────────►  "Saving recording..."    ◄── NEW!
                       │                      [Spinner]
                       │
                       │  ┌─────────────────────────────────┐
                       │  │  IndexedDB Persistence          │
                       │  ├─────────────────────────────────┤
                       │  │  1. Generate recordingId (UUID) │
                       │  │  2. Create LocalRecording:      │
                       │  │     - recordingId               │
                       │  │     - taskId                    │
                       │  │     - speakerId                 │
                       │  │     - deviceId                  │
                       │  │     - blob (audio data)         │
                       │  │     - mimeType                  │
                       │  │     - durationMs                │
                       │  │     - createdAt                 │
                       │  │     - status: LOCAL_ONLY        │
                       │  │  3. Call saveRecording()        │
                       │  │  4. Wait for IDB write          │
                       │  └─────────────────────────────────┘
                       │
Success ──────────────►│
                       ▼
                   RECORDED  ─────────────►  "Recording Complete"     ◄── NEW!
                       │                     "✓ Saved on this device"
                       │                     [🎵 Audio Player]
                       │                     [Keep] [Record Again]
                       │
Keep Button ──────────►│
                       │  Show: "Recording saved! You can now
                       │         move to the next task."
                       │  Wait 2 seconds...
                       ▼
                     IDLE  ───────────────► Reset to start


Error Paths:
━━━━━━━━━━━━
REQUESTING_PERMISSION ──► ERROR  (mic denied)
RECORDING ─────────────►  ERROR  (recording fails)
STOPPING ──────────────►  IDLE   (too short, < 400ms)
PERSISTING ────────────►  ERROR  (IndexedDB failure)
```

## Recovery Flow (Page Refresh)

```
┌──────────────────────────────────────────────────────────────┐
│              Recording Recovery on Task Load                  │
└──────────────────────────────────────────────────────────────┘

App Start
   │
   ▼
Load Device ID ──────────► localStorage.getItem('device_id')
   │                        If none: generate & save UUID
   │
   ▼
User Logs In ────────────► Enter speaker identifier
   │                        Backend creates/restores speaker
   │                        Returns: speaker_id, token
   │
   ▼
Task Loaded ─────────────► setCurrentTask(task)
   │
   │  useEffect triggers on currentTask change
   ▼
   ┌────────────────────────────────────────────┐
   │  Recording Recovery Effect                 │
   ├────────────────────────────────────────────┤
   │  if (!currentTask) return;                 │
   │                                             │
   │  recordings = await getRecordingsByTask(   │
   │      currentTask.task_id                   │
   │  );                                         │
   │                                             │
   │  if (recordings.length > 0) {              │
   │    console.log("Recovered X recordings")   │
   │    setPersistenceMessage(                  │
   │      "X previous recordings found..."      │
   │    );                                       │
   │  }                                          │
   └────────────────────────────────────────────┘
   │
   ▼
Display Task ────────────► Show scenario text
   │                        Show "X recordings found" message
   │                        User can record new attempt
   │
   ▼
Record New ──────────────► Same flow as above
                            Creates NEW recording
                            Both persist in IndexedDB
```

## Data Model

```
┌────────────────────────────────────────────────────────────────┐
│                     IndexedDB Schema                            │
└────────────────────────────────────────────────────────────────┘

Database: "hinglish-s2i-recordings"
Version: 1

Store: "recordings"
KeyPath: "recordingId"

Indexes:
  - by-task      (taskId)       → Query all recordings for a task
  - by-speaker   (speakerId)    → Query all recordings by a speaker
  - by-device    (deviceId)     → Query all recordings from a device
  - by-status    (status)       → Query by LOCAL_ONLY/UPLOADED/etc
  - by-created   (createdAt)    → Query by timestamp

Record Structure:
┌─────────────────┬──────────────┬─────────────────────────────────┐
│ Field           │ Type         │ Example                         │
├─────────────────┼──────────────┼─────────────────────────────────┤
│ recordingId     │ string       │ "a1b2c3d4-..."                  │
│ taskId          │ string       │ "task-uuid-..."                 │
│ speakerId       │ string       │ "speaker-uuid-..."              │
│ deviceId        │ string       │ "device-uuid-..."               │
│ blob            │ Blob         │ Blob {size: 45678, type: ...}   │
│ mimeType        │ string       │ "audio/webm;codecs=opus"        │
│ durationMs      │ number       │ 5420                            │
│ createdAt       │ string       │ "2026-07-20T10:30:45.123Z"      │
│ status          │ string       │ "LOCAL_ONLY"                    │
└─────────────────┴──────────────┴─────────────────────────────────┘

Important: speakerId ≠ deviceId
  - Multiple speakers can use the same device
  - Same speaker can use multiple devices
  - Recordings track BOTH
```

## Component Integration

```
┌────────────────────────────────────────────────────────────────┐
│                   Component Architecture                        │
└────────────────────────────────────────────────────────────────┘

Phase3App.tsx
    │
    ├─► State: currentTask, currentSpeaker, deviceId
    │
    ├─► handlePersistRecording(blob, mime, duration, createdAt)
    │   │
    │   └──► Creates LocalRecording object
    │       Calls saveRecording(record)
    │       Returns recordingId
    │
    ├─► useAudioRecorder({ persistToIndexedDB: handlePersistRecording })
    │   │
    │   └──► Custom hook with persistence
    │       Returns: state, recording, actions
    │
    └─► useEffect(() => { ... }, [currentTask])
        │
        └──► Recovery effect
            Queries getRecordingsByTask(taskId)
            Shows persistence message


useAudioRecorder.ts (Hook)
    │
    ├─► Options: { persistToIndexedDB?: Function }
    │
    ├─► State Machine: IDLE → ... → PERSISTING → RECORDED
    │
    └─► MediaRecorder.onstop handler:
        │
        ├─► Create blob from chunks
        │
        ├─► If persistToIndexedDB provided:
        │   │
        │   ├─► setState('PERSISTING')
        │   │
        │   ├─► recordingId = await persistToIndexedDB(...)
        │   │
        │   └─► Set recording.savedToIndexedDB = true
        │
        └─► setState('RECORDED')


recordingDB.ts (Service)
    │
    ├─► openRecordingDB() → Opens/creates IndexedDB
    │
    ├─► saveRecording(record) → IDBPut
    │
    ├─► getRecording(id) → IDBGet
    │
    ├─► getRecordingsByTask(taskId) → IDBIndex query
    │
    ├─► getRecordingsBySpeaker(speakerId) → IDBIndex query
    │
    ├─► getRecordingsByDevice(deviceId) → IDBIndex query
    │
    └─► deleteRecording(id) → IDBDelete
```

## Multi-Recording Scenario

```
┌────────────────────────────────────────────────────────────────┐
│        Multiple Recording Attempts for Same Task               │
└────────────────────────────────────────────────────────────────┘

Task: "Book a flight to Mumbai"
   │
   ▼
Attempt 1 ────────────────►  Recording created
   │                         recordingId: "rec-001"
   │                         taskId: "task-123"
   │                         createdAt: 10:30:00
   │                         ✅ Saved to IndexedDB
   │
User clicks "Record Again"
   │
   ▼
Attempt 2 ────────────────►  Recording created
   │                         recordingId: "rec-002"  ◄── Different!
   │                         taskId: "task-123"      ◄── Same!
   │                         createdAt: 10:32:15
   │                         ✅ Saved to IndexedDB
   │
User clicks "Record Again"
   │
   ▼
Attempt 3 ────────────────►  Recording created
   │                         recordingId: "rec-003"  ◄── Different!
   │                         taskId: "task-123"      ◄── Same!
   │                         createdAt: 10:35:42
   │                         ✅ Saved to IndexedDB
   │
   ▼
IndexedDB State:
┌──────────┬──────────┬───────────────┬─────────────┐
│ recId    │ taskId   │ createdAt     │ status      │
├──────────┼──────────┼───────────────┼─────────────┤
│ rec-001  │ task-123 │ 10:30:00      │ LOCAL_ONLY  │
│ rec-002  │ task-123 │ 10:32:15      │ LOCAL_ONLY  │
│ rec-003  │ task-123 │ 10:35:42      │ LOCAL_ONLY  │
└──────────┴──────────┴───────────────┴─────────────┘

Query: getRecordingsByTask("task-123")
Result: Array of 3 recordings

Future: User/system can decide which to keep/upload
```

## Error Handling

```
┌────────────────────────────────────────────────────────────────┐
│                     Error Scenarios                             │
└────────────────────────────────────────────────────────────────┘

Error: Storage Quota Exceeded
   │
   ├─► Catch: QuotaExceededError
   │
   └─► Show: "Storage quota exceeded. Please free up space
             or upload existing recordings."


Error: IndexedDB Not Supported
   │
   ├─► Catch: At openDB()
   │
   └─► Show: "Your browser doesn't support offline storage.
             Please use a modern browser."


Error: Persistence Failed
   │
   ├─► Recording still completes (blob exists)
   │
   ├─► Show error message
   │
   └─► User can still listen to recording
       (Just not persisted)


Error: Missing Context (speaker/task/device)
   │
   ├─► Throw: "Missing required context for saving"
   │
   └─► This shouldn't happen in normal flow
       Indicates app state issue
```

## Storage Estimates

```
┌────────────────────────────────────────────────────────────────┐
│                  Storage Calculations                           │
└────────────────────────────────────────────────────────────────┘

Typical Recording:
  Duration: 5 seconds
  Format: WebM Opus
  Bitrate: 32 kbps (configured)
  Size: ~20-50 KB per recording

Metadata overhead: ~1 KB per recording

Total per recording: ~21-51 KB

Storage Capacity Examples:
┌─────────────────┬──────────────┬───────────────────┐
│ Storage Limit   │ # Recordings │ Scenarios         │
├─────────────────┼──────────────┼───────────────────┤
│ 50 MB (iOS)     │ ~1000-2400   │ ~100-200 tasks    │
│ 200 MB          │ ~4000-9600   │ ~400-800 tasks    │
│ 1 GB            │ ~20k-48k     │ ~2k-4k tasks      │
│ 10 GB           │ ~200k-480k   │ ~20k-40k tasks    │
└─────────────────┴──────────────┴───────────────────┘

A typical user completing 300 tasks = ~15 MB
Well within browser limits!
```

## Phase 6 Preview

Phase 5: LOCAL_ONLY ✅ (Current)
Phase 6: Upload Flow (Future)

```
LOCAL_ONLY ──upload──► UPLOADING ──success──► UPLOADED
                            │
                            │
                            └──fail──► UPLOAD_FAILED
                                           │
                                           └──retry──► UPLOADING
```

Phase 6 will add:
- Upload queue
- Background sync
- Server confirmation
- Status transitions
- Export functionality
- Conflict resolution

---

**Phase 5 Status**: Complete ✅
**Next**: Manual testing and Phase 6 planning
