/**
 * Firebase 부트스트랩 — Auth UI + 앱 연동
 * authLoading → isLoggingIn → dataLoading 단계 분리, 병렬 동기화로 체감 속도 개선
 */
import { AuthService } from './services/auth-service.js';
import { FirestoreUserService } from './services/firestore-user-service.js';
import { FirestoreIngredientService } from './services/firestore-ingredient-service.js';
import { migrateLegacyPantryToFirestore, purgePantryLocalStorage } from './services/pantry-local-migration.js';
import { AnalysisQuotaService } from './services/analysis-quota-service.js';
import { formatAuthError } from './services/auth-errors.js';
import { createAuthGateController } from './services/auth-gate-controller.js';
import { auth, db, isFirebaseConfigured } from './firebase.js';

const USER_ERROR_MESSAGE = '로그인에 실패했어요. 잠시 후 다시 시도해 주세요.';
const DATA_LOAD_GATE_MS = 1800;
const PANTRY_SNAPSHOT_TIMEOUT_MS = 8000;

let authUiBound = false;
let authReady = false;
let initialAuthResolved = false;
let syncedUid = null;
let activeAuthTask = null;
let pendingAuthUid = undefined;

const gate = createAuthGateController({
  onUiSync: syncAuthGateUi,
  onStateChange: (state) => {
    window.__authGateState = state;
  },
});

function $(id) {
  return document.getElementById(id);
}

function setBodyMode(mode) {
  document.body.classList.toggle('body-auth', mode === 'auth');
  document.body.classList.toggle('body-app', mode === 'app');
}

function syncAuthGateUi(state, { phase, message, phaseChanged }) {
  const gateEl = $('auth-gate');
  const loadingEl = $('auth-gate-loading');
  const loginEl = $('auth-gate-login');
  const statusEl = $('auth-gate-status');
  const appOverlay = $('app-data-loading');

  if (gateEl) {
    gateEl.dataset.phase = phase;
    gateEl.toggleAttribute('data-auth-loading', state.authLoading);
    gateEl.toggleAttribute('data-logging-in', state.isLoggingIn);
    gateEl.toggleAttribute('data-data-loading', state.dataLoading);
    gateEl.toggleAttribute('data-logging-out', state.isLoggingOut);
  }

  const showLoadingPanel = state.authLoading || state.isLoggingIn || state.isLoggingOut
    || (state.dataLoading && !state.appReady);

  if (loadingEl) loadingEl.hidden = !showLoadingPanel;
  if (loginEl) loginEl.hidden = showLoadingPanel || Boolean(state.user);

  if (statusEl && message) statusEl.textContent = message;

  if (appOverlay) {
    appOverlay.hidden = !(state.appReady && state.dataLoading);
  }

  if (phaseChanged) {
    console.log('[auth-gate]', phase, message || 'idle');
  }

  syncGoogleButton(state);
}

function syncGoogleButton(state) {
  const btn = $('auth-google-btn');
  if (!btn) return;

  const label = btn.querySelector('.auth-gate__google-label');
  const spinner = btn.querySelector('.auth-gate__google-spinner');
  const buttonLoading = state.isLoggingIn;
  const disabled = buttonLoading || state.authLoading || !authReady || !isFirebaseConfigured();

  btn.classList.toggle('auth-gate__google-btn--loading', buttonLoading);
  btn.disabled = disabled;
  btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');

  if (label) label.textContent = buttonLoading ? '로그인 중입니다…' : 'Google로 계속하기';
  if (spinner) spinner.hidden = !buttonLoading;
}

function showAuthError(formatted) {
  const el = $('auth-error');
  if (!el) return;

  let message = USER_ERROR_MESSAGE;
  if (formatted?.code === 'auth/unauthorized-domain') {
    message = '허용되지 않은 도메인입니다. Firebase Console에서 도메인을 추가해 주세요.';
    el.classList.add('auth-gate__error--domain');
  } else if (formatted?.code === 'auth/config-not-set') {
    message = '앱 설정을 확인해 주세요.';
    el.classList.remove('auth-gate__error--domain');
  } else {
    el.classList.remove('auth-gate__error--domain');
  }

  el.hidden = false;
  el.textContent = message;
}

function clearAuthError() {
  const el = $('auth-error');
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
  el.classList.remove('auth-gate__error--domain');
}

function setGoogleButtonEnabled(enabled) {
  authReady = enabled;
  syncGoogleButton(gate.getState());
}

function revealAppShell() {
  const current = gate.getState();
  if (current.appReady) return;

  gate.patch({ appReady: true, dataLoading: false });

  const gateEl = $('auth-gate');
  const shell = $('app-shell');

  setBodyMode('app');
  gateEl?.classList.add('auth-gate--hide');

  window.setTimeout(() => {
    if (gateEl) {
      gateEl.hidden = true;
      gateEl.setAttribute('aria-hidden', 'true');
    }
    if (shell) {
      shell.hidden = false;
      requestAnimationFrame(() => shell.classList.add('app-shell--visible'));
    }
  }, 280);
}

