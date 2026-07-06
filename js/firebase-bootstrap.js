/**
 * Firebase 부트스트랩 — 게스트 우선 + 로그인 시 Firestore 동기화
 */
import { AuthService } from './services/auth-service.js';
import { FirestoreUserService, resolveProfileAvatar } from './services/firestore-user-service.js';
import { FirestoreIngredientService } from './services/firestore-ingredient-service.js';
import { migrateLegacyPantryToFirestore } from './services/pantry-local-migration.js';
import { AnalysisQuotaService } from './services/analysis-quota-service.js';
import { FirestoreUserDataSync } from './services/firestore-user-data-sync.js';
import { formatAuthError } from './services/auth-errors.js';
import { auth, db, isFirebaseConfigured } from './firebase.js';

const USER_ERROR_MESSAGE = '로그인에 실패했어요. 잠시 후 다시 시도해 주세요.';
const DATA_LOADING_FALLBACK_MS = 2000;

let authUiBound = false;
let authReady = false;
let initialAuthResolved = false;
let syncedUid = null;
let activeAuthTask = null;
let pendingAuthUid = undefined;
let logoutInProgress = false;
let dataLoadingFallbackTimer = null;
let cachedUserProfile = null;

const authState = {
  authLoading: true,
  isLoggingIn: false,
  dataLoading: false,
  isLoggingOut: false,
  user: null,
};

function $(id) {
  return document.getElementById(id);
}

function isIgnorableAuthNoise(message) {
  const msg = String(message || '');
  return /Cross-Origin-Opener-Policy|COOP|window\.closed|initial state/i.test(msg);
}

function resolveAuthUser() {
  if (authState.isLoggingOut) return null;
  return authState.user || AuthService.getCurrentUser?.() || auth?.currentUser || null;
}

function patchAuthState(partial) {
  Object.assign(authState, partial);
  syncAuthUi();
  updateProfileMenuSyncStatus();
  window.__authGateState = { ...authState };
  window.dispatchEvent(new CustomEvent('auth-gate-state', { detail: { ...authState } }));
}

function clearDataLoading(reason = 'unknown') {
  if (dataLoadingFallbackTimer) {
    clearTimeout(dataLoadingFallbackTimer);
    dataLoadingFallbackTimer = null;
  }
  if (!authState.dataLoading) return;
  console.log('[firebase-bootstrap] dataLoading cleared:', reason);
  patchAuthState({ dataLoading: false });
}

function startDataLoading(user) {
  if (!user?.uid || !AuthService.isLoggedIn()) return;
  patchAuthState({ dataLoading: true, user });
  if (dataLoadingFallbackTimer) clearTimeout(dataLoadingFallbackTimer);
  dataLoadingFallbackTimer = window.setTimeout(() => {
    clearDataLoading('2s fallback');
  }, DATA_LOADING_FALLBACK_MS);
}

function isModalBlockingSyncHint() {
  const recipeFormModal = document.getElementById('recipe-form-modal');
  const profileModal = document.getElementById('profile-menu-modal');
  if (recipeFormModal && !recipeFormModal.hidden) return true;
  if (profileModal && !profileModal.hidden) return true;
  return false;
}

function syncAuthUi() {
  const guestEl = $('auth-guest');
  const userEl = $('auth-user');

  const user = resolveAuthUser();
  const loggedIn = Boolean(user);

  if (!loggedIn && authState.dataLoading) {
    clearDataLoading('guest mode');
  }

  if (guestEl) {
    guestEl.hidden = loggedIn;
    guestEl.style.display = loggedIn ? 'none' : '';
  }
  if (userEl) {
    userEl.hidden = !loggedIn;
    userEl.style.display = loggedIn ? '' : 'none';
  }

  syncLoginButton();
  updateProfileMenuSyncStatus();
}

function syncLoginButton() {
  const btn = $('auth-login-btn');
  if (!btn) return;

  const label = btn.querySelector('.header-login-btn__label');
  const spinner = btn.querySelector('.header-login-btn__spinner');
  const buttonLoading = authState.isLoggingIn;
  const disabled = buttonLoading || authState.authLoading || !authReady || !isFirebaseConfigured();

  btn.classList.toggle('header-login-btn--loading', buttonLoading);
  btn.disabled = disabled;
  btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');

  if (label) label.textContent = buttonLoading ? '로그인 중…' : '로그인';
  if (spinner) spinner.hidden = !buttonLoading;
}

