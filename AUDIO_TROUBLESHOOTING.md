# Audio Recording & Playback Troubleshooting Guide

## ✅ What Should Happen

When you hold down the record button and speak:
1. **Recording starts** - Timer counts up, mic button turns red
2. **Release button** - Recording stops
3. **Audio plays back automatically** - You hear what you just said
4. **Confirm or Redo** - Buttons appear to keep or redo the recording

## 🐛 Common Issues & Fixes

### Issue 1: No Audio Playback After Recording

**Symptoms:**
- Recording works (timer counts)
- But you hear nothing when it plays back
- Audio player shows but no sound

**Fixes:**

#### Fix A: Check Browser Console
Open browser console (F12 or Ctrl+Shift+I) and look for errors:

```javascript
// Should see this when recording completes:
Recording complete: { duration: "2.50s", blobSize: "45.2KB", mimeType: "audio/webm;codecs=opus" }
```

#### Fix B: Check Browser Compatibility
```javascript
// Test in browser console:
console.log(MediaRecorder.isTypeSupported('audio/webm;codecs=opus'));
// Should return: true
```

**If false**, try:
- Chrome/Edge: Should work with webm/opus
- Firefox: Should work with webm/opus  
- Safari: Uses mp4/aac (automatically detected)

#### Fix C: Check Microphone Permissions
1. Click the 🔒 icon in address bar
2. Ensure microphone is allowed
3. Refresh the page
4. Try recording again

#### Fix D: Test With Simple Audio
Open browser console and paste:

```javascript
// Test 1: Check if getUserMedia works
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.log('✅ Microphone access works!');
    stream.getTracks().forEach(t => t.stop());
  })
  .catch(err => console.log('❌ Microphone error:', err));

// Test 2: Check MediaRecorder
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
      console.log('✅ Test recording playback!');
    };
    recorder.start();
    setTimeout(() => {
      recorder.stop();
      stream.getTracks().forEach(t => t.stop());
    }, 2000);
  });
```

### Issue 2: Recording Doesn't Start

**Symptoms:**
- Click/hold button but nothing happens
- No timer, no red button

**Fixes:**

#### Fix A: HTTPS Required
```
❌ http://localhost:5173  - May not work
✅ https://localhost:5173 - Works
✅ http://localhost:5173  - Works (localhost exception)
✅ http://127.0.0.1:5173  - Works (localhost exception)
```

**Solution**: Use localhost or enable HTTPS

#### Fix B: Check Browser Console for Errors
Common errors:
- `NotAllowedError`: Microphone permission denied
- `NotFoundError`: No microphone found
- `NotSupportedError`: MediaRecorder not supported

### Issue 3: Audio is Silent/Very Quiet

**Symptoms:**
- Recording works
- Playback works
- But audio is too quiet or silent

**Fixes:**

#### Fix A: Check System Microphone Level
1. **Windows**: Settings → Sound → Input → Device properties → Test
2. **Mac**: System Preferences → Sound → Input → Check input level
3. **Linux**: Settings → Sound → Input → Test microphone

#### Fix B: Check Browser Microphone Settings
Some browsers allow per-site microphone settings

#### Fix C: Speak Louder/Closer to Mic
The app disables automatic gain control to preserve audio quality, so:
- Speak clearly
- Hold phone/laptop close
- Check microphone isn't blocked

### Issue 4: Browser Says "Microphone Already in Use"

**Symptoms:**
- Error about microphone being used by another app
- Can't start recording

**Fixes:**

#### Fix A: Close Other Apps Using Microphone
- Zoom, Teams, Discord
- Other browser tabs
- Voice recording apps

#### Fix B: Reload the Page
Sometimes the mic stream doesn't release properly:
1. Close the browser tab
2. Open a new tab
3. Go to http://localhost:5173 again

### Issue 5: Recording Cuts Off/Doesn't Upload

**Symptoms:**
- Recording works
- Playback works
- But "Keep" button doesn't do anything

**Fixes:**

#### Fix A: Check API Connection
Open: http://localhost:8000/api/health

Should see: `{"status": "healthy"}`

If not:
```bash
# Restart API server
cd /home/gyan-max/Desktop/S2i_recorder/api
source .venv/bin/activate
uvicorn app.main:app --reload
```

#### Fix B: Check Browser Console
Look for CORS errors or 404s

