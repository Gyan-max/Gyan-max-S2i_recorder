# Phase 5 Manual Testing Guide

## Quick Test: Verify IndexedDB Persistence Works

### Prerequisites
- API server running on http://localhost:8000
- Web server running on http://localhost:3000
- Chrome/Edge browser (for DevTools IndexedDB inspection)

### Test 1: Basic Recording & Persistence (3 minutes)

1. **Open the app**
   - Navigate to http://localhost:3000
   - Open DevTools (F12)
   - Go to Application tab → IndexedDB

2. **Create a speaker**
   - Enter speaker identifier (e.g., "TestUser1")
   - Select age, gender, L1, region
   - Click "Continue"

3. **Accept consent**
   - Check consent box
   - Click "I Understand and Consent"

4. **Get a task**
   - Click "Start Recording"
   - You'll see a task with Hindi text

5. **Record audio**
   - **Hold** the microphone button
   - Speak for 2-3 seconds
   - **Release** the button
   - Watch for state changes:
     - "Finalizing recording..."
     - "Saving recording..." ← **NEW in Phase 5**
     - Recording Complete with "✓ Recording saved on this device" ← **NEW**

6. **Verify in IndexedDB**
   - In DevTools → Application → IndexedDB
   - Expand "hinglish-s2i-recordings" → "recordings"
   - You should see 1 entry with:
     - `recordingId`: UUID
     - `taskId`: Task UUID
     - `speakerId`: Speaker UUID  
     - `deviceId`: Device UUID
     - `blob`: Blob object (audio data)
     - `mimeType`: "audio/webm" or similar
     - `durationMs`: Duration in milliseconds
     - `createdAt`: ISO timestamp
     - `status`: "LOCAL_ONLY"

✅ **PASS**: If you see the recording in IndexedDB with all fields

### Test 2: Page Refresh Recovery (2 minutes)

1. **While still on the task screen** (after Test 1)
   - Note the current task ID (shown at bottom)
   - Note "✓ Recording saved on this device" message

2. **Refresh the page** (F5 or Ctrl+R)
   - App reloads to welcome screen

3. **Log in again**
   - Use the SAME speaker identifier
   - The app will restore your session
   - Navigate back to tasks

4. **Check for recovery message**
   - When the same task loads, you should see:
     - "1 previous recording(s) found for this task" ← **NEW**
   - Check browser console (F12 → Console)
   - You should see: "Recovered 1 recording(s) for task..."

5. **Verify recording still in IndexedDB**
   - DevTools → Application → IndexedDB → recordings
   - Same recording should still be there

✅ **PASS**: If recovery message appears and recording persists

### Test 3: Multiple Recordings Per Task (2 minutes)

1. **On the same task** (after Test 2)
   - Record another audio clip (hold button, speak, release)
   - Wait for "Recording saved on this device"

2. **Check IndexedDB**
   - You should now see 2 recordings for the same taskId
   - Both have different recordingId values
   - Both have same taskId, speakerId, deviceId

3. **Refresh page again**
   - Log in with same speaker
   - Return to same task
   - Should see: "2 previous recording(s) found for this task"

✅ **PASS**: If both recordings are saved and recovery shows count of 2

### Test 4: Offline Recording (3 minutes)

1. **Open DevTools → Network tab**
   - Switch to "Offline" mode (dropdown at top)

2. **Try to record audio**
   - You'll get an error trying to fetch task (expected)

3. **Go back online**
   - Switch Network back to "Online"

4. **Get a task and record**
   - Switch back to "Offline" in Network tab
   - Record audio (hold button, speak, release)
   - Watch carefully:
     - Recording should complete
     - "Saving recording..." should appear
     - **Recording should still save to IndexedDB even offline**

5. **Verify in IndexedDB**
   - Recording should be present even without network

✅ **PASS**: If recording saves to IndexedDB while offline

### Test 5: Different Speakers, Same Device (3 minutes)

