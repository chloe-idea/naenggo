/**
 * Firebase Authentication (Google 로그인)
 */
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  getFirebaseAuth,
  getGoogleProvider,
  isFirebaseConfigured,
} from '../firebase.js';
import { formatAuthError, logAuthError } from './auth-errors.js';

let currentUser = null;
const listeners = new Set();
let redirectChecked = false;

function notifyListeners(user) {
  currentUser = user;
  listeners.forEach((fn) => {
    try { fn(user); } catch (err) { console.warn('[AuthService] listener error:', err); }
  });
}

function shouldUseRedirectFallback(err) {
  const code = String(err?.code || '');
  return [
    'auth/popup-blocked',
    'auth/popup-closed-by-user',
    'auth/cancelled-popup-request',
  ].includes(code);
}

export const AuthService = {
  isConfigured: isFirebaseConfigured,

  async init(onChange) {
    if (typeof onChange === 'function') listeners.add(onChange);

    if (!isFirebaseConfigured()) {
      console.error('[AuthService] firebase-config.js가 설정되지 않았습니다.');
      notifyListeners(null);
      return () => {};
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      console.error('[AuthService] getFirebaseAuth() returned null');
      notifyListeners(null);
      return () => {};
    }

    if (!redirectChecked) {
      redirectChecked = true;
      try {
        console.log('[AuthService] getRedirectResult checking…');
        const redirectResult = await getRedirectResult(auth);
        if (redirectResult?.user) {
          console.log('[AuthService] Redirect login success:', redirectResult.user.email);
        }
      } catch (err) {
        const formatted = logAuthError('getRedirectResult failed', err);
        window.dispatchEvent(new CustomEvent('auth-error', { detail: formatted }));
      }
    }

    return onAuthStateChanged(auth, (user) => {
      console.log('[AuthService] auth state changed:', user ? user.email || user.uid : 'signed out');
      notifyListeners(user);
    });
  },

  getCurrentUser() {
    return currentUser || getFirebaseAuth()?.currentUser || null;
  },

  isLoggedIn() {
    return Boolean(this.getCurrentUser());
  },

  getUid() {
    return this.getCurrentUser()?.uid || null;
  },

  async getIdToken(forceRefresh = false) {
    const user = this.getCurrentUser();
    if (!user) return null;
    try {
      return await user.getIdToken(forceRefresh);
    } catch (err) {
      console.error('[AuthService] getIdToken failed:', err);
      return null;
    }
  },

  async signInWithGoogle() {
    if (!isFirebaseConfigured()) {
      const err = new Error('Firebase 설정(firebase-config.js)이 완료되지 않았습니다.');
      err.code = 'auth/config-not-set';
      throw err;
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      const err = new Error('Firebase Auth 초기화에 실패했습니다.');
      err.code = 'auth/not-initialized';
      throw err;
    }

    const provider = getGoogleProvider();
    console.log('[AuthService] signInWithPopup start');

    try {
      const result = await signInWithPopup(auth, provider);
      console.log('[AuthService] signInWithPopup success:', result.user?.email);
      return result.user;
    } catch (err) {
      logAuthError('signInWithPopup failed', err);

      if (shouldUseRedirectFallback(err)) {
        console.log('[AuthService] signInWithRedirect fallback start');
        await signInWithRedirect(auth, provider);
        return null;
      }

      const formatted = formatAuthError(err);
      const wrapped = new Error(formatted.message);
      wrapped.code = formatted.code;
      wrapped.authError = formatted;
      throw wrapped;
    }
  },

  async signOut() {
    const auth = getFirebaseAuth();
    if (!auth) return;
    console.log('[AuthService] signOut');
    await signOut(auth);
  },

  subscribe(fn) {
    listeners.add(fn);
    fn(currentUser);
    return () => listeners.delete(fn);
  },
};
