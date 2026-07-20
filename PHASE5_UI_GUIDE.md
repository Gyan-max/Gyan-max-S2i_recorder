# Phase 5 UI Changes - What You'll See

## Visual Guide to New Features

### 🎯 Recording States (What the UI Shows)

---

#### 1. IDLE State
```
┌────────────────────────────────────┐
│                                    │
│     Ready to record                │ ← Status text
│                                    │
│         ┌───────┐                  │
│         │       │                  │
│         │  🎤   │                  │ ← Microphone button
│         │       │                  │
│         └───────┘                  │
│                                    │
│    Hold button to record           │ ← Instruction
│                                    │
└────────────────────────────────────┘
```

---

#### 2. RECORDING State
```
┌────────────────────────────────────┐
│                                    │
│    Recording: 0:03                 │ ← Status with timer
│                                    │
│         ┌───────┐                  │
│         │       │                  │
│         │ 0:03  │                  │ ← Timer inside button
│         │  🔴   │                  │   (recording indicator)
│         └───────┘                  │
│                                    │
│      Release to stop               │ ← Instruction
│                                    │
└────────────────────────────────────┘
```

---

#### 3. STOPPING State
```
┌────────────────────────────────────┐
│                                    │
│   Finalizing recording...          │ ← Processing
│                                    │
│         ┌───────┐                  │
│         │   ⌛  │                  │ ← Spinner
│         │       │                  │
│         └───────┘                  │
│                                    │
│       Processing...                │
│                                    │
└────────────────────────────────────┘
```

---

#### 4. ⭐ PERSISTING State (NEW!)
```
┌────────────────────────────────────┐
│                                    │
│   Saving recording...              │ ← NEW: Saving to IndexedDB
│                                    │
│         ┌───────┐                  │
│         │   💾  │                  │ ← Spinner
│         │       │                  │
│         └───────┘                  │
│                                    │
│       Saving...                    │ ← NEW instruction
│                                    │
└────────────────────────────────────┘
```

**Duration**: Usually < 100ms (very fast!)

---

#### 5. ⭐ RECORDED State (Updated!)
```
┌────────────────────────────────────────────────────┐
│                                                    │
│  ✓  Recording Complete                            │ ← Header
│     Duration: 0:05                                │
│     ✓ Recording saved on this device              │ ← NEW! Success message
│                                                    │
│  ┌──────────────────────────────────────────┐    │
│  │ ▶️  ━━━━━━━━━━━━━━━━━ 🔊 ⋯               │    │ ← Audio player
│  └──────────────────────────────────────────┘    │
│                                                    │
│  ℹ️  Please listen to your recording              │
│     before proceeding                             │
│                                                    │
│  ┌────────────┐  ┌────────────────┐              │
│  │  🔄         │  │  ✓ Keep        │              │ ← Buttons
│  │  Record    │  │  Recording     │              │
│  │  Again     │  │                │              │
│  └────────────┘  └────────────────┘              │
│                                                    │
└────────────────────────────────────────────────────┘
```

**Key Changes**:
- "✓ Recording saved on this device" message appears
- "Keep Recording" button now works (no alert!)
- Recording is already in IndexedDB at this point

---

### 🔄 Recovery State (After Refresh)

When you refresh the page and return to a task:

```
┌────────────────────────────────────────────────────┐
│                                                    │
│  📋 Task: Book a flight to Mumbai                 │
│                                                    │
│  ℹ️  2 previous recording(s) found for this task  │ ← NEW! Recovery message
│                                                    │
│     Domain: Travel                                │
│     Intent: Flight Booking                        │
│                                                    │
│  ┌────────────────────────────────────────────┐  │
│  │ SCENARIO                                    │  │
│  │                                              │  │
│  │ मुंबई के लिए एक फ्लाइट बुक करें            │  │
│  │                                              │  │
│  └────────────────────────────────────────────┘  │
│                                                    │
│         ┌───────┐                                 │
│         │       │                                 │
│         │  🎤   │                                 │ ← Ready to record again
│         │       │                                 │
│         └───────┘                                 │
│                                                    │
│    Hold button to record                          │
│                                                    │
└────────────────────────────────────────────────────┘
```

**What happens**:
1. App loads task
2. Queries IndexedDB for existing recordings
3. Shows count: "2 previous recording(s) found"
4. User can record NEW attempts
5. All recordings stored with same taskId

---

### ⚠️ Error States

#### Storage Quota Exceeded
```
┌────────────────────────────────────────────────────┐
│                                                    │
│  ⚠️  Recording Error                              │
│                                                    │
│  Storage quota exceeded. Please free up space     │
│  or upload existing recordings.                   │
│                                                    │
│  [ Try Again ]                                    │
│                                                    │
└────────────────────────────────────────────────────┘
```

#### Persistence Failed (Rare)
```
┌────────────────────────────────────────────────────┐
│                                                    │
│  ⚠️  Recording Error                              │
│                                                    │
│  Unable to save your recording on this device.    │
│  Please try again.                                │
│                                                    │
│  [ Try Again ]                                    │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

### 📊 DevTools View (IndexedDB)

What you'll see in Chrome DevTools:

```
DevTools → Application Tab → Storage