function showAuthError(formatted) {
  const el = $('auth-error');
  if (!el) return;

  let message = USER_ERROR_MESSAGE;
  if (formatted?.code === 'auth/unauthorized-domain') {
    message = '허용되지 않은 도메인입니다. Firebase Console에서 도메인을 추가해 주세요.';
    el.classList.add('auth-bar__error--domain');
  } else if (formatted?.code === 'auth/config-not-set') {
    message = '앱 설정을 확인해 주세요.';
    el.classList.remove('auth-bar__error--domain');
  } else if (formatted?.code === 'auth/popup-blocked') {
    message = '브라우저가 로그인 팝업을 차단했습니다. 팝업을 허용한 뒤 다시 시도해 주세요.';
    el.classList.remove('auth-bar__error--domain');
  } else if (formatted?.code === 'auth/popup-closed-by-user' || formatted?.code === 'auth/cancelled-popup-request') {
    message = 'Google 로그인 창이 닫혔습니다. 다시 시도해 주세요.';
    el.classList.remove('auth-bar__error--domain');
  } else if (formatted?.message) {
    message = formatted.message;
    el.classList.remove('auth-bar__error--domain');
  } else {
    el.classList.remove('auth-bar__error--domain');
  }

  el.hidden = false;
  el.textContent = message;
  if (typeof window.syncLoginPromptError === 'function') {
    window.syncLoginPromptError(message);
  }
}

function clearAuthError() {
  const el = $('auth-error');
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
  el.classList.remove('auth-bar__error--domain');
}

function setGoogleButtonEnabled(enabled) {
  authReady = enabled;
  syncLoginButton();
}

function applyAvatarToElements(avatar, imgEl, emojiEl, initialEl) {
  if (!initialEl) return;

  if (imgEl) {
    if (avatar.mode === 'image' && avatar.src) {
      imgEl.src = avatar.src;
      imgEl.alt = `${avatar.displayName} 프로필`;
      imgEl.hidden = false;
    } else {
      imgEl.removeAttribute('src');
      imgEl.hidden = true;
    }
  }

  if (emojiEl) {
    if (avatar.mode === 'emoji') {
      emojiEl.textContent = avatar.emoji || '🧊';
      emojiEl.hidden = false;
    } else {
      emojiEl.hidden = true;
    }
  }

  initialEl.textContent = avatar.initial || '냉';
  initialEl.hidden = avatar.mode !== 'initial';
}

function renderProfileAvatar(authUser, profile = null) {
  const avatar = resolveProfileAvatar(profile, authUser);
  applyAvatarToElements(
    avatar,
    $('profile-avatar-img'),
    $('profile-avatar-emoji'),
    $('profile-avatar-initial'),
  );
  applyAvatarToElements(
    avatar,
    $('profile-menu-avatar-img'),
    $('profile-menu-avatar-emoji'),
    $('profile-menu-avatar-initial'),
  );
  return avatar;
}

function updateProfileMenuSyncStatus() {
  const syncEl = $('profile-menu-sync');
  if (!syncEl) return;

  const user = resolveAuthUser();
  if (!user) {
    syncEl.hidden = true;
    return;
  }

  syncEl.hidden = false;
  if (authState.dataLoading) {
    syncEl.textContent = '재료 동기화 중…';
    syncEl.classList.add('profile-menu__sync--loading');
  } else {
    syncEl.textContent = '데이터 동기화 완료';
    syncEl.classList.remove('profile-menu__sync--loading');
  }
}

function updateProfileMenuContent(authUser, profile = null) {
  const resolvedProfile = profile || cachedUserProfile;
  const avatar = renderProfileAvatar(authUser, resolvedProfile);
  const titleEl = $('profile-menu-title');
  const emailEl = $('profile-menu-email');
  const nameInput = $('profile-display-name');
  const picker = $('profile-avatar-picker');

  if (titleEl) titleEl.textContent = avatar.displayName || '프로필';
  if (emailEl) emailEl.textContent = authUser?.email || '—';
  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = resolvedProfile?.displayName || avatar.displayName || '';
  }

  if (picker) {
    const activeType = resolvedProfile?.avatarType || avatar.avatarType || 'fridge';
    picker.querySelectorAll('[data-avatar-type]').forEach((btn) => {
      btn.classList.toggle('profile-avatar-picker__btn--active', btn.dataset.avatarType === activeType);
      if (btn.dataset.avatarType === 'google') {
        btn.disabled = !authUser?.photoURL;
      }
    });
  }

  updateProfileMenuSyncStatus();
}

