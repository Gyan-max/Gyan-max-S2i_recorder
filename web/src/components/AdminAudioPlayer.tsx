import { useState, useEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import { API_BASE } from '../config';
import AudioPlayer from './AudioPlayer';

interface AdminAudioPlayerProps {
  clipId: string;
  adminToken: string;
}

export default function AdminAudioPlayer({ clipId, adminToken }: AdminAudioPlayerProps) {
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

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `clip_${clipId.slice(0, 8)}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (!audioUrl) return <p className="admin-audio-loading">Loading audio…</p>;

  return (
    <div className="admin-audio-wrapper">
      <AudioPlayer src={audioUrl} />
      <button 
        type="button" 
        className="btn btn-secondary btn-sm"
        onClick={handleDownload}
        title="Download raw audio clip"
        style={{ marginTop: '0.4rem', gap: '0.3rem' }}
      >
        <Download size={14} /> Download Audio
      </button>
    </div>
  );
}
