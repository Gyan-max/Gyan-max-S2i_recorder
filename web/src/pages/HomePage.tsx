import { useState, useEffect, useRef } from 'react';
import { Mic, RotateCcw, Check, Users, RefreshCw, Headphones, Lock, WifiOff, CheckCircle } from 'lucide-react';
import { SpeakerResponse, SpeakerRosterItem, SessionBatchInfo, TaskResponse } from '../types';
import { saveAudioBlob, enqueueUpload, getUploadQueue, dequeueUpload } from '../db';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface HomePageProps {
  deviceId: string;
  currentSpeaker: SpeakerResponse | null;
  setCurrentSpeaker: (speaker: SpeakerResponse | null) => void;
  speakerRoster: SpeakerRosterItem[];
  fetchSpeakerRoster: (deviceId: string) => void;
  isOnline: boolean;
}

export default function HomePage({
  deviceId,
  currentSpeaker,
  setCurrentSpeaker,
  speakerRoster,
  fetchSpeakerRoster,
  isOnline
}: HomePageProps) {
  
  const [showOnboarding, setShowOnboarding] = useState(!currentSpeaker);
  const [showSpeakerConfirm, setShowSpeakerConfirm] = useState(!!currentSpeaker);
  const [showSpeakerRoster, setShowSpeakerRoster] = useState(false);
  
  // Domain & Session State
  const [selectedDomain, setSelectedDomain] = useState<string>('BNK');
  const [sessionBatch, setSessionBatch] = useState<SessionBatchInfo | null>(null);
  const [currentTaskIndex, setCurrentTaskIndex] = useState<number>(0);
  
  // Recording State
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'reviewing' | 'uploading'>('idle');
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [transcriptEdit, setTranscriptEdit] = useState<string>('');
  const [isPrompted, setIsPrompted] = useState<boolean>(false);
  const [hasListened, setHasListened] = useState(false);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const [recordingError, setRecordingError] = useState<string>('');
  
  // Action Loading States
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRedoing, setIsRedoing] = useState(false);
  
  // Onboarding Form
  const [age, setAge] = useState<number>(25);
  const [gender, setGender] = useState<string>('male');
  const [l1, setL1] = useState<string>('Hindi');
  const [region, setRegion] = useState<string>('Delhi');
  
  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const playbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStartTimeRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const furthestPlaybackRef = useRef(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Ask the browser to retain locally saved recordings when storage persistence is available.
  useEffect(() => {
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => undefined);
    }
  }, []);

  // Mobile browsers can suspend or revoke microphone access when the app is backgrounded.
  // Stop cleanly so the volunteer returns to a playable review state instead of a stuck recorder.
  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.hidden && mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => document.removeEventListener('visibilitychange', stopWhenHidden);
  }, []);

  // Sync offline queue when coming online
  useEffect(() => {
    if (!isOnline) return;
    processUploadQueue();
  }, [isOnline]);

  const processUploadQueue = async () => {
    try {
      const queue = await getUploadQueue();
      for (const item of queue) {
        try {
          const formData = new FormData();
          formData.append('file', item.blob, 'audio_record');
          const res = await fetch(`${API_BASE}/clips/upload?clip_id=${item.clipId}`, {
            method: 'POST',
            headers: { 'X-Device-ID': item.deviceId },
            body: formData
          });
          if (res.ok) {
            await dequeueUpload(item.clipId);
          }
        } catch (e) {
          console.error('Queued upload failed for', item.clipId, e);
        }
      }
    } catch (e) {
      console.error('Failed to process upload queue', e);
    }
  };

  useEffect(() => {
    if (currentSpeaker && !showSpeakerConfirm && !showOnboarding) {
      if (recordingState !== 'idle') {
        resetAudioState();
      }
      fetchSessionBatch(selectedDomain);
    }
  }, [currentSpeaker, selectedDomain, showSpeakerConfirm, showOnboarding]);

  useEffect(() => {
    if (recordingState === 'recording') {
      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 0.1);
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (recordingState === 'idle') setRecordingDuration(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [recordingState]);

  const handleAuthError = (status: number) => {
    if (status === 401 || status === 403) {
      setCurrentSpeaker(null);
      localStorage.removeItem('active_speaker');
      setShowOnboarding(true);
      setShowSpeakerConfirm(false);
      setSessionBatch(null);
      setRecordingState('idle');
      return true;
    }
    return false;
  };

  const fetchSessionBatch = async (domain: string) => {
    if (!currentSpeaker) return;
    try {
      const res = await fetch(`${API_BASE}/session/next?domain=${domain}`, {
        headers: {
          'X-Device-ID': deviceId,
          'Authorization': `Bearer ${currentSpeaker.token}`
        }
      });
      if (handleAuthError(res.status)) return;
      if (res.ok) {
        const data = await res.json();
        setSessionBatch(data.batch);
        const pendingIndex = data.batch.tasks.findIndex((t: TaskResponse) => t.status === 'pending');
        setCurrentTaskIndex(pendingIndex >= 0 ? pendingIndex : 0);
      }
    } catch (e) {
      console.error('Failed to load session batch', e);
    }
  };

  const switchToSpeaker = (speaker: SpeakerRosterItem) => {
    const speakerResponse: SpeakerResponse = {
      speaker_id: speaker.speaker_id,
      token: currentSpeaker?.token || '',
      age_band: speaker.age_band,
      consent_at: new Date().toISOString()
    };
    setCurrentSpeaker(speakerResponse);
    localStorage.setItem('active_speaker', JSON.stringify(speakerResponse));
    setShowSpeakerConfirm(false);
    setShowSpeakerRoster(false);
    setSessionBatch(null);
  };

  const handleOnboardingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/speakers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId
        },
        body: JSON.stringify({
          age, gender, l1, region,
          consent_version: 'consent-v1'
        })
      });
      if (handleAuthError(res.status)) return;
      if (res.ok) {
        const speaker: SpeakerResponse = await res.json();
        setCurrentSpeaker(speaker);
        localStorage.setItem('active_speaker', JSON.stringify(speaker));
        setShowOnboarding(false);
        setShowSpeakerConfirm(false);
        fetchSpeakerRoster(deviceId);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.detail?.message || 'Speaker registration failed');
      }
    } catch (err) {
      console.error(err);
      alert('Error connecting to backend.');
    }
  };

  const handleRecordToggle = async () => {
    if (recordingState === 'recording') {
      handleRecordStop();
    } else if (recordingState === 'idle') {
      await handleRecordStart();
    }
  };

  const handleRecordStart = async () => {
    if (!currentSpeaker) return;
    setRecordingError('');
    setNotice('');
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      setRecordingError('Recording requires a secure HTTPS connection. Please open the official secure link and try again.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setRecordingError('This browser does not support audio recording. Please use a current version of Chrome, Safari, or Firefox.');
      return;
    }
    audioChunksRef.current = [];
    setAudioUrl(null);

    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/mp4;codecs=aac';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/mp4';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/ogg;codecs=opus';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
              mimeType = '';
            }
          }
        }
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 16000,
          channelCount: 1
        }
      });
      mediaStreamRef.current = stream;

      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        if (!isMountedRef.current) return;
        
        const actualDuration = recordingStartTimeRef.current 
          ? (Date.now() - recordingStartTimeRef.current) / 1000 
          : recordingDuration;
        
        if (actualDuration < 0.4) {
          setRecordingError('That recording was too short. Please record for at least one second and try again.');
          setRecordingState('idle');
          audioChunksRef.current = [];
          recordingStartTimeRef.current = null;
          return;
        }

        const actualMimeType = mediaRecorderRef.current?.mimeType || mimeType || 'audio/webm';
        const finalBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
        
        const url = URL.createObjectURL(finalBlob);
        
        setAudioUrl(url);
        setRecordingState('reviewing');
        setHasListened(false);
        setIsPlayingBack(false);
        furthestPlaybackRef.current = 0;
        recordingStartTimeRef.current = null;
        
        playbackTimerRef.current = setTimeout(() => {
          if (audioPlayerRef.current && isMountedRef.current) {
            audioPlayerRef.current.load();
            audioPlayerRef.current.play().catch((err) => {
              console.log('Auto playback interrupted:', err);
            });
          }
        }, 200);

        if (isOnline) {
          initializeClipOnBackend(finalBlob, actualMimeType);
        } else {
          const localClipId = crypto.randomUUID();
          setActiveClipId(localClipId);
          await saveAudioBlob(localClipId, finalBlob);
          setNotice('Saved on this device. It will remain available while you are offline.');
        }
      };

      recordingStartTimeRef.current = Date.now();
      setRecordingDuration(0);
      setRecordingState('recording');
      recorder.start();
    } catch (err) {
      console.error('Mic access error:', err);
      const name = err instanceof DOMException ? err.name : '';
      setRecordingError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access is needed to record your response. Allow microphone access in your browser settings, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone was found on this device. Connect or enable a microphone, then try again.'
            : 'We couldn’t start the recording. Please try again.'
      );
    }
  };

  const handleRecordStop = () => {
    if (mediaRecorderRef.current && recordingState === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const initializeClipOnBackend = async (blob: Blob, mimeType: string) => {
    if (!currentSpeaker || !sessionBatch) return;
    const task = sessionBatch.tasks[currentTaskIndex];
    if (task.status !== 'pending') {
      console.warn('Task already recorded, advancing to next pending task');
      advanceTask();
      setRecordingState('idle');
      return;
    }
    setRecordingState('uploading');
    try {
      const res = await fetch(`${API_BASE}/clips/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId,
          'Authorization': `Bearer ${currentSpeaker.token}`
        },
        body: JSON.stringify({
          task_id: task.task_id,
          mime_type: mimeType
        })
      });
      if (handleAuthError(res.status)) return;
      if (res.ok) {
        const data = await res.json();
        setActiveClipId(data.clip_id);
        uploadAudioBlob(data.clip_id, blob, mimeType);
      } else if (res.status === 409) {
        console.warn('Task already recorded on server, skipping');
        advanceTask();
        setRecordingState('idle');
      } else {
        setRecordingState('reviewing');
      }
    } catch (e) {
      console.error(e);
      setRecordingState('reviewing');
    }
  };

  const uploadAudioBlob = async (clipId: string, blob: Blob, mimeType: string) => {
    try {
      const formData = new FormData();
      formData.append('file', blob, 'audio_record');
      
      const res = await fetch(`${API_BASE}/clips/upload?clip_id=${clipId}`, {
        method: 'POST',
        headers: { 'X-Device-ID': deviceId },
        body: formData
      });
      if (handleAuthError(res.status)) return;
      if (res.ok) {
        setRecordingState('reviewing');
      } else {
        throw new Error('Upload failed');
      }
    } catch (e) {
      console.error('Upload failed. Saving to offline queue...', e);
      if (currentSpeaker) {
        await saveAudioBlob(clipId, blob);
        await enqueueUpload({
          clipId, blob, mimeType,
          token: currentSpeaker.token,
          deviceId
        });
      }
      setRecordingState('reviewing');
    }
  };

  const handleConfirmKeep = async () => {
    if (!currentSpeaker || !sessionBatch || !activeClipId || isConfirming) return;
    setIsConfirming(true);
    
    if (!isOnline) {
      const updatedTasks = [...sessionBatch.tasks];
      updatedTasks[currentTaskIndex].status = 'recorded';
      setSessionBatch({ ...sessionBatch, tasks: updatedTasks });
      advanceTask();
      resetAudioState();
      setIsConfirming(false);
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE}/clips/${activeClipId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSpeaker.token}`
        },
        body: JSON.stringify({
          transcript_edit: transcriptEdit || undefined,
          prompted: isPrompted
        })
      });
      if (handleAuthError(res.status)) { setIsConfirming(false); return; }
      if (res.ok) {
        const updatedTasks = [...sessionBatch.tasks];
        updatedTasks[currentTaskIndex].status = 'recorded';
        setSessionBatch({ ...sessionBatch, tasks: updatedTasks });
        advanceTask();
        setNotice('Recording saved. Moving to the next task.');
        resetAudioState();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleDiscardRedo = async () => {
    if (!currentSpeaker || !sessionBatch || !activeClipId || isRedoing) return;
    setIsRedoing(true);
    
    if (!isOnline) {
      resetAudioState();
      setIsRedoing(false);
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE}/clips/${activeClipId}/discard`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentSpeaker.token}` }
      });
      if (handleAuthError(res.status)) { setIsRedoing(false); return; }
      if (res.ok) {
        const data = await res.json();
        const updatedTasks = [...sessionBatch.tasks];
        updatedTasks[currentTaskIndex] = data.task;
        setSessionBatch({ ...sessionBatch, tasks: updatedTasks });
        resetAudioState();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsRedoing(false);
    }
  };

  const advanceTask = () => {
    if (!sessionBatch) return;
    const nextPendingIndex = sessionBatch.tasks.findIndex(
      (t, idx) => idx > currentTaskIndex && t.status === 'pending'
    );
    if (nextPendingIndex >= 0) {
      setCurrentTaskIndex(nextPendingIndex);
    } else {
      const firstPending = sessionBatch.tasks.findIndex(t => t.status === 'pending');
      if (firstPending >= 0) {
        setCurrentTaskIndex(firstPending);
      } else {
        alert('Batch completed! Fetching next batch...');
        fetchSessionBatch(selectedDomain);
      }
    }
  };

  const resetAudioState = () => {
    if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setActiveClipId(null);
    setTranscriptEdit('');
    setIsPrompted(false);
    setHasListened(false);
    setIsPlayingBack(false);
    furthestPlaybackRef.current = 0;
    setRecordingState('idle');
    recordingStartTimeRef.current = null;
  };

  const activeTask: TaskResponse | undefined = sessionBatch?.tasks[currentTaskIndex];

  // If showing speaker roster for switching
  if (showSpeakerRoster && speakerRoster.length > 0) {
    return (
      <div className="page-container">
        <div className="content-wrapper">
          <div className="card card-lg">
            <div className="card-header">
              <h2>Switch Profile</h2>
              <p>Select a speaker profile to record as</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {speakerRoster.map(s => (
                <button
                  key={s.speaker_id}
                  className="btn btn-secondary"
                  style={{ width: '100%', justifyContent: 'flex-start', gap: '8px' }}
                  onClick={() => switchToSpeaker(s)}
                >
                  <Users size={18} />
                  <span>{s.speaker_id}</span>
                  <span style={{ opacity: 0.6, fontSize: '0.85rem' }}>
                    ({s.gender}, {s.age_band})
                  </span>
                </button>
              ))}
            </div>
            <div style={{ marginTop: '16px' }}>
              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={() => { setShowSpeakerRoster(false); setShowOnboarding(true); }}
              >
                Register New Speaker
              </button>
            </div>
            <button
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: '8px' }}
              onClick={() => setShowSpeakerRoster(false)}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If showing onboarding
  if (showOnboarding) {
    return (
      <main className="page-container onboarding-page">
        <div className="content-wrapper onboarding-wrapper">
          <div className="card card-lg onboarding-card">
            <div className="card-header onboarding-header">
              <span className="eyebrow">Welcome</span>
              <h1>Help improve Hinglish speech technology</h1>
              <p>Before you begin, tell us a little about your voice. Your recordings are associated with an anonymous participant ID, not your name.</p>
            </div>
            <form onSubmit={handleOnboardingSubmit} className="form">
              <div className="form-section-heading">
                <h2>About you</h2>
                <p>This helps researchers understand coverage across different speakers.</p>
              </div>
              <div className="form-group">
                <label className="form-label">Age</label>
                <input 
                  type="number" 
                  className="form-input" 
                  min="10" max="100" 
                  value={age}
                  onChange={(e) => setAge(parseInt(e.target.value))}
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Gender</label>
                <select className="form-select" value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_say">Prefer not to say</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Native Language (L1)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={l1}
                  onChange={(e) => setL1(e.target.value)}
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Home State / Region</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  required 
                />
              </div>
              <div className="consent-box">
                <h4>How your recordings will be used</h4>
                <p>I agree to contribute my anonymous voice recordings for researchers training speech recognition models. I understand no personal names or contact information is associated with my voice clips. I can request dataset deletion at any time via my Speaker ID.</p>
                <label className="consent-check">
                  <input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} />
                  <span>I understand and agree to participate.</span>
                </label>
              </div>
              <button type="submit" className="btn btn-primary btn-lg" disabled={!consentAccepted}>
                Continue to recording
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  // If showing speaker confirmation
  if (showSpeakerConfirm && currentSpeaker) {
    return (
      <main className="page-container onboarding-page">
        <div className="content-wrapper onboarding-wrapper">
          <div className="card card-center identity-card">
            <Users size={48} className="icon-accent" />
            <span className="eyebrow">Welcome back</span>
            <h1>Are you ready to continue?</h1>
            <p>Confirm that you are recording with the same participant profile as your previous session.</p>
            <div className="button-group">
              <button className="btn btn-primary" onClick={() => setShowSpeakerConfirm(false)}>
                Yes, continue
              </button>
              <button className="btn btn-secondary" onClick={() => setShowSpeakerRoster(true)}>
                Choose another profile
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Main recording interface
  return (
    <main className="page-container volunteer-page">
      <div className="content-wrapper">
        <header className="volunteer-hero">
          <div>
            <span className="eyebrow">Hinglish speech study</span>
            <h1>Record a short response</h1>
            <p>Follow one prompt at a time. You can listen before choosing whether to keep each recording.</p>
          </div>
          <span className={`connection-status ${isOnline ? 'online' : 'offline'}`} role="status">
            <span aria-hidden="true" />
            {isOnline ? 'Ready to sync' : 'Offline mode'}
          </span>
        </header>

        {notice && <div className="volunteer-notice" role="status"><CheckCircle size={18} />{notice}</div>}

        {!isOnline && (
          <div className="offline-note" role="status">
            <WifiOff size={18} />
            <span><strong>You’re offline.</strong> Recordings will remain safely stored on this device.</span>
          </div>
        )}

        {/* Domain Selector */}
        <div className="card domain-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Choose a topic</span>
              <h2>Pick the type of situation you’d like to speak about.</h2>
            </div>
          </div>
          <div className="domain-selector">
            {['BNK', 'EDU', 'TRV', 'VAS'].map(dom => (
              <button
                key={dom}
                className={`domain-btn ${selectedDomain === dom ? 'active' : ''}`}
                onClick={() => setSelectedDomain(dom)}
              >
                {dom === 'BNK' ? '🏦 Banking' : 
                 dom === 'EDU' ? '🎓 Education' : 
                 dom === 'TRV' ? '✈️ Travel' : '🎙️ Assistant'}
              </button>
            ))}
          </div>
        </div>

        {/* Progress */}
        {sessionBatch && (
          <section className="card task-progress" aria-label="Task progress">
            <div className="progress-info">
              <span>Task {currentTaskIndex + 1} of {sessionBatch.tasks.length}</span>
              <span>{sessionBatch.progress.intents_done} of {sessionBatch.progress.intents_total} sections complete</span>
            </div>
            <div className="progress-diamonds">
              {sessionBatch.tasks.map((task, idx) => {
                let statusClass = 'pending';
                if (task.status === 'recorded') statusClass = 'recorded';
                else if (idx === currentTaskIndex) statusClass = 'active';
                
                return (
                  <div 
                    key={task.task_id} 
                    className={`progress-diamond ${statusClass}`}
                    onClick={() => task.status === 'pending' && setCurrentTaskIndex(idx)}
                    role="button"
                    tabIndex={task.status === 'pending' ? 0 : -1}
                    aria-label={`Prompt ${idx + 1}: ${task.status}`}
                    onKeyDown={(event) => {
                      if (task.status === 'pending' && (event.key === 'Enter' || event.key === ' ')) setCurrentTaskIndex(idx);
                    }}
                    title={`Scenario ${task.scenario_no}`}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Recording Task */}
        {activeTask && (
          <section className="card card-lg recording-card" aria-labelledby="task-title">
            <div className="task-header">
              <div className="task-meta">
                <span className="task-badge">Scenario</span>
                <span>Task {currentTaskIndex + 1} of {sessionBatch?.tasks.length}</span>
              </div>
              <p className="scenario-name">{activeTask.intent.replace(/^[A-Z]+\./, '').replace(/_/g, ' ')}</p>
              <span className="prompt-label">Your task</span>
              <h1 id="task-title">{activeTask.text_hi}</h1>
              {activeTask.register && (
                <p className="task-register">🎭 Tone: <strong>{activeTask.register}</strong></p>
              )}
            </div>

            {(recordingState === 'idle' || recordingState === 'recording') ? (
              <div className="record-section">
                <p className="record-hint">
                  {recordingState === 'recording' 
                    ? 'Recording in progress. Select stop when you are finished.' 
                    : 'Ready when you are. Start recording when you’re comfortable.'}
                </p>
                {recordingError && <div className="recording-error" role="alert">{recordingError}</div>}
                
                <button 
                  className={`record-btn ${recordingState === 'recording' ? 'recording' : ''}`}
                  onClick={handleRecordToggle}
                  aria-label={recordingState === 'recording' ? 'Stop recording' : 'Start recording'}
                >
                  <Mic size={26} />
                  <span>{recordingState === 'recording' ? 'Stop recording' : 'Start recording'}</span>
                </button>

                {recordingState === 'recording' && (
                  <p className="record-duration">{recordingDuration.toFixed(1)}s</p>
                )}
              </div>
            ) : (
              <div className="review-section" aria-live="polite">
                <div className="audio-player-box">
                  <div className="review-heading">
                    <div>
                      <span className="eyebrow">Recording ready</span>
                      <h2>Listen to your recording</h2>
                    </div>
                    {hasListened ? <span className="review-status complete"><CheckCircle size={16} />Reviewed</span> : <span className="review-status"><Headphones size={16} />Listen required</span>}
                  </div>
                  <audio
                    ref={audioPlayerRef}
                    src={audioUrl || ''}
                    controls
                    onPlay={() => setIsPlayingBack(true)}
                    onPause={() => setIsPlayingBack(false)}
                    onTimeUpdate={(event) => {
                      furthestPlaybackRef.current = Math.max(furthestPlaybackRef.current, event.currentTarget.currentTime);
                    }}
                    onSeeking={(event) => {
                      if (!hasListened && event.currentTarget.currentTime > furthestPlaybackRef.current + 0.75) {
                        event.currentTarget.currentTime = furthestPlaybackRef.current;
                      }
                    }}
                    onEnded={() => { setIsPlayingBack(false); setHasListened(true); }}
                  />
                  <p className="listen-guidance">
                    {hasListened ? 'Recording reviewed. You can keep it or record another attempt.' : isPlayingBack ? 'Listening… keep will unlock when playback finishes.' : 'Please listen to the full recording before keeping it.'}
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">Type what you said (optional):</label>
                  <textarea
                    className="form-input"
                    placeholder={`Examples: "${activeTask.examples[0]}"`}
                    value={transcriptEdit}
                    onChange={(e) => setTranscriptEdit(e.target.value)}
                  />
                </div>

                <div className="button-group review-actions">
                  <button className="btn btn-secondary" onClick={handleDiscardRedo} disabled={isRedoing || isConfirming}>
                    {isRedoing ? <RefreshCw size={18} className="animate-spin" /> : <RotateCcw size={18} />} Record again
                  </button>
                  <button className="btn btn-primary" onClick={handleConfirmKeep} disabled={isConfirming || isRedoing || !hasListened} title={!hasListened ? 'Listen to the full recording before keeping it.' : undefined}>
                    {isConfirming ? <RefreshCw size={18} className="animate-spin" /> : hasListened ? <Check size={18} /> : <Lock size={18} />} {isConfirming ? 'Saving…' : 'Keep recording'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
        {!sessionBatch && !showOnboarding && !showSpeakerConfirm && (
          <div className="card loading-task" role="status">Loading your next recording task…</div>
        )}
      </div>
    </main>
  );
}
