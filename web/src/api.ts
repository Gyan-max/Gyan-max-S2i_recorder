/**
 * Single entry point for every API call.
 *
 * Attaches a fresh Firebase ID token to each request. Tokens expire after an
 * hour, so `getIdToken()` is called per request rather than cached - the SDK
 * returns the cached token until it is close to expiry and refreshes silently
 * otherwise, which is exactly the behaviour we want during a long recording
 * session.
 */
import { getFirebaseAuth, isFirebaseConfigured } from './firebase';
import { API_BASE } from './config';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  if (!isFirebaseConfigured) return {};
  const user = getFirebaseAuth().currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Sent as multipart instead of JSON. */
  formData?: FormData;
  deviceId?: string;
  /** Return the raw Response (for audio blobs) instead of parsed JSON. */
  raw?: boolean;
}

export async function apiFetch(path: string, options: RequestOptions = {}): Promise<any> {
  const { method = 'GET', body, formData, deviceId, raw } = options;

  const headers: Record<string, string> = { ...(await authHeader()) };
  if (deviceId) headers['X-Device-ID'] = deviceId;
  // Content-Type is deliberately left unset for FormData so the browser can
  // add the multipart boundary itself.
  if (body !== undefined && !formData) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  if (raw) {
    if (!res.ok) throw await toError(res);
    return res;
  }

  if (!res.ok) throw await toError(res);
  if (res.status === 204) return null;

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function toError(res: Response): Promise<ApiError> {
  let code = 'REQUEST_FAILED';
  let message = `Request failed (HTTP ${res.status})`;
  try {
    const data = await res.json();
    const detail = data?.detail;
    if (typeof detail === 'string') {
      message = detail;
    } else if (detail) {
      code = detail.code || code;
      message = detail.message || message;
    }
  } catch {
    // Non-JSON error body; keep the generic message.
  }
  return new ApiError(res.status, code, message);
}

/** Fetches audio behind an authenticated endpoint as an object URL. */
export async function fetchAudioObjectUrl(path: string): Promise<string> {
  const res: Response = await apiFetch(path, { raw: true });
  return URL.createObjectURL(await res.blob());
}

/**
 * Authenticated fetch that returns the raw Response instead of throwing.
 *
 * For callers that branch on `res.ok` / `res.status` themselves - the admin
 * panel surfaces per-action error messages and distinguishes 401 from other
 * failures, so throwing would lose that detail.
 */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    ...(await authHeader()),
  };
  // Let the browser set the multipart boundary itself.
  if (init.body instanceof FormData) delete headers['Content-Type'];
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}
