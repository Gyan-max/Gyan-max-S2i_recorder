import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Mic, Download, RefreshCw, AlertCircle, Trash2 } from 'lucide-react';
import { SpeakerResponse, SpeakerClipItem } from '../types';
import { API_BASE } from '../config';
import AuthedAudioPlayer from '../components/AuthedAudioPlayer';

interface MyRecordingsPageProps {
  currentSpeaker: SpeakerResponse | null;
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

export default function MyRecordingsPage({ currentSpeaker }: MyRecordingsPageProps) {
  const [clips, setClips] = useState<SpeakerClipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (currentSpeaker) fetchClips();
    else setLoading(false);
  }, [currentSpeaker?.token]);

  const fetchClips = async () => {
    if (!currentSpeaker) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/clips/my`, {
        headers: { Authorization: `Bearer ${currentSpeaker.token}` },
      });
      if (!res.ok) throw new Error(`Request failed with ${res.status}`);
      const data = await res.json();
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
    if (!currentSpeaker) return;
    setDownloading(clip.clip_id);
    try {
      const res = await fetch(`${API_BASE}/clips/${clip.clip_id}/download`, {
        headers: { Authorization: `Bearer ${currentSpeaker.token}` },
      });
      if (!res.ok) throw new Error(`Download failed with ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
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

  // Deletion is permanent and removes the audio from the server, so it is
  // confirmed explicitly rather than being a one-tap action.
  const handleDelete = async (clip: SpeakerClipItem) => {
    if (!currentSpeaker) return;
    const label = humanizeIntent(clip.intent);
    const confirmed = window.confirm(
      `Delete your “${label}” recording?\n\n` +
        'This permanently removes the audio from the server. ' +
        'The prompt becomes available to record again. This cannot be undone.'
    );
    if (!confirmed) return;

    setDeleting(clip.clip_id);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/clips/${clip.clip_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${currentSpeaker.token}` },
      });
      if (!res.ok) throw new Error(`Delete failed with ${res.status}`);
      setClips((prev) => prev.filter((c) => c.clip_id !== clip.clip_id));
    } catch (e) {
      console.error('Delete failed', e);
      setError('That recording could not be deleted. Please try again.');
    } finally {
      setDeleting(null);
    }
  };

  if (!currentSpeaker) {
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

                  <AuthedAudioPlayer
                    url={`${API_BASE}/clips/${clip.clip_id}/download`}
                    token={currentSpeaker.token}
                  />

                  <div className="my-clip-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleDownload(clip)}
                      disabled={downloading === clip.clip_id || deleting === clip.clip_id}
                    >
                      <Download size={15} />
                      {downloading === clip.clip_id ? 'Preparing…' : 'Download'}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(clip)}
                      disabled={deleting === clip.clip_id || downloading === clip.clip_id}
                    >
                      <Trash2 size={15} />
                      {deleting === clip.clip_id ? 'Deleting…' : 'Delete'}
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
