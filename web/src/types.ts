// Type definitions for the S2I Recorder frontend application

export interface SpeakerResponse {
  speaker_id: string;
  name?: string;
  token: string;
  age_band: string;
  consent_at: string;
}

export interface SpeakerRosterItem {
  speaker_id: string;
  name?: string;
  age_band: string;
  gender: string;
  last_used_at: string;
}

export interface TaskResponse {
  task_id: string;
  intent: string;
  scenario_id: string;
  scenario_no: number;
  example_no: number;
  text_hi: string;
  examples: string[];
  register: string | null;
  status: 'pending' | 'recorded' | 'skipped';
  redo_count: number;
}

export interface ProgressInfo {
  intents_total: number;
  intents_done: number;
  current_intent: string | null;
  scenarios_in_intent: number;
  scenarios_done: number;
  examples_in_scenario: number;
  examples_done: number;
}

export interface SessionBatchInfo {
  domain: string;
  batch_no: number;
  tasks: TaskResponse[];
  progress: ProgressInfo;
  assigned_domain?: string | null;
}

export interface SpeakerClipItem {
  clip_id: string;
  task_id: string;
  domain: string;
  intent: string;
  scenario_id: string;
  filename: string | null;
  duration_s: number | null;
  transcript_final: string | null;
  status: string;
  created_at: string;
}

export interface ClipInitResponse {
  clip_id: string;
  filename: string;
  upload_url: string;
  upload_expires_at: string;
}

export interface ClipConfirmResponse {
  clip_id: string;
  status: string;
  next_task: TaskResponse | null;
}

export interface ClipDiscardResponse {
  clip_id: string;
  status: string;
  task: TaskResponse;
}

// Admin types
export interface AdminStatsResponse {
  total_speakers: number;
  total_recordings: number;
  confirmed_clips: number;
  redo_count: number;
  qc_passed: number;
  qc_failed: number;
}

export interface AdminCoverageItem {
  domain: string;
  intent: string;
  clips_processed: number;
  speakers_count: number;
  floor: number;
}

export interface ClipReviewItem {
  clip_id: string;
  task_id: string;
  speaker_id: string;
  device_id: string;
  domain: string;
  intent: string;
  scenario_id: string;
  filename: string | null;
  duration_s: number | null;
  qc_flags: string[];
  status: string;
  transcript_provisional: string | null;
  transcript_final: string | null;
  transcript_source: string | null;
  created_at: string;
}

// IndexedDB Types
export interface UploadQueueItem {
  /** Server clip id, or a local placeholder while offline (needsInit=true). */
  clipId: string;
  blob: Blob;
  mimeType: string;
  /**
   * Legacy field from the bearer-token backend. Queued items no longer carry
   * credentials: a token captured before going offline would very likely have
   * expired by the time the queue drains, so authFetch attaches a fresh
   * Firebase ID token at replay instead. Optional only so older queued items
   * still deserialise.
   */
  token?: string;
  deviceId: string;
  /** Required to initialise the clip on the server when the queue drains. */
  taskId: string;
  /** True when captured offline and no server clip exists yet. */
  needsInit: boolean;
  /** Set after init returns the server-side clip id for offline uploads. */
  serverClipId?: string;
  /** Carried so the queued clip can be confirmed, not just uploaded. */
  transcriptEdit?: string;
  prompted: boolean;
  lastError?: string;
  timestamp: number;
  retryCount: number;
}

export interface AudioBlobRecord {
  clipId: string;
  blob: Blob;
  timestamp: number;
}
