import { useState, useRef, useCallback, useEffect } from 'react';

// Recording state machine
export type RecordingState =
  | 'IDLE'
  | 'REQUESTING_PERMISSION'
  | 'RECORDING'
  | 'STOPPING'
  | 'PERSISTING'
  | 'RECORDED'
  | 'ERROR';

// Recording result data structure
export interface RecordingResult {
  recordingId?: string; // UUID assigned when saved to IndexedDB
  blob: Blob;
  mimeType: string;
  durationMs: number;
  objectUrl: string;
  createdAt: number;
  savedToIndexedDB?: boolean; // True if successfully persisted
}

// Playback state tracking
export interface PlaybackState {
  hasStartedPlayback: boolean;
  hasCompletedPlayback: boolean;
  isPlaying: boolean;
}

// Hook return type
export interface UseAudioRecorderReturn {
  // State
  state: RecordingState;
  recording: RecordingResult | null;
  error: string | null;
  elapsedTime: number;
  playbackState: PlaybackState;
  
  // Actions
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  discardRecording: () => void;
  playRecording: () => void;
  pauseRecording: () => void;
  
  // Audio element ref for player
  audioRef: React.RefObject<HTMLAudioElement>;
}

// Hook options for persistence
export interface UseAudioRecorderOptions {
  onRecordingComplete?: (recording: RecordingResult) => void;
  persistToIndexedDB?: (blob: Blob, mimeType: string, durationMs: number, createdAt: number) => Promise<string | null>;
}

// Supported MIME types in order of preference
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=aac',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

// Minimum recording duration (0.4s = 400ms to filter out mis-taps)
const MIN_DURATION_MS = 400;

