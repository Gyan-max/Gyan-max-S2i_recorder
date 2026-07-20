import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Shield } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface AdminLoginProps {
  setAdminToken: (token: string | null) => void;
}

export default function AdminLogin({ setAdminToken }: AdminLoginProps) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (res.ok) {
        const data = await res.json();
        setAdminToken(data.token);
        localStorage.setItem('admin_token', data.token);
        navigate('/admin');
      } else {
        setError('Invalid credentials. Please try again.');
      }
    } catch (e) {
      setError('Connection failed. Please check your network.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container auth-page">
      <div className="content-wrapper">
        <div className="card card-auth">
          <div className="auth-header">
            <Shield size={56} className="icon-accent" />
            <h1>Admin Login</h1>
            <p>Authorized access only</p>
          </div>

          <form onSubmit={handleSubmit} className="form">
            {error && (
              <div className="alert alert-danger">
                {error}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Username</label>
              <input 
                type="text" 
                className="form-input" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <input 
                type="password" 
                className="form-input" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
                autoComplete="current-password"
              />
            </div>

            <button 
              type="submit" 
              className="btn btn-primary btn-lg" 
              disabled={loading}
            >
              <LogIn size={20} />
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>

          <div className="auth-footer">
            <p>Default credentials: admin / admin123</p>
            <small>⚠️ Change password in production</small>
          </div>
        </div>
      </div>
    </div>
  );
}
