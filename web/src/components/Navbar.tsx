import { Link, useLocation } from 'react-router-dom';
import { Globe, Mic, BarChart3, Users, LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';

interface NavbarProps {
  isAdmin: boolean;
  adminToken: string | null;
  currentSpeaker: any;
  onLogout: () => void;
}

export default function Navbar({ isAdmin, adminToken, currentSpeaker, onLogout }: NavbarProps) {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="navbar">
      <div className="navbar-container">
        {/* Logo */}
        <Link to="/" className="navbar-brand">
          <span className="brand-mark"><Globe size={19} /></span>
          <span><strong>Hinglish</strong> S2I</span>
        </Link>

        {/* Desktop Navigation */}
        <div className="navbar-links">
          {!isAdmin ? (
            <>
              <Link 
                to="/" 
                className={`nav-link ${isActive('/') ? 'active' : ''}`}
              >
                <Mic size={18} />
                <span>Record</span>
              </Link>
              <Link 
                to="/progress" 
                className={`nav-link ${isActive('/progress') ? 'active' : ''}`}
              >
                <BarChart3 size={18} />
                <span>Progress</span>
              </Link>
              {currentSpeaker && (
                <span className="nav-link user-badge" style={{ cursor: 'default' }}>
                  <Users size={18} />
                  <span>{currentSpeaker.speaker_id}</span>
                </span>
              )}
            </>
          ) : adminToken ? (
            <>
              <Link 
                to="/admin" 
                className={`nav-link ${isActive('/admin') ? 'active' : ''}`}
              >
                <BarChart3 size={18} />
                <span>Dashboard</span>
              </Link>
              <Link 
                to="/admin/recordings" 
                className={`nav-link ${isActive('/admin/recordings') ? 'active' : ''}`}
              >
                <Mic size={18} />
                <span>Recordings</span>
              </Link>
              <Link 
                to="/admin/speakers" 
                className={`nav-link ${isActive('/admin/speakers') ? 'active' : ''}`}
              >
                <Users size={18} />
                <span>Speakers</span>
              </Link>
            </>
          ) : null}
        </div>

        {/* User Info & Actions */}
        <div className="navbar-actions">
          {currentSpeaker && !isAdmin && (
            <div className="user-badge">
              <Users size={16} />
              <span>{currentSpeaker.speaker_id}</span>
            </div>
          )}
          
          {adminToken && isAdmin && (
            <button className="btn btn-danger btn-sm" onClick={onLogout}>
              <LogOut size={16} />
              <span className="btn-text">Logout</span>
            </button>
          )}

          <Link 
            to={isAdmin ? "/" : "/admin"} 
            className="btn btn-secondary btn-sm"
          >
            {isAdmin ? 'Volunteer' : 'Admin'}
          </Link>

          {/* Mobile Menu Toggle */}
          <button 
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="mobile-menu">
          {!isAdmin ? (
            <>
              <Link to="/" className={`mobile-link ${isActive('/') ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
                <Mic size={18} />
                <span>Record</span>
              </Link>
              <Link to="/progress" className={`mobile-link ${isActive('/progress') ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
                <BarChart3 size={18} />
                <span>Progress</span>
              </Link>
              {currentSpeaker && (
                <span className="mobile-link" style={{ opacity: 0.7 }}>
                  <Users size={18} />
                  <span>{currentSpeaker.speaker_id}</span>
                </span>
              )}
            </>
          ) : adminToken ? (
            <>
              <Link to="/admin" className={`mobile-link ${isActive('/admin') ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
                <BarChart3 size={18} />
                <span>Dashboard</span>
              </Link>
              <Link to="/admin/recordings" className={`mobile-link ${isActive('/admin/recordings') ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
                <Mic size={18} />
                <span>Recordings</span>
              </Link>
              <Link to="/admin/speakers" className={`mobile-link ${isActive('/admin/speakers') ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
                <Users size={18} />
                <span>Speakers</span>
              </Link>
            </>
          ) : null}
        </div>
      )}
    </nav>
  );
}