function hideAppShell({ keepLoading = false } = {}) {
  syncedUid = null;

  const gateEl = $('auth-gate');
  const shell = $('app-shell');

  gate.patch({
    appReady: false,
    dataLoading: false,
    user: null,
    ...(keepLoading ? {} : { isLoggingOut: false }),
  });

  setBodyMode('auth');
  shell?.classList.remove('app-shell--visible');
  if (shell) shell.hidden = true;

  if (gateEl) {
    gateEl.hidden = false;
    gateEl.setAttribute('aria-hidden', 'false');
    gateEl.classList.remove('auth-gate--hide');
  }
}

function waitForPantrySnapshot(timeoutMs = PANTRY_SNAPSHOT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (items) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('pantry-firestore-sync', onSync);
      clearTimeout(timer);
      resolve(items);
    };
    const onSync = (event) => finish(Array.isArray(event.detail?.items) ? event.detail.items : []);
    window.addEventListener('pantry-firestore-sync', onSync);
    const timer = window.setTimeout(() => finish([]), timeoutMs);
  });
}

function renderAuthUi(user) {
  const userEl = $('auth-user');
  const nameEl = $('auth-user-name');
  const emailEl = $('auth-user-email');
  const remainingEl = $('auth-header-remaining');

  if (!userEl) {
    console.error('[firebase-bootstrap] auth UI elements not found in DOM');
    return;
  }

  if (!isFirebaseConfigured()) {
    userEl.hidden = true;
    showAuthError({ code: 'auth/config-not-set' });
    return;
  }

  if (user) {
    userEl.hidden = false;
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
    userEl.hidden = true;
  }
}

function refreshHeaderQuota() {
  const remainingEl = $('auth-header-remaining');
  if (!remainingEl) return Promise.resolve();

  return AnalysisQuotaService.fetchUsage()
    .then((usage) => {
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
    })
    .catch((err) => {
      console.error('[firebase-bootstrap] quota refresh failed:', err?.code, err?.message, err);
      remainingEl.textContent = '무료 분석 —';
    });
}

async function syncUserData(user) {
  const uid = user.uid;
  if (syncedUid === uid) return;

  FirestoreIngredientService.stopSync();
  syncedUid = uid;

  gate.patch({ dataLoading: true, user });

  // 1) Firestore 구독을 먼저 시작 — 첫 snapshot까지 대기
  FirestoreIngredientService.startSync(
    (items) => {
      window.dispatchEvent(new CustomEvent('pantry-firestore-sync', { detail: { items } }));
    },
    (err) => {
      console.error('[firebase-bootstrap] ingredients sync failed:', err?.code, err?.message, err);
    },
  );

  const snapshotPromise = waitForPantrySnapshot(PANTRY_SNAPSHOT_TIMEOUT_MS);
  const gateTimer = new Promise((resolve) => {
    window.setTimeout(resolve, DATA_LOAD_GATE_MS);
  });

  // 2) 사용자 문서·마이그레이션은 백그라운드 병렬 처리 (게이트 대기에 포함하지 않음)
  const backgroundTasks = Promise.allSettled([
    FirestoreUserService.ensureUserDocument(user),
    migrateLegacyPantryToFirestore(FirestoreIngredientService, uid),
  ]).then((results) => {
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const label = index === 0 ? 'ensureUserDocument' : 'pantry migration';
        console.error(`[firebase-bootstrap] ${label} failed:`, result.reason);
      }
    });
  });

  // 3) 첫 snapshot 또는 짧은 타임아웃 중 먼저 도달하면 앱 진입
  await Promise.race([snapshotPromise, gateTimer]);
  backgroundTasks.catch(() => undefined);
}

let logoutInProgress = false;

function clearPantryImmediately() {
  FirestoreIngredientService.stopSync();
  syncedUid = null;
  purgePantryLocalStorage();
  window.dispatchEvent(new CustomEvent('pantry-firestore-sync', { detail: { items: [] } }));
  window.dispatchEvent(new CustomEvent('pantry-logout-clear'));
  if (typeof window.clearPantryState === 'function') {
    window.clearPantryState();
  }
}

async function handleSignedInUser(user) {
  if (logoutInProgress) return;
  const uid = user.uid;
  renderAuthUi(user);
  gate.patch({ isLoggingIn: false, user });

  await syncUserData(user);

  if (gate.getState().isLoggingOut || !AuthService.isLoggedIn() || AuthService.getUid() !== uid) {
    console.log('[firebase-bootstrap] sign-in flow aborted (logged out during sync)');
    return;
  }

  revealAppShell();

  refreshHeaderQuota();
  window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user } }));
}

