import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../config';
import AudioPlayer from './AudioPlayer';

interface AdminAudioPlayerProps {
  clipId: string;
  adminToken: string;
}

/**
 * Fetches a clip's audio via an authenticated admin request (the raw file
 * isn't publicly reachable) and hands the resulting blob URL to the shared
 * AudioPlayer for a consistent playback UI across the volunteer and admin
 * surfaces. No mandatory-listen wiring here — that constraint only applies
 * to the volunteer's own review step.
 */
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

  if (!audioUrl) return <p className="admin-audio-loading">Loading audio…</p>;
  return <AudioPlayer src={audioUrl} />;
}