async function loadUserProfile(authUser) {
  if (!authUser?.uid) {
    cachedUserProfile = null;
    return null;
  }
  try {
    cachedUserProfile = await FirestoreUserService.getUserDocument(authUser.uid);
    if (!cachedUserProfile) {
      cachedUserProfile = await FirestoreUserService.ensureUserDocument(authUser);
    }
  } catch (err) {
    console.error('[firebase-bootstrap] loadUserProfile failed:', err);
    cachedUserProfile = null;
  }
  updateProfileMenuContent(authUser, cachedUserProfile);
  return cachedUserProfile;
}

function renderAuthUi(user) {
  const resolvedUser = user ?? resolveAuthUser();
  const userEl = $('auth-user');

  if (!userEl) {
    console.error('[firebase-bootstrap] auth UI elements not found in DOM');
    return;
  }

  if (!isFirebaseConfigured()) {
    userEl.hidden = true;
    showAuthError({ code: 'auth/config-not-set' });
    return;
  }

  if (resolvedUser) {
    userEl.hidden = false;
    clearAuthError();
    renderProfileAvatar(resolvedUser, cachedUserProfile);
  } else {
    userEl.hidden = true;
    cachedUserProfile = null;
  }

  syncAuthUi();
}

function refreshProfileQuota() {
  const quotaEl = $('profile-menu-quota');
  if (!quotaEl) return Promise.resolve();

  return AnalysisQuotaService.fetchUsage()
    .then((usage) => {
      if (!usage) {
        quotaEl.textContent = '무료 분석 —';
        quotaEl.classList.remove('profile-menu__quota--exhausted');
        return;
      }
      if (usage.remaining > 0) {
        quotaEl.textContent = `이번 주 남은 무료 분석 ${usage.remaining}회`;
        quotaEl.classList.remove('profile-menu__quota--exhausted');
      } else {
        quotaEl.textContent = '무료 분석 소진';
        quotaEl.classList.add('profile-menu__quota--exhausted');
      }
      window.dispatchEvent(new CustomEvent('analysis-quota-updated', { detail: usage }));
    })
    .catch((err) => {
      console.error('[firebase-bootstrap] quota refresh failed:', err?.code, err?.message, err);
      quotaEl.textContent = '무료 분석 —';
    });
}

function refreshHeaderQuota() {
  return refreshProfileQuota();
}

function openProfileMenu() {
  const modal = $('profile-menu-modal');
  const btn = $('profile-menu-btn');
  if (!modal || !resolveAuthUser()) return;

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  if (btn) btn.setAttribute('aria-expanded', 'true');

  updateProfileMenuContent(resolveAuthUser(), cachedUserProfile);
  refreshProfileQuota();
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}

function closeProfileMenu() {
  const modal = $('profile-menu-modal');
  const btn = $('profile-menu-btn');
  if (!modal) return;

  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  if (btn) btn.setAttribute('aria-expanded', 'false');

  const anyModalOpen = ['recipe-form-modal', 'meal-modal', 'shopping-modal', 'pantry-modal', 'recipe-modal']
    .some((id) => {
      const el = document.getElementById(id);
      return el && !el.hidden;
    });
  if (!anyModalOpen) document.body.style.overflow = '';
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}

async function saveProfileDisplayName() {
  const user = resolveAuthUser();
  const input = $('profile-display-name');
  if (!user?.uid || !input) return;

  const displayName = input.value.trim().slice(0, 20);
  if (!displayName) return;

  try {
    cachedUserProfile = await FirestoreUserService.updateProfile(user.uid, { displayName });
    renderAuthUi(user);
    updateProfileMenuContent(user, cachedUserProfile);
  } catch (err) {
    console.error('[firebase-bootstrap] save displayName failed:', err);
    showAuthError({ message: '닉네임 저장에 실패했어요.' });
  }
}

async function saveProfileAvatarType(avatarType) {
  const user = resolveAuthUser();
  if (!user?.uid || !avatarType) return;

  try {
    cachedUserProfile = await FirestoreUserService.updateProfile(user.uid, { avatarType });
    renderAuthUi(user);
    updateProfileMenuContent(user, cachedUserProfile);
  } catch (err) {
    console.error('[firebase-bootstrap] save avatarType failed:', err);
    showAuthError({ message: '프로필 이미지 변경에 실패했어요.' });
  }
}

