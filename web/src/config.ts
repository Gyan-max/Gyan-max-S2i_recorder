/**
 * Runtime configuration shared by the web app.
 *
 * The explicit cast keeps this compatible with TypeScript builds where Vite's
 * ambient `ImportMetaEnv` declaration is not loaded by the deployment system.
 */
type BuildEnvironment = {
  VITE_API_URL?: string;
};

const buildEnvironment = (import.meta as unknown as { env?: BuildEnvironment }).env;

const raw = (buildEnvironment?.VITE_API_URL || '').replace(/\/+$/, '');

/**
 * Base URL for the API.
 *
 * Left blank, this resolves to a same-origin `/api`, which is what Firebase
 * Hosting serves: firebase.json rewrites `/api/**` to the `api` Cloud
 * Function, so the browser never needs the function's own URL and there is no
 * cross-origin request to configure.
 *
 * Set VITE_API_URL only when the frontend is hosted somewhere other than
 * Firebase Hosting (e.g. Vercel), pointing at the deployed function origin.
 */
export const API_BASE = raw ? (raw.endsWith('/api') ? raw : raw + '/api') : '/api';