1. **Record as first speaker** (use current session)
   - Record one audio clip
   - Note your speaker ID in DevTools → IndexedDB
   - Note your device ID

2. **Start over / Log out**
   - Click "Start Over" button
   - Or close and reopen app

3. **Create a NEW speaker**
   - Use different identifier (e.g., "TestUser2")
   - Complete consent

4. **Record for any task**
   - Record one audio clip

5. **Check IndexedDB**
   - You should see 2+ recordings
   - They have:
     - ✅ Different `speakerId` values
     - ✅ **Same** `deviceId` value (it's the same browser)
   - This proves speaker_id ≠ device_id separation

✅ **PASS**: If recordings have different speakers but same device

### Test 6: Keep Recording Button (1 minute)

1. **Record audio on any task**

2. **Listen to playback**
   - Audio player should play automatically or click play

3. **Click "Keep Recording" button**
   - Should see: "Recording saved! You can now move to the next task."
   - After 2 seconds, UI should reset
   - Recording is already in IndexedDB (saved earlier)

4. **Previously this showed an alert about Phase 5**
   - Now it works properly

✅ **PASS**: If button shows success message and works

## Expected Issues (Known Limitations)

### 1. Recording NOT Auto-Loaded on Recovery
**Behavior**: When you refresh and return to a task, you see "X recordings found" but don't hear the audio.

**Why**: This is intentional. Loading blobs from IndexedDB and creating object URLs for all recovered recordings would:
- Consume memory
- Slow down task loading
- User might not want to hear old recordings

**Phase 5 Scope**: Just verify recordings survive refresh. Phase 6 will add playback of old recordings.

### 2. No Upload Happening
**Behavior**: Recordings stay as "LOCAL_ONLY" status.

**Why**: Phase 5 deliberately does NOT implement upload. This comes in Phase 6.

**Expected**: All recordings should have `status: "LOCAL_ONLY"`

### 3. "Next Task" Doesn't Check Recording
**Behavior**: You can click "Next Task" without recording.

**Why**: Phase 4 behavior. Phase 5 focused on persistence, not task flow validation.

**Future**: Phase 6+ will add proper task completion flow.

## Debugging Tips

### Can't See IndexedDB?
- Make sure you're in Chrome/Edge (best DevTools support)
- DevTools → Application tab → IndexedDB
- Expand "hinglish-s2i-recordings"
- Click "recordings" store

### Recording Not Saving?
1. Check browser console for errors
2. Check if storage quota exceeded
3. Verify speaker, task, and device IDs are set
4. Try in incognito mode (fresh storage)

### Recovery Not Working?
1. Make sure you're using the SAME speaker identifier
2. Check localStorage has "speaker_token"
3. Verify task_id matches in IndexedDB
4. Check console logs for recovery messages

### State Stuck on "Persisting"?
- Check console for errors
- IndexedDB might have failed
- Try refreshing and recording again

## Success Criteria

Phase 5 is successful if:

1. ✅ Recordings save to IndexedDB after recording
2. ✅ "Saving..." and "Saved" messages appear
3. ✅ Recordings survive page refresh
4. ✅ Recovery message appears when returning to task
5. ✅ Multiple recordings per task are supported
6. ✅ Different speakers on same device have correct IDs
7. ✅ Recordings work offline (no network needed for IndexedDB)
8. ✅ "Keep Recording" button works without alerts

## Performance Benchmarks

Expected timings:
- Recording save to IndexedDB: < 100ms
- Recovery query on task load: < 50ms
- Page refresh with 10 recordings: < 200ms

Anything slower indicates an issue.

## Next: Phase 6 Features

After Phase 5 verification, Phase 6 will add:
- Upload queue
- Server-side storage
- Status transitions (LOCAL_ONLY → UPLOADED → CONFIRMED)
- Background sync
- Retry logic
- Export functionality

---

**Questions?** Check PHASE5_STATUS.md for implementation details.
