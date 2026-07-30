/**
 * Firebase client initialisation.
 *
 * All values here are public by design - Firebase web config is not a secret.
 * What actually protects the data is the deny-all Firestore/Storage rules plus
 * the ID-token check inside the `api` Cloud Function. Nothing in this app
 * talks to Firestore directly.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  browserLocalPersistence,
  setPersistence,
  type Auth,
} from 'firebase/auth';

type Env = {
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_STORAGE_BUCKET?: string;
  VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
};

const env = ((import.meta as unknown as { env?: Env }).env || {}) as Env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/** True when the build was given a Firebase config at all. */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!isFirebaseConfigured) {
    throw new Error(
      'Firebase is not configured. Set VITE_FIREBASE_* variables in your build environment.'
    );
  }
  if (!app) {
    app = initializeApp(firebaseConfig as Required<typeof firebaseConfig>);
    auth = getAuth(app);
    // Survive a tab close: a volunteer mid-session should not be signed out
    // by refreshing. Recordings live on the server either way, but losing the
    // session mid-batch is needless friction.
    setPersistence(auth, browserLocalPersistence).catch(() => undefined);
  }
  return auth!;
}
