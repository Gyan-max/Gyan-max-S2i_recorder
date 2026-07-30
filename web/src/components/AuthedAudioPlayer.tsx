import { useState, useEffect, useRef } from 'react';
import { fetchAudioObjectUrl } from '../api';
import AudioPlayer from './AudioPlayer';

interface AuthedAudioPlayerProps {
  /** API path for the clip audio, e.g. `${API_BASE}/clips/abc/download`. */
  url: string;
}

/**
 * Plays a clip whose audio sits behind an authenticated endpoint.
 *
 * A plain <audio src> cannot send an Authorization header, so the bytes are
 * fetched once (with a fresh Firebase ID token) and handed to the shared
 * AudioPlayer as an object URL. Used by both the volunteer's recordings list
 * and the admin review queue so the two behave identically.
 */
export default function AuthedAudioPlayer({ url }: AuthedAudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAudioUrl(null);
    setFailed(false);

    (async () => {
      try {
        // fetchAudioObjectUrl builds against API_BASE already; strip it back
        // off so callers can keep passing a full URL.
        const objectUrl = await fetchAudioObjectUrl(stripApiBase(url));
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
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
  }, [url]);

  if (failed) return <p className="audio-load-state">Audio unavailable for this recording.</p>;
  if (!audioUrl) return <p className="audio-load-state">Loading audio…</p>;
  return <AudioPlayer src={audioUrl} />;
}

/** Accepts either a full `${API_BASE}/...` URL or a bare `/clips/...` path. */
function stripApiBase(url: string): string {
  const marker = '/api/';
  const idx = url.indexOf(marker);
  return idx >= 0 ? url.slice(idx + marker.length - 1) : url;
}
