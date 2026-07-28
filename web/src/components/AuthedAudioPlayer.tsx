import { useState, useEffect, useRef } from 'react';
import AudioPlayer from './AudioPlayer';

interface AuthedAudioPlayerProps {
  /** Absolute API path for the clip audio, e.g. `${API_BASE}/clips/abc/download`. */
  url: string;
  /** Bearer token for whoever is allowed to hear this clip (speaker or admin). */
  token: string;
}

/**
 * Plays a clip whose audio sits behind an authenticated endpoint.
 *
 * A plain <audio src> cannot send an Authorization header, so the bytes are
 * fetched once and handed to the shared AudioPlayer as an object URL. Used by
 * both the volunteer's own recordings list and the admin review queue so the
 * two surfaces behave identically.
 */
export default function AuthedAudioPlayer({ url, token }: AuthedAudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAudioUrl(null);
    setFailed(false);

    (async () => {
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        setAudioUrl(objectUrl);
      } catch (e) {
        console.error('Failed to load audio from', url, e);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [url, token]);

  if (failed) return <p className="audio-load-state">Audio unavailable for this recording.</p>;
  if (!audioUrl) return <p className="audio-load-state">Loading audio…</p>;
  return <AudioPlayer src={audioUrl} />;
}
