import { useState, type FormEvent } from 'react';
import { Mic, LogIn, UserPlus, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth, describeAuthError } from '../AuthContext';

type Mode = 'signin' | 'signup' | 'reset';

/**
 * Sign-in / sign-up for volunteers.
 *
 * An account is what makes recordings portable: the server keys a speaker
 * profile by Firebase uid, so signing in on a new phone restores the same
 * profile and the same recordings.
 */
export default function SignInPage() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        await signUp(email, password);
      } else if (mode === 'signin') {
        await signIn(email, password);
      } else {
        await resetPassword(email);
        setNotice('If that email has an account, a reset link is on its way.');
        setMode('signin');
      }
      // On success the auth listener in AuthProvider re-renders the router;
      // no navigation needed here.
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, string> = {
    signin: 'Welcome back',
    signup: 'Create your account',
    reset: 'Reset your password',
  };

  const blurbs: Record<Mode, string> = {
    signin: 'Sign in to continue recording and to see everything you have contributed.',
    signup: 'An account keeps your recordings with you — on this device and any other.',
    reset: 'Enter your email and we will send you a link to set a new password.',
  };

  return (
    <div className="page-container onboarding-page">
      <div className="content-wrapper onboarding-wrapper">
        <div className="card card-lg onboarding-card">
          <div className="card-header onboarding-header">
            <span className="eyebrow">
              <Mic size={13} style={{ display: 'inline', marginRight: 5 }} />
              Hinglish speech study
            </span>
            <h1>{titles[mode]}</h1>
            <p>{blurbs[mode]}</p>
          </div>

          {error && (
            <div className="alert alert-danger" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="volunteer-notice" role="status">
              <CheckCircle size={18} />
              <span>{notice}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="form">
            <div className="form-group">
              <label className="form-label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={busy}
              />
            </div>

            {mode !== 'reset' && (
              <div className="form-group">
                <label className="form-label" htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  className="form-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  minLength={6}
                  required
                  disabled={busy}
                />
                {mode === 'signup' && (
                  <span className="form-hint">At least 6 characters.</span>
                )}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              {mode === 'signup' ? <UserPlus size={18} /> : <LogIn size={18} />}
              {busy
                ? 'Please wait…'
                : mode === 'signup'
                  ? 'Create account'
                  : mode === 'signin'
                    ? 'Sign in'
                    : 'Send reset link'}
            </button>
          </form>

          <div className="auth-switch">
            {mode === 'signin' && (
              <>
                <button className="link-button" onClick={() => { setMode('signup'); setError(''); }}>
                  New here? Create an account
                </button>
                <button className="link-button" onClick={() => { setMode('reset'); setError(''); }}>
                  Forgot your password?
                </button>
              </>
            )}
            {mode !== 'signin' && (
              <button className="link-button" onClick={() => { setMode('signin'); setError(''); }}>
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
