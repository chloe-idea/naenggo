/**
 * Firebase 부트스트랩 — 게스트 우선 + 로그인 시 Firestore 동기화
 */
import { AuthService } from './services/auth-service.js';
import { FirestoreUserService, resolveProfileAvatar } from './services/firestore-user-service.js';
import { FirestoreIngredientService } from './services/firestore-ingredient-service.js';
import { migrateLegacyPantryToFirestore } from './services/pantry-local-migration.js';
import { AnalysisQuotaService } from './services/analysis-quota-service.js';
import { AdminService } from './services/admin-service.js';
import { FirestoreBuiltinRecipesService } from './services/firestore-builtin-recipes-service.js';
import { FirestoreUserDataSync } from './services/firestore-user-data-sync.js';
import { FirestorePublicProfilesService } from './services/firestore-public-profiles-service.js';
import { FirestorePublicRecipesService } from './services/firestore-public-recipes-service.js';
import { FamilySharingService } from './services/family-sharing-service.js';
import { normalizeSocialLinks } from './lib/social-url.js';
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
let authBootstrapSafetyTimer = null;
let pendingFamilyLinkInvite = new URLSearchParams(location.search).get('familyInvite')
  || sessionStorage.getItem('pending-family-link-invite');
let familyLinkJoinInFlight = false;

function clearPendingFamilyInviteCache() {
  pendingFamilyLinkInvite = null;
  try {
    sessionStorage.removeItem('pending-family-link-invite');
  } catch {
    // Storage access can be unavailable in private browser contexts.
  }
}

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
  const bioInput = $('profile-bio');
  const picker = $('profile-avatar-picker');
  const errorEl = $('profile-menu-error');
  const social = resolvedProfile?.socialLinks || {};

  if (titleEl) titleEl.textContent = avatar.displayName || '프로필';
  if (emailEl) emailEl.textContent = authUser?.email || '—';
  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = resolvedProfile?.displayName || avatar.displayName || '';
  }
  if (bioInput && document.activeElement !== bioInput) {
    bioInput.value = resolvedProfile?.bio || '';
  }

  const socialFields = [
    ['profile-social-youtube', social.youtube],
    ['profile-social-instagram', social.instagram],
    ['profile-social-tiktok', social.tiktok],
    ['profile-social-website', social.website],
  ];
  socialFields.forEach(([id, value]) => {
    const input = $(id);
    if (input && document.activeElement !== input) input.value = value || '';
  });

  if (errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = '';
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
    } else {
      const publicProfile = await FirestorePublicProfilesService.getById(authUser.uid);
      if (!publicProfile) {
        const avatarType = cachedUserProfile.avatarType;
        const profileImageUrl = avatarType === 'google' && authUser.photoURL
          ? authUser.photoURL
          : String(cachedUserProfile.profileImageUrl || cachedUserProfile.profileImage || '').trim();
        await FirestorePublicProfilesService.syncFromUserProfile(authUser.uid, {
          ...cachedUserProfile,
          profileImageUrl,
        });
      }
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
      if (usage.unlimited || AdminService.isAdmin()) {
        quotaEl.textContent = '관리자 계정 · 분석 무제한';
        quotaEl.classList.remove('profile-menu__quota--exhausted');
        window.dispatchEvent(new CustomEvent('analysis-quota-updated', { detail: usage }));
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
  if (typeof window.updateBodyScrollLock === 'function') window.updateBodyScrollLock();
  else document.body.style.overflow = 'hidden';
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

  if (typeof window.updateBodyScrollLock === 'function') window.updateBodyScrollLock();
  else {
    const anyModalOpen = ['recipe-form-modal', 'meal-modal', 'shopping-modal', 'pantry-modal']
      .some((id) => {
        const el = document.getElementById(id);
        return el && !el.hidden;
      });
    if (!anyModalOpen) document.body.style.overflow = '';
  }
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}

async function saveProfileViaServer(updates) {
  const idToken = await AuthService.getIdToken();
  if (!idToken) return null;
  const res = await fetch('/api/user-profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(updates),
  });
  const contentType = String(res.headers.get('content-type') || '');
  const data = contentType.includes('application/json')
    ? await res.json().catch(() => ({}))
    : {};
  if (!res.ok || !data?.ok) {
    const err = new Error(data?.error || '프로필 저장에 실패했어요.');
    err.code = 'SERVER_PROFILE_SAVE_FAILED';
    err.status = res.status;
    err.serverUnavailable = res.status === 401
      || res.status === 404
      || res.status === 503
      || res.status >= 500
      || !contentType.includes('application/json');
    throw err;
  }
  return data.profile || null;
}

