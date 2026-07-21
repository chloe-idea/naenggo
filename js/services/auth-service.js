/**
 * Firebase Authentication (Google 로그인 — popup + iOS redirect fallback)
 */
import {
  onAuthStateChanged,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  auth,
  googleProvider,
  assertAuthReady,
  isFirebaseConfigured,
} from '../firebase.js';
import { formatAuthError, logAuthError } from './auth-errors.js';

let currentUser = null;
let initialAuthResolved = false;
/** @type {Promise<void> | null} */
let initialAuthPromise = null;
/** @type {((value?: void) => void) | null} */
let resolveInitialAuth = null;
const listeners = new Set();

function isIosBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua);
}

function shouldUseRedirectLogin() {
  return false;
}

function notifyListeners(user) {
  currentUser = user;
  listeners.forEach((fn) => {
    try { fn(user); } catch (err) { console.warn('[AuthService] listener error:', err); }
  });
}

function markInitialAuthResolved() {
  if (initialAuthResolved) return;
  initialAuthResolved = true;
  console.log('[VideoAuth] auth initialized');
  resolveInitialAuth?.();
  resolveInitialAuth = null;
}

function ensureInitialAuthPromise() {
  if (!initialAuthPromise) {
    initialAuthPromise = new Promise((resolve) => {
      resolveInitialAuth = resolve;
      if (initialAuthResolved) resolve();
    });
  }
  return initialAuthPromise;
}

export const AuthService = {
  isConfigured: isFirebaseConfigured,

  isInitialAuthResolved() {
    return initialAuthResolved;
  },

  async waitForInitialAuth() {
    if (!isFirebaseConfigured()) return null;
    ensureInitialAuthPromise();
    if (auth?.authStateReady) {
      try {
        await auth.authStateReady();
      } catch (err) {
        console.warn('[VideoAuth] authStateReady failed:', err?.code || err?.message || err);
      }
    }
    await initialAuthPromise;
    return auth?.currentUser || currentUser || null;
  },

  async init(onChange) {
    if (typeof onChange === 'function') listeners.add(onChange);

    if (!isFirebaseConfigured()) {
      console.error('[AuthService] Firebase auth is not ready (config or init failed).');
      notifyListeners(null);
      markInitialAuthResolved();
      return () => {};
    }

    ensureInitialAuthPromise();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('[AuthService] auth state changed:', user ? user.email || user.uid : 'signed out');
      if (user) currentUser = user;
      else currentUser = null;
      notifyListeners(user);
      markInitialAuthResolved();
    });

    try {
      const redirectResult = await getRedirectResult(auth);
      if (redirectResult?.user) {
        console.log('[AuthService] getRedirectResult success:', redirectResult.user.email || redirectResult.user.uid);
        currentUser = redirectResult.user;
        notifyListeners(redirectResult.user);
      }
    } catch (err) {
      logAuthError('getRedirectResult failed', err);
      window.dispatchEvent(new CustomEvent('auth-error', { detail: formatAuthError(err) }));
    }

    return unsubscribe;
  },

  getCurrentUser() {
    return auth?.currentUser || currentUser || null;
  },

  isLoggedIn() {
    return Boolean(this.getCurrentUser()?.uid);
  },

  getUid() {
    return this.getCurrentUser()?.uid || null;
  },

  async getIdToken(forceRefresh = false) {
    const user = await this.waitForInitialAuth().then(() => this.getCurrentUser());
    if (!user?.uid) return null;
    try {
      return await user.getIdToken(forceRefresh);
    } catch (err) {
      console.error('[AuthService] getIdToken failed:', err?.code, err?.message, err);
      return null;
    }
  },

  /**
   * 영상 추출 API용 Firebase ID Token — authStateReady 후 최신 토큰 사용
   */
  async acquireIdTokenForApi({ forceRefresh = false } = {}) {
    if (!isFirebaseConfigured() || !auth) {
      const err = new Error('Firebase 인증이 준비되지 않았습니다.');
      err.code = 'AUTH_NOT_INITIALIZED';
      throw err;
    }

    await this.waitForInitialAuth();

    const user = auth.currentUser;
    console.log('[VideoAuth] current user', {
      exists: Boolean(user),
      uid: user?.uid || null,
      email: user?.email || null,
    });

    if (!user?.uid) {
      const err = new Error('AUTH_REQUIRED');
      err.code = 'AUTH_REQUIRED';
      throw err;
    }

    currentUser = user;

    try {
      const idToken = await user.getIdToken(forceRefresh);
      if (!idToken) {
        const err = new Error('AUTH_TOKEN_UNAVAILABLE');
        err.code = 'AUTH_TOKEN_UNAVAILABLE';
        throw err;
      }
      console.log('[VideoAuth] token acquired', {
        length: idToken.length,
        forceRefresh,
        uid: user.uid,
      });
      return idToken;
    } catch (err) {
      console.error('[VideoAuth] token acquire failed:', err?.code || err?.message || err);
      const wrapped = new Error('AUTH_TOKEN_UNAVAILABLE');
      wrapped.code = 'AUTH_TOKEN_UNAVAILABLE';
      wrapped.cause = err;
      throw wrapped;
    }
  },

  async signInWithGoogle() {
    const { auth: authInstance, googleProvider: provider } = assertAuthReady();
    const useRedirect = shouldUseRedirectLogin();
    console.log(`[AuthService] signInWithGoogle start (${useRedirect ? 'redirect' : 'popup'})`);

    try {
      if (useRedirect) {
        await signInWithRedirect(authInstance, provider);
        return null;
      }
      const result = await signInWithPopup(authInstance, provider);
      console.log('[AuthService] signInWithPopup success:', result.user?.email);
      currentUser = result.user;
      notifyListeners(result.user);
      markInitialAuthResolved();
      return result.user;
    } catch (err) {
      const code = String(err?.code || '');
      const shouldFallbackToRedirect = isIosBrowser()
        && (code === 'auth/popup-blocked'
          || code === 'auth/popup-closed-by-user'
          || code === 'auth/cancelled-popup-request');
      if (shouldFallbackToRedirect) {
        console.warn('[AuthService] popup failed on iOS, fallback to redirect:', code);
        await signInWithRedirect(authInstance, provider);
        return null;
      }
      logAuthError(`signInWithGoogle(${useRedirect ? 'redirect' : 'popup'}) failed`, err);
      const formatted = formatAuthError(err);
      const wrapped = new Error(formatted.message);
      wrapped.code = formatted.code;
      wrapped.authError = formatted;
      throw wrapped;
    }
  },

  async signOut() {
    if (!auth) return;
    console.log('[AuthService] signOut');
    currentUser = null;
    await firebaseSignOut(auth);
  },

  subscribe(fn) {
    listeners.add(fn);
    fn(currentUser);
    return () => listeners.delete(fn);
  },
};
