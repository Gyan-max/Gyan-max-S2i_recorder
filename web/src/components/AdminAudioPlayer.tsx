import { API_BASE } from '../config';
import AuthedAudioPlayer from './AuthedAudioPlayer';

interface AdminAudioPlayerProps {
  clipId: string;
  adminToken: string;
}

/**
 * Admin-side clip playback. The fetch-with-auth mechanics live in
 * AuthedAudioPlayer, which the volunteer's own recordings list shares.
 */
export default function AdminAudioPlayer({ clipId, adminToken }: AdminAudioPlayerProps) {
  return (
    <AuthedAudioPlayer
      url={`${API_BASE}/admin/clips/${clipId}/audio`}
      token={adminToken}
    />
  );
}
