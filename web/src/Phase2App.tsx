import React, { useState, useEffect } from 'react';
import { Mic2, CheckCircle2, ShieldCheck, ArrowRight, RotateCcw, User, MapPin, Globe2, Calendar } from 'lucide-react';

const API_BASE = '/api';
const CONSENT_VERSION = 'consent-v1';

interface SpeakerResponse {
  speaker_id: string;
  token: string;
  age_band: string;
  consent_at: string;
}

type Screen = 'welcome' | 'consent' | 'ready';

export default function Phase2App() {
  // Core state
  const [currentScreen, setCurrentScreen] = useState<Screen>('welcome');
  const [deviceId, setDeviceId] = useState<string>('');
  const [currentSpeaker, setCurrentSpeaker] = useState<SpeakerResponse | null>(null);
  
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
        throw new Error('Failed to register device');
      }
    } catch (err) {
      console.error('Device registration error:', err);
      setError('Failed to register device. Please refresh and try again.');
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
      // For Phase 2, we always create a new speaker (no lookup by identifier)
      // The identifier is just used as a reference/display name
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
      throw new Error(errorData.error?.message || 'Failed to create speaker');
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
      // In Phase 2, consent is already recorded during speaker creation
      // This is just UI validation
      setCurrentScreen('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process consent');
    } finally {
      setIsLoading(false);
    }
  };

  const resetSession = () => {
    // Clear session data
    localStorage.removeItem('speaker_token');
    localStorage.removeItem('speaker_id');
    setCurrentSpeaker(null);
    setConsentAccepted(false);
    setSpeakerIdentifier('');
    setError(null);
    setCurrentScreen('welcome');
  };

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
              onClick={resetSession}
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

  if (currentScreen === 'ready' && currentSpeaker) {
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
                <span className="info-value">{currentSpeaker.speaker_id}</span>
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
                  {new Date(currentSpeaker.consent_at).toLocaleDateString('en-IN', { 
                    day: 'numeric', 
                    month: 'short', 
                    year: 'numeric' 
                  })}
                </span>
              </div>
            </div>
          </div>

          <div className="next-phase-banner">
            <div className="banner-icon">
              <Mic2 size={24} />
            </div>
            <div className="banner-content">
              <h3>Next: Task Assignment</h3>
              <p>Recording features will be available in the next phase</p>
            </div>
          </div>

          <div className="button-group">
            <button 
              onClick={resetSession}
              className="btn btn-secondary btn-large"
            >
              <RotateCcw size={18} />
              Test Another Speaker
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}