async function syncUserData(user) {
  const uid = user.uid;
  if (!AuthService.isLoggedIn()) {
    clearDataLoading('not logged in');
    return;
  }
  if (syncedUid === uid && !authState.dataLoading) return;

  FirestoreUserDataSync.stopAll();
  syncedUid = uid;
  startDataLoading(user);

  if (typeof window.clearAllUserDataState === 'function') {
    window.clearAllUserDataState();
  }

  try {
    let firstSnapshotDone = false;
    const finishFirstSnapshot = (reason) => {
      if (firstSnapshotDone) return;
      firstSnapshotDone = true;
      clearDataLoading(reason);
    };

    let pending = 6;
    const markSnapshot = () => {
      pending -= 1;
      if (pending <= 0) finishFirstSnapshot('all user snapshots');
    };

    FirestoreUserDataSync.startUserSync({
      onIngredients: (items) => {
        window.dispatchEvent(new CustomEvent('pantry-firestore-sync', { detail: { items } }));
        markSnapshot();
      },
      onMyRecipes: (recipes) => {
        window.dispatchEvent(new CustomEvent('my-recipes-firestore-sync', { detail: { recipes } }));
        markSnapshot();
      },
      onMealCalendar: (logs) => {
        window.dispatchEvent(new CustomEvent('meal-calendar-firestore-sync', { detail: { logs } }));
        markSnapshot();
      },
      onMealPlans: (plans) => {
        window.dispatchEvent(new CustomEvent('meal-plans-firestore-sync', { detail: { plans } }));
        markSnapshot();
      },
      onShopping: (records) => {
        window.dispatchEvent(new CustomEvent('shopping-firestore-sync', { detail: { records } }));
        markSnapshot();
      },
      onSettings: (settings) => {
        window.dispatchEvent(new CustomEvent('settings-firestore-sync', { detail: { settings } }));
        markSnapshot();
      },
      onError: (err) => {
        console.error('[firebase-bootstrap] user data sync failed:', err?.code, err?.message, err);
        markSnapshot();
      },
    });

    Promise.allSettled([
      FirestoreUserService.ensureUserDocument(user).then((doc) => {
        if (doc) cachedUserProfile = doc;
      }),
      migrateLegacyPantryToFirestore(FirestoreIngredientService, uid),
    ]).then((results) => {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const label = index === 0 ? 'ensureUserDocument' : 'pantry migration';
          console.error(`[firebase-bootstrap] ${label} failed:`, result.reason);
        }
      });
    }).catch(() => undefined);
  } catch (err) {
    console.error('[firebase-bootstrap] syncUserData failed:', err);
    clearDataLoading('sync error');
  }
}

function startPublicRecipesSync() {
  FirestoreUserDataSync.startPublicSync(
    (recipes) => {
      window.dispatchEvent(new CustomEvent('public-recipes-firestore-sync', { detail: { recipes } }));
    },
    (err) => {
      console.error('[firebase-bootstrap] public recipes sync failed:', err?.code, err?.message, err);
    },
  );
}

async function handleSignedInUser(user) {
  if (logoutInProgress) return;
  const uid = user.uid;
  patchAuthState({ isLoggingIn: false, authLoading: false, user });
  renderAuthUi(user);

  window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user } }));

  await syncUserData(user);

  if (authState.isLoggingOut || !AuthService.isLoggedIn() || AuthService.getUid() !== uid) {
    console.log('[firebase-bootstrap] sign-in flow aborted (logged out during sync)');
    return;
  }

  await loadUserProfile(user);
  refreshProfileQuota();
}

async function handleSignedOutUser() {
  logoutInProgress = false;
  FirestoreUserDataSync.stopAll();
  syncedUid = null;
  cachedUserProfile = null;
  clearDataLoading('signed out');
  closeProfileMenu();

  if (typeof window.clearUserData === 'function') {
    window.clearUserData();
  } else if (typeof window.switchToGuestPantry === 'function') {
    window.switchToGuestPantry();
  }

  renderAuthUi(null);
  patchAuthState({
    authLoading: false,
    isLoggingIn: false,
    isLoggingOut: false,
    user: null,
  });
  setGoogleButtonEnabled(authReady);

  console.log('LOGOUT_SUCCESS_GUEST_MODE');
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
      patchAuthState({ authLoading: false });
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
      patchAuthState({ isLoggingIn: false, isLoggingOut: false });
    }
  }
}

