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

export const API_BASE = buildEnvironment?.VITE_API_URL || '/api';
