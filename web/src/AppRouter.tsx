import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import ProgressPage from './pages/ProgressPage';
import AdminLogin from './pages/AdminLogin';
import AdminPanel from './pages/AdminPanel';
import { SpeakerResponse, SpeakerRosterItem } from './types';
import './styles/responsive.css';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function AppRouter() {
  // App State
  const [deviceId, setDeviceId] = useState<string>('');
  const [currentSpeaker, setCurrentSpeaker] = useState<SpeakerResponse | null>(null);
  const [speakerRoster, setSpeakerRoster] = useState<SpeakerRosterItem[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  
  // Admin State
  const [isAdmin, setIsAdmin] = useState<boolean>(() => Boolean(localStorage.getItem('admin_token')));
  const [adminToken, setAdminToken] = useState<string | null>(
    localStorage.getItem('admin_token')
  );

  useEffect(() => {
    // Initialize device ID
    let devId = localStorage.getItem('device_id');
    if (!devId) {
      devId = crypto.randomUUID();
      localStorage.setItem('device_id', devId);
    }
    setDeviceId(devId);
    
    // Check for saved speaker
    const savedSpeaker = localStorage.getItem('active_speaker');
    if (savedSpeaker) {
      try {
        setCurrentSpeaker(JSON.parse(savedSpeaker));
      } catch (e) {
        console.error('Failed to parse saved speaker', e);
      }
    }

    // Network listeners
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // Register device
    registerDevice(devId);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const registerDevice = async (devId: string) => {
    try {
      await fetch(`${API_BASE}/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          device_id: devId, 
          ua_class: navigator.userAgent 
        })
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

  const handleAdminLogout = () => {
    setAdminToken(null);
    localStorage.removeItem('admin_token');
    setIsAdmin(false);
  };

  return (
    <BrowserRouter>
      <div className="app">
        <Navbar
          isAdmin={isAdmin}
          adminToken={adminToken}
          currentSpeaker={currentSpeaker}
          onLogout={handleAdminLogout}
        />
        
        <Routes>
          {/* Volunteer Routes */}
          <Route 
            path="/" 
            element={
              <HomePage
                deviceId={deviceId}
                currentSpeaker={currentSpeaker}
                setCurrentSpeaker={setCurrentSpeaker}
                speakerRoster={speakerRoster}
                fetchSpeakerRoster={fetchSpeakerRoster}
                isOnline={isOnline}
              />
            } 
          />
          <Route 
            path="/progress" 
            element={
              <ProgressPage
                currentSpeaker={currentSpeaker}
                deviceId={deviceId}
              />
            } 
          />
          
          {/* Admin Routes */}
          <Route 
            path="/admin" 
            element={
              adminToken ? (
                <AdminPanel 
                  adminToken={adminToken} 
                  onLogout={handleAdminLogout} 
                />
              ) : (
                <Navigate to="/admin/login" replace />
              )
            } 
          />
          <Route 
            path="/admin/login" 
            element={
              adminToken ? (
                <Navigate to="/admin" replace />
              ) : (
                <AdminLogin setAdminToken={(token) => {
                  setAdminToken(token);
                  setIsAdmin(true);
                }} />
              )
            } 
          />
          <Route 
            path="/admin/recordings" 
            element={
              adminToken ? (
                <AdminPanel 
                  adminToken={adminToken} 
                  onLogout={handleAdminLogout} 
                  initialTab="clips"
                />
              ) : (
                <Navigate to="/admin/login" replace />
              )
            } 
          />
          <Route 
            path="/admin/speakers" 
            element={
              adminToken ? (
                <AdminPanel 
                  adminToken={adminToken} 
                  onLogout={handleAdminLogout} 
                  initialTab="speakers"
                />
              ) : (
                <Navigate to="/admin/login" replace />
              )
            } 
          />
          
          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