async function signInWithGoogleFlow(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (authState.isLoggingIn || authState.authLoading || activeAuthTask) return;

  if (!authReady || !auth) {
    showAuthError({ code: 'auth/not-initialized' });
    return;
  }

  if (!isFirebaseConfigured()) {
    showAuthError({ code: 'auth/config-not-set' });
    return;
  }

  clearAuthError();
  patchAuthState({ isLoggingIn: true });

  try {
    console.log('[firebase-bootstrap] signInWithGoogleFlow');
    const user = await AuthService.signInWithGoogle();
    if (user) {
      patchAuthState({ isLoggingIn: false, authLoading: false, user });
      renderAuthUi(user);
      console.log('POPUP_LOGIN_SUCCESS', user.uid);
    }
  } catch (err) {
    console.error('[firebase-bootstrap] Google login failed:', err?.code, err?.message, err);
    patchAuthState({ isLoggingIn: false });
    if (err?.authError) {
      showAuthError(err.authError);
    } else {
      showAuthError(formatAuthError(err));
    }
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

  patchAuthState({ isLoggingOut: true, user: null });
  clearAuthError();

  try {
    FirestoreUserDataSync.stopAll();

    if (auth && authReady) {
      await AuthService.signOut();
    }

    if (typeof window.clearUserData === 'function') {
      window.clearUserData();
    }

    console.log('LOGOUT_SUCCESS');
  } catch (err) {
    console.error('LOGOUT_FAILED', err);
    showAuthError(formatAuthError(err));
    patchAuthState({ isLoggingOut: false });
  } finally {
    logoutInProgress = false;
  }
}

function bindAuthUi() {
  if (authUiBound) return;
  authUiBound = true;

  const loginBtn = $('auth-login-btn');
  const profileBtn = $('profile-menu-btn');
  const logoutBtn = $('profile-logout-btn');
  const saveNameBtn = $('profile-save-name-btn');
  const avatarPicker = $('profile-avatar-picker');
  const profileModal = $('profile-menu-modal');

  if (!loginBtn) {
    console.error('[firebase-bootstrap] #auth-login-btn not found');
    return;
  }

  loginBtn.disabled = true;
  loginBtn.addEventListener('click', (event) => {
    event.preventDefault();
    if (typeof window.openLoginPrompt === 'function') {
      window.openLoginPrompt();
      return;
    }
    signInWithGoogleFlow(event);
  });
  console.log('[firebase-bootstrap] login handler attached');

  profileBtn?.addEventListener('click', () => openProfileMenu());
  logoutBtn?.addEventListener('click', (event) => {
    closeProfileMenu();
    signOutFlow(event);
  }, { capture: true });
  saveNameBtn?.addEventListener('click', saveProfileDisplayName);
  avatarPicker?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-avatar-type]');
    if (!btn || btn.disabled) return;
    saveProfileAvatarType(btn.dataset.avatarType);
  });

  profileModal?.querySelectorAll('[data-close-modal="profile"]').forEach((el) => {
    el.addEventListener('click', closeProfileMenu);
  });

  window.__authSignOut = signOutFlow;
  window.__authSignInGoogle = signInWithGoogleFlow;
}

async function bootstrap() {
  console.log('[firebase-bootstrap] start', {
    configured: isFirebaseConfigured(),
    authReady: Boolean(auth),
    hostname: location.hostname,
  });

  document.body.classList.add('body-app');
  bindAuthUi();
  syncAuthUi();
  patchAuthState({ authLoading: true, isLoggingIn: false, dataLoading: false, isLoggingOut: false });

  try {
    await AuthService.init(handleAuthChange);
    setGoogleButtonEnabled(isFirebaseConfigured());

    if (!initialAuthResolved) {
      initialAuthResolved = true;
      patchAuthState({ authLoading: false });
    }
  } catch (err) {
    console.error('[firebase-bootstrap] AuthService.init failed:', err?.code, err?.message, err);
    patchAuthState({ authLoading: false, isLoggingIn: false, dataLoading: false });
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
    FirestoreUserDataSync,
    AnalysisQuotaService,
    refreshHeaderQuota,
    isConfigured: isFirebaseConfigured(),
    getAuthGateState: () => ({ ...authState }),
  };

  if (isFirebaseConfigured()) {
    startPublicRecipesSync();
  }

  window.dispatchEvent(new Event('firebase-ready'));
  console.log('[firebase-bootstrap] ready');
}

window.addEventListener('auth-error', (e) => {
  if (e.detail && !isIgnorableAuthNoise(e.detail?.message)) {
    patchAuthState({ isLoggingIn: false, authLoading: false });
    showAuthError(e.detail);
  }
});

window.addEventListener('ui-modal-change', () => {
  syncAuthUi();
});

window.addEventListener('error', (event) => {
  if (isIgnorableAuthNoise(event.message)) return;
  const file = event.filename || '';
  if (file.includes('firebase') || file.includes('auth')) {
    console.error('[firebase-bootstrap] script error:', event.message, file, event.error);
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