export function useAudioRecorder(options: UseAudioRecorderOptions = {}): UseAudioRecorderReturn {
  const { onRecordingComplete, persistToIndexedDB } = options;
  // State
  const [state, setState] = useState<RecordingState>('IDLE');
  const [recording, setRecording] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    hasStartedPlayback: false,
    hasCompletedPlayback: false,
    isPlaying: false,
  });

  // Refs for managing recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Detect supported MIME type
  const getSupportedMimeType = useCallback((): string | null => {
    if (typeof MediaRecorder === 'undefined') {
      return null;
    }
    
    for (const mimeType of PREFERRED_MIME_TYPES) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return mimeType;
      }
    }
    
    return null;
  }, []);

  // Clean up media stream
  const cleanupMediaStream = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      mediaStreamRef.current = null;
    }
  }, []);

  // Clean up timer
  const cleanupTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  // Revoke object URL
  const revokeObjectUrl = useCallback((url: string) => {
    try {
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('Failed to revoke object URL:', err);
    }
  }, []);

  // Start recording timer
  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setElapsedTime(0);
    
    timerIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      setElapsedTime(elapsed);
    }, 100); // Update every 100ms for smooth display
  }, []);

  // Stop recording timer
  const stopTimer = useCallback(() => {
    cleanupTimer();
    const finalElapsed = Date.now() - startTimeRef.current;
    setElapsedTime(finalElapsed);
    return finalElapsed;
  }, [cleanupTimer]);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      // Check browser support
      if (typeof MediaRecorder === 'undefined') {
        setState('ERROR');
        setError('Your browser does not support audio recording. Please use a recent version of Chrome, Edge, Firefox, or Safari.');
        return;
      }

      // Check for supported MIME type
      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        setState('ERROR');
        setError('No supported audio format found in your browser.');
        return;
      }

      // Clear any previous error
      setError(null);
      setState('REQUESTING_PERMISSION');

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      mediaStreamRef.current = stream;

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 32000,
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      // Handle data available
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      // Handle recording stop
      mediaRecorder.onstop = async () => {
        const durationMs = stopTimer();
        
        // Check minimum duration
        if (durationMs < MIN_DURATION_MS) {
          // Too short - discard silently and reset
          cleanupMediaStream();
          setState('IDLE');
          setError('Recording too short. Please try again.');
          return;
        }

        // Create blob from chunks
        const blob = new Blob(chunksRef.current, { type: mimeType });
        
        // Check if blob is empty
        if (blob.size === 0) {
          cleanupMediaStream();
          setState('ERROR');
          setError('No usable audio was recorded. Please try again.');
          return;
        }

        // Create object URL
        const objectUrl = URL.createObjectURL(blob);
        const createdAt = Date.now();

        // If persistence is enabled, save to IndexedDB first
        let recordingId: string | undefined;
        let savedToIndexedDB = false;

        if (persistToIndexedDB) {
          setState('PERSISTING');
          
          try {
            const id = await persistToIndexedDB(blob, mimeType, durationMs, createdAt);
            if (id) {
              recordingId = id;
              savedToIndexedDB = true;
            } else {
              // Persistence failed but we continue with recording
              console.warn('Recording will not be persisted to IndexedDB');
            }
          } catch (err: any) {
            console.error('IndexedDB persistence error:', err);
            // Continue anyway - recording still works, just not persisted
            console.warn('Recording will not be persisted, but you can still listen to it');
          }
        }

        // Create recording result
        const result: RecordingResult = {
          recordingId,
          blob,
          mimeType,
          durationMs,
          objectUrl,
          createdAt,
          savedToIndexedDB,
        };

        setRecording(result);
        setState('RECORDED');
        cleanupMediaStream();

        // Call completion callback if provided
        if (onRecordingComplete) {
          onRecordingComplete(result);
        }

        // Attempt automatic playback
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.src = objectUrl;
            audioRef.current.play().catch((err) => {
              // Autoplay blocked - this is expected in many browsers
              console.log('Autoplay blocked:', err);
            });
          }
        }, 100);
      };

      // Handle errors
      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        stopTimer();
        cleanupMediaStream();
        setState('ERROR');
        setError('Recording failed. Please try again.');
      };

      // Start recording
      mediaRecorder.start();
      setState('RECORDING');
      startTimer();

    } catch (err: any) {
      console.error('Start recording error:', err);
      stopTimer();
      cleanupMediaStream();
      setState('ERROR');

      // User-friendly error messages
      if (err.name === 'NotAllowedError') {
        setError('Microphone access was denied. Please allow microphone access and try again.');
      } else if (err.name === 'NotFoundError') {
        setError('No microphone was detected. Please connect a microphone and try again.');
      } else if (err.name === 'NotReadableError') {
        setError('Your microphone is being used by another application. Please close other apps and try again.');
      } else {
        setError('Failed to start recording. Please check your microphone and try again.');
      }
    }
  }, [getSupportedMimeType, cleanupMediaStream, cleanupTimer, stopTimer, startTimer]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      setState('STOPPING');
      mediaRecorderRef.current.stop();
    }
  }, []);

  // Discard recording
  const discardRecording = useCallback(() => {
    if (recording) {
      revokeObjectUrl(recording.objectUrl);
    }
    
    setRecording(null);
    setState('IDLE');
    setElapsedTime(0);
    setPlaybackState({
      hasStartedPlayback: false,
      hasCompletedPlayback: false,
      isPlaying: false,
    });
    setError(null);
  }, [recording, revokeObjectUrl]);

  // Play recording
  const playRecording = useCallback(() => {
    if (audioRef.current && recording) {
      audioRef.current.play();
    }
  }, [recording]);

  // Pause recording
  const pauseRecording = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  // Handle audio element events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => {
      setPlaybackState(prev => ({
        ...prev,
        hasStartedPlayback: true,
        isPlaying: true,
      }));
    };

    const handlePause = () => {
      setPlaybackState(prev => ({
        ...prev,
        isPlaying: false,
      }));
    };

    const handleEnded = () => {
      setPlaybackState(prev => ({
        ...prev,
        hasCompletedPlayback: true,
        isPlaying: false,
      }));
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [recording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupMediaStream();
      cleanupTimer();
      if (recording) {
        revokeObjectUrl(recording.objectUrl);
      }
    };
  }, [recording, cleanupMediaStream, cleanupTimer, revokeObjectUrl]);

  return {
    state,
    recording,
    error,
    elapsedTime,
    playbackState,
    startRecording,
    stopRecording,
    discardRecording,
    playRecording,
    pauseRecording,
    audioRef,
  };
}
