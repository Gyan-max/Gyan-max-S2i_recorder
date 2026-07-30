import { API_BASE } from '../config';
import AuthedAudioPlayer from './AuthedAudioPlayer';

interface AdminAudioPlayerProps {
  clipId: string;
}

/**
 * Admin-side clip playback. The fetch-with-auth mechanics live in
 * AuthedAudioPlayer, which the volunteer's own recordings list shares.
 * Authorization comes from the caller's Firebase ID token, so there is no
 * separate admin token to thread through.
 */
export default function AdminAudioPlayer({ clipId }: AdminAudioPlayerProps) {
  return <AuthedAudioPlayer url={`${API_BASE}/admin/clips/${clipId}/audio`} />;
}
