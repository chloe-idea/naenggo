/**
 * Firebase 부트스트랩 — Auth UI + 전역 서비스 노출
 */
import { AuthService } from './services/auth-service.js';
import { FirestoreUserService } from './services/firestore-user-service.js';
import { AnalysisQuotaService } from './services/analysis-quota-service.js';
import { isFirebaseConfigured } from './firebase.js';

function $(id) {
  return document.getElementById(id);
}

function renderAuthUi(user) {
  const guestEl = $('auth-guest');
  const userEl = $('auth-user');
  const guestHint = $('auth-guest-hint');
  const nameEl = $('auth-user-name');
  const remainingEl = $('auth-header-remaining');
  const googleBtn = $('auth-google-btn');

  if (!guestEl || !userEl) return;

  if (!isFirebaseConfigured()) {
    guestEl.hidden = false;
    userEl.hidden = true;
    if (guestHint) guestHint.hidden = false;
    if (googleBtn) {
      googleBtn.disabled = true;
      googleBtn.title = 'firebase-config.js 설정이 필요합니다';
    }
    return;
  }

  if (user) {
    guestEl.hidden = true;
    userEl.hidden = false;
    if (guestHint) guestHint.hidden = true;
    if (nameEl) nameEl.textContent = user.displayName || user.email || '로그인됨';
    if (remainingEl) remainingEl.textContent = '분석 횟수 확인 중…';
  } else {
    guestEl.hidden = false;
    userEl.hidden = true;
    if (guestHint) guestHint.hidden = false;
    if (googleBtn) googleBtn.disabled = false;
  }
}

async function refreshHeaderQuota() {
  const remainingEl = $('auth-header-remaining');
  if (!remainingEl) return;

  try {
    const usage = await AnalysisQuotaService.fetchUsage();
    if (!usage) return;
    if (usage.remaining > 0) {
      remainingEl.textContent = `무료 분석 ${usage.remaining}회`;
      remainingEl.classList.remove('auth-header__remaining--exhausted');
    } else {
      remainingEl.textContent = '무료 분석 소진';
      remainingEl.classList.add('auth-header__remaining--exhausted');
    }
    window.dispatchEvent(new CustomEvent('analysis-quota-updated', { detail: usage }));
  } catch (err) {
    console.warn('[firebase-bootstrap] quota refresh failed:', err);
  }
}

async function handleAuthChange(user) {
  renderAuthUi(user);
  if (user) {
    try {
      await FirestoreUserService.ensureUserDocument(user);
    } catch (err) {
      console.warn('[firebase-bootstrap] ensureUserDocument failed:', err);
    }
  }
  await refreshHeaderQuota();
  window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user } }));
}

function bindAuthEvents() {
  $('auth-google-btn')?.addEventListener('click', async () => {
    const btn = $('auth-google-btn');
    if (btn) btn.disabled = true;
    try {
      await AuthService.signInWithGoogle();
    } catch (err) {
      console.error('[AuthService] Google login failed:', err);
      alert(err?.message || 'Google 로그인에 실패했습니다.');
    } finally {
      if (btn && !AuthService.isLoggedIn()) btn.disabled = false;
    }
  });

  $('auth-logout-btn')?.addEventListener('click', async () => {
    try {
      await AuthService.signOut();
    } catch (err) {
      alert(err?.message || '로그아웃에 실패했습니다.');
    }
  });
}

async function bootstrap() {
  bindAuthEvents();
  AuthService.init(handleAuthChange);
  window.FirebaseServices = {
    ready: true,
    AuthService,
    FirestoreUserService,
    AnalysisQuotaService,
    refreshHeaderQuota,
    isConfigured: isFirebaseConfigured(),
  };
  window.dispatchEvent(new Event('firebase-ready'));
}

window.__firebaseBootstrapPromise = bootstrap();
