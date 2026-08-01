/**
 * Firebase Authentication (Google 로그인 — popup + iOS redirect fallback)
 */
import {
  onAuthStateChanged,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  reauthenticateWithPopup,
  signOut as firebaseSignOut,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  auth,
  googleProvider,
  assertAuthReady,
  isFirebaseConfigured,
} from '../firebase.js';
import { formatAuthError, logAuthError } from './auth-errors.js';
import { StartupPerf } from './startup-perf.js';

let currentUser = null;
let initialAuthResolved = false;
let authInitStartedMs = null;
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

function wrapReauthError(err, fallbackMessage) {
  const code = String(err?.code || '');
  const wrapped = new Error(fallbackMessage || err?.message || 'Google 재인증에 실패했습니다.');
  wrapped.code = code || 'auth/unknown';
  wrapped.cause = err;
  return wrapped;
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
  StartupPerf.end('auth resolved', {
    documentCount: 0,
    firestorePath: 'auth/onAuthStateChanged',
    startMs: authInitStartedMs ?? StartupPerf.originMs,
  });
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
    authInitStartedMs = performance.now();
    StartupPerf.begin('auth resolved', 'auth/onAuthStateChanged');

    if (!isFirebaseConfigured()) {
      console.error('[AuthService] Firebase auth is not ready (config or init failed).');
      notifyListeners(null);
      markInitialAuthResolved();
      return () => {};
    }

    ensureInitialAuthPromise();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('[AuthService] auth state changed:', user ? 'signed in' : 'signed out');
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

  /**
   * 회원 탈퇴용 Google 재인증 — popup만 사용.
   * 클릭 핸들러에서 첫 await로 호출해야 팝업 차단을 줄일 수 있다.
   * redirect fallback은 탈퇴 오인 위험이 있어 사용하지 않는다.
   *
   * @param {{ expectedUid?: string, expectedEmail?: string|null }} [options]
   * @returns {Promise<import('firebase/auth').User>}
   */
  async reauthenticateWithGoogleForAccountDelete(options = {}) {
    const { auth: authInstance, googleProvider: provider } = assertAuthReady();
    const user = authInstance.currentUser;
    if (!user?.uid) {
      throw wrapReauthError(
        { code: 'AUTH_REQUIRED' },
        '로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.',
      );
    }

    const expectedUid = String(options.expectedUid || user.uid).trim();
    const expectedEmail = String(options.expectedEmail ?? user.email ?? '')
      .trim()
      .toLowerCase();

    // 계정 선택 유도 (firebase.js 초기화와 동일)
    provider.setCustomParameters({ prompt: 'select_account' });

    console.log('[AuthService] reauthenticateWithPopup start (account delete)');

    let result;
    try {
      // 사용자 제스처 직후 호출 — 사전 await/API/setTimeout 금지
      result = await reauthenticateWithPopup(user, provider);
    } catch (err) {
      const code = String(err?.code || '');
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        throw wrapReauthError(err, 'Google 재인증이 취소되었습니다.');
      }
      if (code === 'auth/popup-blocked') {
        throw wrapReauthError(
          err,
          '팝업이 차단되었습니다. 브라우저에서 팝업을 허용한 뒤 다시 시도해 주세요.',
        );
      }
      if (code === 'auth/operation-not-supported-in-this-environment') {
        throw wrapReauthError(
          err,
          '이 환경에서는 Google 팝업 재인증을 사용할 수 없습니다. 모바일 브라우저나 데스크톱에서 다시 시도해 주세요.',
        );
      }
      if (code === 'auth/requires-recent-login') {
        throw wrapReauthError(err, '보안을 위해 Google 계정으로 다시 확인해 주세요.');
      }
      logAuthError('reauthenticateWithGoogleForAccountDelete failed', err);
      const formatted = formatAuthError(err);
      const wrapped = wrapReauthError(err, formatted.message || 'Google 재인증에 실패했습니다.');
      wrapped.authError = formatted;
      throw wrapped;
    }

    const reauthUser = result?.user;
    if (!reauthUser?.uid) {
      throw wrapReauthError(
        { code: 'AUTH_REQUIRED' },
        '로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.',
      );
    }

    const reauthEmail = String(reauthUser.email || '').trim().toLowerCase();
    if (reauthUser.uid !== expectedUid
      || (expectedEmail && reauthEmail && reauthEmail !== expectedEmail)) {
      throw wrapReauthError(
        { code: 'AUTH_ACCOUNT_MISMATCH' },
        '현재 로그인한 Google 계정으로 다시 인증해 주세요.',
      );
    }

    currentUser = reauthUser;
    notifyListeners(reauthUser);
    console.log('[AuthService] reauthenticateWithPopup success:', reauthUser.email || reauthUser.uid);
    return reauthUser;
  },

  subscribe(fn) {
    listeners.add(fn);
    fn(currentUser);
    return () => listeners.delete(fn);
  },
};