function showProfileMenuError(message) {
  const errorEl = $('profile-menu-error');
  if (!errorEl) return;
  errorEl.textContent = message || '';
  errorEl.hidden = !message;
}

async function saveProfileDisplayName() {
  return saveFullProfile();
}

async function saveFullProfile() {
  const user = resolveAuthUser();
  const nameInput = $('profile-display-name');
  const bioInput = $('profile-bio');
  const saveBtn = $('profile-save-btn');
  if (!user?.uid || !nameInput) return;

  const displayName = nameInput.value.trim().slice(0, 20);
  if (!displayName) {
    showProfileMenuError('닉네임을 입력해 주세요.');
    nameInput.focus();
    return;
  }

  const socialLinks = {
    youtube: $('profile-social-youtube')?.value || '',
    instagram: $('profile-social-instagram')?.value || '',
    tiktok: $('profile-social-tiktok')?.value || '',
    website: $('profile-social-website')?.value || '',
  };
  const linksResult = normalizeSocialLinks(socialLinks);
  if (!linksResult.ok) {
    showProfileMenuError(linksResult.error);
    return;
  }

  const updates = {
    displayName,
    bio: (bioInput?.value || '').trim().slice(0, 80),
    socialLinks: linksResult.socialLinks,
    avatarType: cachedUserProfile?.avatarType,
  };

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중…';
  }
  showProfileMenuError('');

  try {
    let savedViaServer = false;
    try {
      const serverProfile = await saveProfileViaServer(updates);
      if (serverProfile) {
        cachedUserProfile = {
          ...(cachedUserProfile || {}),
          ...serverProfile,
          socialLinks: serverProfile.socialLinks || linksResult.socialLinks,
        };
        FirestorePublicProfilesService.clearCache(user.uid);
        savedViaServer = true;
      }
    } catch (serverErr) {
      const msg = String(serverErr?.message || '');
      const isValidation = serverErr?.status === 400
        || /YouTube|Instagram|TikTok|https|링크|URL|허용되지/i.test(msg);
      // 서버 미기동/구버전(404)·Admin 미설정(503) 등은 Firestore 직접 저장으로 폴백
      const shouldFallback = serverErr?.serverUnavailable
        || serverErr?.code === 'INVALID_ID_TOKEN'
        || serverErr?.name === 'TypeError'
        || /서버 프로필|Firebase Admin|not configured|Failed to fetch|NetworkError|로그인 정보/i.test(msg);
      if (isValidation && !shouldFallback) throw serverErr;
      if (!shouldFallback && serverErr?.code === 'SERVER_PROFILE_SAVE_FAILED' && serverErr?.status === 400) {
        throw serverErr;
      }
      console.warn('[firebase-bootstrap] server profile save unavailable, using client write:', {
        status: serverErr?.status,
        message: msg,
      });
    }

    if (!savedViaServer) {
      cachedUserProfile = await FirestoreUserService.updateProfile(user.uid, updates, {
        photoURL: user.photoURL || '',
      });
    }

    renderAuthUi(user);
    updateProfileMenuContent(user, cachedUserProfile);
    window.dispatchEvent(new CustomEvent('public-profile-updated', { detail: { uid: user.uid } }));
    if (typeof window.showToast === 'function') window.showToast('프로필을 저장했어요');
  } catch (err) {
    console.error('[firebase-bootstrap] save profile failed:', err);
    showProfileMenuError(err?.message || '프로필 저장에 실패했어요.');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = '프로필 저장';
    }
  }
}

async function saveProfileAvatarType(avatarType) {
  const user = resolveAuthUser();
  if (!user?.uid || !avatarType) return;

  try {
    cachedUserProfile = await FirestoreUserService.updateProfile(
      user.uid,
      { avatarType },
      { photoURL: user.photoURL || '' },
    );
    renderAuthUi(user);
    updateProfileMenuContent(user, cachedUserProfile);
    window.dispatchEvent(new CustomEvent('public-profile-updated', { detail: { uid: user.uid } }));
  } catch (err) {
    console.error('[firebase-bootstrap] save avatarType failed:', err);
    showAuthError({ message: '프로필 이미지 변경에 실패했어요.' });
  }
}

