import { useState, useEffect } from 'react';
import {
  Download, RefreshCw, Check, X,
  Users, FileText, BarChart3, Trash2,
  FileSpreadsheet, AlertCircle, Archive
} from 'lucide-react';
import {
  AdminStatsResponse, AdminCoverageItem, ClipReviewItem
} from '../types';
import { API_BASE } from '../config';
import AdminAudioPlayer from '../components/AdminAudioPlayer';

interface AdminPanelProps {
  adminToken: string;
  onLogout: () => void;
  initialTab?: 'stats' | 'clips' | 'coverage' | 'speakers';
}

interface SpeakerDetailed {
  speaker_id: string;
  gender: string;
  age: number;
  age_band: string;
  l1: string;
  region: string;
  consent_at: string | null;
  created_at: string;
  total_clips: number;
  confirmed_clips: number;
  processed_clips: number;
  rejected_clips: number;
  avg_duration: number;
}

const STAT_TONES = ['primary', 'accent', 'info', 'success', 'danger', 'warning'] as const;

export default function AdminPanel({ adminToken, onLogout, initialTab = 'stats' }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<'stats' | 'clips' | 'coverage' | 'speakers'>(initialTab);
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [coverage, setCoverage] = useState<AdminCoverageItem[]>([]);
  const [clips, setClips] = useState<ClipReviewItem[]>([]);
  const [speakers, setSpeakers] = useState<SpeakerDetailed[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const headers = { 'Authorization': `Bearer ${adminToken}` };

  const handleUnauthorized = () => {
    console.error('Admin token expired or invalid. Logging out.');
    onLogout();
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchStats(),
        fetchCoverage(),
        fetchClips(),
        fetchSpeakers()
      ]);
    } catch (e) {
      console.error('Failed to fetch admin data:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/stats`, { headers });
      if (res.ok) setStats(await res.json());
      else if (res.status === 401) handleUnauthorized();
    } catch (e) {
      console.error('Failed to fetch stats:', e);
    }
  };

  const fetchCoverage = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/coverage`, { headers });
      if (res.ok) {
        const data = await res.json();
        setCoverage(data.coverage);
      } else if (res.status === 401) handleUnauthorized();
    } catch (e) {
      console.error('Failed to fetch coverage:', e);
    }
  };

  const fetchClips = async () => {
    try {
      const url = filterStatus !== 'all'
        ? `${API_BASE}/admin/clips?status_filter=${filterStatus}`
        : `${API_BASE}/admin/clips`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        setClips(data.clips);
      } else if (res.status === 401) handleUnauthorized();
    } catch (e) {
      console.error('Failed to fetch clips:', e);
    }
  };

  const fetchSpeakers = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/speakers/detailed`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSpeakers(data.speakers);
      } else if (res.status === 401) handleUnauthorized();
    } catch (e) {
      console.error('Failed to fetch speakers:', e);
    }
  };

  const handleReviewAction = async (clipId: string, action: 'accept' | 'reject') => {
    try {
      const res = await fetch(`${API_BASE}/admin/clips/${clipId}/review`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        alert(`Clip ${action}ed successfully!`);
        fetchClips();
        fetchStats();
      } else if (res.status === 401) {
        handleUnauthorized();
      }
    } catch (e) {
      console.error(`Failed to ${action} clip:`, e);
      alert(`Failed to ${action} clip`);
    }
  };

  const handleWithdrawSpeaker = async (speakerId: string) => {
    if (!confirm(`Are you sure you want to withdraw speaker ${speakerId}? This will permanently delete all their recordings and data!`)) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/admin/speakers/${speakerId}/withdraw`, {
        method: 'POST',
        headers
      });
      if (res.ok) {
        alert('Speaker withdrawn successfully');
        fetchSpeakers();
        fetchStats();
      } else if (res.status === 401) {
        handleUnauthorized();
      } else {
        alert('Failed to withdraw speaker');
      }
    } catch (e) {
      console.error('Failed to withdraw speaker:', e);
      alert('Failed to withdraw speaker');
    }
  };

  const downloadExport = async (endpoint: string, filename: string) => {
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, { headers });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error(`Export failed with ${res.status}`);

      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert('The export could not be created. Please try again.');
    }
  };

  const downloadCSVExport = () => downloadExport('/admin/export', 'manifest.csv');

  const downloadExcelExport = () => downloadExport('/admin/export/excel', 'dataset_export.xlsx');

  const downloadResearchBundle = () => downloadExport('/admin/export/research-bundle', 'hinglish_s2i_research_export.zip');

  const filteredClips = clips.filter(clip => {
    const matchesSearch = searchQuery === '' ||
      clip.speaker_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      clip.intent.toLowerCase().includes(searchQuery.toLowerCase()) ||
      clip.domain.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const filteredSpeakers = speakers.filter(speaker => {
    const matchesSearch = searchQuery === '' ||
      speaker.speaker_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      speaker.region.toLowerCase().includes(searchQuery.toLowerCase()) ||
      speaker.l1.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  useEffect(() => {
    fetchClips();
  }, [filterStatus]);

  const statCards: { label: string; value: number; tone: typeof STAT_TONES[number] }[] = stats ? [
    { label: 'Total Speakers', value: stats.total_speakers, tone: 'primary' },
    { label: 'Total Recordings', value: stats.total_recordings, tone: 'accent' },
    { label: 'Confirmed Clips', value: stats.confirmed_clips, tone: 'info' },
    { label: 'QC Passed', value: stats.qc_passed, tone: 'success' },
    { label: 'QC Failed', value: stats.qc_failed, tone: 'danger' },
    { label: 'Redo Attempts', value: stats.redo_count, tone: 'warning' },
  ] : [];

  return (
    <div className="admin-shell content-wrapper">
      <div className="admin-section">
        {/* Header */}
        <div className="card admin-topbar">
          <div>
            <h1>Admin Dashboard</h1>
            <p>Manage recordings, speakers, and export datasets</p>
          </div>
          <div className="admin-topbar-actions">
            <button className="btn btn-secondary" onClick={fetchAllData} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button className="btn btn-danger" onClick={onLogout}>
              Logout
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="card admin-tabs">
          <button
            className={`btn ${activeTab === 'stats' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('stats')}
          >
            <BarChart3 size={16} />
            Statistics
          </button>
          <button
            className={`btn ${activeTab === 'clips' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('clips')}
          >
            <FileText size={16} />
            Recordings ({clips.length})
          </button>
          <button
            className={`btn ${activeTab === 'coverage' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('coverage')}
          >
            <BarChart3 size={16} />
            Coverage
          </button>
          <button
            className={`btn ${activeTab === 'speakers' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('speakers')}
          >
            <Users size={16} />
            Speakers ({speakers.length})
          </button>
        </div>

        {/* Statistics Tab */}
        {activeTab === 'stats' && stats && (
          <div className="admin-section">
            <div className="admin-grid">
              {statCards.map((card) => (
                <div key={card.label} className="stat-card">
                  <h3>{card.label}</h3>
                  <p className={`stat-value tone-${card.tone}`}>{card.value}</p>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-header">
                <h2>Export Dataset</h2>
              </div>
              <div className="button-group">
                <button className="btn btn-success" onClick={downloadCSVExport}>
                  <Download size={18} />
                  Download CSV Manifest
                </button>
                <button className="btn btn-primary" onClick={downloadExcelExport}>
                  <FileSpreadsheet size={18} />
                  Download Excel Report
                </button>
                <button className="btn btn-secondary" onClick={downloadResearchBundle}>
                  <Archive size={18} />
                  Download Research ZIP
                </button>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '12px' }}>
                Research ZIP includes processed WAV recordings, an Excel workbook, CSV manifests, task prompts, speaker metadata, QC data, checksums, and a local-use README.
              </p>
            </div>
          </div>
        )}

        {/* Clips Tab */}
        {activeTab === 'clips' && (
          <div className="admin-section">
            <div className="card filter-bar">
              <input
                type="text"
                className="form-input"
                placeholder="Search by speaker, domain, or intent..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                className="form-select"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="confirmed">Confirmed</option>
                <option value="processing">Processing</option>
                <option value="processed">Processed</option>
                <option value="rejected">Rejected</option>
                <option value="discarded">Discarded</option>
              </select>
            </div>

            <div className="admin-list">
              {filteredClips.length === 0 ? (
                <div className="card card-center">
                  <AlertCircle size={40} className="icon-muted" />
                  <p>No recordings found</p>
                </div>
              ) : (
                filteredClips.map(clip => (
                  <div key={clip.clip_id} className="clip-card">
                    <div className="clip-header">
                      <div>
                        <h4 style={{ fontSize: '1rem', marginBottom: '4px' }}>
                          {clip.speaker_id} - {clip.intent}
                        </h4>
                        <p className="clip-meta">
                          {clip.domain} • {clip.scenario_id} • Clip ID: {clip.clip_id.slice(0, 8)}...
                        </p>
                      </div>
                      <span className={`status-badge ${clip.status}`}>{clip.status}</span>
                    </div>

                    {clip.transcript_provisional && (
                      <div className="transcript-box">
                        <p>Transcript ({clip.transcript_source || 'provisional'}):</p>
                        <p>"{clip.transcript_provisional}"</p>
                      </div>
                    )}

                    {clip.qc_flags && clip.qc_flags.length > 0 && (
                      <div className="qc-flags">
                        {clip.qc_flags.map((flag, idx) => (
                          <span key={idx} className="qc-flag">
                            <AlertCircle size={12} />
                            {flag}
                          </span>
                        ))}
                      </div>
                    )}

                    {clip.filename && (
                      <div style={{ marginBottom: '12px' }}>
                        <AdminAudioPlayer clipId={clip.clip_id} adminToken={adminToken} />
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '16px', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '12px', flexWrap: 'wrap' }}>
                      <span>Duration: {clip.duration_s ? `${clip.duration_s.toFixed(2)}s` : 'N/A'}</span>
                      <span>Created: {new Date(clip.created_at).toLocaleDateString()}</span>
                      <span>Device: {clip.device_id.slice(0, 8)}...</span>
                    </div>

                    <div className="button-group">
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => handleReviewAction(clip.clip_id, 'accept')}
                        disabled={clip.status === 'processed'}
                      >
                        <Check size={14} />
                        Approve
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleReviewAction(clip.clip_id, 'reject')}
                        disabled={clip.status === 'rejected'}
                      >
                        <X size={14} />
                        Reject
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Coverage Tab */}
        {activeTab === 'coverage' && (
          <div className="admin-section">
            <div className="card">
              <div className="card-header">
                <h2>Intent Coverage Heatmap</h2>
                <p>Target: 40 clips per intent with diverse speakers</p>
              </div>

              <div className="admin-list">
                {coverage.map((item, idx) => {
                  const progress = Math.min(100, (item.clips_processed / 40) * 100);
                  const isComplete = item.clips_processed >= 40;

                  return (
                    <div key={idx} className={`coverage-item ${isComplete ? 'complete' : ''}`}>
                      <div className="coverage-header">
                        <div>
                          <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '4px' }}>
                            {item.domain} • {item.intent}
                          </h4>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {item.speakers_count} unique speakers contributed
                          </p>
                        </div>
                        <div className="coverage-progress">
                          <p className="count" style={{ color: isComplete ? 'var(--success)' : 'var(--text-primary)' }}>
                            {item.clips_processed} / 40
                          </p>
                          <p className="target">{progress.toFixed(1)}%</p>
                        </div>
                      </div>

                      <div className="progress-bar-container">
                        <div
                          className={`progress-bar-fill ${isComplete ? 'complete' : 'in-progress'}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Speakers Tab */}
        {activeTab === 'speakers' && (
          <div className="admin-section">
            <div className="card">
              <input
                type="text"
                className="form-input"
                placeholder="Search speakers by ID, region, or language..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="speaker-grid">
              {filteredSpeakers.length === 0 ? (
                <div className="card card-center" style={{ gridColumn: '1 / -1' }}>
                  <Users size={40} className="icon-muted" />
                  <p>No speakers found</p>
                </div>
              ) : (
                filteredSpeakers.map(speaker => (
                  <div key={speaker.speaker_id} className="speaker-card">
                    <div className="speaker-header">
                      <Users size={18} />
                      <h4 style={{ fontSize: '1.05rem' }}>{speaker.speaker_id}</h4>
                    </div>
                    <div className="speaker-badges" style={{ marginBottom: '16px' }}>
                      <span className="speaker-badge">{speaker.gender}</span>
                      <span className="speaker-badge">{speaker.age_band}</span>
                    </div>

                    <div className="admin-demographics">
                      <div>
                        <p className="label">Native Language</p>
                        <p className="value">{speaker.l1}</p>
                      </div>
                      <div>
                        <p className="label">Region</p>
                        <p className="value">{speaker.region}</p>
                      </div>
                    </div>

                    <div className="speaker-stats">
                      <div className="stat-box">
                        <p className="value" style={{ color: 'var(--primary)' }}>{speaker.total_clips}</p>
                        <p className="label">Total Clips</p>
                      </div>
                      <div className="stat-box">
                        <p className="value" style={{ color: 'var(--success)' }}>{speaker.processed_clips}</p>
                        <p className="label">Processed</p>
                      </div>
                      <div className="stat-box">
                        <p className="value" style={{ color: 'var(--danger)' }}>{speaker.rejected_clips}</p>
                        <p className="label">Rejected</p>
                      </div>
                      <div className="stat-box">
                        <p className="value" style={{ color: 'var(--primary)' }}>{speaker.avg_duration.toFixed(1)}s</p>
                        <p className="label">Avg Duration</p>
                      </div>
                    </div>

                    <div className="admin-dates">
                      <p>Registered: {new Date(speaker.created_at).toLocaleDateString()}</p>
                      {speaker.consent_at && <p>Consented: {new Date(speaker.consent_at).toLocaleDateString()}</p>}
                    </div>

                    <button
                      className="btn btn-danger"
                      onClick={() => handleWithdrawSpeaker(speaker.speaker_id)}
                    >
                      <Trash2 size={14} />
                      Withdraw Speaker
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
