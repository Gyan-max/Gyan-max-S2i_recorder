import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import ProgressPage from './pages/ProgressPage';
import MyRecordingsPage from './pages/MyRecordingsPage';
import SignInPage from './pages/SignInPage';
import AdminPanel from './pages/AdminPanel';
import { useAuth } from './AuthContext';
import { isFirebaseConfigured } from './firebase';
import { apiFetch } from './api';
import './styles/responsive.css';

export default function AppRouter() {
  const { user, profile, isAdmin, loading, refreshProfile } = useAuth();

  const [deviceId, setDeviceId] = useState<string>('');
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('s2i_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('s2i_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  useEffect(() => {
    // The device id is not identity - it only groups recordings made on the
    // same hardware. Speaker identity comes from Firebase Auth.
    let devId = localStorage.getItem('device_id');
    if (!devId) {
      devId = crypto.randomUUID();
      localStorage.setItem('device_id', devId);
    }
    setDeviceId(devId);

    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Register the device once signed in: the endpoint requires no auth, but
  // doing it here keeps the roster tied to a real session.
  useEffect(() => {
    if (!deviceId || !user) return;
    apiFetch('/devices', {
      method: 'POST',
      body: { device_id: deviceId, ua_class: navigator.userAgent },
    }).catch((e) => console.error('Device registration failed', e));
  }, [deviceId, user]);

  if (!isFirebaseConfigured) {
    return (
      <div className="page-container">
        <div className="content-wrapper narrow-wrapper">
          <div className="card card-center">
            <h2>Firebase is not configured</h2>
            <p>
              Set the <code>VITE_FIREBASE_*</code> variables in your build
              environment, then rebuild. See <code>docs/FIREBASE.md</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Hold the shell until the auth check settles, otherwise a signed-in user
  // sees the sign-in page flash before being redirected away from it.
  if (loading) {
    return (
      <div className="page-container">
        <div className="content-wrapper narrow-wrapper">
          <div className="card card-center" role="status">
            <p>Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <SignInPage />;
  }

  return (
    <BrowserRouter>
      <div className="app">
        <Navbar
          isAdmin={isAdmin}
          profile={profile}
          theme={theme}
          toggleTheme={toggleTheme}
        />

        <Routes>
          <Route
            path="/"
            element={
              <HomePage
                deviceId={deviceId}
                profile={profile}
                refreshProfile={refreshProfile}
                isOnline={isOnline}
              />
            }
          />
          <Route path="/progress" element={<ProgressPage profile={profile} deviceId={deviceId} />} />
          <Route path="/my-recordings" element={<MyRecordingsPage profile={profile} />} />

          {/* Admin is a token claim, not a separate login. A volunteer who
              types /admin is simply sent home rather than to a login form
              they could never satisfy. */}
          <Route
            path="/admin"
            element={isAdmin ? <AdminPanel /> : <Navigate to="/" replace />}
          />
          <Route path="/admin/login" element={<Navigate to="/admin" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