async function syncUserData(user, { force = false } = {}) {
  const uid = user.uid;
  if (!AuthService.isLoggedIn()) {
    clearDataLoading('not logged in');
    return;
  }
  if (!force && syncedUid === uid && !authState.dataLoading) return;

  FirestoreUserDataSync.stopAll();
  syncedUid = uid;
  startDataLoading(user);

  if (typeof window.clearAllUserDataState === 'function') {
    window.clearAllUserDataState();
  }

  try {
    await FamilySharingService.refresh();
    if (pendingFamilyLinkInvite && !FamilySharingService.isActive() && !familyLinkJoinInFlight) {
      familyLinkJoinInFlight = true;
      try {
        await FamilySharingService.join({ kind: 'link', secret: pendingFamilyLinkInvite });
        pendingFamilyMigration = true;
        sessionStorage.removeItem('pending-family-link-invite');
        pendingFamilyLinkInvite = null;
      } finally {
        familyLinkJoinInFlight = false;
      }
    }
    const householdId = FamilySharingService.getActiveHouseholdId();
    // 로컬 냉장고 이관은 개인 scope에서 끝낸 뒤에만 가족 복사를 허용한다.
    // 가족 활성 상태에서 실행하면 개인 로컬 데이터를 공유 household에 섞을 수 있다.
    if (!householdId) {
      const legacyResult = await migrateLegacyPantryToFirestore(FirestoreIngredientService, uid);
      if (legacyResult.migrated) {
        console.info('[FamilySharing] personal pantry migration completed before household setup', legacyResult);
      }
    }
    const scopeRoot = householdId ? `households/${householdId}` : `users/${uid}`;
    console.info('[FamilySharing] Firestore data scope', {
      mode: householdId ? 'family' : 'personal',
      ingredients: `${scopeRoot}/ingredients`,
      shopping: `${scopeRoot}/shopping`,
      groceryAndBudget: householdId
        ? `${scopeRoot}/grocery/preferences`
        : `${scopeRoot}/settings/preferences`,
      mealPlans: `${scopeRoot}/mealPlans/default`,
      mealCalendar: `${scopeRoot}/mealCalendar`,
      savedRecipes: householdId
        ? `${scopeRoot}/savedRecipes`
        : `${scopeRoot}/settings/preferences.savedRecipeIds`,
      extractedRecipes: householdId ? `${scopeRoot}/extractedRecipes` : '(not shared)',
      myRecipes: `users/${uid}/myRecipes`,
      statistics: householdId ? 'derived from shared mealCalendar + shopping + grocery' : 'derived from personal mealCalendar + shopping + settings',
    });
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
      householdId,
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

    FirestoreUserService.ensureUserDocument(user).then((doc) => {
      if (doc) cachedUserProfile = doc;
    }).catch((error) => {
      console.error('[firebase-bootstrap] ensureUserDocument failed:', error);
    });
  } catch (err) {
    console.error('[firebase-bootstrap] syncUserData failed:', err);
    clearDataLoading('sync error');
  }
}

