import { useState, useEffect } from 'react';
import {
  Download, RefreshCw, Check, X,
  Users, FileText, BarChart3, Trash2,
  FileSpreadsheet, AlertCircle, Archive, CheckSquare, Square, Eye, Sparkles, PieChart,
  Edit3, Save, Target, HardDrive, Clock
} from 'lucide-react';
import {
  AdminStatsResponse, AdminCoverageItem, ClipReviewItem
} from '../types';
import { API_BASE } from '../config';
import AdminAudioPlayer from '../components/AdminAudioPlayer';

interface AdminPanelProps {
  adminToken: string;
  onLogout: () => void;
  initialTab?: 'stats' | 'clips' | 'coverage' | 'speakers' | 'prompts';
}

interface SpeakerDetailed {
  speaker_id: string;
  name?: string;
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
  const [activeTab, setActiveTab] = useState<'stats' | 'clips' | 'coverage' | 'speakers' | 'prompts'>(initialTab);
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [coverage, setCoverage] = useState<AdminCoverageItem[]>([]);
  const [clips, setClips] = useState<ClipReviewItem[]>([]);
  const [speakers, setSpeakers] = useState<SpeakerDetailed[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Interactive Batch Selection & Inspector State
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [batchLoading, setBatchLoading] = useState<boolean>(false);
  const [inspectorSpeaker, setInspectorSpeaker] = useState<SpeakerDetailed | null>(null);

  // Inline Transcript Editing State
  const [editingTranscriptId, setEditingTranscriptId] = useState<string | null>(null);
  const [editedTranscriptText, setEditedTranscriptText] = useState<string>('');

  // Admin Task Assignment State
  const [assignedPrompts, setAssignedPrompts] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('admin_assigned_prompts') || '{}');
    } catch {
      return {};
    }
  });

  const headers = { 'Authorization': `Bearer ${adminToken}` };

  const handleUnauthorized = () => {
    console.error('Admin token expired or invalid. Logging out.');
    onLogout();
  };

  // Sync activeTab when navigating via navbar routes (e.g. /admin/recordings → /admin/speakers)
  // Without this, React reuses the mounted component and useState ignores the updated initialTab prop.
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

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
      const url = filterStatus !== 'all' && filterStatus !== 'flagged'
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
        fetchClips();
        fetchStats();
      } else if (res.status === 401) {
        handleUnauthorized();
      }
    } catch (e) {
      console.error(`Failed to ${action} clip:`, e);
    }
  };

  const handleSaveTranscript = async (clipId: string) => {
    try {
      const res = await fetch(`${API_BASE}/admin/clips/${clipId}/review`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'edit_transcript', transcript_final: editedTranscriptText })
      });
      if (res.ok) {
        setEditingTranscriptId(null);
        fetchClips();
      } else if (res.status === 401) {
        handleUnauthorized();
      }
    } catch (e) {
      console.error('Failed to save transcript:', e);
    }
  };

  const handleAssignPromptToSpeaker = (speakerId: string, domain: string) => {
    const updated = { ...assignedPrompts, [speakerId]: domain };
    setAssignedPrompts(updated);
    localStorage.setItem('admin_assigned_prompts', JSON.stringify(updated));
    alert(`Assigned ${domain} domain prompts to speaker ${speakerId}`);
  };

  const handleBatchAction = async (action: 'accept' | 'reject') => {
    if (selectedClipIds.length === 0) return;
    if (!confirm(`Are you sure you want to ${action} ${selectedClipIds.length} selected clips?`)) return;
    
    setBatchLoading(true);
    try {
      for (const clipId of selectedClipIds) {
        await fetch(`${API_BASE}/admin/clips/${clipId}/review`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        }).catch(() => undefined);
      }
      setSelectedClipIds([]);
      await fetchClips();
      await fetchStats();
    } catch (e) {
      console.error('Batch review error:', e);
    } finally {
      setBatchLoading(false);
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
        if (inspectorSpeaker?.speaker_id === speakerId) setInspectorSpeaker(null);
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
    
    if (!matchesSearch) return false;

    if (filterStatus === 'flagged') {
      return clip.qc_flags && clip.qc_flags.length > 0;
    }
    return true;
  });

  const filteredSpeakers = speakers.filter(speaker => {
    return searchQuery === '' ||
      speaker.speaker_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (speaker.name && speaker.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      speaker.region.toLowerCase().includes(searchQuery.toLowerCase()) ||
      speaker.l1.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const toggleSelectClip = (clipId: string) => {
    setSelectedClipIds(prev => 
      prev.includes(clipId) ? prev.filter(id => id !== clipId) : [...prev, clipId]
    );
  };

  const toggleSelectAllClips = () => {
    if (selectedClipIds.length === filteredClips.length) {
      setSelectedClipIds([]);
    } else {
      setSelectedClipIds(filteredClips.map(c => c.clip_id));
    }
  };

  const exportFilteredSelectionCSV = () => {
    if (filteredClips.length === 0) return;
    const headersLine = 'clip_id,speaker_id,domain,intent,scenario_id,status,duration_s,created_at\n';
    const rows = filteredClips.map(c => 
      `"${c.clip_id}","${c.speaker_id}","${c.domain}","${c.intent}","${c.scenario_id}","${c.status}",${c.duration_s || 0},"${c.created_at}"`
    ).join('\n');

    const blob = new Blob([headersLine + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `filtered_clips_export_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    fetchClips();
  }, [filterStatus]);

  const totalDurationSeconds = clips.reduce((acc, c) => acc + (c.duration_s || 0), 0);
  const totalDurationMinutes = (totalDurationSeconds / 60).toFixed(1);
  const avgDuration = clips.length > 0 ? (totalDurationSeconds / clips.length).toFixed(1) : '0';

  const statCards: { label: string; value: string | number; tone: typeof STAT_TONES[number] }[] = stats ? [
    { label: 'Total Speakers', value: stats.total_speakers, tone: 'primary' },
    { label: 'Total Recordings', value: stats.total_recordings, tone: 'accent' },
    { label: 'Audio Duration', value: `${totalDurationMinutes} mins`, tone: 'info' },
    { label: 'QC Passed', value: stats.qc_passed, tone: 'success' },
    { label: 'QC Failed', value: stats.qc_failed, tone: 'danger' },
    { label: 'Avg Duration', value: `${avgDuration}s`, tone: 'warning' },
  ] : [];

  // Demographics aggregation for Diversity Matrix
  const genderCounts: Record<string, number> = {};
  const regionCounts: Record<string, number> = {};
  speakers.forEach(s => {
    genderCounts[s.gender || 'Unknown'] = (genderCounts[s.gender || 'Unknown'] || 0) + 1;
    regionCounts[s.region || 'Other'] = (regionCounts[s.region || 'Other'] || 0) + 1;
  });

  return (
    <div className="admin-shell content-wrapper">
      <div className="admin-section">
        {/* Header */}
        <div className="card admin-topbar glass-card">
          <div>
            <span className="eyebrow"><Sparkles size={14} style={{ display: 'inline', marginRight: 4 }} /> Speech Dataset Operations</span>
            <h1>Admin Dashboard</h1>
            <p>Manage recordings, assign prompts to speakers, audit quality, and export datasets</p>
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
        <div className="card admin-tabs glass-card">
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
            <PieChart size={16} />
            Coverage & Diversity
          </button>
          <button
            className={`btn ${activeTab === 'speakers' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('speakers')}
          >
            <Users size={16} />
            Speakers ({speakers.length})
          </button>
          <button
            className={`btn ${activeTab === 'prompts' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('prompts')}
          >
            <Target size={16} />
            Prompt Assignments
          </button>
        </div>

        {/* Statistics Tab */}
        {activeTab === 'stats' && stats && (
          <div className="admin-section fade-in">
            <div className="admin-grid">
              {statCards.map((card) => (
                <div key={card.label} className="stat-card glass-card">
                  <h3>{card.label}</h3>
                  <p className={`stat-value tone-${card.tone}`}>{card.value}</p>
                </div>
              ))}
            </div>

            {/* Storage & Audio Quality Meter */}
            <div className="card glass-card" style={{ marginBottom: '1.25rem' }}>
              <div className="card-header">
                <h2>Audio Data Storage & Health</h2>
              </div>
              <div className="admin-demographics" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <div>
                  <p className="label"><Clock size={12} style={{ display: 'inline', marginRight: 4 }} /> Total Speech Duration</p>
                  <p className="value">{totalDurationSeconds.toFixed(0)} seconds ({totalDurationMinutes} mins)</p>
                </div>
                <div>
                  <p className="label"><HardDrive size={12} style={{ display: 'inline', marginRight: 4 }} /> Est. Storage Size</p>
                  <p className="value">~{(totalDurationSeconds * 0.032).toFixed(1)} MB (16kHz Mono WAV)</p>
                </div>
                <div>
                  <p className="label"><Check size={12} style={{ display: 'inline', marginRight: 4 }} /> QC Health Score</p>
                  <p className="value" style={{ color: 'var(--success)' }}>
                    {stats.total_recordings > 0 ? ((stats.qc_passed / stats.total_recordings) * 100).toFixed(1) : 100}% Passed
                  </p>
                </div>
              </div>
            </div>

            <div className="card glass-card">
              <div className="card-header">
                <h2>Export Full Dataset Packages</h2>
                <p>Download complete manifests, research bundles, and structured tabular formats.</p>
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
            </div>
          </div>
        )}

        {/* Clips Tab with Batch Review & Inline Transcript Editor */}
        {activeTab === 'clips' && (
          <div className="admin-section fade-in">
            {/* Filter & Batch Actions Bar */}
            <div className="card filter-bar glass-card">
              <div style={{ display: 'flex', gap: '0.75rem', flex: 1, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search by speaker, domain, or intent..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ flex: 1, minWidth: '220px' }}
                />
                
                {/* Preset Filter Chips */}
                <div className="preset-filters">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'confirmed', label: 'Confirmed' },
                    { id: 'processed', label: 'Processed' },
                    { id: 'flagged', label: '⚠️ QC Flagged' }
                  ].map(f => (
                    <button
                      key={f.id}
                      className={`preset-chip ${filterStatus === f.id ? 'active' : ''}`}
                      onClick={() => setFilterStatus(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <button className="btn btn-secondary btn-sm" onClick={exportFilteredSelectionCSV} title="Export current filtered view to CSV">
                <Download size={14} /> Export Filtered CSV
              </button>
            </div>

            {/* Batch Operations Bar */}
            {filteredClips.length > 0 && (
              <div className="card batch-toolbar glass-card">
                <div className="batch-select-all" onClick={toggleSelectAllClips}>
                  {selectedClipIds.length > 0 && selectedClipIds.length === filteredClips.length ? (
                    <CheckSquare size={18} className="icon-accent" />
                  ) : (
                    <Square size={18} className="icon-muted" />
                  )}
                  <span>Select All ({filteredClips.length})</span>
                </div>

                {selectedClipIds.length > 0 && (
                  <div className="batch-actions-group">
                    <span className="selected-count-badge">{selectedClipIds.length} selected</span>
                    <button 
                      className="btn btn-success btn-sm" 
                      onClick={() => handleBatchAction('accept')}
                      disabled={batchLoading}
                    >
                      <Check size={14} /> Batch Approve
                    </button>
                    <button 
                      className="btn btn-danger btn-sm" 
                      onClick={() => handleBatchAction('reject')}
                      disabled={batchLoading}
                    >
                      <X size={14} /> Batch Reject
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="admin-list">
              {filteredClips.length === 0 ? (
                <div className="card card-center glass-card">
                  <AlertCircle size={40} className="icon-muted" />
                  <p>No recordings match your current filters</p>
                </div>
              ) : (
                filteredClips.map(clip => {
                  const isSelected = selectedClipIds.includes(clip.clip_id);
                  const isEditingTranscript = editingTranscriptId === clip.clip_id;

                  return (
                    <div key={clip.clip_id} className={`clip-card glass-card ${isSelected ? 'selected' : ''}`}>
                      <div className="clip-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div 
                            className="clip-checkbox" 
                            onClick={() => toggleSelectClip(clip.clip_id)}
                            style={{ cursor: 'pointer' }}
                          >
                            {isSelected ? <CheckSquare size={20} className="icon-accent" /> : <Square size={20} className="icon-muted" />}
                          </div>
                          <div>
                            <h4 style={{ fontSize: '1rem', marginBottom: '4px' }}>
                              {clip.speaker_id} • <span style={{ color: 'var(--primary)' }}>{clip.intent}</span>
                            </h4>
                            <p className="clip-meta">
                              {clip.domain} • Scenario: {clip.scenario_id} • Clip ID: {clip.clip_id.slice(0, 8)}...
                            </p>
                          </div>
                        </div>
                        <span className={`status-badge ${clip.status}`}>{clip.status}</span>
                      </div>

                      {/* Mini Visual Audio Waveform Simulation Bar */}
                      <div className="clip-waveform-bar">
                        {[40, 65, 30, 85, 95, 50, 70, 45, 90, 60, 35, 80, 100, 55, 75, 40, 85, 65, 30, 50].map((h, idx) => (
                          <span key={idx} className="waveform-bar-line" style={{ height: `${h}%` }} />
                        ))}
                      </div>

                      {/* Transcript Box with Inline Editing */}
                      <div className="transcript-box">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <p className="transcript-label">Transcript ({clip.transcript_source || 'provisional'}):</p>
                          {!isEditingTranscript ? (
                            <button 
                              className="btn btn-secondary btn-sm" 
                              style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }}
                              onClick={() => {
                                setEditingTranscriptId(clip.clip_id);
                                setEditedTranscriptText(clip.transcript_final || clip.transcript_provisional || '');
                              }}
                            >
                              <Edit3 size={12} /> Edit
                            </button>
                          ) : (
                            <button 
                              className="btn btn-success btn-sm" 
                              style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }}
                              onClick={() => handleSaveTranscript(clip.clip_id)}
                            >
                              <Save size={12} /> Save
                            </button>
                          )}
                        </div>

                        {isEditingTranscript ? (
                          <input
                            type="text"
                            className="form-input"
                            value={editedTranscriptText}
                            onChange={(e) => setEditedTranscriptText(e.target.value)}
                            style={{ fontSize: '0.9rem', marginTop: '4px' }}
                          />
                        ) : (
                          <p className="transcript-text">"{clip.transcript_final || clip.transcript_provisional || 'No transcript'}"</p>
                        )}
                      </div>

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
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Coverage & Diversity Tab */}
        {activeTab === 'coverage' && (
          <div className="admin-section fade-in">
            {/* Demographic Diversity Breakdown */}
            <div className="card glass-card">
              <div className="card-header">
                <h2>Speaker Demographic Diversity</h2>
                <p>Ensuring balanced speech dataset collection across gender & regional accents</p>
              </div>
              
              <div className="diversity-matrix-grid">
                <div className="diversity-box">
                  <h4>Gender Distribution</h4>
                  <div className="pill-choice-group" style={{ marginTop: '0.5rem' }}>
                    {Object.entries(genderCounts).map(([g, count]) => (
                      <span key={g} className="badge-pill unlocked">
                        {g}: <strong>{count}</strong>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="diversity-box">
                  <h4>Regional Accents Distribution</h4>
                  <div className="pill-choice-group" style={{ marginTop: '0.5rem' }}>
                    {Object.entries(regionCounts).map(([r, count]) => (
                      <span key={r} className="badge-pill unlocked">
                        {r}: <strong>{count}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Coverage Heatmap */}
            <div className="card glass-card">
              <div className="card-header">
                <h2>Intent Coverage Target Progress</h2>
                <p>Target: 40 clips per intent with diverse speaker voices</p>
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

        {/* Speakers Tab with Inspector & Task Assign */}
        {activeTab === 'speakers' && (
          <div className="admin-section fade-in">
            <div className="card glass-card">
              <input
                type="text"
                className="form-input"
                placeholder="Search speakers by ID, name, region, or language..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="speaker-grid">
              {filteredSpeakers.length === 0 ? (
                <div className="card card-center glass-card" style={{ gridColumn: '1 / -1' }}>
                  <Users size={40} className="icon-muted" />
                  <p>No speakers match your search query</p>
                </div>
              ) : (
                filteredSpeakers.map(speaker => (
                  <div key={speaker.speaker_id} className="speaker-card glass-card">
                    <div className="speaker-header">
                      <Users size={18} />
                      <div>
                        <h4 style={{ fontSize: '1.05rem' }}>{speaker.name || speaker.speaker_id}</h4>
                        {speaker.name && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{speaker.speaker_id}</p>}
                      </div>
                    </div>
                    <div className="speaker-badges" style={{ marginBottom: '12px' }}>
                      <span className="speaker-badge">{speaker.gender}</span>
                      <span className="speaker-badge">{speaker.age_band}</span>
                      {assignedPrompts[speaker.speaker_id] && (
                        <span className="badge-pill unlocked">
                          🎯 Assigned: {assignedPrompts[speaker.speaker_id]}
                        </span>
                      )}
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

                    <div className="button-group" style={{ marginTop: '0.75rem' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setInspectorSpeaker(speaker)}
                      >
                        <Eye size={14} /> Inspect & Assign
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleWithdrawSpeaker(speaker.speaker_id)}
                      >
                        <Trash2 size={14} /> Withdraw
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Prompt Assignments Tab */}
        {activeTab === 'prompts' && (
          <div className="admin-section fade-in">
            <div className="card glass-card">
              <div className="card-header">
                <h2>Admin Prompt & Domain Dispatcher</h2>
                <p>Assign specific speech domains to speakers to balance dataset collection</p>
              </div>

              <div className="admin-list">
                {speakers.map(spk => (
                  <div key={spk.speaker_id} className="clip-card glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <h4 style={{ fontSize: '1.05rem', marginBottom: '2px' }}>
                        {spk.name || spk.speaker_id} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>({spk.speaker_id})</span>
                      </h4>
                      <p className="clip-meta">{spk.gender} • {spk.age_band} • {spk.l1} ({spk.region})</p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="transcript-label" style={{ margin: 0 }}>Assigned Domain:</span>
                      <select 
                        className="form-select"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                        value={assignedPrompts[spk.speaker_id] || 'BNK'}
                        onChange={(e) => handleAssignPromptToSpeaker(spk.speaker_id, e.target.value)}
                      >
                        <option value="BNK">🏦 Banking (BNK)</option>
                        <option value="EDU">🎓 Education (EDU)</option>
                        <option value="TRV">✈️ Travel (TRV)</option>
                        <option value="VAS">🎙️ Assistant (VAS)</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Speaker Inspector Modal */}
        {inspectorSpeaker && (
          <div className="modal-overlay fade-in" onClick={() => setInspectorSpeaker(null)}>
            <div className="modal-card glass-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '540px', textAlign: 'left', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <h2>Speaker Inspector & Task Assignment</h2>
                <button className="btn btn-secondary btn-sm" onClick={() => setInspectorSpeaker(null)}>
                  <X size={16} />
                </button>
              </div>
              
              <div style={{ margin: '1rem 0', width: '100%' }}>
                <p style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary)' }}>
                  {inspectorSpeaker.name || inspectorSpeaker.speaker_id}
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  ID: {inspectorSpeaker.speaker_id} • Registered on {new Date(inspectorSpeaker.created_at).toLocaleString()}
                </p>
              </div>

              <div className="admin-demographics" style={{ width: '100%', gridTemplateColumns: '1fr 1fr 1fr' }}>
                <div>
                  <p className="label">Gender</p>
                  <p className="value">{inspectorSpeaker.gender}</p>
                </div>
                <div>
                  <p className="label">Age Band</p>
                  <p className="value">{inspectorSpeaker.age_band}</p>
                </div>
                <div>
                  <p className="label">Language (L1)</p>
                  <p className="value">{inspectorSpeaker.l1}</p>
                </div>
              </div>

              {/* Admin Prompt Assignment Section inside Inspector */}
              <div className="card glass-card" style={{ width: '100%', margin: '1rem 0', padding: '1rem' }}>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>
                  <Target size={14} style={{ display: 'inline', marginRight: 4 }} /> Assign Target Recording Domain
                </h4>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {['BNK', 'EDU', 'TRV', 'VAS'].map(dom => (
                    <button
                      key={dom}
                      className={`preset-chip ${assignedPrompts[inspectorSpeaker.speaker_id] === dom ? 'active' : ''}`}
                      onClick={() => handleAssignPromptToSpeaker(inspectorSpeaker.speaker_id, dom)}
                    >
                      {dom === 'BNK' ? '🏦 Banking' : dom === 'EDU' ? '🎓 Education' : dom === 'TRV' ? '✈️ Travel' : '🎙️ Assistant'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="speaker-stats" style={{ width: '100%', margin: '0.5rem 0' }}>
                <div className="stat-box">
                  <p className="value">{inspectorSpeaker.total_clips}</p>
                  <p className="label">Total Clips</p>
                </div>
                <div className="stat-box">
                  <p className="value" style={{ color: 'var(--success)' }}>{inspectorSpeaker.processed_clips}</p>
                  <p className="label">Passed</p>
                </div>
                <div className="stat-box">
                  <p className="value" style={{ color: 'var(--danger)' }}>{inspectorSpeaker.rejected_clips}</p>
                  <p className="label">Rejected</p>
                </div>
              </div>

              <div className="button-group" style={{ width: '100%', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button 
                  className="btn btn-danger" 
                  onClick={() => handleWithdrawSpeaker(inspectorSpeaker.speaker_id)}
                >
                  <Trash2 size={16} /> Withdraw Speaker & Delete Clips
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