#### Fix C: Check Network Tab
1. Open DevTools (F12)
2. Go to Network tab
3. Record a clip
4. Click "Keep"
5. Look for `/api/clips/` requests - should be 200 OK

## 🧪 Testing Recording & Playback Step-by-Step

### Step 1: Verify Microphone Access
```bash
# Should see mic permission prompt first time
# Click "Allow"
```

### Step 2: Test Recording
1. Hold red mic button
2. Say "Testing one two three"
3. Release button
4. **You should immediately hear your voice**

### Step 3: Verify Audio Element
After recording, check browser console:
```javascript
// Should see these in order:
Recording complete: { duration: "X.XXs", blobSize: "XX.XKB", ... }
// No errors about autoplay or audio loading
```

### Step 4: Manual Playback Test
If auto-playback fails, you can still click the play button on the audio player controls.

## 🔍 Debugging Commands

### Check if Recording is Working:
```javascript
// In browser console while on the page:
console.log('Audio chunks:', window.audioChunksRef);
console.log('Audio URL:', window.audioUrl);
console.log('Recording state:', window.recordingState);
```

### Check MediaRecorder Support:
```javascript
// Try different MIME types:
['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/wav'].forEach(mime => {
  console.log(mime, MediaRecorder.isTypeSupported(mime));
});
```

### Force Playback:
```javascript
// If autoplay failed, force it:
const audio = document.querySelector('audio');
if (audio) {
  audio.load();
  audio.play().then(() => console.log('Playing!')).catch(e => console.error(e));
}
```

## 📝 Expected Behavior Timeline

```
[0.0s] User presses/holds button
       → State: idle → recording
       → Timer starts
       → Mic stream opens

[2.5s] User releases button  
       → State: recording → uploading
       → MediaRecorder.stop() called
       → Audio chunks combined into Blob

[2.6s] Blob created
       → State: uploading → reviewing
       → URL.createObjectURL() called
       → audioPlayerRef updated

[2.8s] Auto-playback starts
       → audio.load() called
       → audio.play() called
       → You hear your recording

[5.0s] User clicks "Keep" or "Redo"
       → State: reviewing → idle (or uploading)
       → Next task loaded
```

## ✅ Verification Checklist

- [ ] Browser console shows "Recording complete" message
- [ ] Blob size is > 0 KB (not empty)
- [ ] MIME type is valid (webm, mp4, or ogg)
- [ ] Audio element src is set (blob:http://...)
- [ ] No autoplay errors in console
- [ ] Audio controls are visible
- [ ] Can manually click play if autoplay failed
- [ ] API server is running (http://localhost:8000/api/health)
- [ ] No CORS errors in console

## 🚀 Quick Test Script

Save this as `test_audio.html` and open in browser:

```html
<!DOCTYPE html>
<html>
<head><title>Audio Test</title></head>
<body>
  <button id="record">Hold to Record</button>
  <audio id="playback" controls></audio>
  <div id="status"></div>
  
  <script>
    let recorder, chunks = [];
    const btn = document.getElementById('record');
    const audio = document.getElementById('playback');
    const status = document.getElementById('status');
    
    btn.onmousedown = async () => {
      chunks = [];
      status.innerText = 'Recording...';
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        audio.src = url;
        audio.load();
        audio.play();
        status.innerText = `Done! Size: ${(blob.size/1024).toFixed(1)}KB`;
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
    };
    
    btn.onmouseup = () => {
      if (recorder && recorder.state === 'recording') {
        recorder.stop();
      }
    };
  </script>
</body>
</html>
```

If this simple test works, the issue is in the React app. If it doesn't work, the issue is browser/system configuration.

## 📞 Still Not Working?

1. **Check browser**: Chrome 60+, Firefox 55+, Safari 14.3+
2. **Try different browser**: Test in Chrome, Firefox, or Edge
3. **Check system audio**: Make sure speakers/headphones work
4. **Try incognito mode**: Rules out extension conflicts
5. **Check API logs**: Look for errors when saving clips

## 🎯 Most Common Solution

9 out of 10 times, the issue is one of these:
1. ❌ Microphone permission not granted → Allow in browser
2. ❌ Using HTTP instead of localhost → Use http://localhost:5173
3. ❌ API server not running → Start with `uvicorn app.main:app --reload`
4. ❌ Browser doesn't support MediaRecorder → Update browser

**The recording and playback code is working correctly**. The issue is almost always one of the above!