function startBuiltinRecipesSync() {
  FirestoreBuiltinRecipesService.startSync(
    ({ recipes, tombstones }) => {
      window.dispatchEvent(new CustomEvent('builtin-recipes-firestore-sync', {
        detail: { recipes, tombstones },
      }));
    },
    (err) => {
      console.error('[firebase-bootstrap] builtin recipes sync failed:', err?.code, err?.message, err);
    },
  );
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

  AdminService.startSync(uid);
  window.dispatchEvent(new CustomEvent('admin-status-changed', {
    detail: AdminService.getState(),
  }));

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
  AdminService.stopSync();
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
      window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user } }));
      console.log('POPUP_LOGIN_SUCCESS', user.uid);
    } else {
      // redirect 로그인 경로(iOS)에서는 페이지 이동 전까지 로딩 상태를 해제
      patchAuthState({ isLoggingIn: false });
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

let pendingFamilyMigration = false;
let familyInviteRequestInFlight = false;
let familyMigrationInFlight = false;
let familyWizardStep = 'start';
let familyWizardNotice = '';

function setFamilyError(message = '') {
  const el = $('family-sharing-error');
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
}

function toggleFamilyPanel(id, visible) {
  const el = $(id);
  if (el) el.hidden = !visible;
}

function setFamilyWizardStep(step) {
  familyWizardStep = step;
  setFamilyError('');
  renderFamilySharing();
}

function setFamilyWizardNotice(message = '') {
  familyWizardNotice = message;
  const notice = $('family-sharing-notice');
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = !message;
}

function renderFamilySharing() {
  const family = FamilySharingService.getActiveFamily();
  const hasFamily = Boolean(family);
  const setupPending = Boolean(family?.pendingSetup);
  if (setupPending || family?.needsMigrationChoice) pendingFamilyMigration = true;
  const isCreateChoice = !hasFamily && familyWizardStep === 'create-choice';
  const setupStep = isCreateChoice || (hasFamily && pendingFamilyMigration);
  if (hasFamily && !setupStep && familyWizardStep !== 'invite') familyWizardStep = 'manage';
  if (!hasFamily && !['join', 'create-choice'].includes(familyWizardStep)) familyWizardStep = 'start';

  toggleFamilyPanel('family-sharing-empty', !hasFamily && familyWizardStep === 'start');
  toggleFamilyPanel('family-join-panel', !hasFamily && familyWizardStep === 'join');
  toggleFamilyPanel('family-migration-panel', setupStep);
  toggleFamilyPanel('family-sharing-active', hasFamily && !setupStep);
  toggleFamilyPanel('family-invite-panel', hasFamily && !setupStep && familyWizardStep === 'invite');
  setFamilyWizardNotice(hasFamily && !setupStep ? familyWizardNotice : '');
  const isJoining = hasFamily && family?.role === 'member' && setupPending;
  if (setupStep) {
    $('family-migration-title').textContent = isJoining
      ? '가족에 참여했습니다. 현재 사용 중인 개인 냉장고 데이터를 가족 냉장고에 추가하시겠습니까?'
      : '현재 냉장고 데이터를 새로운 가족 냉장고로 가져올까요?';
    $('family-migration-description').textContent = isJoining
      ? '기존 가족 데이터는 변경하지 않으며, 개인 원본 데이터도 그대로 유지됩니다.'
      : '기존 개인 데이터는 삭제하지 않으며, 복사가 끝난 뒤에 가족 공유 모드로 전환됩니다.';
    $('family-copy-data-btn').textContent = familyMigrationInFlight
      ? (isJoining ? '내 데이터를 병합하는 중…' : '기존 데이터를 가져오는 중…')
      : (isJoining ? '내 데이터 가져오기' : '✓ 현재 데이터를 가져오기 (권장)');
    $('family-empty-data-btn').textContent = familyMigrationInFlight
      ? '가족 공유를 시작하는 중…'
      : (isJoining ? '건너뛰기' : '빈 가족 냉장고로 시작');
    $('family-migration-back-btn').hidden = hasFamily;
  }
  if (!hasFamily) {
    $('family-sharing-status').textContent = familyWizardStep === 'join'
      ? '초대 코드로 가족에 참여하기'
      : (isCreateChoice ? '2단계 · 가족 냉장고 준비' : '1단계 · 가족 공유 시작하기');
    return;
  }
  if (setupStep) {
    $('family-sharing-status').textContent = familyMigrationInFlight
      ? '가족 냉장고를 준비하고 있어요.'
      : '2단계 · 가족 냉장고 준비';
    return;
  }
  $('family-sharing-status').textContent = `3단계 · ${family.role === 'owner' ? '가족 관리자' : '가족 구성원'}`;
  $('family-name-input').value = family.name || '';
  const members = Array.isArray(family.members) ? family.members : [];
  $('family-member-list').innerHTML = members.map((member) => {
    const role = member.role === 'owner' ? '관리자' : '구성원';
    const controls = family.role === 'owner' && member.uid !== resolveAuthUser()?.uid
      ? `<button type="button" class="btn btn--ghost" data-family-transfer="${member.uid}">관리자 이전</button>
         <button type="button" class="btn btn--ghost" data-family-remove="${member.uid}">제거</button>`
      : '';
    return `<div class="profile-menu__name-row"><span class="profile-menu__email">${member.uid === resolveAuthUser()?.uid ? '나' : esc(member.uid.slice(0, 8))} · ${role}</span>${controls}</div>`;
  }).join('') || '<p class="profile-menu__sync">구성원을 불러오는 중이에요.</p>';
  $('family-create-new-invite-btn').hidden = setupPending || family.role !== 'owner';
  $('family-name-input').disabled = setupPending || family.role !== 'owner';
  $('family-name-save-btn').hidden = setupPending || family.role !== 'owner';
  $('family-leave-btn').hidden = setupPending;
  $('family-delete-btn').hidden = setupPending || family.role !== 'owner' || members.length !== 1;
}

function openFamilySharing() {
  const modal = $('family-sharing-modal');
  if (!modal || !resolveAuthUser()) return;
  closeProfileMenu();
  setFamilyError('');
  familyWizardStep = FamilySharingService.getActiveFamily()?.pendingSetup ? 'setup' : 'start';
  familyWizardNotice = '';
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  if (typeof window.updateBodyScrollLock === 'function') window.updateBodyScrollLock();
  renderFamilySharing();
}

function closeFamilySharing() {
  const modal = $('family-sharing-modal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  if (typeof window.updateBodyScrollLock === 'function') window.updateBodyScrollLock();
}

async function startFamilySetup() {
  // Household는 복사 방식 선택 뒤에만 생성한다.
  setFamilyWizardStep('create-choice');
}

async function showFamilyInvites() {
  if (familyInviteRequestInFlight) return;
  familyInviteRequestInFlight = true;
  const reissueButton = $('family-create-new-invite-btn');
  if (reissueButton) reissueButton.disabled = true;
  setFamilyError('');
  try {
    const family = FamilySharingService.getActiveFamily();
    if (!family) return;
    if (family.pendingSetup) {
      return;
    }
    const expiresAt = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)).toISOString();
    const { link: linkInvite, code: codeInvite } = await FamilySharingService.reissueInvites({
      householdId: family.householdId,
      maxUses: 10,
      expiresAt,
    });
    $('family-invite-link').value = `${location.origin}${location.pathname}?familyInvite=${encodeURIComponent(linkInvite.secret)}`;
    $('family-invite-code').value = codeInvite.secret;
    familyWizardStep = 'invite';
    renderFamilySharing();
    setFamilyWizardNotice('새 초대 코드가 발급되었습니다. 기존 코드는 사용할 수 없습니다.');
  } catch (err) {
    setFamilyError(err.code === 'RATE_LIMITED'
      ? `초대 코드를 너무 자주 재발급했습니다. ${err.retryAfterSeconds >= 60
        ? `${Math.ceil(err.retryAfterSeconds / 60)}분`
        : `${Math.max(1, err.retryAfterSeconds || 1)}초`} 후 다시 시도해 주세요.`
      : err.message);
  } finally {
    familyInviteRequestInFlight = false;
    if (reissueButton) reissueButton.disabled = false;
  }
}

