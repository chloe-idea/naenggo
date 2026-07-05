/**
 * Firebase 부트스트랩 — Auth UI + 앱 연동
 * Google 로그인 버튼은 Firebase auth 준비 후에만 활성화
 */
import { AuthService } from './services/auth-service.js';
import { FirestoreUserService } from './services/firestore-user-service.js';
import { AnalysisQuotaService } from './services/analysis-quota-service.js';
import { formatAuthError } from './services/auth-errors.js';
import { auth, isFirebaseConfigured } from './firebase.js';

const DEFAULT_GOOGLE_LABEL = 'Google 로그인';
let authUiBound = false;
let authReady = false;

function $(id) {
  return document.getElementById(id);
}

function showAuthError(formatted) {
  const el = $('auth-error');
  if (!el || !formatted) return;
  el.hidden = false;
  el.textContent = [formatted.message, formatted.hint].filter(Boolean).join(' ');
  el.classList.toggle('auth-error--domain', formatted.code === 'auth/unauthorized-domain');
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
  btn.classList.toggle('btn--loading', loading);
  btn.textContent = loading ? '로그인 중…' : DEFAULT_GOOGLE_LABEL;
  btn.disabled = loading || !authReady || !isFirebaseConfigured();
}

function setGoogleButtonEnabled(enabled) {
  authReady = enabled;
  const btn = $('auth-google-btn');
  if (!btn) return;
  const loading = btn.classList.contains('btn--loading');
  btn.disabled = !enabled || loading || !isFirebaseConfigured();
  btn.setAttribute('aria-disabled', btn.disabled ? 'true' : 'false');
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
    if (googleBtn) googleBtn.disabled = true;
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
      googleBtn.textContent = DEFAULT_GOOGLE_LABEL;
      googleBtn.disabled = !authReady;
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
    console.error('[firebase-bootstrap] quota refresh failed:', err?.code, err?.message, err);
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
      console.error('[firebase-bootstrap] ensureUserDocument failed:', err?.code, err?.message, err);
    }
  }

  await refreshHeaderQuota();
  window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user } }));
}

async function signInWithGoogleFlow(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!authReady || !auth) {
    showAuthError({
      message: 'Firebase 인증 모듈을 불러오는 중입니다.',
      hint: '잠시 후 다시 시도해 주세요.',
      code: 'auth/not-initialized',
    });
    return;
  }

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
    console.error('[firebase-bootstrap] Google login failed:', err?.code, err?.message, err);
    const formatted = err.authError || formatAuthError(err);
    showAuthError(formatted);
    if (formatted.code === 'auth/unauthorized-domain') {
      alert(`${formatted.message}\n\n${formatted.hint}`);
    }
  } finally {
    if (!AuthService.isLoggedIn()) setGoogleButtonLoading(false);
  }
}

async function signOutFlow(event) {
  if (event) event.preventDefault();
  if (!authReady || !auth) return;

  console.log('[firebase-bootstrap] signOutFlow');
  try {
    await AuthService.signOut();
    clearAuthError();
    await handleAuthChange(null);
  } catch (err) {
    console.error('[firebase-bootstrap] signOut failed:', err?.code, err?.message, err);
    showAuthError(formatAuthError(err));
  }
}

function bindAuthUi() {
  if (authUiBound) return;
  authUiBound = true;

  const googleBtn = $('auth-google-btn');
  const logoutBtn = $('auth-logout-btn');

  if (!googleBtn) {
    console.error('[firebase-bootstrap] #auth-google-btn not found');
    return;
  }

  googleBtn.disabled = true;
  googleBtn.addEventListener('click', signInWithGoogleFlow);
  console.log('[firebase-bootstrap] Google login handler attached');

  if (logoutBtn) {
    logoutBtn.addEventListener('click', signOutFlow);
  }
}

async function bootstrap() {
  console.log('[firebase-bootstrap] start', {
    configured: isFirebaseConfigured(),
    authReady: Boolean(auth),
    hostname: location.hostname,
  });

  bindAuthUi();
  renderAuthUi(null);

  try {
    await AuthService.init(handleAuthChange);
    setGoogleButtonEnabled(isFirebaseConfigured());
  } catch (err) {
    console.error('[firebase-bootstrap] AuthService.init failed:', err?.code, err?.message, err);
    showAuthError(formatAuthError(err));
    setGoogleButtonEnabled(false);
    throw err;
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
    console.error('[firebase-bootstrap] script error:', event.message, file, event.error);
    showAuthError({
      message: `Firebase 스크립트 오류: ${event.message}`,
      hint: 'F12 → Console 탭에서 자세한 오류를 확인해 주세요.',
      code: 'auth/script-error',
    });
  }
});

bootstrap()
  .then(() => {
    window.__firebaseBootstrapComplete?.resolve(true);
  })
  .catch((err) => {
    console.error('[firebase-bootstrap] fatal error:', err?.code, err?.message, err);
    window.__firebaseBootstrapComplete?.reject(err);
  });
