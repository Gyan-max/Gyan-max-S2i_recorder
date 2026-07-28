import { useState, useEffect, useRef, useMemo } from 'react';
import { Mic, RotateCcw, Check, Users, RefreshCw, Headphones, Lock, WifiOff, CheckCircle, Sparkles, ShieldCheck } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { SpeakerResponse, SpeakerRosterItem, SessionBatchInfo, TaskResponse } from '../types';
import { saveAudioBlob, enqueueUpload, getUploadQueue, dequeueUpload, deleteAudioBlob } from '../db';
import { API_BASE } from '../config';
import AudioPlayer from '../components/AudioPlayer';
import AudioVisualizer from '../components/AudioVisualizer';

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
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const initialDomain = searchParams.get('domain') || 'BNK';

  // Read the saved session synchronously rather than from the currentSpeaker
  // prop. AppRouter restores that prop in a useEffect, so it is still null
  // during this first render - initialising from it left returning volunteers
  // stuck on the onboarding form, where re-registering created a duplicate
  // speaker and orphaned every recording made under the previous profile.
  const hasSavedSpeaker = () => {
    try {
      return Boolean(localStorage.getItem('active_speaker'));
    } catch {
      return false;
    }
  };

  const [showOnboarding, setShowOnboarding] = useState(() => !hasSavedSpeaker());
  const [showSpeakerConfirm, setShowSpeakerConfirm] = useState(() => hasSavedSpeaker());
  const [showSpeakerRoster, setShowSpeakerRoster] = useState(false);

  // Domain & Session State
  const [selectedDomain, setSelectedDomain] = useState<string>(initialDomain);
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
  const [showBatchCompleteModal, setShowBatchCompleteModal] = useState(false);
  const [showScenarioComplete, setShowScenarioComplete] = useState(false);
  const [completedScenarioNo, setCompletedScenarioNo] = useState<number>(0);




  // Onboarding Form
  const [fullName, setFullName] = useState<string>('');
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
  const pendingRecordingRef = useRef<{ blob: Blob; mimeType: string } | null>(null);

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

  // Ask browser to retain local storage persistence
  useEffect(() => {
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => undefined);
    }
  }, []);

  // Mobile visibility handling
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

  // Keyboard Shortcuts (Space for Record, Enter for Keep, R for Redo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept typing in input or textarea
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select') {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (recordingState === 'recording') {
          handleRecordStop();
        } else if (recordingState === 'idle') {
          handleRecordStart();
        }
      } else if (e.code === 'Enter' && recordingState === 'reviewing' && hasListened && !isConfirming) {
        e.preventDefault();
        handleConfirmKeep();
      } else if ((e.code === 'KeyR' || e.key === 'r') && recordingState === 'reviewing' && !isRedoing) {
        e.preventDefault();
        handleDiscardRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [recordingState, hasListened, isConfirming, isRedoing]);

  /**
   * Drains recordings captured while offline (or whose upload failed).
   * Each item goes through the full init -> upload -> confirm sequence;
   * stopping after upload leaves the clip unconfirmed and unprocessed.
   */
  const processUploadQueue = async () => {
    let synced = 0;
    try {
      const queue = await getUploadQueue();
      for (const item of queue) {
        try {
          let clipId = item.clipId;

          // Offline recordings have no server-side clip yet.
          if (item.needsInit) {
            const initRes = await fetch(`${API_BASE}/clips/init`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Device-ID': item.deviceId,
                'Authorization': `Bearer ${item.token}`
              },
              body: JSON.stringify({ task_id: item.taskId, mime_type: item.mimeType })
            });

            if (initRes.status === 409) {
              // Already recorded elsewhere - drop it rather than retry forever.
              await dequeueUpload(item.clipId);
              await deleteAudioBlob(item.clipId);
              continue;
            }
            if (!initRes.ok) continue;
            clipId = (await initRes.json()).clip_id;
          }

          const formData = new FormData();
          formData.append('file', item.blob, 'audio_record');
          const uploadRes = await fetch(`${API_BASE}/clips/upload?clip_id=${clipId}`, {
            method: 'POST',
            headers: {
              'X-Device-ID': item.deviceId,
              'Authorization': `Bearer ${item.token}`
            },
            body: formData
          });
          if (!uploadRes.ok) continue;

          const confirmRes = await fetch(`${API_BASE}/clips/${clipId}/confirm`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${item.token}`
            },
            body: JSON.stringify({
              transcript_edit: item.transcriptEdit || undefined,
              prompted: item.prompted
            })
          });
          if (!confirmRes.ok) continue;

          // Only drop the local copy once the server owns the recording.
          await dequeueUpload(item.clipId);
          await deleteAudioBlob(item.clipId);
          synced += 1;
        } catch (e) {
          console.error('Queued upload failed for', item.clipId, e);
        }
      }
    } catch (e) {
      console.error('Failed to process upload queue', e);
    }

    if (synced > 0) {
      setNotice(`${synced} offline recording${synced > 1 ? 's' : ''} uploaded successfully.`);
      if (currentSpeaker) fetchSessionBatch(selectedDomain);
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
    const searchParams = new URLSearchParams(location.search);
    const domain = searchParams.get('domain');
    if (domain && domain !== selectedDomain) {
      setSelectedDomain(domain);
    }
  }, [location.search]);

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

        // If speaker has an assigned domain, sync selectedDomain
        if (data.batch.assigned_domain) {
          setSelectedDomain(data.batch.assigned_domain);
        }

        // Check if we need to jump to a specific example from URL
        const searchParams = new URLSearchParams(location.search);
        const exampleParam = searchParams.get('example');

        let targetIndex = -1;
        if (exampleParam) {
          const exNo = parseInt(exampleParam, 10);
          targetIndex = data.batch.tasks.findIndex((t: TaskResponse) => t.example_no === exNo);
        }

        if (targetIndex >= 0) {
          setCurrentTaskIndex(targetIndex);
        } else {
          const pendingIndex = data.batch.tasks.findIndex((t: TaskResponse) => t.status === 'pending');
          setCurrentTaskIndex(pendingIndex >= 0 ? pendingIndex : 0);
        }
      } else {
        const errData = await res.json().catch(() => ({} as any));
        setRecordingError(
          errData?.detail?.code === 'SCENARIOS_NOT_SEEDED'
            ? 'No recording tasks are available yet. Please contact the study coordinator.'
            : 'Could not load your recording tasks. Please refresh and try again.'
        );
      }
    } catch (e) {
      console.error('Failed to load session batch', e);
      setRecordingError('Could not reach the server to load your tasks. Check your connection and refresh.');
    }
  };

  const switchToSpeaker = (speaker: SpeakerRosterItem) => {
    const speakerResponse: SpeakerResponse = {
      speaker_id: speaker.speaker_id,
      name: speaker.name,
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
          name: fullName || undefined,
          age, gender, l1, region,
          consent_version: 'consent-v1'
        })
      });
      if (handleAuthError(res.status)) return;
      if (res.ok) {
        const speaker: SpeakerResponse = await res.json();
        if (fullName) speaker.name = fullName;
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
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
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

        // Keep the raw take so the offline Keep path can queue the real bytes.
        pendingRecordingRef.current = { blob: finalBlob, mimeType: actualMimeType };

        if (isOnline) {
          initializeClipOnBackend(finalBlob, actualMimeType);
        } else {
          const localClipId = crypto.randomUUID();
          setActiveClipId(localClipId);
          await saveAudioBlob(localClipId, finalBlob);
          setNotice('Saved on this device. It will upload automatically when you are back online.');
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
        setRecordingError('Could not prepare the upload. You can still press Keep - the recording will be saved and uploaded when the connection recovers.');
        setRecordingState('reviewing');
      }
    } catch (e) {
      console.error(e);
      setRecordingError('Could not reach the server. Press Keep to save this recording on your device; it will upload automatically later.');
      setRecordingState('reviewing');
    }
  };

  const uploadAudioBlob = async (clipId: string, blob: Blob, mimeType: string) => {
    const task = sessionBatch?.tasks[currentTaskIndex];
    try {
      const formData = new FormData();
      formData.append('file', blob, 'audio_record');

      const res = await fetch(`${API_BASE}/clips/upload?clip_id=${clipId}`, {
        method: 'POST',
        headers: {
          'X-Device-ID': deviceId,
          'Authorization': `Bearer ${currentSpeaker?.token ?? ''}`
        },
        body: formData
      });
      if (handleAuthError(res.status)) return;
      if (res.ok) {
        setRecordingState('reviewing');
      } else {
        throw new Error(`Upload failed with status ${res.status}`);
      }
    } catch (e) {
      console.error('Upload failed. Saving to offline queue...', e);
      if (currentSpeaker && task) {
        await saveAudioBlob(clipId, blob);
        await enqueueUpload({
          clipId, blob, mimeType,
          token: currentSpeaker.token,
          deviceId,
          taskId: task.task_id,
          // Clip row already exists server-side; only upload+confirm remain.
          needsInit: false,
          prompted: isPrompted
        });
        setNotice('Upload will retry automatically - your recording is safe on this device.');
      }
      setRecordingState('reviewing');
    }
  };

  const handleConfirmKeep = async () => {
    if (!currentSpeaker || !sessionBatch || !activeClipId || !activeTask || isConfirming) return;
    setIsConfirming(true);

    const currentTask = activeTask;
    if (!isOnline) {
      // Queue the recording before advancing, otherwise the audio sits in
      // IndexedDB under an id the server never issued and can never be sent.
      const pending = pendingRecordingRef.current;
      if (!pending) {
        setRecordingError('That recording is no longer available. Please record this task again.');
        setIsConfirming(false);
        return;
      }

      try {
        await saveAudioBlob(activeClipId, pending.blob);
        await enqueueUpload({
          clipId: activeClipId,
          blob: pending.blob,
          mimeType: pending.mimeType,
          token: currentSpeaker.token,
          deviceId,
          taskId: currentTask.task_id,
          needsInit: true,
          transcriptEdit: transcriptEdit || undefined,
          prompted: isPrompted
        });
      } catch (e) {
        console.error('Failed to queue offline recording', e);
        setRecordingError('We could not save that recording on this device. Please try again.');
        setIsConfirming(false);
        return;
      }

      const updatedTasks = [...sessionBatch.tasks];
      updatedTasks[currentTaskIndex].status = 'recorded';
      setSessionBatch({ ...sessionBatch, tasks: updatedTasks });

      const scenarioTasksAfter = updatedTasks
        .filter(t => t.intent === currentTask.intent && t.scenario_no === currentTask.scenario_no);
      const totalInScenario = scenarioTasksAfter.length;
      const recordedCount = scenarioTasksAfter.filter(t => t.status === 'recorded').length;
      const allScenarioDone = recordedCount === totalInScenario && totalInScenario >= 3;

      if (allScenarioDone) {
        setCompletedScenarioNo(currentTask.scenario_no);
        setShowScenarioComplete(true);
        setNotice(`Scenario ${currentTask.scenario_no} complete! Saved on this device - will upload when you are online.`);
        resetAudioState();
      } else {
        advanceTask();
        setNotice(`Saved on this device (${recordedCount}/${totalInScenario} done). Will upload when you are online.`);
        resetAudioState();
      }
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

        const scenarioTasksAfter = updatedTasks
          .filter(t => t.intent === currentTask.intent && t.scenario_no === currentTask.scenario_no);
        const totalInScenario = scenarioTasksAfter.length;
        const recordedCount = scenarioTasksAfter.filter(t => t.status === 'recorded').length;
        const allScenarioDone = recordedCount === totalInScenario && totalInScenario >= 3;

        if (allScenarioDone) {
          setCompletedScenarioNo(currentTask.scenario_no);
          setShowScenarioComplete(true);
          setNotice(`Scenario ${currentTask.scenario_no} complete! All examples recorded.`);
          resetAudioState();
        } else {
          advanceTask();
          setNotice(`Recording saved! (${recordedCount}/${totalInScenario} done)`);
          resetAudioState();
        }
      } else {
        // Never advance the task here - the recording is not saved.
        const errData = await res.json().catch(() => ({} as any));
        const serverMessage = errData?.detail?.message || errData?.detail;
        setRecordingError(
          typeof serverMessage === 'string'
            ? `Could not save this recording: ${serverMessage}`
            : 'Could not save this recording. Please try Keep again, or record it once more.'
        );
      }
    } catch (e) {
      // Never reached the server - queue locally so it syncs later.
      console.error('Confirm failed, queueing locally', e);
      const pending = pendingRecordingRef.current;
      if (pending && activeClipId) {
        try {
          await saveAudioBlob(activeClipId, pending.blob);
          await enqueueUpload({
            clipId: activeClipId,
            blob: pending.blob,
            mimeType: pending.mimeType,
            token: currentSpeaker.token,
            deviceId,
            taskId: currentTask.task_id,
            needsInit: false,
            transcriptEdit: transcriptEdit || undefined,
            prompted: isPrompted
          });
          setNotice('Network issue - saved on this device and will upload automatically.');
          advanceTask();
          resetAudioState();
        } catch (queueErr) {
          console.error('Failed to queue recording', queueErr);
          setRecordingError('Could not save this recording. Please check your connection and try again.');
        }
      } else {
        setRecordingError('Could not save this recording. Please check your connection and try again.');
      }
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
        setShowBatchCompleteModal(true);
      }
    }
  };

  const handleNextScenario = () => {
    setShowScenarioComplete(false);
    advanceTask();
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

  // Group tasks by scenario (all 3 examples for the same prompt)
  const scenarioTasks = useMemo(() => {
    if (!sessionBatch || !activeTask) return [];
    return sessionBatch.tasks
      .filter(t => t.intent === activeTask.intent && t.scenario_no === activeTask.scenario_no)
      .sort((a, b) => a.example_no - b.example_no);
  }, [sessionBatch, activeTask]);

  const currentExamplePos = scenarioTasks.findIndex(t => t.task_id === activeTask?.task_id);
  const allExamples = activeTask?.examples || [];
  const currentExampleText = allExamples[currentExamplePos] || '';

  // If showing speaker roster for switching
  if (showSpeakerRoster && speakerRoster.length > 0) {
    return (
      <div className="page-container">
        <div className="content-wrapper">
          <div className="card card-lg glass-card fade-in">
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
                  <span>{s.name || s.speaker_id}</span>
                  <span style={{ opacity: 0.6, fontSize: '0.85rem', marginLeft: 'auto' }}>
                    {s.speaker_id} &middot; {s.gender}, {s.age_band}
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
        <div className="content-wrapper onboarding-wrapper fade-in">
          <div className="card card-lg onboarding-card glass-card">
            <div className="card-header onboarding-header">
              <span className="eyebrow"><Sparkles size={14} style={{ display: 'inline', marginRight: 4 }} /> Welcome</span>
              <h1>Help Improve Speech AI</h1>
              <p>Record natural Hinglish conversations and help build better speech technology. Your recordings are associated with an anonymous participant ID, not your name.</p>
              <div className="hero-badges">
                <span className="hero-badge">🎙️ Record</span>
                <span className="hero-badge">🔒 Private</span>
                <span className="hero-badge">⚡ Simple</span>
              </div>
            </div>
            <form onSubmit={handleOnboardingSubmit} className="form">
              <div className="form-section-heading">
                <h2>About you</h2>
                <p>This helps researchers understand coverage across different speakers.</p>
              </div>

              <div className="form-group">
                <label className="form-label">Your Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter your name (e.g. Rahul Sharma)"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
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

              {/* Interactive Gender Selector */}
              <div className="form-group">
                <label className="form-label">Gender</label>
                <div className="pill-choice-group">
                  {[
                    { id: 'male', label: '👨 Male' },
                    { id: 'female', label: '👩 Female' },
                    { id: 'other', label: '⚧ Other' },
                    { id: 'prefer_not_say', label: '🔒 Prefer not to say' }
                  ].map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`pill-choice ${gender === opt.id ? 'active' : ''}`}
                      onClick={() => setGender(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Interactive L1 Selector */}
              <div className="form-group">
                <label className="form-label">Native Language (L1)</label>
                <div className="pill-choice-group">
                  {['Hindi', 'English', 'Hinglish', 'Bengali', 'Marathi', 'Other'].map(lang => (
                    <button
                      key={lang}
                      type="button"
                      className={`pill-choice ${l1 === lang ? 'active' : ''}`}
                      onClick={() => setL1(lang)}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
                {l1 === 'Other' && (
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Specify native language"
                    style={{ marginTop: 8 }}
                    onChange={(e) => setL1(e.target.value)}
                    required
                  />
                )}
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

              <div className="consent-box glass-card" style={{ padding: '20px', marginTop: '32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <ShieldCheck size={20} className="icon-success" style={{ color: 'var(--color-success)' }} />
                  <h4 style={{ margin: 0 }}>Data & Privacy Consent</h4>
                </div>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>I agree to contribute my anonymous voice recordings for researchers training speech recognition models. I understand no personal names or contact information is associated with my voice clips.</p>
                <label className="consent-check" style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer', background: 'var(--bg-primary)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
                  <input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} style={{ marginTop: '4px', transform: 'scale(1.2)' }} />
                  <span style={{ fontWeight: 500 }}>I understand and agree to participate.</span>
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

  // A saved session exists but AppRouter has not finished restoring it yet.
  // Hold here instead of falling through to the recorder with no speaker.
  if (showSpeakerConfirm && !currentSpeaker) {
    return (
      <main className="page-container onboarding-page">
        <div className="content-wrapper onboarding-wrapper">
          <div className="card card-center" role="status">
            <p>Restoring your profile…</p>
          </div>
        </div>
      </main>
    );
  }

  // If showing speaker confirmation
  if (showSpeakerConfirm && currentSpeaker) {
    return (
      <main className="page-container onboarding-page">
        <div className="content-wrapper onboarding-wrapper fade-in">
          <div className="card card-center identity-card glass-card">
            <Users size={48} className="icon-accent" />
            <span className="eyebrow">Welcome back</span>
            <h1>Are you ready to continue?</h1>
            <p>Confirm that you are recording as <strong>{currentSpeaker.name || currentSpeaker.speaker_id}</strong>.</p>
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
            <span className="eyebrow"><Sparkles size={14} style={{ display: 'inline', marginRight: 4 }} /> Hinglish speech study</span>
            <h1>Record your responses</h1>
            <p>Each prompt has 3 example phrasings — record one response for each example. Complete all 3 to move to the next prompt.</p>
          </div>
          <span className={`connection-status ${isOnline ? 'online' : 'offline'}`} role="status">
            <span aria-hidden="true" />
            {isOnline ? 'Ready to sync' : 'Offline mode'}
          </span>
        </header>

        {notice && <div className="volunteer-notice fade-in" role="status"><CheckCircle size={18} />{notice}</div>}

        {!isOnline && (
          <div className="offline-note" role="status">
            <WifiOff size={18} />
            <span><strong>You’re offline.</strong> Recordings will remain safely stored on this device.</span>
          </div>
        )}

        {/* Domain Selector - hidden when admin assigned a domain */}
        {sessionBatch?.assigned_domain ? (
          <div className="card domain-card glass-card assigned-domain">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Assigned Topic</span>
                <h2>You are recording for: <strong>{
                  {BNK: '🏦 Banking', EDU: '🎓 Education', TRV: '✈️ Travel', VAS: '🎙️ Assistant'}[sessionBatch.assigned_domain] || sessionBatch.assigned_domain
                }</strong></h2>
              </div>
            </div>
          </div>
        ) : (
          <div className="card domain-card glass-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Choose a topic</span>
                <h2>Pick the type of situation you’d like to speak about.</h2>
              </div>
            </div>
            <div className="domain-selector">
              {[
                { id: 'BNK', label: '🏦 Banking' },
                { id: 'EDU', label: '🎓 Education' },
                { id: 'TRV', label: '✈️ Travel' },
                { id: 'VAS', label: '🎙️ Assistant' }
              ].map(dom => (
                <button
                  key={dom.id}
                  className={`domain-btn ${selectedDomain === dom.id ? 'active' : ''}`}
                  onClick={() => setSelectedDomain(dom.id)}
                >
                  {dom.label}
                </button>
              ))}
            </div>
          </div>
        )}



        {/* Scenario Progress Grid — one card per scenario (3 examples each) */}
        {sessionBatch && activeTask && (() => {
          const flatIdxMap = new Map<string, number>();
          sessionBatch.tasks.forEach((t, i) => flatIdxMap.set(t.task_id, i));

          // Group tasks by (intent, scenario_no) → one scenario = 3 examples
          const scenarioMap = new Map<string, { tasks: typeof sessionBatch.tasks; intent: string; scenario_no: number }>();
          sessionBatch.tasks.forEach(t => {
            const key = `${t.intent}::${t.scenario_no}`;
            if (!scenarioMap.has(key)) scenarioMap.set(key, { tasks: [], intent: t.intent, scenario_no: t.scenario_no });
            scenarioMap.get(key)!.tasks.push(t);
          });
          const scenarioGroups = Array.from(scenarioMap.entries()).sort(([a], [b]) => a.localeCompare(b));

          return (
            <section className="card task-progress glass-card" aria-label="Scenario progress">
              <div className="progress-header-row">
                <span className="progress-label">Scenarios</span>
              </div>
              <div className="scenario-progress-grid">
                {scenarioGroups.map(([key, group]) => {
                  const recordedCount = group.tasks.filter(t => t.status === 'recorded').length;
                  const isCurrent = group.tasks.some(t => t.task_id === activeTask?.task_id);
                  const isDone = recordedCount === group.tasks.length;
                  const intentLabel = group.intent.replace(/^[A-Z]+\./, '').replace(/_/g, ' ');

                  const firstPending = group.tasks.find(t => t.status === 'pending');
                  const clickIdx = firstPending ? flatIdxMap.get(firstPending.task_id) : flatIdxMap.get(group.tasks[0].task_id);

                  return (
                    <div
                      key={key}
                      className={`scenario-card ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}
                      onClick={() => clickIdx !== undefined && setCurrentTaskIndex(clickIdx)}
                      role="button"
                      tabIndex={0}
                      title={`${intentLabel} — sc${group.scenario_no}: ${recordedCount}/${group.tasks.length} done`}
                    >
                      <span className="sc-intent">{intentLabel}</span>
                      <span className="sc-id">sc{group.scenario_no}</span>
                      <span className="sc-progress">{recordedCount}/{group.tasks.length}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })()}

        {/* Scenario Complete Celebration */}
        {showScenarioComplete && (
          <section className="card scenario-complete-card glass-card fade-in">
            <div className="scenario-complete-icon">🎉</div>
            <h2>Scenario {completedScenarioNo} Complete!</h2>
            <p>You have recorded all 3 examples for this scenario. Ready for the next one?</p>
            <button className="btn btn-primary btn-large" onClick={handleNextScenario}>
              Next Scenario <span style={{ marginLeft: 4 }}>→</span>
            </button>
          </section>
        )}

        {/* Recording Task — hidden while showing scenario complete */}
        {activeTask && !showScenarioComplete && (
          <section className="card card-lg recording-card glass-card fade-in" aria-labelledby="task-title">
            <div className="task-header">
              {/* Intent — big, on top */}
              <div className="intent-header-row">
                <span className="intent-label">INTENT</span>
                <h2 className="intent-name">{activeTask.intent.replace(/^[A-Z]+\./, '').replace(/_/g, ' ')}</h2>
              </div>

              <div className="task-meta-bar">
                  <div className="task-meta">
                    <span className="task-badge">Scenario {activeTask.scenario_no}</span>
                    <span className="task-step-count">sc{activeTask.scenario_no} — ex {activeTask.example_no}</span>
                  </div>
                {activeTask.register && (
                  <span className="task-register">🎭 Tone: <strong>{activeTask.register}</strong></span>
                )}
              </div>

              {/* Example Stepper — shows all 3 examples for this prompt */}
              {scenarioTasks.length > 1 && (
                <div className="example-stepper">
                  <div className="example-steps">
                    {scenarioTasks.map((t, i) => (
                      <div
                        key={t.task_id}
                        className={`example-step ${
                          t.status === 'recorded' ? 'completed' : ''
                        } ${t.task_id === activeTask?.task_id ? 'active' : ''} ${
                          t.status !== 'recorded' && t.task_id !== activeTask?.task_id ? 'upcoming' : ''
                        }`}
                      >
                        <div className="step-indicator">
                          {t.status === 'recorded' ? (
                            <Check size={14} />
                          ) : (
                            <span>{t.example_no}</span>
                          )}
                        </div>
                        <div className="step-detail">
                          <span className="step-title">ex {t.example_no}</span>
                          <span className="step-phrase">{allExamples[i] || ''}</span>
                        </div>
                        {t.task_id === activeTask?.task_id && t.status !== 'recorded' && (
                          <span className="step-active-badge">RECORD NOW</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Current Example Text — highlighted so user knows what to say */}
              <div className="current-example-box">
                <div className="current-example-header">
                  <Sparkles size={16} className="icon-accent" />
                  <span className="current-example-label">
                    sc{activeTask.scenario_no} — ex {activeTask.example_no} — Say this phrase:
                  </span>
                </div>
                <p className="current-example-phrase">“{currentExampleText}”</p>
              </div>
            </div>

            {(recordingState === 'idle' || recordingState === 'recording') ? (
              <div className="record-section">
                {/* Dynamic Sound Visualizer */}
                <AudioVisualizer
                  stream={mediaStreamRef.current}
                  isRecording={recordingState === 'recording'}
                  duration={recordingDuration}
                />

                <p className="record-hint" aria-live="polite">
                  {recordingState === 'recording'
                    ? 'Recording in progress. Press Space or click Stop when finished.'
                    : `Ready to record Example ${currentExamplePos + 1}. Press Space or click Start to say the phrase above.`}
                </p>

                {recordingError && <div className="recording-error" role="alert">{recordingError}</div>}

                <div className="rec-btn-container">
                  <button
                    className={`record-btn ${recordingState === 'recording' ? 'recording' : ''}`}
                    onClick={handleRecordToggle}
                    aria-label={recordingState === 'recording' ? 'Stop recording' : 'Start recording'}
                  >
                    <Mic size={26} />
                    <span>{recordingState === 'recording' ? 'Stop recording' : 'Start recording'}</span>
                    <kbd className="kbd-badge"></kbd>
                  </button>
                </div>
              </div>
            ) : (
              <div className="review-section fade-in" aria-live="polite">
                <div className="audio-player-box glass-card">
                  <div className="review-heading">
                    <div>
                      <span className="eyebrow">Recording ready</span>
                      <h2>Listen to your recording</h2>
                    </div>
                    {hasListened ? <span className="review-status complete"><CheckCircle size={16} />Reviewed</span> : <span className="review-status"><Headphones size={16} />Listen required</span>}
                  </div>
                  <AudioPlayer
                    ref={audioPlayerRef}
                    src={audioUrl || ''}
                    onPlay={() => setIsPlayingBack(true)}
                    onPause={() => setIsPlayingBack(false)}
                    onTimeUpdate={(currentTime) => {
                      furthestPlaybackRef.current = Math.max(furthestPlaybackRef.current, currentTime);
                    }}
                    onSeekAttempt={(attemptedTime) => {
                      if (!hasListened && attemptedTime > furthestPlaybackRef.current + 0.75) {
                        return furthestPlaybackRef.current;
                      }
                      return undefined;
                    }}
                    onEnded={() => { setIsPlayingBack(false); setHasListened(true); }}
                  />
                  <p className="listen-guidance">
                    {hasListened
                      ? 'Recording reviewed! Press Enter to keep or R to record again.'
                      : isPlayingBack
                        ? 'Listening… keep will unlock when playback finishes.'
                        : `Listen to your recording for Example ${currentExamplePos + 1}. When done, you can keep it or try again.`}
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">Type what you said (optional):</label>
                  <textarea
                    className="form-input"
                    placeholder={`What you said for Example ${currentExamplePos + 1}: "${currentExampleText}"`}
                    value={transcriptEdit}
                    onChange={(e) => setTranscriptEdit(e.target.value)}
                  />
                </div>

                <div className="button-group review-actions">
                  <button className="btn btn-secondary" onClick={handleDiscardRedo} disabled={isRedoing || isConfirming}>
                    {isRedoing ? <RefreshCw size={18} className="animate-spin" /> : <RotateCcw size={18} />}
                    <span>Record again</span>
                    <kbd className="kbd-badge">R</kbd>
                  </button>
                  <button className="btn btn-primary" onClick={handleConfirmKeep} disabled={isConfirming || isRedoing || !hasListened} title={!hasListened ? 'Listen to the full recording before keeping it.' : undefined}>
                    {isConfirming ? <RefreshCw size={18} className="animate-spin" /> : hasListened ? <Check size={18} /> : <Lock size={18} />}
                    <span>{isConfirming ? 'Saving…' : 'Keep recording'}</span>
                    {hasListened && <kbd className="kbd-badge light">Enter</kbd>}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {!sessionBatch && !showOnboarding && !showSpeakerConfirm && (
          <div className="card loading-task" role="status">Loading your next recording task…</div>
        )}

        {/* Batch Complete Celebration Modal */}
        {showBatchCompleteModal && (
          <div className="modal-overlay fade-in">
            <div className="modal-card glass-card">
              <div className="celebration-icon">🎉</div>
              <h2>Batch Completed!</h2>
              <p>Awesome work! You have finished all tasks in this batch.</p>
              <button
                className="btn btn-primary btn-large"
                onClick={() => {
                  setShowBatchCompleteModal(false);
                  fetchSessionBatch(selectedDomain);
                }}
              >
                Load Next Batch
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
