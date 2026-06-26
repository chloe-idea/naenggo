/**
 * Firebase 부트스트랩 — Auth UI + 전역 서비스 노출
 * 클릭 이벤트는 js/auth-ui-bridge.js (non-module)에서 처리
 */
import { AuthService } from './services/auth-service.js';
import { FirestoreUserService } from './services/firestore-user-service.js';
import { AnalysisQuotaService } from './services/analysis-quota-service.js';
import { formatAuthError } from './services/auth-errors.js';
import { isFirebaseConfigured } from './firebase.js';

const DEFAULT_GOOGLE_LABEL = 'Google 로그인';

function $(id) {
  return document.getElementById(id);
}

function showAuthError(formatted) {
  const el = $('auth-error');
  if (!el || !formatted) return;
  el.hidden = false;
  el.textContent = [formatted.message, formatted.hint].filter(Boolean).join(' ');
  if (formatted.code === 'auth/unauthorized-domain') {
    el.classList.add('auth-error--domain');
  } else {
    el.classList.remove('auth-error--domain');
  }
}

function clearAuthError() {
  const el = $('auth-error');
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
  el.classList.remove('auth-error--domain');
}

function setGoogleButtonLoading(loading) {
  const btn = $('auth-google-btn');
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '로그인 중…' : DEFAULT_GOOGLE_LABEL;
  btn.classList.toggle('btn--loading', loading);
}

function renderAuthUi(user) {
  const guestEl = $('auth-guest');
  const userEl = $('auth-user');
  const guestHint = $('auth-guest-hint');
  const nameEl = $('auth-user-name');
  const emailEl = $('auth-user-email');
  const remainingEl = $('auth-header-remaining');
  const googleBtn = $('auth-google-btn');

  if (!guestEl || !userEl) {
    console.error('[firebase-bootstrap] auth UI elements not found in DOM');
    return;
  }

  if (!isFirebaseConfigured()) {
    guestEl.hidden = false;
    userEl.hidden = true;
    if (guestHint) guestHint.hidden = false;
    if (googleBtn) googleBtn.disabled = false;
    showAuthError({
      message: 'Firebase 설정(firebase-config.js)이 필요합니다.',
      hint: 'js/firebase-config.js에 Console에서 받은 firebaseConfig 값을 입력해 주세요.',
      code: 'auth/config-not-set',
    });
    return;
  }

  if (user) {
    guestEl.hidden = true;
    userEl.hidden = false;
    if (guestHint) guestHint.hidden = true;
    clearAuthError();

    const displayName = user.displayName || '';
    const email = user.email || '';

    if (nameEl) nameEl.textContent = displayName || email || '로그인됨';
    if (emailEl) {
      if (displayName && email) {
        emailEl.textContent = email;
        emailEl.hidden = false;
      } else {
        emailEl.textContent = '';
        emailEl.hidden = true;
      }
    }
    if (remainingEl) remainingEl.textContent = '무료 분석 확인 중…';
  } else {
    guestEl.hidden = false;
    userEl.hidden = true;
    if (guestHint) guestHint.hidden = false;
    if (googleBtn) {
      googleBtn.disabled = false;
      googleBtn.textContent = DEFAULT_GOOGLE_LABEL;
    }
  }
}

async function refreshHeaderQuota() {
  const remainingEl = $('auth-header-remaining');
  if (!remainingEl) return;

  try {
    const usage = await AnalysisQuotaService.fetchUsage();
    if (!usage) {
      remainingEl.textContent = '무료 분석 —';
      return;
    }
    if (usage.remaining > 0) {
      remainingEl.textContent = `무료 분석 ${usage.remaining}회`;
      remainingEl.classList.remove('auth-bar__remaining--exhausted');
    } else {
      remainingEl.textContent = '무료 분석 소진';
      remainingEl.classList.add('auth-bar__remaining--exhausted');
    }
    window.dispatchEvent(new CustomEvent('analysis-quota-updated', { detail: usage }));
  } catch (err) {
    console.error('[firebase-bootstrap] quota refresh failed:', err);
    remainingEl.textContent = '무료 분석 —';
  }
}

async function handleAuthChange(user) {
  console.log('[firebase-bootstrap] handleAuthChange:', user?.email || 'guest');
  renderAuthUi(user);

  if (user) {
    try {
      await FirestoreUserService.ensureUserDocument(user);
    } catch (err) {
      console.error('[firebase-bootstrap] ensureUserDocument failed:', err);
    }
  }

  await refreshHeaderQuota();
  window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user } }));
}

async function signInWithGoogleFlow() {
  console.log('[firebase-bootstrap] signInWithGoogleFlow');
  clearAuthError();
  setGoogleButtonLoading(true);

  try {
    const user = await AuthService.signInWithGoogle();
    if (user) {
      console.log('[firebase-bootstrap] login success:', user.email);
      await handleAuthChange(user);
    } else {
      console.log('[firebase-bootstrap] redirect flow — page will reload after Google sign-in');
    }
  } catch (err) {
    console.error('[firebase-bootstrap] Google login failed:', err);
    const formatted = err.authError || formatAuthError(err);
    showAuthError(formatted);
    if (formatted.code === 'auth/unauthorized-domain') {
      alert(`${formatted.message}\n\n${formatted.hint}`);
    }
    throw err;
  } finally {
    if (!AuthService.isLoggedIn()) setGoogleButtonLoading(false);
  }
}

async function signOutFlow() {
  console.log('[firebase-bootstrap] signOutFlow');
  await AuthService.signOut();
  clearAuthError();
  await handleAuthChange(null);
}

async function bootstrap() {
  console.log('[firebase-bootstrap] start', {
    configured: isFirebaseConfigured(),
    hostname: location.hostname,
  });

  window.__authSignInGoogle = signInWithGoogleFlow;
  window.__authSignOut = signOutFlow;
  window.__authHandleUser = handleAuthChange;

  try {
    await AuthService.init(handleAuthChange);
  } catch (err) {
    console.error('[firebase-bootstrap] AuthService.init failed:', err);
    showAuthError(formatAuthError(err));
  }

  window.FirebaseServices = {
    ready: true,
    AuthService,
    FirestoreUserService,
    AnalysisQuotaService,
    refreshHeaderQuota,
    isConfigured: isFirebaseConfigured(),
  };

  window.dispatchEvent(new Event('firebase-ready'));
  console.log('[firebase-bootstrap] ready');
}

window.addEventListener('auth-error', (e) => {
  if (e.detail) showAuthError(e.detail);
});

window.addEventListener('error', (event) => {
  const file = event.filename || '';
  if (file.includes('firebase') || file.includes('auth')) {
    console.error('[firebase-bootstrap] script error:', event.message, file);
    showAuthError({
      message: `Firebase 스크립트 오류: ${event.message}`,
      hint: 'F12 → Console 탭에서 자세한 오류를 확인해 주세요.',
      code: 'auth/script-error',
    });
  }
});

window.__firebaseBootstrapPromise = bootstrap().catch((err) => {
  console.error('[firebase-bootstrap] fatal error:', err);
  showAuthError(formatAuthError(err));
});
