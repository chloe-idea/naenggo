/**
 * Firebase Authentication (Google 로그인 — popup 전용)
 */
import {
  onAuthStateChanged,
  signInWithPopup,
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
const listeners = new Set();

function notifyListeners(user) {
  currentUser = user;
  listeners.forEach((fn) => {
    try { fn(user); } catch (err) { console.warn('[AuthService] listener error:', err); }
  });
}

export const AuthService = {
  isConfigured: isFirebaseConfigured,

  async init(onChange) {
    if (typeof onChange === 'function') listeners.add(onChange);

    if (!isFirebaseConfigured()) {
      console.error('[AuthService] Firebase auth is not ready (config or init failed).');
      notifyListeners(null);
      return () => {};
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('[AuthService] auth state changed:', user ? user.email || user.uid : 'signed out');
      if (user) currentUser = user;
      else currentUser = null;
      notifyListeners(user);
    });

    return unsubscribe;
  },

  getCurrentUser() {
    return currentUser || auth?.currentUser || null;
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
      console.error('[AuthService] getIdToken failed:', err?.code, err?.message, err);
      return null;
    }
  },

  async signInWithGoogle() {
    const { auth: authInstance, googleProvider: provider } = assertAuthReady();
    console.log('[AuthService] signInWithPopup start');

    try {
      const result = await signInWithPopup(authInstance, provider);
      console.log('[AuthService] signInWithPopup success:', result.user?.email);
      currentUser = result.user;
      notifyListeners(result.user);
      return result.user;
    } catch (err) {
      logAuthError('signInWithPopup failed', err);
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
