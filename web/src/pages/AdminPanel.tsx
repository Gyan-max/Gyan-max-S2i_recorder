import { useState, useEffect, useRef } from 'react';
import { 
  Download, RefreshCw, Check, X, 
  Users, FileText, BarChart3, Trash2, 
  FileSpreadsheet, AlertCircle, Archive
} from 'lucide-react';
import { 
  AdminStatsResponse, AdminCoverageItem, ClipReviewItem
} from '../types';

const API_BASE = '/api';

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

function AdminAudioPlayer({ clipId, adminToken }: { clipId: string; adminToken: string }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/clips/${clipId}/audio`, {
          headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        if (!cancelled) setAudioUrl(url);
      } catch (e) {
        console.error('Failed to load audio for', clipId, e);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [clipId, adminToken]);

  if (!audioUrl) return <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Loading audio...</p>;
  return <audio controls src={audioUrl} style={{ width: '100%', height: '40px' }} />;
}

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

  return (
    <div className="admin-shell" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div className="glass-card" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '4px' }}>Admin Dashboard</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Manage recordings, speakers, and export datasets
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            className="btn btn-secondary" 
            onClick={fetchAllData}
            disabled={loading}
            style={{ width: 'auto', padding: '8px 16px' }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button 
            className="btn btn-danger"
            onClick={onLogout}
            style={{ width: 'auto', padding: '8px 16px' }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="glass-card" style={{ padding: '16px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className={`btn ${activeTab === 'stats' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('stats')}
            style={{ width: 'auto', padding: '8px 16px', display: 'flex', gap: '6px', alignItems: 'center' }}
          >
            <BarChart3 size={16} />
            Statistics
          </button>
          <button
            className={`btn ${activeTab === 'clips' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('clips')}
            style={{ width: 'auto', padding: '8px 16px', display: 'flex', gap: '6px', alignItems: 'center' }}
          >
            <FileText size={16} />
            Recordings ({clips.length})
          </button>
          <button
            className={`btn ${activeTab === 'coverage' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('coverage')}
            style={{ width: 'auto', padding: '8px 16px', display: 'flex', gap: '6px', alignItems: 'center' }}
          >
            <BarChart3 size={16} />
            Coverage
          </button>
          <button
            className={`btn ${activeTab === 'speakers' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('speakers')}
            style={{ width: 'auto', padding: '8px 16px', display: 'flex', gap: '6px', alignItems: 'center' }}
          >
            <Users size={16} />
            Speakers ({speakers.length})
          </button>
        </div>
      </div>

      {/* Statistics Tab */}
      {activeTab === 'stats' && stats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            {[
              { label: 'Total Speakers', value: stats.total_speakers, color: 'var(--color-accent)' },
              { label: 'Total Recordings', value: stats.total_recordings, color: '#8b5cf6' },
              { label: 'Confirmed Clips', value: stats.confirmed_clips, color: '#06b6d4' },
              { label: 'QC Passed', value: stats.qc_passed, color: 'var(--color-success)' },
              { label: 'QC Failed', value: stats.qc_failed, color: 'var(--color-danger)' },
              { label: 'Redo Attempts', value: stats.redo_count, color: 'var(--color-warning)' },
            ].map((card, i) => (
              <div key={i} className="glass-card" style={{
                padding: '20px',
                borderLeft: `4px solid ${card.color}`,
                position: 'relative',
                overflow: 'hidden'
              }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {card.label}
                </p>
                <p style={{ fontSize: '2.5rem', fontWeight: 'bold', color: card.color }}>
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          {/* Export Buttons */}
          <div className="glass-card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Export Dataset</h3>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button 
                className="btn btn-success"
                onClick={downloadCSVExport}
                style={{ width: 'auto', padding: '10px 20px', display: 'flex', gap: '8px', alignItems: 'center' }}
              >
                <Download size={18} />
                Download CSV Manifest
              </button>
              <button 
                className="btn btn-primary"
                onClick={downloadExcelExport}
                style={{ width: 'auto', padding: '10px 20px', display: 'flex', gap: '8px', alignItems: 'center' }}
              >
                <FileSpreadsheet size={18} />
                Download Excel Report
              </button>
              <button 
                className="btn btn-secondary"
                onClick={downloadResearchBundle}
                style={{ width: 'auto', padding: '10px 20px', display: 'flex', gap: '8px', alignItems: 'center' }}
              >
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Filters */}
          <div className="glass-card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search by speaker, domain, or intent..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1, minWidth: '250px' }}
              />
              <select 
                className="form-select"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={{ width: 'auto', minWidth: '150px' }}
              >
                <option value="all">All Status</option>
                <option value="confirmed">Confirmed</option>
                <option value="processing">Processing</option>
                <option value="processed">Processed</option>
                <option value="rejected">Rejected</option>
                <option value="discarded">Discarded</option>
              </select>
            </div>
          </div>

          {/* Clips List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredClips.length === 0 ? (
              <div className="glass-card" style={{ padding: '40px', textAlign: 'center' }}>
                <AlertCircle size={48} style={{ color: 'var(--text-secondary)', margin: '0 auto 16px' }} />
                <p style={{ color: 'var(--text-secondary)' }}>No recordings found</p>
              </div>
            ) : (
              filteredClips.map(clip => (
                <div key={clip.clip_id} className="glass-card" style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <h4 style={{ fontSize: '1rem', marginBottom: '4px' }}>
                        {clip.speaker_id} - {clip.intent}
                      </h4>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {clip.domain} • {clip.scenario_id} • Clip ID: {clip.clip_id.slice(0, 8)}...
                      </p>
                    </div>
                    <span style={{
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      background: 
                        clip.status === 'processed' ? 'var(--color-success-glow)' :
                        clip.status === 'rejected' ? 'var(--color-danger-glow)' :
                        clip.status === 'confirmed' ? 'var(--color-accent-glow)' :
                        'var(--color-warning-glow)',
                      alignSelf: 'flex-start'
                    }}>
                      {clip.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Transcript */}
                  {clip.transcript_provisional && (
                    <div style={{ marginBottom: '12px', padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px' }}>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        Transcript ({clip.transcript_source || 'provisional'}):
                      </p>
                      <p style={{ fontSize: '0.9rem', fontStyle: 'italic' }}>"{clip.transcript_provisional}"</p>
                    </div>
                  )}

                  {/* QC Flags */}
                  {clip.qc_flags && clip.qc_flags.length > 0 && (
                    <div style={{ marginBottom: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {clip.qc_flags.map((flag, idx) => (
                        <span key={idx} style={{
                          background: 'rgba(239, 68, 68, 0.2)',
                          color: 'var(--color-danger)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          display: 'flex',
                          gap: '4px',
                          alignItems: 'center'
                        }}>
                          <AlertCircle size={12} />
                          {flag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Audio Player */}
                  {clip.filename && (
                    <div style={{ marginBottom: '12px' }}>
                      <AdminAudioPlayer clipId={clip.clip_id} adminToken={adminToken} />
                    </div>
                  )}

                  {/* Metadata */}
                  <div style={{ display: 'flex', gap: '16px', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '12px', flexWrap: 'wrap' }}>
                    <span>Duration: {clip.duration_s ? `${clip.duration_s.toFixed(2)}s` : 'N/A'}</span>
                    <span>Created: {new Date(clip.created_at).toLocaleDateString()}</span>
                    <span>Device: {clip.device_id.slice(0, 8)}...</span>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      className="btn btn-success"
                      onClick={() => handleReviewAction(clip.clip_id, 'accept')}
                      disabled={clip.status === 'processed'}
                      style={{ width: 'auto', padding: '6px 12px', fontSize: '0.85rem', display: 'flex', gap: '6px', alignItems: 'center' }}
                    >
                      <Check size={14} />
                      Approve
                    </button>
                    <button 
                      className="btn btn-danger"
                      onClick={() => handleReviewAction(clip.clip_id, 'reject')}
                      disabled={clip.status === 'rejected'}
                      style={{ width: 'auto', padding: '6px 12px', fontSize: '0.85rem', display: 'flex', gap: '6px', alignItems: 'center' }}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="glass-card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Intent Coverage Heatmap</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Target: 40 clips per intent with diverse speakers
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {coverage.map((item, idx) => {
                const progress = Math.min(100, (item.clips_processed / 40) * 100);
                const isComplete = item.clips_processed >= 40;
                
                return (
                  <div key={idx} style={{ 
                    padding: '16px', 
                    background: 'var(--bg-tertiary)', 
                    borderRadius: '8px',
                    border: `2px solid ${isComplete ? 'var(--color-success)' : 'var(--border-glass)'}`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: '600', marginBottom: '4px' }}>
                          {item.domain} • {item.intent}
                        </h4>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {item.speakers_count} unique speakers contributed
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ 
                          fontSize: '1.4rem', 
                          fontWeight: 'bold',
                          color: isComplete ? 'var(--color-success)' : 'var(--text-primary)'
                        }}>
                          {item.clips_processed} / 40
                        </p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {progress.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                    
                    {/* Progress Bar */}
                    <div style={{ 
                      width: '100%', 
                      height: '8px', 
                      background: 'rgba(255,255,255,0.1)', 
                      borderRadius: '4px',
                      overflow: 'hidden'
                    }}>
                      <div style={{ 
                        width: `${progress}%`, 
                        height: '100%',
                        background: isComplete 
                          ? 'var(--color-success)'
                          : 'var(--color-accent)',
                        transition: 'width 0.3s ease'
                      }} />
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Search */}
          <div className="glass-card" style={{ padding: '16px' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search speakers by ID, region, or language..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Speakers List */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '16px' }}>
            {filteredSpeakers.length === 0 ? (
              <div className="glass-card" style={{ padding: '40px', textAlign: 'center', gridColumn: '1 / -1' }}>
                <Users size={48} style={{ color: 'var(--text-secondary)', margin: '0 auto 16px' }} />
                <p style={{ color: 'var(--text-secondary)' }}>No speakers found</p>
              </div>
            ) : (
              filteredSpeakers.map(speaker => (
                <div key={speaker.speaker_id} className="glass-card" style={{ padding: '20px' }}>
                  {/* Header */}
                  <div style={{ marginBottom: '16px' }}>
                    <h4 style={{ fontSize: '1.1rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Users size={18} />
                      {speaker.speaker_id}
                    </h4>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ 
                        fontSize: '0.75rem', 
                        padding: '2px 8px', 
                        background: 'var(--color-accent-glow)', 
                        borderRadius: '4px' 
                      }}>
                        {speaker.gender}
                      </span>
                      <span style={{ 
                        fontSize: '0.75rem', 
                        padding: '2px 8px', 
                        background: 'var(--color-success-glow)', 
                        borderRadius: '4px' 
                      }}>
                        {speaker.age_band}
                      </span>
                    </div>
                  </div>

                  {/* Demographics */}
                  <div style={{ 
                    marginBottom: '16px', 
                    padding: '12px', 
                    background: 'var(--bg-tertiary)', 
                    borderRadius: '8px',
                    fontSize: '0.85rem'
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Native Language</p>
                        <p style={{ fontWeight: '500' }}>{speaker.l1}</p>
                      </div>
                      <div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Region</p>
                        <p style={{ fontWeight: '500' }}>{speaker.region}</p>
                      </div>
                    </div>
                  </div>

                  {/* Statistics */}
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ textAlign: 'center', padding: '8px', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
                        <p style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--color-accent)' }}>
                          {speaker.total_clips}
                        </p>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Total Clips</p>
                      </div>
                      <div style={{ textAlign: 'center', padding: '8px', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
                        <p style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--color-success)' }}>
                          {speaker.processed_clips}
                        </p>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Processed</p>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div style={{ textAlign: 'center', padding: '8px', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
                        <p style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--color-danger)' }}>
                          {speaker.rejected_clips}
                        </p>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Rejected</p>
                      </div>
                      <div style={{ textAlign: 'center', padding: '8px', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
                        <p style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--color-accent)' }}>
                          {speaker.avg_duration.toFixed(1)}s
                        </p>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Avg Duration</p>
                      </div>
                    </div>
                  </div>

                  {/* Dates */}
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                    <p>Registered: {new Date(speaker.created_at).toLocaleDateString()}</p>
                    {speaker.consent_at && (
                      <p>Consented: {new Date(speaker.consent_at).toLocaleDateString()}</p>
                    )}
                  </div>

                  {/* Withdraw Button */}
                  <button 
                    className="btn btn-danger"
                    onClick={() => handleWithdrawSpeaker(speaker.speaker_id)}
                    style={{ width: '100%', display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'center' }}
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
  );
}
