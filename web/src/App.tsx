import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, RotateCcw, Check, UserPlus, Users, 
  ShieldAlert, RefreshCw, LogIn, LogOut, Download, Trash2, Globe
} from 'lucide-react';
import { 
  SpeakerResponse, SpeakerRosterItem, 
  TaskResponse, SessionBatchInfo, ClipReviewItem, AdminStatsResponse, AdminCoverageItem
} from './types';
import { saveAudioBlob, deleteAudioBlob, enqueueUpload, getUploadQueue, dequeueUpload } from './db';

const API_BASE = '/api';

export default function App() {
  // Navigation & Auth State
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [adminToken, setAdminToken] = useState<string | null>(localStorage.getItem('admin_token'));
  const [deviceId, setDeviceId] = useState<string>('');
  const [currentSpeaker, setCurrentSpeaker] = useState<SpeakerResponse | null>(null);
  const [speakerRoster, setSpeakerRoster] = useState<SpeakerRosterItem[]>([]);
  const [showSpeakerConfirm, setShowSpeakerConfirm] = useState<boolean>(false);
  const [showSpeakerRoster, setShowSpeakerRoster] = useState<boolean>(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  
  // Volunteer Session State
  const [selectedDomain, setSelectedDomain] = useState<string>('BNK');
  const [sessionBatch, setSessionBatch] = useState<SessionBatchInfo | null>(null);
  const [currentTaskIndex, setCurrentTaskIndex] = useState<number>(0);
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'reviewing' | 'uploading'>('idle');
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  
  // Audio state
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [transcriptEdit, setTranscriptEdit] = useState<string>('');
  const [isPrompted, setIsPrompted] = useState<boolean>(false);
  
  // Network/Offline State
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [syncQueueSize, setSyncQueueSize] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  
  // Forms State
  const [age, setAge] = useState<number>(25);
  const [gender, setGender] = useState<string>('male');
  const [l1, setL1] = useState<string>('Hindi');
  const [region, setRegion] = useState<string>('Delhi');
  
  // Admin Panel State
  const [adminUsername, setAdminUsername] = useState<string>('admin');
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [adminStats, setAdminStats] = useState<AdminStatsResponse | null>(null);
  const [adminCoverage, setAdminCoverage] = useState<AdminCoverageItem[]>([]);
  const [reviewQueue, setReviewQueue] = useState<ClipReviewItem[]>([]);
  const [activeReviewTab, setActiveReviewTab] = useState<'stats' | 'reviews' | 'coverage' | 'speakers'>('stats');
  
  // Audio Recording Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const recordingStartTimeRef = useRef<number | null>(null);

  // Initialize Device and Speaker on Mount
  useEffect(() => {
    // 1. Get or generate Device ID
    let devId = localStorage.getItem('device_id');
    if (!devId) {
      devId = crypto.randomUUID();
      localStorage.setItem('device_id', devId);
    }
    setDeviceId(devId);
    
    // Check local storage for active speaker
    const savedSpeaker = localStorage.getItem('active_speaker');
    if (savedSpeaker) {
      const parsed = JSON.parse(savedSpeaker) as SpeakerResponse;
      setCurrentSpeaker(parsed);
      setShowSpeakerConfirm(true);
    } else {
      setShowOnboarding(true);
    }

    // 2. Network listener
    const goOnline = () => { setIsOnline(true); triggerOfflineSync(); };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    
    // Register device in backend
    registerDeviceOnBackend(devId);
    checkQueueSize();

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Sync Queue size checker
  const checkQueueSize = async () => {
    try {
      const queue = await getUploadQueue();
      setSyncQueueSize(queue.length);
    } catch (e) {
      console.error(e);
    }
  };

  // Trigger Session loading when Speaker & Domain changes
  useEffect(() => {
    if (currentSpeaker && !showSpeakerConfirm && !showOnboarding) {
      // Reset any active recording state when switching domains
      if (recordingState !== 'idle') {
        resetAudioState();
      }
      fetchSessionBatch(selectedDomain);
    }
  }, [currentSpeaker, selectedDomain, showSpeakerConfirm, showOnboarding]);

  // Handle Recording Timer
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

  // Keyboard shortcut: Spacebar to toggle recording
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Only trigger if not typing in an input field
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        if (recordingState === 'idle' || recordingState === 'recording') {
          handleRecordToggle();
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [recordingState]);

  // --- API Integrations ---

  const registerDeviceOnBackend = async (devId: string) => {
    try {
      await fetch(`${API_BASE}/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: devId, ua_class: navigator.userAgent })
      });
      fetchSpeakerRoster(devId);
    } catch (e) {
      console.error('Failed to register device', e);
    }
  };

  const fetchSpeakerRoster = async (devId: string) => {
    try {
      const res = await fetch(`${API_BASE}/devices/${devId}/speakers`, {
        headers: { 'X-Device-ID': devId }
      });
      if (res.ok) {
        const data = await res.json();
        setSpeakerRoster(data.speakers);
      }
    } catch (e) {
      console.error('Failed to fetch roster', e);
    }
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
      if (res.ok) {
        const data = await res.json();
        setSessionBatch(data.batch);
        // Find first pending task
        const pendingIndex = data.batch.tasks.findIndex((t: TaskResponse) => t.status === 'pending');
        const newTaskIndex = pendingIndex >= 0 ? pendingIndex : 0;
        setCurrentTaskIndex(newTaskIndex);
      }
    } catch (e) {
      console.error('Failed to load session batch', e);
    }
  };

  // --- Onboarding & Switcher Actions ---

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
          age,
          gender,
          l1,
          region,
          consent_version: 'v1.0-testing'
        })
      });
      if (res.ok) {
        const speaker: SpeakerResponse = await res.json();
        setCurrentSpeaker(speaker);
        localStorage.setItem('active_speaker', JSON.stringify(speaker));
        setShowOnboarding(false);
        setShowSpeakerConfirm(false);
        fetchSpeakerRoster(deviceId);
      } else {
        alert('Failed to register speaker profile.');
      }
    } catch (err) {
      console.error(err);
      alert('Error connecting to backend.');
    }
  };

  const selectSpeakerFromRoster = (spkId: string) => {
    // Switch to existing speaker. In prototype, we can trigger backend verification.
    // Since we don't store full token in roster, we query the speaker profile if available,
    // or request re-onboarding if token is missing. For simplicity in the prototype,
    // we'll assume the speaker token is saved in localStorage under a list or we can
    // register again if token is lost. To be clean, let's search if we have the token
    // for this speaker saved.
    const savedSpeakers = localStorage.getItem('speaker_tokens_map') || '{}';
    const tokens = JSON.parse(savedSpeakers);
    const token = tokens[spkId];
    
    if (token) {
      const newSpk: SpeakerResponse = {
        speaker_id: spkId,
        token,
        age_band: '26-35', // placeholder
        consent_at: new Date().toISOString()
      };
      setCurrentSpeaker(newSpk);
      localStorage.setItem('active_speaker', JSON.stringify(newSpk));
      setShowSpeakerRoster(false);
      setShowSpeakerConfirm(false);
    } else {
      // In prototype: if token is not cached, we can allow onboarding again or simple bypass
      // Let's create a mockup token for simplicity
      const dummyToken = crypto.randomUUID();
      tokens[spkId] = dummyToken;
      localStorage.setItem('speaker_tokens_map', JSON.stringify(tokens));
      const newSpk: SpeakerResponse = {
        speaker_id: spkId,
        token: dummyToken,
        age_band: '26-35',
        consent_at: new Date().toISOString()
      };
      setCurrentSpeaker(newSpk);
      localStorage.setItem('active_speaker', JSON.stringify(newSpk));
      setShowSpeakerRoster(false);
      setShowSpeakerConfirm(false);
    }
  };

  // Helper to register local speaker tokens
  useEffect(() => {
    if (currentSpeaker) {
      const savedSpeakers = localStorage.getItem('speaker_tokens_map') || '{}';
      const tokens = JSON.parse(savedSpeakers);
      tokens[currentSpeaker.speaker_id] = currentSpeaker.token;
      localStorage.setItem('speaker_tokens_map', JSON.stringify(tokens));
    }
  }, [currentSpeaker]);

  // --- Audio Recording Core Flow ---

  const handleRecordToggle = async () => {
    if (recordingState === 'recording') {
      // Stop recording
      handleRecordStop();
    } else if (recordingState === 'idle') {
      // Start recording
      await handleRecordStart();
    }
  };

  // Add a ref to track recording start time

  const handleRecordStart = async () => {
    if (!currentSpeaker) return;
    audioChunksRef.current = [];
    setAudioUrl(null);
    setAudioBlob(null);

    // Negotiate MIME Type (standard Opus or AAC format based on Safari vs others)
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/mp4;codecs=aac';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/ogg;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = ''; // Let browser decide
        }
      }
    }

    try {
      // Audio Capture constraints: disable auto gain, echo cancellation, noise suppression
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 16000,
          channelCount: 1
        }
      });

      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        // Stop all microphone tracks first
        stream.getTracks().forEach(track => track.stop());
        
        // Calculate actual duration from timestamps
        const actualDuration = recordingStartTimeRef.current 
          ? (Date.now() - recordingStartTimeRef.current) / 1000 
          : recordingDuration;
        
        // Layer 2: Client-side short duration threshold check
        if (actualDuration < 0.4) {
          alert('Recording too short! Please record for at least 0.4 seconds.');
          setRecordingState('idle');
          audioChunksRef.current = [];
          recordingStartTimeRef.current = null;
          return;
        }

        // Create blob with proper MIME type
        const actualMimeType = mediaRecorderRef.current?.mimeType || mimeType || 'audio/webm';
        const finalBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
        
        console.log('Recording complete:', {
          duration: actualDuration.toFixed(2) + 's',
          blobSize: (finalBlob.size / 1024).toFixed(2) + 'KB'
        });

        // Create object URL for playback
        const url = URL.createObjectURL(finalBlob);
        
        setAudioBlob(finalBlob);
        setAudioUrl(url);
        setRecordingState('reviewing');
        recordingStartTimeRef.current = null;
        
        // Playback recorded audio automatically after a short delay
        setTimeout(() => {
          if (audioPlayerRef.current) {
            audioPlayerRef.current.load(); // Reload the audio element
            audioPlayerRef.current.play().catch((err) => {
              console.log('Auto playback interrupted:', err);
              // If autoplay fails, user can click play manually
            });
          }
        }, 200);

        // Pre-initialize Clip ID
        if (isOnline) {
          initializeClipOnBackend(finalBlob, actualMimeType);
        } else {
          // Offline mode initialization: generate local clip ID and queue it
          const localClipId = crypto.randomUUID();
          setActiveClipId(localClipId);
          await saveAudioBlob(localClipId, finalBlob);
        }
      };

      // Record the start time
      recordingStartTimeRef.current = Date.now();
      setRecordingDuration(0);
      setRecordingState('recording');
      recorder.start();
    } catch (err) {
      console.error('Mic access error:', err);
      alert('Could not access microphone. Please verify site permissions.');
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
      if (res.ok) {
        const data = await res.json();
        setActiveClipId(data.clip_id);
        uploadAudioBlob(data.clip_id, blob, mimeType);
      } else {
        setRecordingState('reviewing');
        alert('Failed to initialize clip on server.');
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
      if (res.ok) {
        setRecordingState('reviewing');
      } else {
        throw new Error('Upload failed');
      }
    } catch (e) {
      console.error('Upload failed. Saving to offline queue...', e);
      // Save in IndexedDB queue
      if (currentSpeaker) {
        await saveAudioBlob(clipId, blob);
        await enqueueUpload({
          clipId,
          blob,
          mimeType,
          token: currentSpeaker.token,
          deviceId
        });
        checkQueueSize();
      }
      setRecordingState('reviewing');
    }
  };

  const handleConfirmKeep = async () => {
    if (!currentSpeaker || !sessionBatch || !activeClipId) return;
    
    if (!isOnline) {
      // Offline Keep logic: Queue decision locally and move to next task in memory
      await enqueueUpload({
        clipId: activeClipId,
        blob: audioBlob!,
        mimeType: audioBlob!.type,
        token: currentSpeaker.token,
        deviceId
      });
      
      // Update task status in memory
      const updatedTasks = [...sessionBatch.tasks];
      updatedTasks[currentTaskIndex].status = 'recorded';
      setSessionBatch({
        ...sessionBatch,
        tasks: updatedTasks
      });
      
      advanceTask();
      resetAudioState();
      checkQueueSize();
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
      
      if (res.ok) {
        // Update batch status
        const updatedTasks = [...sessionBatch.tasks];
        updatedTasks[currentTaskIndex].status = 'recorded';
        setSessionBatch({
          ...sessionBatch,
          tasks: updatedTasks
        });
        
        advanceTask();
        resetAudioState();
      } else {
        alert('Could not confirm recording on server.');
      }
    } catch (e) {
      console.error(e);
      alert('Connection error.');
    }
  };

  const handleDiscardRedo = async () => {
    if (!currentSpeaker || !sessionBatch || !activeClipId) return;
    
    if (!isOnline) {
      // Offline Redo: delete local database entries, increment local redo counter
      await deleteAudioBlob(activeClipId);
      const updatedTasks = [...sessionBatch.tasks];
      updatedTasks[currentTaskIndex].redo_count += 1;
      setSessionBatch({
        ...sessionBatch,
        tasks: updatedTasks
      });
      resetAudioState();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/clips/${activeClipId}/discard`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentSpeaker.token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        // Update batch tasks with updated redo count
        const updatedTasks = [...sessionBatch.tasks];
        updatedTasks[currentTaskIndex] = data.task;
        setSessionBatch({
          ...sessionBatch,
          tasks: updatedTasks
        });
        resetAudioState();
      } else {
        alert('Could not discard clip.');
      }
    } catch (e) {
      console.error(e);
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
      // Loop back to start or query next batch
      const firstPending = sessionBatch.tasks.findIndex(t => t.status === 'pending');
      if (firstPending >= 0) {
        setCurrentTaskIndex(firstPending);
      } else {
        // All tasks recorded! Load next batch.
        alert('Batch completed successfully! Fetching next batch...');
        fetchSessionBatch(selectedDomain);
      }
    }
  };

  const resetAudioState = () => {
    // Clean up object URL to prevent memory leaks
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setAudioBlob(null);
    setActiveClipId(null);
    setTranscriptEdit('');
    setIsPrompted(false);
    setRecordingState('idle');
    recordingStartTimeRef.current = null;
  };

  // --- Offline Queue Synchronization ---

  const triggerOfflineSync = async () => {
    if (!isOnline || isSyncing) return;
    const queue = await getUploadQueue();
    if (queue.length === 0) return;
    
    setIsSyncing(true);
    console.log(`Starting background sync of ${queue.length} clips...`);
    
    for (const item of queue) {
      try {
        // Initialize
        const initRes = await fetch(`${API_BASE}/clips/init`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Device-ID': item.deviceId,
            'Authorization': `Bearer ${item.token}`
          },
          body: JSON.stringify({
            task_id: sessionBatch?.tasks.find(t => t.status === 'pending')?.task_id || '', // fallback
            mime_type: item.mimeType
          })
        });
        
        if (initRes.ok) {
          const initData = await initRes.json();
          // Upload
          const formData = new FormData();
          formData.append('file', item.blob, 'audio_record');
          const upRes = await fetch(`${API_BASE}/clips/upload?clip_id=${initData.clip_id}`, {
            method: 'POST',
            headers: { 'X-Device-ID': item.deviceId },
            body: formData
          });
          
          if (upRes.ok) {
            // Confirm
            await fetch(`${API_BASE}/clips/${initData.clip_id}/confirm`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${item.token}` },
              body: JSON.stringify({ prompted: false })
            });
            
            // Delete from IndexedDB
            await deleteAudioBlob(item.clipId);
            await dequeueUpload(item.clipId);
          }
        }
      } catch (err) {
        console.error('Failed to sync item', item.clipId, err);
      }
    }
    
    setIsSyncing(false);
    checkQueueSize();
    fetchSessionBatch(selectedDomain);
  };

  // --- Admin Dashboard Actions ---

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminUsername, password: adminPassword })
      });
      if (res.ok) {
        const data = await res.json();
        setAdminToken(data.token);
        localStorage.setItem('admin_token', data.token);
        fetchAdminData(data.token);
      } else {
        alert('Invalid admin credentials.');
      }
    } catch (e) {
      alert('Admin login connection failure.');
    }
  };

  const handleAdminLogout = () => {
    setAdminToken(null);
    localStorage.removeItem('admin_token');
  };

  const fetchAdminData = async (token: string) => {
    const headers = { 'Authorization': `Bearer ${token}` };
    try {
      const statsRes = await fetch(`${API_BASE}/admin/stats`, { headers });
      if (statsRes.ok) setAdminStats(await statsRes.json());
      
      const covRes = await fetch(`${API_BASE}/admin/coverage`, { headers });
      if (covRes.ok) setAdminCoverage((await covRes.json()).coverage);
      
      const queueRes = await fetch(`${API_BASE}/admin/clips`, { headers });
      if (queueRes.ok) setReviewQueue((await queueRes.json()).clips);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isAdmin && adminToken) {
      fetchAdminData(adminToken);
    }
  }, [isAdmin, adminToken]);

  const handleReviewAction = async (clipId: string, action: 'accept' | 'reject') => {
    if (!adminToken) return;
    try {
      const res = await fetch(`${API_BASE}/admin/clips/${clipId}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        // Refresh queue
        fetchAdminData(adminToken);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleWithdrawSpeaker = async (spkId: string) => {
    if (!adminToken) return;
    if (!confirm(`Are you absolutely sure you want to withdraw ${spkId}? This will delete all their recorded data!`)) return;
    try {
      const res = await fetch(`${API_BASE}/admin/speakers/${spkId}/withdraw`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (res.ok) {
        alert('Speaker data deleted successfully.');
        fetchAdminData(adminToken);
        fetchSpeakerRoster(deviceId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const downloadDatasetExport = () => {
    if (!adminToken) return;
    window.open(`${API_BASE}/admin/export?token=${adminToken}`, '_blank');
  };

  // --- Rendering Helpers ---

  const activeTask: TaskResponse | undefined = sessionBatch?.tasks[currentTaskIndex];

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <div className="glass-card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Globe className="text-accent" style={{ color: 'var(--color-accent)' }} />
          <h2 style={{ fontSize: '1.2rem', fontFamily: 'var(--font-display)' }}>Hinglish S2I</h2>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Online/Offline Status Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
            <span style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              background: isOnline ? 'var(--color-success)' : 'var(--color-danger)',
              boxShadow: isOnline ? '0 0 6px var(--color-success)' : '0 0 6px var(--color-danger)'
            }} />
            <span style={{ color: 'var(--text-secondary)' }}>{isOnline ? 'Online' : 'Offline'}</span>
          </div>

          <button 
            className="btn btn-secondary" 
            style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={() => setIsAdmin(prev => !prev)}
          >
            {isAdmin ? 'volunteer App' : 'Admin Panel'}
          </button>
        </div>
      </div>

      {/* Offline Sync Area */}
      {syncQueueSize > 0 && (
        <div className="glass-card" style={{ border: '1px solid var(--color-warning)', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <ShieldAlert style={{ color: 'var(--color-warning)' }} />
            <div>
              <p style={{ fontWeight: '600', fontSize: '0.9rem' }}>Offline Clips Saved ({syncQueueSize})</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Clips stored in IndexedDB. Will sync when network recovers.</p>
            </div>
          </div>
          <button 
            className="btn btn-primary" 
            disabled={!isOnline || isSyncing}
            style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={triggerOfflineSync}
          >
            {isSyncing ? <RefreshCw className="animate-spin" /> : 'Sync Now'}
          </button>
        </div>
      )}

      {/* ================= ADMIN VIEW ================= */}
      {isAdmin ? (
        !adminToken ? (
          <div className="glass-card">
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <LogIn size={48} style={{ color: 'var(--color-accent)', marginBottom: '12px' }} />
              <h2 style={{ fontSize: '1.4rem' }}>Admin Dashboard Login</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Authorized credentials required</p>
            </div>
            
            <form onSubmit={handleAdminLogin}>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)} 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input 
                  type="password" 
                  className="form-input" 
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)} 
                />
              </div>
              <button type="submit" className="btn btn-primary">Login</button>
            </form>
          </div>
        ) : (
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem' }}>Domain Manager Panel</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Logged in as admin</span>
              </div>
              <button 
                className="btn btn-secondary" 
                style={{ width: 'auto', padding: '6px 10px' }}
                onClick={handleAdminLogout}
              >
                <LogOut size={16} />
              </button>
            </div>

            {/* Admin Tabs */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
              {(['stats', 'reviews', 'coverage', 'speakers'] as const).map(tab => (
                <button
                  key={tab}
                  className={`btn ${activeReviewTab === tab ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '6px 12px', fontSize: '0.8rem', width: 'auto', textTransform: 'capitalize' }}
                  onClick={() => setActiveReviewTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab: Stats */}
            {activeReviewTab === 'stats' && adminStats && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="glass-card" style={{ padding: '16px', background: 'var(--bg-tertiary)' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Speakers Registered</p>
                  <p style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>{adminStats.total_speakers}</p>
                </div>
                <div className="glass-card" style={{ padding: '16px', background: 'var(--bg-tertiary)' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Recordings</p>
                  <p style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>{adminStats.total_recordings}</p>
                </div>
                <div className="glass-card" style={{ padding: '16px', background: 'var(--bg-tertiary)' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Confirmed (Keep)</p>
                  <p style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--color-success)' }}>{adminStats.confirmed_clips}</p>
                </div>
                <div className="glass-card" style={{ padding: '16px', background: 'var(--bg-tertiary)' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Redo Attempts</p>
                  <p style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--color-warning)' }}>{adminStats.redo_count}</p>
                </div>

                <div style={{ gridColumn: 'span 2', marginTop: '12px' }}>
                  <button className="btn btn-success" onClick={downloadDatasetExport}>
                    <Download size={18} /> Export Dataset Manifest
                  </button>
                </div>
              </div>
            )}

            {/* Tab: Reviews Queue */}
            {activeReviewTab === 'reviews' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '1rem' }}>Audio Quality Control review</h4>
                {reviewQueue.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '24px' }}>Review queue is empty.</p>
                ) : (
                  reviewQueue.map(item => (
                    <div key={item.clip_id} className="glass-card" style={{ padding: '16px', background: 'var(--bg-tertiary)', fontSize: '0.85rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontWeight: '600' }}>{item.speaker_id} ({item.intent})</span>
                        <span style={{ 
                          fontSize: '0.75rem', 
                          padding: '2px 6px', 
                          borderRadius: '4px',
                          background: item.status === 'processed' ? 'var(--color-success-glow)' : 'var(--color-warning-glow)'
                        }}>{item.status}</span>
                      </div>
                      
                      <p style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        PROV: <span style={{ fontStyle: 'italic' }}>"{item.transcript_provisional}"</span>
                      </p>

                      {/* Display QC Flags */}
                      {item.qc_flags.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '12px' }}>
                          {item.qc_flags.map(f => (
                            <span key={f} style={{ background: '#ef444422', color: 'var(--color-danger)', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px' }}>
                              ⚠️ {f}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Audio Player */}
                      {item.filename && (
                        <audio 
                          controls 
                          src={`${API_BASE}/storage/processed/${item.filename}`} // in prototype, we host static resources or mock
                          style={{ width: '100%', height: '32px', marginBottom: '12px' }}
                        />
                      )}

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-success" style={{ padding: '6px', fontSize: '0.75rem' }} onClick={() => handleReviewAction(item.clip_id, 'accept')}>
                          Accept
                        </button>
                        <button className="btn btn-danger" style={{ padding: '6px', fontSize: '0.75rem' }} onClick={() => handleReviewAction(item.clip_id, 'reject')}>
                          Reject
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab: Coverage Heatmap */}
            {activeReviewTab === 'coverage' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h4 style={{ fontSize: '1rem' }}>Intent Representation Heatmap</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {adminCoverage.map(cov => (
                    <div key={cov.intent} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-tertiary)', padding: '10px 14px', borderRadius: '8px' }}>
                      <div>
                        <p style={{ fontWeight: '500', fontSize: '0.85rem' }}>{cov.intent}</p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Speakers contributed: {cov.speakers_count}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ 
                          fontSize: '0.9rem', 
                          fontWeight: 'bold',
                          color: cov.clips_processed >= 40 ? 'var(--color-success)' : 'var(--color-warning)'
                        }}>{cov.clips_processed}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}> / 40 min</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab: Speakers & Withdrawal */}
            {activeReviewTab === 'speakers' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h4 style={{ fontSize: '1rem' }}>Speaker Demographics & Withdrawal</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {speakerRoster.map(spk => (
                    <div key={spk.speaker_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-tertiary)', padding: '10px 14px', borderRadius: '8px' }}>
                      <div>
                        <p style={{ fontWeight: '500', fontSize: '0.85rem' }}>{spk.speaker_id} ({spk.gender}, {spk.age_band})</p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Registered on device</p>
                      </div>
                      <button 
                        className="btn btn-danger" 
                        style={{ width: 'auto', padding: '6px 10px' }}
                        onClick={() => handleWithdrawSpeaker(spk.speaker_id)}
                      >
                        <Trash2 size={14} /> Withdraw
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      ) : (
        /* ================= VOLUNTEER VIEW ================= */
        <>
          {/* Identity Confirmation Dialog */}
          {showSpeakerConfirm && currentSpeaker && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ textAlign: 'center' }}>
                <Users size={32} style={{ color: 'var(--color-accent)', marginBottom: '8px' }} />
                <h3>Welcome back</h3>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Are you recording as <strong style={{ color: 'var(--text-primary)' }}>{currentSpeaker.speaker_id}</strong>?
                </p>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn btn-primary" onClick={() => setShowSpeakerConfirm(false)}>
                  Yes, Continue
                </button>
                <button className="btn btn-secondary" onClick={() => { setShowSpeakerRoster(true); setShowSpeakerConfirm(false); }}>
                  Switch Profile
                </button>
              </div>
            </div>
          )}

          {/* Speaker Switcher / Roster Screen */}
          {showSpeakerRoster && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <h3>Select Speaker Profile</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Volunteers on this shared device:</p>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {speakerRoster.map(spk => (
                  <button 
                    key={spk.speaker_id}
                    className="btn btn-secondary"
                    style={{ justifyContent: 'space-between', padding: '12px' }}
                    onClick={() => selectSpeakerFromRoster(spk.speaker_id)}
                  >
                    <span>🎙️ {spk.speaker_id}</span>
                    <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>({spk.gender}, {spk.age_band})</span>
                  </button>
                ))}
                
                <button 
                  className="btn btn-primary" 
                  style={{ marginTop: '12px' }}
                  onClick={() => { setShowOnboarding(true); setShowSpeakerRoster(false); }}
                >
                  <UserPlus size={18} /> Add New Speaker Profile
                </button>
              </div>
            </div>
          )}

          {/* Onboarding Screen (Demographics & Consent) */}
          {showOnboarding && (
            <div className="glass-card">
              <div style={{ marginBottom: '20px' }}>
                <h3>Volunteer Onboarding</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Demographics are exported anonymized without your name.</p>
              </div>

              <form onSubmit={handleOnboardingSubmit}>
                <div className="form-group">
                  <label className="form-label">Age</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    min="10" 
                    max="100" 
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

                {/* Consent Disclosure Box */}
                <div className="glass-card" style={{ background: 'var(--bg-tertiary)', padding: '16px', fontSize: '0.8rem', margin: '20px 0', border: '1px solid var(--border-glass)' }}>
                  <h4 style={{ marginBottom: '6px' }}>Consent Agreement (v1.0-testing)</h4>
                  <p style={{ color: 'var(--text-secondary)', maxHeight: '100px', overflowY: 'auto', paddingRight: '4px' }}>
                    I agree to contribute my anonymous voice recordings for researchers training speech recognition models. 
                    I understand no personal names or contact information is associated with my voice clips. 
                    I can request dataset deletion at any time via my Speaker ID.
                  </p>
                </div>

                <button type="submit" className="btn btn-primary">
                  Accept Terms & Register
                </button>
              </form>
            </div>
          )}

          {/* Main Recording Interface */}
          {!showSpeakerConfirm && !showSpeakerRoster && !showOnboarding && currentSpeaker && (
            <>
              {/* Domain Switcher */}
              <div className="glass-card" style={{ padding: '12px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {['BNK', 'EDU', 'TRV', 'VAS'].map(dom => (
                    <button
                      key={dom}
                      className={`btn ${selectedDomain === dom ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                      onClick={() => setSelectedDomain(dom)}
                    >
                      {dom === 'BNK' ? '🏦 Banking' : 
                       dom === 'EDU' ? '🎓 School' : 
                       dom === 'TRV' ? '✈️ Travel' : '🎙️ Assistant'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Progress Panel */}
              {sessionBatch && (
                <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="progress-container">
                    <div className="progress-header">
                      <span>Intent Progress</span>
                      <span>{sessionBatch.progress.intents_done} / {sessionBatch.progress.intents_total} Intents</span>
                    </div>
                    {/* Render Progress Diamonds */}
                    <div className="progress-diamonds-grid">
                      {sessionBatch.tasks.map((task, idx) => {
                        let statusClass = 'pending';
                        if (task.status === 'recorded') statusClass = 'recorded';
                        else if (idx === currentTaskIndex) statusClass = 'active';
                        
                        return (
                          <div 
                            key={task.task_id} 
                            className={`progress-diamond ${statusClass}`}
                            onClick={() => setCurrentTaskIndex(idx)}
                            style={{ cursor: 'pointer' }}
                            title={`Scenario ${task.scenario_no} (${task.intent})`}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Task Details and Recording Actions */}
              {activeTask && (
                <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ 
                      fontSize: '0.75rem', 
                      background: 'rgba(99, 102, 241, 0.15)', 
                      color: 'var(--color-accent)', 
                      padding: '4px 8px', 
                      borderRadius: '4px',
                      textTransform: 'uppercase',
                      fontWeight: 'bold'
                    }}>
                      {activeTask.intent}
                    </span>
                    
                    <h1 style={{ fontSize: '1.4rem', marginTop: '12px', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                      {activeTask.text_hi}
                    </h1>

                    {activeTask.register && (
                      <p style={{ fontSize: '0.8rem', color: 'var(--color-warning)', marginTop: '6px' }}>
                        🎭 Tone: <strong>{activeTask.register}</strong>
                      </p>
                    )}
                  </div>

                  {/* Tap-to-Start/Stop Recording Area */}
                  {recordingState === 'idle' || recordingState === 'recording' ? (
                    <div className="record-trigger-container">
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {recordingState === 'recording' 
                          ? '🔴 Recording in progress... Tap to stop' 
                          : 'Tap the microphone button to start recording'}
                      </p>
                      
                      <div className="record-btn-wrapper">
                        <button 
                          className={`record-btn ${recordingState === 'recording' ? 'recording' : ''}`}
                          onClick={handleRecordToggle}
                          type="button"
                        >
                          <Mic size={40} />
                        </button>
                      </div>

                      {recordingState === 'recording' && (
                        <p style={{ fontFamily: 'monospace', fontSize: '1.1rem', color: 'var(--color-danger)', fontWeight: 'bold' }}>
                          {recordingDuration.toFixed(1)}s
                        </p>
                      )}
                      
                      {recordingState === 'idle' && (
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                          💡 Tip: You can also use Spacebar to start/stop recording
                        </p>
                      )}
                    </div>
                  ) : (
                    /* Review and Listen State */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Recorded Clip Playback:</p>
                        <audio ref={audioPlayerRef} src={audioUrl || ''} controls style={{ width: '100%', height: '40px' }} />
                      </div>

                      {/* Transcription Correction Textarea */}
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Type what you said (optional Hinglish correction):</label>
                        <textarea
                          className="form-input"
                          style={{ minHeight: '80px', resize: 'vertical' }}
                          placeholder={`Examples: "${activeTask.examples[0]}"`}
                          value={transcriptEdit}
                          onChange={(e) => setTranscriptEdit(e.target.value)}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '12px' }}>
                        <button className="btn btn-danger" onClick={handleDiscardRedo}>
                          <RotateCcw size={18} /> Redo (Discard)
                        </button>
                        <button className="btn btn-success" onClick={handleConfirmKeep}>
                          <Check size={18} /> Keep (Confirm)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Footer Details */}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span>Speaker ID: {currentSpeaker.speaker_id}</span>
                <button 
                  style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '0.75rem' }}
                  onClick={() => setShowSpeakerRoster(true)}
                >
                  Switch Volunteer Profile
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
