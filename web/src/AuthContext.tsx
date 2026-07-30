/**
 * Firebase auth state for the whole app.
 *
 * Replaces the old localStorage speaker token. The practical difference: a
 * volunteer who clears their browser or picks up a different phone signs in
 * and finds their recordings waiting, because the profile is keyed by Firebase
 * uid on the server rather than by a token that only existed on one device.
 */
import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth, isFirebaseConfigured } from './firebase';
import { apiFetch } from './api';

export interface SpeakerProfile {
  speaker_id: string;
  name: string | null;
  age_band?: string;
  gender?: string;
  l1?: string;
  region?: string;
  consent_at?: string | null;
  assigned_domain?: string | null;
}

interface AuthState {
  user: User | null;
  profile: SpeakerProfile | null;
  isAdmin: boolean;
  /** True until the initial auth check settles - avoids a redirect flash. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<SpeakerProfile | null>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<SpeakerProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (current: User | null) => {
    if (!current) {
      setProfile(null);
      setIsAdmin(false);
      return null;
    }

    // Admin is a custom claim on the token, not a role stored in Firestore,
    // so it cannot be edited by anything the client can reach.
    const tokenResult = await current.getIdTokenResult();
    setIsAdmin(Boolean(tokenResult.claims.admin));

    try {
      const me = await apiFetch('/speakers/me');
      setProfile(me);
      return me as SpeakerProfile;
    } catch {
      // 404 here is the normal "signed in but hasn't onboarded yet" state.
      setProfile(null);
      return null;
    }
  };

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(getFirebaseAuth(), async (current) => {
      setUser(current);
      await loadProfile(current);
      setLoading(false);
    });
    return unsub;
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    profile,
    isAdmin,
    loading,
    signIn: async (email, password) => {
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
    },
    signUp: async (email, password) => {
      await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
    },
    logOut: async () => {
      await signOut(getFirebaseAuth());
      setProfile(null);
      setIsAdmin(false);
    },
    resetPassword: async (email) => {
      await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
    },
    refreshProfile: () => loadProfile(getFirebaseAuth().currentUser),
  }), [user, profile, isAdmin, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Turns Firebase auth error codes into something a volunteer can act on. */
export function describeAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address does not look right.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email or password is incorrect.';
    case 'auth/email-already-in-use':
      return 'An account already exists for this email. Try signing in instead.';
    case 'auth/weak-password':
      return 'Please choose a password of at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Could not reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong signing you in. Please try again.';
  }
}