async function handleSignedOutUser() {
  logoutInProgress = false;
  clearPantryImmediately();
  renderAuthUi(null);
  hideAppShell();
  gate.resetForGuest();
  setGoogleButtonEnabled(authReady);

  console.log('LOGOUT_SUCCESS_AND_INGREDIENTS_CLEARED');
  window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user: null } }));
}

async function handleAuthChange(user) {
  const uid = user?.uid ?? null;

  if (uid === null) {
    activeAuthTask = null;
    pendingAuthUid = null;
  } else if (pendingAuthUid === uid && activeAuthTask) {
    return activeAuthTask;
  }

  pendingAuthUid = uid;
  activeAuthTask = (async () => {
    if (!initialAuthResolved) {
      initialAuthResolved = true;
      gate.patch({ authLoading: false });
    }

    console.log('[firebase-bootstrap] handleAuthChange:', user?.email || 'guest');

    if (user) {
      await handleSignedInUser(user);
    } else {
      await handleSignedOutUser();
    }
  })();

  try {
    await activeAuthTask;
  } finally {
    if (pendingAuthUid === uid) {
      activeAuthTask = null;
    }
    if (user) {
      gate.patch({ isLoggingIn: false, isLoggingOut: false });
    }
  }
}

async function signInWithGoogleFlow(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const state = gate.getState();
  if (state.isLoggingIn || state.authLoading || activeAuthTask) return;

  if (!authReady || !auth) {
    showAuthError({ code: 'auth/not-initialized' });
    return;
  }

  if (!isFirebaseConfigured()) {
    showAuthError({ code: 'auth/config-not-set' });
    return;
  }

  clearAuthError();
  gate.patch({ isLoggingIn: true });

  try {
    console.log('[firebase-bootstrap] signInWithGoogleFlow');
    await AuthService.signInWithGoogle();
    // onAuthStateChanged → handleAuthChange
  } catch (err) {
    console.error('[firebase-bootstrap] Google login failed:', err?.code, err?.message, err);
    gate.patch({ isLoggingIn: false });
    showAuthError(err.authError || formatAuthError(err));
  }
}

async function signOutFlow(event) {
  if (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  console.log('[firebase-bootstrap] signOutFlow');

  logoutInProgress = true;
  activeAuthTask = null;
  pendingAuthUid = null;

  clearPantryImmediately();
  hideAppShell();
  gate.resetForGuest();
  renderAuthUi(null);
  setBodyMode('auth');
  clearAuthError();

  try {
    if (auth && authReady) {
      await AuthService.signOut();
    }
    console.log('LOGOUT_SUCCESS');
    console.log('LOGOUT_SUCCESS_AND_INGREDIENTS_CLEARED');
    window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user: null } }));
  } catch (err) {
    console.error('LOGOUT_FAILED', err);
    showAuthError(formatAuthError(err));
  } finally {
    logoutInProgress = false;
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
    logoutBtn.addEventListener('click', signOutFlow, { capture: true });
  }

  window.__authSignOut = signOutFlow;
}

async function bootstrap() {
  console.log('[firebase-bootstrap] start', {
    configured: isFirebaseConfigured(),
    authReady: Boolean(auth),
    hostname: location.hostname,
  });

  setBodyMode('auth');
  bindAuthUi();
  gate.patch({ authLoading: true, isLoggingIn: false, dataLoading: false, isLoggingOut: false });

  try {
    await AuthService.init(handleAuthChange);
    setGoogleButtonEnabled(isFirebaseConfigured());

    if (!initialAuthResolved) {
      initialAuthResolved = true;
      gate.patch({ authLoading: false });
    }

    if (!AuthService.isLoggedIn() && !gate.getState().appReady) {
      gate.resetForGuest();
    }
  } catch (err) {
    console.error('[firebase-bootstrap] AuthService.init failed:', err?.code, err?.message, err);
    gate.patch({ authLoading: false, isLoggingIn: false, dataLoading: false });
    showAuthError(formatAuthError(err));
    setGoogleButtonEnabled(false);
    throw err;
  }

  window.FirebaseServices = {
    ready: true,
    auth,
    db,
    AuthService,
    FirestoreUserService,
    FirestoreIngredientService,
    AnalysisQuotaService,
    refreshHeaderQuota,
    isConfigured: isFirebaseConfigured(),
    getAuthGateState: () => gate.getState(),
  };

  window.dispatchEvent(new Event('firebase-ready'));
  console.log('[firebase-bootstrap] ready');
}

window.addEventListener('auth-error', (e) => {
  if (e.detail) {
    gate.patch({ isLoggingIn: false, authLoading: false });
    showAuthError(e.detail);
  }
});

window.addEventListener('error', (event) => {
  const file = event.filename || '';
  if (file.includes('firebase') || file.includes('auth')) {
    console.error('[firebase-bootstrap] script error:', event.message, file, event.error);
    showAuthError({ code: 'auth/script-error' });
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
