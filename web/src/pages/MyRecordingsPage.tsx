import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Mic, Download, RefreshCw, AlertCircle } from 'lucide-react';
import { SpeakerClipItem } from '../types';
import { API_BASE } from '../config';
import { apiFetch, fetchAudioObjectUrl } from '../api';
import type { SpeakerProfile } from '../AuthContext';
import AuthedAudioPlayer from '../components/AuthedAudioPlayer';

interface MyRecordingsPageProps {
  profile: SpeakerProfile | null;
}

/**
 * Honest labels for the server's clip states.
 *
 * "uploaded"/"initiated" are attempts that were recorded but never kept, so
 * they must not read as saved. Nothing here claims a clip has reached the
 * corpus before the pipeline has actually processed it.
 */
const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  initiated: { label: 'Not kept', tone: 'muted' },
  uploaded: { label: 'Not kept', tone: 'muted' },
  confirmed: { label: 'Saved', tone: 'confirmed' },
  processing: { label: 'Processing', tone: 'processing' },
  processed: { label: 'Ready', tone: 'processed' },
  rejected: { label: 'Needs re-recording', tone: 'rejected' },
};

function humanizeIntent(intent: string): string {
  return intent.replace(/^[A-Z]+\./, '').replace(/_/g, ' ');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function MyRecordingsPage({ profile }: MyRecordingsPageProps) {
  const [clips, setClips] = useState<SpeakerClipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (profile) fetchClips();
    else setLoading(false);
  }, [profile?.speaker_id]);

  const fetchClips = async () => {
    if (!profile) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/clips/my');
      setClips(data.clips ?? []);
    } catch (e) {
      console.error('Failed to load recordings', e);
      setError('We couldn’t load your recordings. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // The download endpoint needs an Authorization header, so a plain link will
  // not work - fetch the bytes and hand the browser a temporary object URL.
  const handleDownload = async (clip: SpeakerClipItem) => {
    if (!profile) return;
    setDownloading(clip.clip_id);
    try {
      const url = await fetchAudioObjectUrl(`/clips/${clip.clip_id}/download`);
      const link = document.createElement('a');
      link.href = url;
      link.download = clip.filename || `${clip.clip_id}.webm`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed', e);
      setError('That recording could not be downloaded. Please try again.');
    } finally {
      setDownloading(null);
    }
  };

  // No delete action here by design: a kept recording is corpus data, and only
  // an administrator can remove one. The server refuses speaker-initiated
  // deletes outright (403 ADMIN_ONLY), so offering the button would only ever
  // produce an error.

  if (!profile) {
    return (
      <div className="page-container">
        <div className="content-wrapper narrow-wrapper">
          <div className="card card-center">
            <Mic size={40} className="icon-muted" />
            <h2>No active profile</h2>
            <p>Set up your speaker profile to start recording and see your clips here.</p>
            <Link to="/" className="btn btn-primary" style={{ marginTop: '1rem' }}>
              Go to recording
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Redone takes are noise for the volunteer - they deliberately replaced them.
  const visible = clips.filter((c) => c.status !== 'discarded');
  const savedCount = visible.filter((c) =>
    ['confirmed', 'processing', 'processed'].includes(c.status)
  ).length;

  return (
    <div className="page-container">
      <div className="content-wrapper narrow-wrapper">
        <div className="page-header my-recordings-header">
          <div>
            <span className="eyebrow">Your contribution</span>
            <h1>My recordings</h1>
            <p>
              {savedCount === 0
                ? 'Recordings you keep will appear here.'
                : `${savedCount} recording${savedCount === 1 ? '' : 's'} kept on your profile.`}
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={fetchClips} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="alert alert-danger" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="card card-center" role="status">
            <p>Loading your recordings…</p>
          </div>
        )}

        {!loading && visible.length === 0 && !error && (
          <div className="card card-center">
            <Mic size={40} className="icon-muted" />
            <h2>No recordings yet</h2>
            <p>Once you record a prompt and choose “Keep recording”, it will show up here.</p>
            <Link to="/" className="btn btn-primary" style={{ marginTop: '1rem' }}>
              Start recording
            </Link>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <div className="admin-list">
            {visible.map((clip) => {
              const status = STATUS_LABELS[clip.status] ?? { label: clip.status, tone: 'muted' };
              return (
                <div key={clip.clip_id} className="clip-card">
                  <div className="clip-header">
                    <div>
                      <h3 className="my-clip-title">{humanizeIntent(clip.intent)}</h3>
                      <p className="clip-meta">
                        {clip.domain} • {formatDate(clip.created_at)}
                        {clip.duration_s ? ` • ${clip.duration_s.toFixed(1)}s` : ''}
                      </p>
                    </div>
                    <span className={`status-badge tone-${status.tone}`}>{status.label}</span>
                  </div>

                  {clip.transcript_final && (
                    <p className="my-clip-transcript">“{clip.transcript_final}”</p>
                  )}

                  <AuthedAudioPlayer url={`${API_BASE}/clips/${clip.clip_id}/download`} />

                  <div className="my-clip-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleDownload(clip)}
                      disabled={downloading === clip.clip_id}
                    >
                      <Download size={15} />
                      {downloading === clip.clip_id ? 'Preparing…' : 'Download'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