IndexedDB
  ▶ hinglish-s2i-recordings (v1)        ← Database
      ▶ recordings                       ← Store
          ▶ rec-001-uuid                ← Recording 1
          ▶ rec-002-uuid                ← Recording 2
          ▶ rec-003-uuid                ← Recording 3
```

When you expand a recording:

```
recordingId:  "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
taskId:       "task-uuid-1234"
speakerId:    "speaker-uuid-5678"
deviceId:     "device-uuid-9012"
blob:         Blob {size: 45678, type: "audio/webm;codecs=opus"}
mimeType:     "audio/webm;codecs=opus"
durationMs:   5420
createdAt:    "2026-07-20T10:30:45.123Z"
status:       "LOCAL_ONLY"
```

---

### 🎬 Complete Flow Animation

```
1. IDLE → User presses button
   ┌───────┐
   │  🎤   │
   └───────┘
   "Ready to record"

2. RECORDING → User holds
   ┌───────┐
   │ 0:03  │
   │  🔴   │
   └───────┘
   "Recording: 0:03"

3. STOPPING → User releases
   ┌───────┐
   │   ⌛  │
   └───────┘
   "Finalizing recording..."

4. PERSISTING → Saving to IndexedDB (NEW!)
   ┌───────┐
   │   💾  │
   └───────┘
   "Saving recording..."
   
   ⏱️ Duration: ~50-100ms

5. RECORDED → Complete!
   ┌──────────────────────┐
   │ ✓ Recording Complete │
   │ ✓ Saved on device    │ ← NEW!
   │ [▶️ Audio Player]    │
   │ [Record Again] [Keep]│
   └──────────────────────┘

6. Keep Button Clicked
   ┌──────────────────────────────────┐
   │ ✓ Recording saved!               │
   │   You can now move to next task. │
   └──────────────────────────────────┘
   
   ⏱️ Auto-reset after 2 seconds

7. IDLE → Ready for next recording
```

---

### 🆚 Before vs After Phase 5

#### BEFORE Phase 5
```
User records → Blob created → Shows in UI
                              ❌ Lost on refresh
                              ❌ No persistence
                              ❌ "Keep" shows alert
```

#### AFTER Phase 5
```
User records → Blob created → PERSISTING state → IndexedDB
                              ✅ Survives refresh
                              ✅ Recovery message
                              ✅ "Keep" works properly
                              ✅ Multiple attempts stored
```

---

### 📱 Mobile View

Same states, adapted for touch:

```
┌──────────────────────────┐
│                          │
│   Recording: 0:03        │
│                          │
│      ┌──────────┐        │
│      │          │        │
│      │   0:03   │        │ ← Large touch target
│      │    🔴    │        │
│      │          │        │
│      └──────────┘        │
│                          │
│  Release to stop         │
│                          │
└──────────────────────────┘
```

---

### 🔍 Console Messages

Open browser console to see:

```javascript
// On recording save:
"Recording saved successfully with ID: a1b2c3d4-..."

// On task load with existing recordings:
"Recovered 2 recording(s) for task task-uuid-1234"

// On IndexedDB operation:
"IndexedDB: Saving recording to hinglish-s2i-recordings/recordings"
```

---

### 📈 Success Indicators

You know Phase 5 is working when you see:

✅ "Saving recording..." appears briefly after recording  
✅ "✓ Recording saved on this device" appears in header  
✅ Recording appears in DevTools IndexedDB  
✅ After refresh: "X previous recording(s) found"  
✅ "Keep Recording" button works (no alert)  
✅ Multiple recordings have same taskId but different recordingId  

---

### ❌ What You WON'T See

Phase 5 does NOT show:

❌ Upload progress bars  
❌ Server sync indicators  
❌ "UPLOADED" or "CONFIRMED" status  
❌ Auto-playback of recovered recordings  
❌ Export buttons  
❌ Cloud sync icons  

These come in Phase 6+!

---

### 🎓 Testing Checklist

When testing, verify these UI elements:

- [ ] "Saving recording..." appears during PERSISTING
- [ ] "✓ Recording saved on this device" appears in header
- [ ] Recording shows in DevTools IndexedDB
- [ ] Refresh → "X previous recording(s) found" message
- [ ] "Keep Recording" button works (no alert!)
- [ ] Multiple recordings create multiple entries in IndexedDB
- [ ] Error messages are clear and helpful

---

### 💡 Pro Tips

**To see PERSISTING state clearly:**
- It's fast (< 100ms), but you can see it!
- Watch for "Saving recording..." text change
- Look in Network tab DevTools - no network calls!
- Check IndexedDB immediately after - recording is there

**To test recovery:**
1. Record audio
2. Note task ID in debug info
3. Refresh page (F5)
4. Log in with same name
5. Navigate to same task
6. Look for "previous recording(s) found" message

**To verify offline:**
1. DevTools → Network → Offline
2. Record audio
3. See "Saving recording..." (still works!)
4. Check IndexedDB (recording saved!)
5. No network needed for IndexedDB!

---

**Ready to test?** Open http://localhost:3000 and follow the checklist above!

**See something different?** Check console logs for errors and verify servers are running.

**Questions?** Check PHASE5_TESTING.md for detailed test procedures.