async function copyFamilyText(id) {
  const value = $(id)?.value || '';
  try {
    await navigator.clipboard.writeText(value);
    setFamilyError('복사했습니다.');
  } catch {
    $(id)?.select();
    document.execCommand('copy');
    setFamilyError('복사했습니다.');
  }
}

async function completeFamilyJoin(kind, secret) {
  const normalized = String(secret || '').trim();
  if (!normalized) return setFamilyError('초대 코드를 입력해 주세요.');
  setFamilyError('');
  try {
    await FamilySharingService.join({ kind, secret: normalized });
    pendingFamilyMigration = true;
    familyWizardStep = 'setup';
    renderFamilySharing();
  } catch (err) {
    setFamilyError(err.message);
  }
}

function bindFamilySharingUi() {
  $('profile-family-sharing-btn')?.addEventListener('click', openFamilySharing);
  $('family-create-invite-btn')?.addEventListener('click', startFamilySetup);
  $('family-create-new-invite-btn')?.addEventListener('click', showFamilyInvites);
  $('family-open-join-btn')?.addEventListener('click', () => setFamilyWizardStep('join'));
  $('family-join-submit-btn')?.addEventListener('click', () => completeFamilyJoin('code', $('family-join-code')?.value));
  $('family-join-back-btn')?.addEventListener('click', () => setFamilyWizardStep('start'));
  $('family-migration-back-btn')?.addEventListener('click', () => setFamilyWizardStep('start'));
  $('family-copy-link-btn')?.addEventListener('click', () => copyFamilyText('family-invite-link'));
  $('family-copy-code-btn')?.addEventListener('click', () => copyFamilyText('family-invite-code'));
  $('family-name-save-btn')?.addEventListener('click', async () => {
    try { await FamilySharingService.rename($('family-name-input')?.value); renderFamilySharing(); } catch (err) { setFamilyError(err.message); }
  });
  $('family-member-list')?.addEventListener('click', async (event) => {
    const transfer = event.target.closest('[data-family-transfer]')?.dataset.familyTransfer;
    const remove = event.target.closest('[data-family-remove]')?.dataset.familyRemove;
    try {
      if (transfer && window.confirm('이 구성원에게 관리자 권한을 이전할까요?')) await FamilySharingService.transferOwner(transfer);
      if (remove && window.confirm('이 구성원을 가족 공유에서 제거할까요?')) await FamilySharingService.removeMember(remove);
      await FamilySharingService.refresh();
      renderFamilySharing();
    } catch (err) { setFamilyError(err.message); }
  });
  $('family-leave-btn')?.addEventListener('click', async () => {
    try {
      await FamilySharingService.leave();
      clearPendingFamilyInviteCache();
      pendingFamilyMigration = false;
      renderFamilySharing();
    } catch (err) { setFamilyError(err.message); }
  });
  $('family-delete-btn')?.addEventListener('click', async () => {
    if (!window.confirm('가족 공유 데이터를 삭제할까요? 개인 원본 데이터는 유지됩니다.')) return;
    try {
      await FamilySharingService.deleteFamily();
      clearPendingFamilyInviteCache();
      pendingFamilyMigration = false;
      renderFamilySharing();
    } catch (err) { setFamilyError(err.message); }
  });
  $('family-copy-data-btn')?.addEventListener('click', async () => {
    if (familyMigrationInFlight) return;
    familyMigrationInFlight = true;
    const copyButton = $('family-copy-data-btn');
    const emptyButton = $('family-empty-data-btn');
    const originalText = copyButton?.textContent;
    if (copyButton) {
      copyButton.disabled = true;
      copyButton.textContent = '기존 데이터를 가져오는 중…';
    }
    if (emptyButton) emptyButton.disabled = true;
    renderFamilySharing();
    try {
      if (!FamilySharingService.getActiveFamily()) {
        await FamilySharingService.createFamily();
        pendingFamilyMigration = true;
      }
      const migration = await FamilySharingService.copyCurrentData();
      console.info('[FamilySharing] migration copy completed', {
        householdId: FamilySharingService.getActiveFamily()?.householdId,
        copiedCount: migration?.migration?.copiedCount ?? 0,
        skippedCount: migration?.migration?.skippedCount ?? 0,
        copiedPaths: migration?.migration?.copied || [],
      });
      const isJoin = FamilySharingService.getActiveFamily()?.role === 'member';
      if (!isJoin && (migration?.migration?.copiedCount || 0) + (migration?.migration?.skippedCount || 0) === 0) {
        throw new Error('가져올 공유 데이터가 없습니다. 빈 가족 냉장고로 시작하거나 개인 데이터를 먼저 저장해 주세요.');
      }
      await FamilySharingService.activate({ migrationMode: 'copy' });
      pendingFamilyMigration = false;
      familyWizardStep = 'manage';
      setFamilyWizardNotice('가족 냉장고 준비가 완료되었습니다.');
      renderFamilySharing();
    } catch (err) {
      if (FamilySharingService.getActiveFamily()?.role === 'owner') {
        try { await FamilySharingService.cancelPendingSetup(); } catch (cancelError) { console.error('[FamilySharing] pending setup rollback failed', cancelError); }
        pendingFamilyMigration = false;
        familyWizardStep = 'create-choice';
      }
      setFamilyError(`데이터를 가져오지 못했습니다. 개인 데이터는 그대로 유지됩니다. ${err.message}`);
    } finally {
      familyMigrationInFlight = false;
      if (copyButton) {
        copyButton.disabled = false;
        copyButton.textContent = originalText || '✓ 현재 데이터를 가져오기 (권장)';
      }
      if (emptyButton) emptyButton.disabled = false;
      renderFamilySharing();
    }
  });
  $('family-empty-data-btn')?.addEventListener('click', async () => {
    if (familyMigrationInFlight) return;
    familyMigrationInFlight = true;
    const copyButton = $('family-copy-data-btn');
    const emptyButton = $('family-empty-data-btn');
    const originalText = emptyButton?.textContent;
    if (copyButton) copyButton.disabled = true;
    if (emptyButton) {
      emptyButton.disabled = true;
      emptyButton.textContent = '가족 공유를 시작하는 중…';
    }
    renderFamilySharing();
    try {
      if (!FamilySharingService.getActiveFamily()) {
        await FamilySharingService.createFamily();
        pendingFamilyMigration = true;
      }
      await FamilySharingService.activate({ migrationMode: 'empty' });
      pendingFamilyMigration = false;
      familyWizardStep = 'manage';
      setFamilyWizardNotice('가족 냉장고 준비가 완료되었습니다.');
      renderFamilySharing();
    } catch (err) {
      setFamilyError(`가족 공유를 시작하지 못했습니다. 개인 데이터는 그대로 유지됩니다. ${err.message}`);
    } finally {
      familyMigrationInFlight = false;
      if (copyButton) copyButton.disabled = false;
      if (emptyButton) {
        emptyButton.disabled = false;
        emptyButton.textContent = originalText || '빈 가족 냉장고로 시작';
      }
      renderFamilySharing();
    }
  });
  $('family-sharing-modal')?.querySelectorAll('[data-close-modal="family-sharing"]').forEach((el) => el.addEventListener('click', closeFamilySharing));
  const invite = new URLSearchParams(location.search).get('familyInvite');
  if (invite) sessionStorage.setItem('pending-family-link-invite', invite);
  FamilySharingService.subscribe(renderFamilySharing);
}

