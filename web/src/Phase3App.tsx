import React, { useState, useEffect } from 'react';
import { Mic2, CheckCircle2, ShieldCheck, ArrowRight, RotateCcw, User, MapPin, Globe2, Calendar, Target, Mic, AlertCircle, CheckCircle } from 'lucide-react';
import { useAudioRecorder } from './hooks/useAudioRecorder';

const API_BASE = '/api';
const CONSENT_VERSION = 'consent-v1';

interface SpeakerResponse {
  speaker_id: string;
  token: string;
  age_band: string;
  consent_at: string;
}

interface TaskResponse {
  task_id: string;
  intent: string;
  scenario_id: string;
  scenario_no: number;
  example_no: number;
  text_hi: string;
  examples: string[];
  register: string | null;
  status: string;
  redo_count: number;
}

interface ProgressInfo {
  intents_total: number;
  intents_done: number;
  current_intent: string | null;
  scenarios_in_intent: number;
  scenarios_done: number;
  examples_in_scenario: number;
  examples_done: number;
}

interface SessionBatchInfo {
  domain: string;
  batch_no: number;
  tasks: TaskResponse[];
  progress: ProgressInfo;
}

type Screen = 'welcome' | 'consent' | 'ready' | 'task';

export default function Phase3App() {
  // Core state
  const [currentScreen, setCurrentScreen] = useState<Screen>('welcome');
  const [deviceId, setDeviceId] = useState<string>('');
  const [currentSpeaker, setCurrentSpeaker] = useState<SpeakerResponse | null>(null);
  const [currentTask, setCurrentTask] = useState<TaskResponse | null>(null);
  const [sessionBatch, setSessionBatch] = useState<SessionBatchInfo | null>(null);
  
  // Form state
  const [speakerIdentifier, setSpeakerIdentifier] = useState<string>('');
  const [age, setAge] = useState<number>(25);
  const [gender, setGender] = useState<string>('male');
  const [l1, setL1] = useState<string>('Hindi');
  const [region, setRegion] = useState<string>('Delhi');
  const [consentAccepted, setConsentAccepted] = useState<boolean>(false);
  
  // UI state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Audio recorder hook (must be at top level)
  const recorder = useAudioRecorder();

  // Initialize device ID on mount
  useEffect(() => {
    let devId = localStorage.getItem('device_id');
    if (!devId) {
      devId = crypto.randomUUID();
      localStorage.setItem('device_id', devId);
    }
    setDeviceId(devId);
    
    // Register device with backend
    registerDevice(devId);
    
    // Check if we have an existing speaker session
    const speakerToken = localStorage.getItem('speaker_token');
    const speakerId = localStorage.getItem('speaker_id');
    if (speakerToken && speakerId) {
      // Validate token and restore session
      validateAndRestoreSession(speakerToken, speakerId);
    }
  }, []);

  const registerDevice = async (deviceId: string) => {
    try {
      const response = await fetch(`${API_BASE}/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          ua_class: getUserAgentClass()
        })
      });
      
      if (!response.ok) {
        console.warn('Device registration failed, continuing anyway');
      }
    } catch (err) {
      console.error('Device registration error:', err);
    }
  };

  const validateAndRestoreSession = async (token: string, speakerId: string) => {
    try {
      // Try to fetch next task to validate token
      const response = await fetch(`${API_BASE}/session/next`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Device-ID': deviceId
        }
      });
      
      if (response.ok) {
        // Token is valid, restore speaker info and go to task screen
        setCurrentSpeaker({
          speaker_id: speakerId,
          token: token,
          age_band: '',
          consent_at: ''
        });
        setCurrentScreen('task');
        
        const batch = await response.json();
        setSessionBatch(batch.batch);
        if (batch.batch.tasks && batch.batch.tasks.length > 0) {
          // Find first pending task
          const pendingTask = batch.batch.tasks.find((t: TaskResponse) => t.status === 'pending');
          setCurrentTask(pendingTask || batch.batch.tasks[0]);
        }
      } else {
        // Token invalid, clear and start fresh
        localStorage.removeItem('speaker_token');
        localStorage.removeItem('speaker_id');
      }
    } catch (err) {
      console.error('Session restore error:', err);
    }
  };

  const getUserAgentClass = (): string => {
    const ua = navigator.userAgent;
    if (ua.includes('Android')) return 'Android Chrome';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS Safari';
    if (ua.includes('Chrome')) return 'Desktop Chrome';
    if (ua.includes('Firefox')) return 'Desktop Firefox';
    if (ua.includes('Safari')) return 'Desktop Safari';
    return 'Unknown';
  };

  const handleWelcomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!speakerIdentifier.trim()) {
      setError('Please enter a speaker identifier');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await createSpeaker();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const createSpeaker = async () => {
    const response = await fetch(`${API_BASE}/speakers`, {
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
        consent_version: CONSENT_VERSION
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Failed to create speaker');
    }

    const speaker: SpeakerResponse = await response.json();
    setCurrentSpeaker(speaker);
    
    // Store speaker token for session persistence
    localStorage.setItem('speaker_token', speaker.token);
    localStorage.setItem('speaker_id', speaker.speaker_id);
    
    // Move to consent screen
    setCurrentScreen('consent');
  };

  const handleConsentSubmit = async () => {
    if (!consentAccepted) {
      setError('You must accept the consent to continue');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Consent is already recorded during speaker creation
      // Move to ready screen
      setCurrentScreen('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process consent');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestTask = async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (!currentSpeaker) {
        throw new Error('No speaker session found');
      }

      const response = await fetch(`${API_BASE}/session/next`, {
        headers: {
          'Authorization': `Bearer ${currentSpeaker.token}`,
          'X-Device-ID': deviceId
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // Check for consent error
        if (response.status === 403) {
          throw new Error('Consent required. Please complete onboarding.');
        }
        
        throw new Error(errorData.detail?.message || 'Failed to get task');
      }

      const data = await response.json();
      setSessionBatch(data.batch);
      
      if (data.batch.tasks && data.batch.tasks.length > 0) {
        // Find first pending task
        const pendingTask = data.batch.tasks.find((t: TaskResponse) => t.status === 'pending');
        setCurrentTask(pendingTask || data.batch.tasks[0]);
        setCurrentScreen('task');
      } else {
        setError('No tasks available. Please contact support.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get task');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartOver = () => {
    // Clear session and start from beginning
    localStorage.removeItem('speaker_token');
    localStorage.removeItem('speaker_id');
    setCurrentSpeaker(null);
    setCurrentTask(null);
    setSessionBatch(null);
    setSpeakerIdentifier('');
    setConsentAccepted(false);
    setCurrentScreen('welcome');
  };

  // Screen: Welcome
  if (currentScreen === 'welcome') {
    return (
      <div className="app-container fade-in">
        <div className="header-section">
          <div className="icon-glow">
            <Mic2 size={56} strokeWidth={2} />
          </div>
          <h1 className="main-title">Hinglish Voice Project</h1>
          <p className="subtitle">Help us build better speech recognition</p>
        </div>

        <div className="glass-card">
          <form onSubmit={handleWelcomeSubmit}>
            <div className="form-section">
              <h3 className="section-title">
                <User size={20} />
                About You
              </h3>
              
              <div className="form-group">
                <label className="form-label">Your Name or Nickname</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={speakerIdentifier}
                  onChange={(e) => setSpeakerIdentifier(e.target.value)}
                  placeholder="e.g., Priya, Rahul"
                  required 
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    <Calendar size={16} />
                    Age
                  </label>
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
              </div>
            </div>

            <div className="divider"></div>

            <div className="form-section">
              <h3 className="section-title">
                <Globe2 size={20} />
                Language Background
              </h3>

              <div className="form-group">
                <label className="form-label">Native Language (Mother Tongue)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={l1}
                  onChange={(e) => setL1(e.target.value)}
                  placeholder="e.g., Hindi, Tamil, Bengali"
                  required 
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <MapPin size={16} />
                  Home State / Region
                </label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="e.g., Delhi, Maharashtra, Karnataka"
                  required 
                />
              </div>
            </div>

            {error && (
              <div className="error-banner">
                <p>{error}</p>
              </div>
            )}

            <button 
              type="submit" 
              className="btn btn-primary btn-large"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <div className="spinner"></div>
                  Processing...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight size={20} />
                </>
              )}
            </button>
          </form>

          <div className="device-info">
            <span className="device-label">Device</span>
            <span className="device-id">{deviceId.slice(0, 8)}...{deviceId.slice(-4)}</span>
          </div>
        </div>
      </div>
    );
  }

  // Screen: Consent
  if (currentScreen === 'consent') {
    return (
      <div className="app-container fade-in">
        <div className="header-section">
          <div className="icon-glow success">
            <ShieldCheck size={56} strokeWidth={2} />
          </div>
          <h1 className="main-title">Consent Agreement</h1>
          <p className="subtitle">Your privacy and rights matter to us</p>
        </div>

        <div className="glass-card">
          <div className="consent-content">
            <div className="consent-section">
              <h3 className="consent-heading">What We're Building</h3>
              <p>
                You're helping us create better speech recognition for Hinglish (Hindi-English mixed language). 
                Your voice recordings will train AI models to understand how people naturally speak.
              </p>
            </div>

            <div className="consent-section">
              <h3 className="consent-heading">What We Collect</h3>
              <ul className="consent-list">
                <li>Voice recordings of provided text prompts</li>
                <li>Basic demographics (age range, gender, language, region)</li>
                <li>Recording quality and device metadata</li>
              </ul>
            </div>

            <div className="consent-section">
              <h3 className="consent-heading">Your Privacy</h3>
              <ul className="consent-list">
                <li><strong>Anonymous ID:</strong> You'll get a speaker ID like SPK_0042</li>
                <li><strong>No personal data:</strong> No names or contact info stored</li>
                <li><strong>Age bands:</strong> Age converted to ranges (e.g., 26-35)</li>
                <li><strong>Your control:</strong> Request data deletion anytime</li>
              </ul>
            </div>

            <div className="consent-version">
              Version {CONSENT_VERSION}
            </div>
          </div>

          <div className="consent-checkbox">
            <label className="checkbox-label">
              <input 
                type="checkbox" 
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                className="checkbox-input"
              />
              <span className="checkbox-text">
                I understand and agree to participate in this voice recording project
              </span>
            </label>
          </div>

          {error && (
            <div className="error-banner">
              <p>{error}</p>
            </div>
          )}

          <div className="button-group">
            <button 
              onClick={() => setCurrentScreen('welcome')}
              className="btn btn-secondary"
            >
              <RotateCcw size={18} />
              Go Back
            </button>
            <button 
              onClick={handleConsentSubmit}
              className="btn btn-primary btn-large"
              disabled={!consentAccepted || isLoading}
            >
              {isLoading ? (
                <>
                  <div className="spinner"></div>
                  Processing...
                </>
              ) : (
                <>
                  I Agree
                  <ArrowRight size={20} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Screen: Ready
  if (currentScreen === 'ready') {
    return (
      <div className="app-container fade-in">
        <div className="header-section">
          <div className="icon-glow success">
            <CheckCircle2 size={56} strokeWidth={2} />
          </div>
          <h1 className="main-title success-text">You're All Set!</h1>
          <p className="subtitle">Setup completed successfully</p>
        </div>

        <div className="glass-card">
          <div className="info-grid">
            <div className="info-card">
              <div className="info-icon">
                <User size={20} />
              </div>
              <div className="info-content">
                <span className="info-label">Speaker ID</span>
                <span className="info-value">{currentSpeaker?.speaker_id}</span>
                <span className="info-detail">{speakerIdentifier}</span>
              </div>
            </div>

            <div className="info-card">
              <div className="info-icon">
                <Globe2 size={20} />
              </div>
              <div className="info-content">
                <span className="info-label">Device</span>
                <span className="info-value">{deviceId.slice(0, 8)}...{deviceId.slice(-4)}</span>
                <span className="info-detail">{getUserAgentClass()}</span>
              </div>
            </div>

            <div className="info-card success-card">
              <div className="info-icon success">
                <ShieldCheck size={20} />
              </div>
              <div className="info-content">
                <span className="info-label">Consent</span>
                <span className="info-value success-text">Accepted</span>
                <span className="info-detail">
                  {currentSpeaker?.consent_at ? new Date(currentSpeaker.consent_at).toLocaleDateString('en-IN', { 
                    day: 'numeric', 
                    month: 'short', 
                    year: 'numeric' 
                  }) : 'Just now'}
                </span>
              </div>
            </div>
          </div>

          {error && (
            <div className="error-banner">
              <p>{error}</p>
            </div>
          )}

          <button 
            onClick={handleRequestTask}
            className="btn btn-primary btn-large"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <div className="spinner"></div>
                Loading Task...
              </>
            ) : (
              <>
                <Target size={20} />
                Get Your First Task
              </>
            )}
          </button>

          <div className="button-group" style={{ marginTop: '16px' }}>
            <button 
              onClick={handleStartOver}
              className="btn btn-secondary"
            >
              <RotateCcw size={18} />
              Start Over
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Screen: Task Assignment
  if (currentScreen === 'task' && currentTask && sessionBatch) {
    // Format elapsed time as mm:ss
    const formatTime = (ms: number): string => {
      const seconds = Math.floor(ms / 1000);
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Handle record button pointer events
    const handlePointerDown = () => {
      if (recorder.state === 'IDLE' || recorder.state === 'ERROR') {
        recorder.startRecording();
      }
    };

    const handlePointerUp = () => {
      if (recorder.state === 'RECORDING') {
        recorder.stopRecording();
      }
    };

    // Handle record again
    const handleRecordAgain = () => {
      recorder.discardRecording();
    };

    return (
      <div className="app-container fade-in">
        <div className="glass-card">
          <div className="task-header">
            <div className="task-header-left">
              <h2>Recording Task</h2>
              <p>Speaker: {currentSpeaker?.speaker_id}</p>
            </div>
            <Target size={40} style={{ color: 'var(--color-accent)' }} />
          </div>

          {/* Task Metadata */}
          <div className="task-meta-grid">
            <div className="task-meta-card domain">
              <p className="task-meta-label">Domain</p>
              <p className="task-meta-value">{sessionBatch.domain}</p>
            </div>
            <div className="task-meta-card intent">
              <p className="task-meta-label">Intent</p>
              <p className="task-meta-value">{currentTask.intent}</p>
            </div>
          </div>

          {/* Scenario */}
          <div className="task-scenario-card">
            <p className="task-scenario-label">SCENARIO</p>
            <p className="task-scenario-text">{currentTask.text_hi}</p>
            {currentTask.register && (
              <p className="task-scenario-register">Register: {currentTask.register}</p>
            )}
          </div>

          {/* Progress Info */}
          <div className="task-progress-card">
            <p className="task-progress-label">PROGRESS</p>
            <div className="task-progress-grid">
              <div className="task-progress-item">
                <span className="task-progress-item-label">Batch</span>
                <span className="task-progress-item-value">{sessionBatch.batch_no}/3</span>
              </div>
              <div className="task-progress-item">
                <span className="task-progress-item-label">Scenario</span>
                <span className="task-progress-item-value">
                  {currentTask.scenario_no}/{sessionBatch.progress.scenarios_in_intent}
                </span>
              </div>
              <div className="task-progress-item">
                <span className="task-progress-item-label">Example</span>
                <span className="task-progress-item-value">{currentTask.example_no}/3</span>
              </div>
            </div>
          </div>

          {/* Recording Section */}
          {recorder.state === 'REQUESTING_PERMISSION' && (
            <div className="permission-request">
              <div className="permission-icon">
                <Mic size={40} />
              </div>
              <div className="permission-text">
                <h3>Microphone Access Required</h3>
                <p>
                  Please allow microphone access in your browser to record your response.
                  Your privacy is important - recordings are only used for this research project.
                </p>
              </div>
            </div>
          )}

          {(recorder.state === 'IDLE' || recorder.state === 'RECORDING' || recorder.state === 'STOPPING') && (
            <div className="recording-section">
              <div className={`recording-status ${recorder.state === 'RECORDING' ? 'recording' : ''}`}>
                {recorder.state === 'IDLE' && 'Ready to record'}
                {recorder.state === 'RECORDING' && `Recording: ${formatTime(recorder.elapsedTime)}`}
                {recorder.state === 'STOPPING' && 'Finalizing recording...'}
              </div>

              <div className="record-button-wrapper">
                <button
                  className={`record-button ${recorder.state === 'RECORDING' ? 'recording' : ''}`}
                  onPointerDown={handlePointerDown}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  disabled={recorder.state === 'STOPPING' || recorder.state === 'REQUESTING_PERMISSION' || recorder.state === 'RECORDED'}
                  aria-label={recorder.state === 'RECORDING' ? 'Release to stop recording' : 'Hold to record'}
                >
                  {recorder.state === 'RECORDING' ? (
                    <span className="record-timer">{formatTime(recorder.elapsedTime)}</span>
                  ) : (
                    <Mic size={48} />
                  )}
                </button>
              </div>

              <p className={`record-instruction ${recorder.state === 'RECORDING' ? 'recording' : ''}`}>
                {recorder.state === 'IDLE' && 'Hold button to record'}
                {recorder.state === 'RECORDING' && 'Release to stop'}
                {recorder.state === 'STOPPING' && 'Processing...'}
              </p>
            </div>
          )}

          {recorder.state === 'ERROR' && recorder.error && (
            <div className="recording-error">
              <AlertCircle size={24} className="recording-error-icon" />
              <div className="recording-error-text">
                <h4>Recording Error</h4>
                <p>{recorder.error}</p>
              </div>
            </div>
          )}

          {recorder.state === 'RECORDED' && recorder.recording && (
            <div className="playback-section">
              <div className="playback-header">
                <div className="playback-header-icon">
                  <CheckCircle size={24} />
                </div>
                <div className="playback-header-text">
                  <h3>Recording Complete</h3>
                  <p>Duration: {formatTime(recorder.recording.durationMs)}</p>
                </div>
              </div>

              <div className="audio-player-wrapper">
                <audio
                  ref={recorder.audioRef}
                  controls
                  controlsList="nodownload"
                  src={recorder.recording.objectUrl}
                />
              </div>

              {!recorder.playbackState.hasStartedPlayback && (
                <div className="playback-info">
                  <AlertCircle size={16} />
                  <span>Please listen to your recording before proceeding</span>
                </div>
              )}

              {recorder.playbackState.hasCompletedPlayback && (
                <div className="playback-info" style={{ borderColor: 'rgba(16, 185, 129, 0.3)', background: 'rgba(16, 185, 129, 0.08)' }}>
                  <CheckCircle size={16} />
                  <span>Playback completed - you can now keep or re-record</span>
                </div>
              )}

              <div className="playback-actions">
                <button
                  onClick={handleRecordAgain}
                  className="btn btn-secondary"
                >
                  <RotateCcw size={18} />
                  Record Again
                </button>
                <button
                  onClick={() => alert('Keep functionality will be implemented in Phase 5 (IndexedDB + Upload)')}
                  className="btn btn-primary"
                  disabled={!recorder.playbackState.hasStartedPlayback}
                >
                  <CheckCircle size={18} />
                  Keep Recording
                </button>
              </div>
            </div>
          )}

          {/* Task Debug Info */}
          <div className="task-debug-card">
            <p>Task ID: {currentTask.task_id.substring(0, 20)}...</p>
            <p>Scenario: {currentTask.scenario_id}</p>
            {recorder.recording && (
              <>
                <p>Recording: {(recorder.recording.blob.size / 1024).toFixed(2)} KB</p>
                <p>MIME: {recorder.recording.mimeType}</p>
              </>
            )}
          </div>

          {error && (
            <div className="error-banner">
              <p>{error}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="task-action-group">
            <button
              onClick={handleStartOver}
              className="btn btn-secondary"
            >
              <RotateCcw size={18} />
              Start Over
            </button>
            <button
              onClick={handleRequestTask}
              className="btn btn-primary"
              disabled={recorder.state === 'RECORDING'}
            >
              <ArrowRight size={18} />
              Next Task
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Fallback
  return (
    <div className="app-container fade-in">
      <div className="glass-card" style={{ textAlign: 'center', padding: '60px 28px' }}>
        <div className="spinner" style={{ width: '40px', height: '40px', margin: '0 auto 24px' }}></div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>Loading...</p>
      </div>
    </div>
  );
}
