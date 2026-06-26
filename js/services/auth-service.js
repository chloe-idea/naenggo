/**
 * Firebase Authentication (Google 로그인)
 */
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  getFirebaseAuth,
  getGoogleProvider,
  isFirebaseConfigured,
} from '../firebase.js';

let currentUser = null;
const listeners = new Set();

function notifyListeners(user) {
  currentUser = user;
  listeners.forEach((fn) => {
    try { fn(user); } catch (err) { console.warn('[AuthService]', err); }
  });
}

export const AuthService = {
  isConfigured: isFirebaseConfigured,

  init(onChange) {
    if (typeof onChange === 'function') listeners.add(onChange);
    const auth = getFirebaseAuth();
    if (!auth) {
      notifyListeners(null);
      return () => {};
    }
    return onAuthStateChanged(auth, (user) => notifyListeners(user));
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
      console.warn('[AuthService] getIdToken failed:', err);
      return null;
    }
  },

  async signInWithGoogle() {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('Firebase 설정이 완료되지 않았습니다. firebase-config.js를 확인해 주세요.');
    const result = await signInWithPopup(auth, getGoogleProvider());
    return result.user;
  },

  async signOut() {
    const auth = getFirebaseAuth();
    if (!auth) return;
    await signOut(auth);
  },

  subscribe(fn) {
    listeners.add(fn);
    fn(currentUser);
    return () => listeners.delete(fn);
  },
};