function bindAuthUi() {
  if (authUiBound) return;
  authUiBound = true;

  const loginBtn = $('auth-login-btn');
  const profileBtn = $('profile-menu-btn');
  const logoutBtn = $('profile-logout-btn');
  const saveNameBtn = $('profile-save-name-btn');
  const saveProfileBtn = $('profile-save-btn');
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
  saveNameBtn?.addEventListener('click', saveFullProfile);
  saveProfileBtn?.addEventListener('click', saveFullProfile);
  avatarPicker?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-avatar-type]');
    if (!btn || btn.disabled) return;
    saveProfileAvatarType(btn.dataset.avatarType);
  });
  bindFamilySharingUi();

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
  if (authBootstrapSafetyTimer) clearTimeout(authBootstrapSafetyTimer);
  authBootstrapSafetyTimer = window.setTimeout(() => {
    if (!authState.authLoading) return;
    console.warn('[firebase-bootstrap] auth init timeout fallback');
    patchAuthState({ authLoading: false, isLoggingIn: false });
    setGoogleButtonEnabled(isFirebaseConfigured());
  }, 5000);

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
  } finally {
    if (authBootstrapSafetyTimer) {
      clearTimeout(authBootstrapSafetyTimer);
      authBootstrapSafetyTimer = null;
    }
  }

  window.FirebaseServices = {
    ready: true,
    auth,
    db,
    AuthService,
    AdminService,
    FirestoreUserService,
    FirestorePublicProfilesService,
    FirestorePublicRecipesService,
    FirestoreIngredientService,
    FirestoreBuiltinRecipesService,
    FirestoreUserDataSync,
    FamilySharingService,
    AnalysisQuotaService,
    refreshHeaderQuota,
    isConfigured: isFirebaseConfigured(),
    getAuthGateState: () => ({ ...authState }),
    waitForAuthReady: () => AuthService.waitForInitialAuth(),
  };

  if (isFirebaseConfigured()) {
    startBuiltinRecipesSync();
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

window.addEventListener('family-sharing-changed', () => {
  const user = resolveAuthUser();
  if (!user?.uid || authState.isLoggingOut) return;
  syncUserData(user, { force: true }).catch((err) => {
    console.error('[firebase-bootstrap] family sharing resync failed:', err);
  });
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
