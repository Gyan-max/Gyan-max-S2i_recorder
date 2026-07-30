import { Link, useLocation } from 'react-router-dom';
import {
  Globe, Mic, BarChart3, Users, LogOut, Menu, X, Sun, Moon, ListMusic, Shield,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth, type SpeakerProfile } from '../AuthContext';

interface NavbarProps {
  isAdmin: boolean;
  profile: SpeakerProfile | null;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

export default function Navbar({ isAdmin, profile, theme, toggleTheme }: NavbarProps) {
  const location = useLocation();
  const { user, logOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;
  const label = profile?.name || profile?.speaker_id || user?.email || 'Signed in';

  const close = () => setMobileMenuOpen(false);

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-brand">
          <span className="brand-mark"><Globe size={19} /></span>
          <span><strong>Hinglish</strong> S2I</span>
        </Link>

        <div className="navbar-links">
          <Link to="/" className={`nav-link ${isActive('/') ? 'active' : ''}`}>
            <Mic size={18} />
            <span>Record</span>
          </Link>
          <Link to="/progress" className={`nav-link ${isActive('/progress') ? 'active' : ''}`}>
            <BarChart3 size={18} />
            <span>Progress</span>
          </Link>
          <Link
            to="/my-recordings"
            className={`nav-link ${isActive('/my-recordings') ? 'active' : ''}`}
          >
            <ListMusic size={18} />
            <span>My recordings</span>
          </Link>
          {/* Only rendered when the ID token actually carries the claim, so a
              volunteer never sees a link that would bounce them home. */}
          {isAdmin && (
            <Link to="/admin" className={`nav-link ${isActive('/admin') ? 'active' : ''}`}>
              <Shield size={18} />
              <span>Admin</span>
            </Link>
          )}
        </div>

        <div className="navbar-actions">
          <div className="user-badge">
            <Users size={16} />
            <span>{label}</span>
          </div>

          <button
            className="btn btn-icon btn-sm"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          <button className="btn btn-secondary btn-sm" onClick={logOut}>
            <LogOut size={16} />
            <span className="btn-text">Sign out</span>
          </button>

          <button
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation"
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="mobile-menu">
          <Link to="/" className={`mobile-link ${isActive('/') ? 'active' : ''}`} onClick={close}>
            <Mic size={18} />
            <span>Record</span>
          </Link>
          <Link
            to="/progress"
            className={`mobile-link ${isActive('/progress') ? 'active' : ''}`}
            onClick={close}
          >
            <BarChart3 size={18} />
            <span>Progress</span>
          </Link>
          <Link
            to="/my-recordings"
            className={`mobile-link ${isActive('/my-recordings') ? 'active' : ''}`}
            onClick={close}
          >
            <ListMusic size={18} />
            <span>My recordings</span>
          </Link>
          {isAdmin && (
            <Link
              to="/admin"
              className={`mobile-link ${isActive('/admin') ? 'active' : ''}`}
              onClick={close}
            >
              <Shield size={18} />
              <span>Admin</span>
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
