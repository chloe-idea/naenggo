/**
 * Firebase 부트스트랩 — 게스트 우선 + 로그인 시 Firestore 동기화
 */
import { AuthService } from './services/auth-service.js';
import {
  FirestoreUserService,
  normalizeAvatarType,
  resolveEffectivePhotoURL,
  resolveProfileAvatar,
} from './services/firestore-user-service.js';
import { ProfileImageService } from './services/profile-image-service.js';
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
import { getDisplayName } from './lib/display-name.js';
import { formatAuthError } from './services/auth-errors.js';
import { StartupPerf } from './services/startup-perf.js';
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
const deduplicatedHouseholdsThisSession = new Set();

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
  if (recipeFormModal && !recipeFormModal.hidden) return true;
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
  const previewNameEl = $('profile-preview-name');
  const previewBioEl = $('profile-preview-bio');
  const emailEl = $('profile-menu-email');
  const nameInput = $('profile-display-name');
  const bioInput = $('profile-bio');
  const picker = $('profile-avatar-picker');
  const errorEl = $('profile-menu-error');
  const social = resolvedProfile?.socialLinks || {};

  const displayName = getDisplayName({
    userProfile: resolvedProfile,
    authUser,
    fallback: '프로필',
  });
  const bio = resolvedProfile?.bio || '';
  if (previewNameEl) previewNameEl.textContent = displayName;
  if (previewBioEl) previewBioEl.textContent = bio;
  if (emailEl) emailEl.textContent = authUser?.email || '—';
  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = getDisplayName({
      userProfile: resolvedProfile,
      authUser,
      fallback: '',
    });
  }
  if (bioInput && document.activeElement !== bioInput) {
    bioInput.value = bio;
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
    const activeType = normalizeAvatarType(
      resolvedProfile?.avatarType || resolvedProfile?.profileImageType || avatar.avatarType,
      authUser,
    );
    picker.querySelectorAll('[data-avatar-type]').forEach((btn) => {
      const type = btn.dataset.avatarType;
      btn.classList.toggle('profile-avatar-picker__btn--active', type === activeType);
      if (type === 'google') {
        btn.disabled = !authUser?.photoURL;
      }
      if (type === 'upload') {
        btn.disabled = !ProfileImageService.isAvailable();
      }
    });
  }

  updateProfileMenuSyncStatus();
}

function setProfileAvatarStatus(message = '', { isError = false } = {}) {
  const el = $('profile-avatar-status');
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
  el.classList.toggle('profile-menu__sync--loading', Boolean(message) && !isError);
  el.style.color = isError ? '#c0392b' : '';
}

function syncProfilePreviewFromInputs() {
  const previewNameEl = $('profile-preview-name');
  const previewBioEl = $('profile-preview-bio');
  const nameInput = $('profile-display-name');
  const bioInput = $('profile-bio');
  if (previewNameEl && nameInput) {
    previewNameEl.textContent = nameInput.value.trim() || '프로필';
  }
  if (previewBioEl && bioInput) {
    previewBioEl.textContent = bioInput.value.trim();
  }
}

async function loadUserProfile(authUser) {
  if (!authUser?.uid) {
    cachedUserProfile = null;
    return null;
  }
  const profileStartMs = StartupPerf.begin('user profile loaded', 'users/{uid}');
  let documentCount = 0;
  try {
    // ensureUserDocument 한 번만 getDoc — 별도 getUserDocument 호출 제거
    StartupPerf.markRead('users/{uid}');
    cachedUserProfile = await FirestoreUserService.ensureUserDocument(authUser);
    documentCount += 1;
    if (cachedUserProfile) {
      StartupPerf.markRead('publicProfiles/{uid}');
      const publicProfile = await FirestorePublicProfilesService.getById(authUser.uid);
      documentCount += 1;
      const needsPublicSync = !publicProfile
        || (
          !String(publicProfile.nickname || '').trim()
          && String(cachedUserProfile.nickname || cachedUserProfile.displayName || '').trim()
        );
      if (needsPublicSync) {
        const profileImageUrl = resolveEffectivePhotoURL(cachedUserProfile, authUser);
        await FirestorePublicProfilesService.syncFromUserProfile(authUser.uid, {
          ...cachedUserProfile,
          profileImageUrl,
          profileImage: profileImageUrl,
          photoURL: profileImageUrl,
        });
      }
    }
  } catch (err) {
    console.error('[firebase-bootstrap] loadUserProfile failed:', err);
    cachedUserProfile = null;
  }
  StartupPerf.end('user profile loaded', {
    documentCount,
    firestorePath: 'users/{uid}+publicProfiles/{uid}',
    startMs: profileStartMs,
  });
  updateProfileMenuContent(authUser, cachedUserProfile);
  return cachedUserProfile;
}

function ensureAdminSync() {
  const user = resolveAuthUser();
  if (!user?.uid || authState.isLoggingOut) return;
  AdminService.startSync(user.uid);
}

function ensureDeferredUserDataSync(keys) {
  return FirestoreUserDataSync.ensureDeferredSync(keys);
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
  const btn = $('profile-menu-btn');
  if (!resolveAuthUser()) return;

  if (typeof window.openProfileManagePage === 'function') {
    window.openProfileManagePage();
  } else {
    console.warn('[firebase-bootstrap] openProfileManagePage unavailable');
  }

  if (btn) btn.setAttribute('aria-expanded', 'true');
  updateProfileMenuContent(resolveAuthUser(), cachedUserProfile);
  refreshProfileQuota();
}

function closeProfileMenu() {
  const btn = $('profile-menu-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function leaveProfileManagePage() {
  closeProfileMenu();
  if (typeof window.closeProfileManagePage === 'function') {
    const profileView = document.getElementById('view-profile');
    if (profileView && !profileView.hidden) {
      window.closeProfileManagePage();
    }
  }
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
    nickname: displayName,
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
    } else {
      // 서버 저장 후 publicProfiles 캐시에 최신 닉네임 즉시 반영
      try {
        await FirestorePublicProfilesService.syncFromUserProfile(user.uid, {
          ...(cachedUserProfile || {}),
          ...updates,
        });
      } catch (syncErr) {
        console.warn('[firebase-bootstrap] public profile cache sync after server save:', syncErr);
        FirestorePublicProfilesService.clearCache(user.uid);
      }
    }

    // 가족 구성원 목록의 내 표시명 즉시 패치
    const family = FamilySharingService.getActiveFamily();
    const siteName = getDisplayName({
      userProfile: cachedUserProfile,
      authUser: user,
      fallback: '사용자',
    });
    if (family && Array.isArray(family.members)) {
      family.members = family.members.map((member) => (
        member.uid === user.uid
          ? {
            ...member,
            nickname: siteName,
            displayName: siteName,
            label: siteName,
          }
          : member
      ));
    }
    const familyModal = $('family-sharing-modal');
    if (familyModal && !familyModal.hidden) renderFamilySharing();

    renderAuthUi(user);
    updateProfileMenuContent(user, cachedUserProfile);
    window.dispatchEvent(new CustomEvent('public-profile-updated', {
      detail: { uid: user.uid, nickname: siteName },
    }));
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

async function saveProfileAvatarType(avatarType, extra = {}) {
  const user = resolveAuthUser();
  if (!user?.uid || !avatarType) return;

  const type = normalizeAvatarType(avatarType, user);
  try {
    const googlePhotoURL = String(user.photoURL || cachedUserProfile?.googlePhotoURL || '').trim();
    const uploadedPhotoURL = String(
      extra.uploadedPhotoURL ?? cachedUserProfile?.uploadedPhotoURL ?? '',
    ).trim();
    const effective = type === 'letter'
      ? ''
      : (type === 'upload' ? uploadedPhotoURL : googlePhotoURL);

    cachedUserProfile = await FirestoreUserService.updateProfile(
      user.uid,
      {
        avatarType: type,
        profileImageType: type,
        uploadedPhotoURL,
        googlePhotoURL,
        profileImageUrl: effective,
        profileImage: effective,
        photoURL: effective,
      },
      { photoURL: googlePhotoURL },
    );
    renderAuthUi(user);
    updateProfileMenuContent(user, cachedUserProfile);
    window.dispatchEvent(new CustomEvent('public-profile-updated', { detail: { uid: user.uid } }));
    // 업로드 파일은 교체 시에만 overwrite. letter/google 전환 시 Storage 파일은 보관.
  } catch (err) {
    console.error('[firebase-bootstrap] save avatarType failed:', err);
    showAuthError({ message: err?.message || '프로필 이미지 변경에 실패했어요.' });
    throw err;
  }
}

async function handleProfileAvatarUpload(file) {
  const user = resolveAuthUser();
  if (!user?.uid || !file) return;

  setProfileAvatarStatus('사진을 준비하는 중…');
  try {
    const result = await ProfileImageService.uploadAvatar(file, {
      onProgress: (phase) => {
        if (phase === 'compressing') setProfileAvatarStatus('사진을 최적화하는 중…');
        if (phase === 'uploading') setProfileAvatarStatus('업로드 중…');
      },
    });
    // 미리보기 즉시 반영
    const previewImg = $('profile-menu-avatar-img');
    if (previewImg && result.downloadURL) {
      previewImg.src = result.downloadURL;
      previewImg.hidden = false;
      const emojiEl = $('profile-menu-avatar-emoji');
      const initialEl = $('profile-menu-avatar-initial');
      if (emojiEl) emojiEl.hidden = true;
      if (initialEl) initialEl.hidden = true;
    }
    await saveProfileAvatarType('upload', { uploadedPhotoURL: result.downloadURL });
    setProfileAvatarStatus('프로필 사진을 저장했어요.');
    if (typeof window.showToast === 'function') window.showToast('프로필 사진을 저장했어요');
  } catch (err) {
    console.error('[firebase-bootstrap] avatar upload failed:', err);
    setProfileAvatarStatus(err?.message || '사진 업로드에 실패했어요.', { isError: true });
  }
}

/** 초기 hydration 중 family-sharing-changed → force sync 루프 방지 */
let householdHydrationInProgress = false;

function buildUserSyncHandlers(markHomeSnapshot) {
  return {
    onIngredients: (items) => {
      window.dispatchEvent(new CustomEvent('pantry-firestore-sync', { detail: { items } }));
      markHomeSnapshot?.('ingredients');
    },
    onMyRecipes: (recipes) => {
      window.dispatchEvent(new CustomEvent('my-recipes-firestore-sync', { detail: { recipes } }));
      markHomeSnapshot?.('myRecipes');
    },
    onMealCalendar: (logs) => {
      window.dispatchEvent(new CustomEvent('meal-calendar-firestore-sync', { detail: { logs } }));
    },
    onMealPlans: (plans) => {
      window.dispatchEvent(new CustomEvent('meal-plans-firestore-sync', { detail: { plans } }));
    },
    onShopping: (records) => {
      window.dispatchEvent(new CustomEvent('shopping-firestore-sync', { detail: { records } }));
    },
    onSettings: (settings) => {
      window.dispatchEvent(new CustomEvent('settings-firestore-sync', { detail: { settings } }));
    },
    onError: (err) => {
      const family = FamilySharingService.getActiveFamily?.();
      console.error('[firebase-bootstrap] user data sync failed — keeping existing UI state', {
        operation: 'userDataSync',
        code: err?.code || null,
        message: err?.message || String(err),
        authPresent: Boolean(AuthService.isLoggedIn?.() || auth?.currentUser),
        activeHouseholdId: FamilySharingService.getActiveHouseholdId?.() || null,
        role: family?.role || null,
        pendingSetup: Boolean(family?.pendingSetup),
        err,
      });
      // permission-denied / 구독 실패 시 빈 데이터로 overwrite 하지 않는다.
      // 로딩 스피너만 해제한다.
      markHomeSnapshot?.('ingredients');
      markHomeSnapshot?.('myRecipes');
    },
  };
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
  householdHydrationInProgress = true;

  if (typeof window.clearAllUserDataState === 'function') {
    window.clearAllUserDataState();
  }

  // leave/deleteFamily 직후: clear로 지워진 내 저장 ID를 개인 스코프 메모리에 즉시 복구
  // (서버 migrate + settings 스냅샷이 이어지기 전까지 다른 구성원 저장분이 다시 섞이지 않게)
  const pendingSavedIds = window.__pendingPersonalSavedRecipeIds;
  if (Array.isArray(pendingSavedIds)) {
    window.__pendingPersonalSavedRecipeIds = null;
    try {
      window.AppServices?.SavedRecipeRepository?.replaceIds?.(pendingSavedIds);
    } catch (error) {
      console.warn('[firebase-bootstrap] pending personal savedRecipes restore skipped', {
        message: error?.message || String(error),
      });
    }
  }

  try {
    const householdStartMs = StartupPerf.begin('household resolved', 'api/households/current');

    // sessionStorage hint로 구독 경로를 먼저 잡고, /current 검증은 병렬
    const hintApply = FamilySharingService.applySessionHintForScope();
    const scopeBeforeVerify = FamilySharingService.getActiveHouseholdId();

    const refreshPromise = FamilySharingService.refresh({
      reason: 'hydration',
      notifySource: 'hydration',
    });

    let firstSnapshotDone = false;
    const finishFirstSnapshot = (reason) => {
      if (firstSnapshotDone) return;
      firstSnapshotDone = true;
      clearDataLoading(reason);
      const hp = FamilySharingService.getPerfSnapshot?.() || {};
      // household refresh와 race 가능 — 미완료면 pending으로 표기 (recovery로 오인 방지)
      StartupPerf.markHomeReady({
        firestorePath: `composite:home; refreshCalls=${hp.refreshCalls}|fetchCalls=${hp.fetchCalls}|cacheHit=${hp.lastCacheHit}|path=${hp.lastResolutionPath || 'pending'}`,
      });
      StartupPerf.summarize();
    };

    let pending = 2;
    const homeSeen = { ingredients: false, myRecipes: false };
    const markHomeSnapshot = (key) => {
      if (homeSeen[key]) return;
      homeSeen[key] = true;
      pending -= 1;
      if (pending <= 0) finishFirstSnapshot('home user snapshots');
    };

    const handlers = buildUserSyncHandlers(markHomeSnapshot);
    // hint/캐시 기준으로 즉시 구독 시작 (권한은 Firestore Rules가 최종 판정)
    FirestoreUserDataSync.startUserSync({
      householdId: scopeBeforeVerify,
      ...handlers,
    });
    console.log('[HouseholdPerf] subscribe-started', {
      fromHint: Boolean(hintApply?.fromHint),
      householdId: scopeBeforeVerify ? '{householdId}' : null,
    });

    await refreshPromise;

    if (pendingFamilyLinkInvite && !FamilySharingService.isActive() && !familyLinkJoinInFlight) {
      familyLinkJoinInFlight = true;
      try {
        await FamilySharingService.join({ kind: 'link', secret: pendingFamilyLinkInvite });
        pendingFamilyMigration = true;
        sessionStorage.removeItem('pending-family-link-invite');
        pendingFamilyLinkInvite = null;
        await FamilySharingService.refresh({
          force: true,
          reason: 'join',
          notifySource: 'hydration',
        });
      } finally {
        familyLinkJoinInFlight = false;
      }
    }

    const householdId = FamilySharingService.getActiveHouseholdId();
    const hp = FamilySharingService.getPerfSnapshot?.() || {};
    StartupPerf.end('household resolved', {
      documentCount: householdId ? 1 : 0,
      firestorePath: `api/households/current path=${hp.lastResolutionPath || 'n/a'} cacheHit=${hp.lastCacheHit} fetchCalls=${hp.fetchCalls}`,
      startMs: householdStartMs,
    });

    // hint와 서버 결과가 다르면 household-scoped 구독 전부 재시작.
    // myRecipes는 users/{uid}/myRecipes 고정이라 재등록하지 않는다 (duplicateListeners 방지).
    if (scopeBeforeVerify !== householdId) {
      console.log('[HouseholdPerf] scope-mismatch-resubscribe', {
        hintHadHousehold: Boolean(scopeBeforeVerify),
        resolvedHadHousehold: Boolean(householdId),
        keepMyRecipes: true,
        restartDeferred: true,
      });
      homeSeen.ingredients = false;
      if (homeSeen.myRecipes) {
        pending = 1;
      } else {
        pending = 2;
      }
      if (firstSnapshotDone) {
        startDataLoading(user);
        firstSnapshotDone = false;
      }
      FirestoreUserDataSync.restartScopedSync({
        householdId,
        ...buildUserSyncHandlers(markHomeSnapshot),
      });
    }

    if (householdId && !deduplicatedHouseholdsThisSession.has(householdId)) {
      try {
        await FamilySharingService.deduplicateIngredients();
        deduplicatedHouseholdsThisSession.add(householdId);
        console.info('[FamilySharing] household ingredient deduplication completed', { householdId: '{householdId}' });
      } catch (error) {
        console.error('[FamilySharing] household ingredient deduplication failed', {
          code: error?.code || null,
          message: error?.message || String(error),
        });
      }
    }
    // 로컬 냉장고 이관은 개인 scope에서 끝낸 뒤에만 가족 복사를 허용한다.
    if (!householdId) {
      const legacyResult = await migrateLegacyPantryToFirestore(FirestoreIngredientService, uid);
      if (legacyResult.migrated) {
        console.info('[FamilySharing] personal pantry migration completed before household setup', legacyResult);
      }
    }
    const scopeRoot = householdId ? 'households/{householdId}' : 'users/{uid}';
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
      myRecipes: 'users/{uid}/myRecipes',
      statistics: householdId ? 'derived from shared mealCalendar + shopping + grocery' : 'derived from personal mealCalendar + shopping + settings',
    });
  } catch (err) {
    console.error('[firebase-bootstrap] syncUserData failed:', {
      message: err?.message || String(err),
      code: err?.code || null,
      status: err?.status || null,
      url: '/api/households/current',
      hostname: location.hostname,
      hintUncleared: Boolean(FamilySharingService.getActiveFamily()?._fromHint),
    });
    // localhost 등에서 /current 실패 + 미검증 hint 가 남아 있으면
    // household 경로 permission-denied 로 clearAll 이후 빈 화면이 고착될 수 있다.
    // Firestore pointer는 건드리지 않고 메모리 hint만 제거 후 개인 경로로 재구독한다.
    const clearedHint = FamilySharingService.clearUnvalidatedHintScope?.();
    if (clearedHint) {
      FirestoreUserDataSync.restartScopedSync(buildUserSyncHandlers(null));
    }
    clearDataLoading('sync error');
  } finally {
    // notify(hydration) 핸들러가 같은 틱에서 force sync 하지 않도록 다음 마이크로태스크에서 해제
    queueMicrotask(() => {
      householdHydrationInProgress = false;
      // clearAll/stopAll 이후에도 현재 탭의 deferred(mealCalendar/settings)를 다시 건다.
      // (달력에 머문 채 resync 되면 구독이 끊긴 채 예산 "불러오는 중"이 남을 수 있음)
      window.dispatchEvent(new CustomEvent('user-data-sync-restarted'));
    });
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

  // admin 구독은 프로필 탭 등에서 지연 시작 (초기 홈 로딩에서 제외)
  window.dispatchEvent(new CustomEvent('admin-status-changed', {
    detail: AdminService.getState(),
  }));

  // 홈 셸을 먼저 그리도록 auth 이벤트를 sync 전에 발행
  window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user } }));

  await syncUserData(user);

  if (authState.isLoggingOut || !AuthService.isLoggedIn() || AuthService.getUid() !== uid) {
    console.log('[firebase-bootstrap] sign-in flow aborted (logged out during sync)');
    return;
  }

  // household scope 확정 후 홈 브리핑 식비(이번 주 grocery) 1회 로드 트리거
  window.dispatchEvent(new CustomEvent('home-user-sync-ready', { detail: { uid } }));

  // 프로필/쿼터는 홈 스냅샷과 병렬 — 홈 진입을 막지 않음
  void loadUserProfile(user).then(() => refreshProfileQuota());
}

async function handleSignedOutUser() {
  logoutInProgress = false;
  AdminService.stopSync();
  FirestoreUserDataSync.stopAll();
  syncedUid = null;
  cachedUserProfile = null;
  clearDataLoading('signed out');
  leaveProfileManagePage();

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

    console.log('[firebase-bootstrap] handleAuthChange:', user ? 'signed in' : 'guest');

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

const ACCOUNT_DELETE_CONFIRM_TEXT = '탈퇴하기';
let accountDeleteInFlight = false;

function setAccountDeleteError(message = '') {
  const el = $('account-delete-error');
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
}

function syncAccountDeleteConfirmButton() {
  const input = $('account-delete-confirm-input');
  const btn = $('account-delete-confirm-btn');
  if (!btn) return;
  const matched = String(input?.value || '').trim() === ACCOUNT_DELETE_CONFIRM_TEXT;
  btn.disabled = !matched || accountDeleteInFlight;
}

function openAccountDeleteModal() {
  const modal = $('account-delete-modal');
  if (!modal) return;
  const input = $('account-delete-confirm-input');
  if (input) input.value = '';
  setAccountDeleteError('');
  accountDeleteInFlight = false;
  syncAccountDeleteConfirmButton();
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  input?.focus();
}

function closeAccountDeleteModal() {
  const modal = $('account-delete-modal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  setAccountDeleteError('');
  accountDeleteInFlight = false;
  syncAccountDeleteConfirmButton();
}

function mapAccountDeleteError(data, fallbackMessage) {
  const code = data?.error || '';
  if (code === 'OWNER_TRANSFER_REQUIRED') {
    return '가족 공유 소유자입니다. 가족 공유에서 소유권을 다른 구성원에게 이전한 뒤 다시 시도해 주세요.';
  }
  if (code === 'MEMBERS_REMAIN') {
    return data?.message
      || '다른 가족 구성원 기록이 남아 있어 탈퇴할 수 없습니다. 가족 공유에서 구성원을 정리하거나 소유권을 이전해 주세요.';
  }
  if (code === 'DELETION_IN_PROGRESS') {
    return '회원 탈퇴가 이미 진행 중입니다. 잠시 후 다시 시도해 주세요.';
  }
  if (code === 'AUTH_REQUIRED' || code === 'INVALID_ID_TOKEN') {
    return '로그인이 필요합니다. Google로 다시 로그인해 주세요.';
  }
  return data?.message || fallbackMessage || '회원 탈퇴에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

async function requestAccountDeletionApi(idToken) {
  const token = String(idToken || '').trim();
  if (!token) {
    const err = new Error('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.');
    err.code = 'AUTH_REQUIRED';
    throw err;
  }
  const res = await fetch('/api/account/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    // uid는 body에 넣지 않음 — 서버는 token uid만 사용
    body: JSON.stringify({}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || !data?.success) {
    const err = new Error(mapAccountDeleteError(data, '회원 탈퇴에 실패했습니다.'));
    err.code = data?.error || `HTTP_${res.status}`;
    err.payload = data;
    throw err;
  }
  return data;
}

async function finishAccountDeletionSuccess() {
  closeAccountDeleteModal();
  try {
    leaveProfileManagePage();
  } catch {
    // profile page helpers may be unavailable during teardown
  }

  // 서버에서 Auth 계정이 이미 삭제된 뒤라 signOut이 실패해도 로컬은 반드시 정리
  logoutInProgress = true;
  activeAuthTask = null;
  pendingAuthUid = null;
  patchAuthState({ isLoggingOut: true, user: null });
  try {
    FirestoreUserDataSync.stopAll();
    try {
      if (auth && authReady) await AuthService.signOut();
    } catch (err) {
      console.warn('[firebase-bootstrap] post-delete signOut:', err?.code || err?.message || err);
    }
    if (typeof window.clearUserData === 'function') {
      window.clearUserData();
    }
  } finally {
    logoutInProgress = false;
    patchAuthState({ isLoggingOut: false, user: null });
  }

  if (typeof window.showToast === 'function') {
    window.showToast('회원 탈퇴가 완료되었습니다');
  }
  if (typeof window.openLoginPrompt === 'function') {
    window.openLoginPrompt();
  } else if (typeof window.switchView === 'function') {
    window.switchView('main');
  }
}

function mapAccountDeleteClientError(err) {
  const code = String(err?.code || '');
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google 재인증이 취소되었습니다.';
  }
  if (code === 'auth/popup-blocked') {
    return '팝업이 차단되었습니다. 브라우저에서 팝업을 허용한 뒤 다시 시도해 주세요.';
  }
  if (code === 'AUTH_ACCOUNT_MISMATCH') {
    return '현재 로그인한 Google 계정으로 다시 인증해 주세요.';
  }
  if (code === 'AUTH_REQUIRED') {
    return '로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.';
  }
  if (code === 'auth/operation-not-supported-in-this-environment') {
    return err?.message
      || '이 환경에서는 Google 팝업 재인증을 사용할 수 없습니다. 모바일 브라우저나 데스크톱에서 다시 시도해 주세요.';
  }
  return err?.message || '회원 탈퇴에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

/**
 * 회원 탈퇴 확인 클릭 핸들러.
 * Google 재인증 팝업은 이 호출 스택의 첫 async 지점에서 바로 연다.
 */
async function confirmAccountDeletionFlow() {
  const input = $('account-delete-confirm-input');
  if (String(input?.value || '').trim() !== ACCOUNT_DELETE_CONFIRM_TEXT) {
    setAccountDeleteError(`확인을 위해 "${ACCOUNT_DELETE_CONFIRM_TEXT}"를 입력해 주세요.`);
    return;
  }
  if (accountDeleteInFlight) return;

  const current = auth?.currentUser || AuthService.getCurrentUser?.();
  if (!current?.uid) {
    setAccountDeleteError('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.');
    if (typeof window.openLoginPrompt === 'function') window.openLoginPrompt();
    return;
  }

  const expectedUid = current.uid;
  const expectedEmail = current.email || null;
  const confirmBtn = $('account-delete-confirm-btn');

  accountDeleteInFlight = true;
  syncAccountDeleteConfirmButton();
  setAccountDeleteError('');
  if (confirmBtn) confirmBtn.textContent = 'Google 계정 확인 중…';

  try {
    // 1) 클릭 직후 재인증 팝업 (사전 API/setTimeout 없음)
    const reauthUser = await AuthService.reauthenticateWithGoogleForAccountDelete({
      expectedUid,
      expectedEmail,
    });

    // 2) 재인증 성공 후에만 토큰 갱신 + 탈퇴 API
    if (confirmBtn) confirmBtn.textContent = '탈퇴 처리 중…';
    const idToken = await reauthUser.getIdToken(true);
    await requestAccountDeletionApi(idToken);
    await finishAccountDeletionSuccess();
  } catch (err) {
    console.error('[firebase-bootstrap] account delete reauth/api failed:', err?.code, err?.message, err);
    // API 실패·재인증 취소 모두: 로그아웃하지 않고 모달 유지 + 재시도 가능
    setAccountDeleteError(mapAccountDeleteClientError(err));
  } finally {
    accountDeleteInFlight = false;
    if (confirmBtn) confirmBtn.textContent = '회원 탈퇴';
    syncAccountDeleteConfirmButton();
  }
}

function bindAccountDeleteUi() {
  const deleteBtn = $('profile-delete-account-btn');
  const modal = $('account-delete-modal');
  const confirmInput = $('account-delete-confirm-input');
  const confirmBtn = $('account-delete-confirm-btn');

  deleteBtn?.addEventListener('click', () => {
    if (!AuthService.isLoggedIn()) {
      if (typeof window.openLoginPrompt === 'function') window.openLoginPrompt();
      return;
    }
    openAccountDeleteModal();
  });

  modal?.querySelectorAll('[data-close-modal="account-delete"]').forEach((el) => {
    el.addEventListener('click', () => {
      if (accountDeleteInFlight) return;
      closeAccountDeleteModal();
    });
  });

  confirmInput?.addEventListener('input', syncAccountDeleteConfirmButton);
  confirmInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (String(confirmInput.value || '').trim() !== ACCOUNT_DELETE_CONFIRM_TEXT) return;
    if (confirmBtn?.disabled || accountDeleteInFlight) return;
    // Enter도 동일 클릭 스택에서 재인증 팝업 시작
    confirmAccountDeletionFlow();
  });
  confirmBtn?.addEventListener('click', () => {
    // 팝업 차단 방지: click 핸들러에서 바로 재인증 시작 (중간 디스패치 없음)
    confirmAccountDeletionFlow();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!modal || modal.hidden) return;
    if (accountDeleteInFlight) return;
    event.preventDefault();
    closeAccountDeleteModal();
  });
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

function escapeFamilyHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 구성원 표시명: nickname → displayName → label → uid 축약 */
function resolveFamilyMemberLabel(member = {}) {
  const name = getDisplayName({
    userProfile: member,
    publicProfile: member,
    storedName: member.label || '',
    fallback: '',
  });
  if (name) return name;
  const uid = String(member.uid || '').trim();
  return uid ? uid.slice(0, 8) : '구성원';
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
  const selfUid = resolveAuthUser()?.uid;
  $('family-member-list').innerHTML = members.map((member) => {
    const role = member.role === 'owner' ? '관리자' : '구성원';
    const isSelf = member.uid === selfUid;
    const label = resolveFamilyMemberLabel(member);
    const roleLine = isSelf ? `나 · ${role}` : role;
    const photoURL = String(member.photoURL || '').trim();
    const avatar = photoURL
      ? `<img class="family-member-card__avatar-img" src="${escapeFamilyHtml(photoURL)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="family-member-card__avatar-fallback" aria-hidden="true">👤</span>`;
    const controls = family.role === 'owner' && !isSelf
      ? `<div class="family-member-card__actions">
           <button type="button" class="btn btn--outline family-member-card__btn" data-family-transfer="${escapeFamilyHtml(member.uid)}">관리자 이전</button>
           <button type="button" class="btn btn--danger family-member-card__btn" data-family-remove="${escapeFamilyHtml(member.uid)}">제거</button>
         </div>`
      : '';
    return `<div class="family-member-card">
      <div class="family-member-card__main">
        <span class="family-member-card__avatar">${avatar}</span>
        <div class="family-member-card__text">
          <span class="family-member-card__name">${escapeFamilyHtml(label)}</span>
          <span class="family-member-card__role">${escapeFamilyHtml(roleLine)}</span>
        </div>
      </div>
      ${controls}
    </div>`;
  }).join('') || '<p class="profile-menu__sync">구성원을 불러오는 중이에요.</p>';
  $('family-create-new-invite-btn').hidden = setupPending || family.role !== 'owner';
  $('family-name-input').disabled = setupPending || family.role !== 'owner';
  $('family-name-save-btn').hidden = setupPending || family.role !== 'owner';
  const soleOwner = family.role === 'owner' && members.length === 1;
  // 마지막 관리자: 나가기 대신 삭제만 노출 (leave API도 삭제로 위임)
  $('family-leave-btn').hidden = setupPending || soleOwner;
  $('family-delete-btn').hidden = setupPending || !soleOwner;
}

async function openFamilySharing() {
  const modal = $('family-sharing-modal');
  if (!modal || !resolveAuthUser()) return;
  setFamilyError('');
  familyWizardStep = FamilySharingService.getActiveFamily()?.pendingSetup ? 'setup' : 'start';
  familyWizardNotice = '';
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  if (typeof window.updateBodyScrollLock === 'function') window.updateBodyScrollLock();
  renderFamilySharing();
  // 홈 Fast path는 members 부분 목록만 가져오므로, 모달에서 전체 구성원을 로드한다.
  try {
    await FamilySharingService.refresh({
      force: true,
      reason: 'load-members',
      includeMembers: true,
      notifySource: 'user-action',
    });
    renderFamilySharing();
  } catch (err) {
    console.warn('[firebase-bootstrap] load family members failed:', err?.message || err);
  }
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
      if (remove && window.confirm('이 구성원을 가족 공유에서 제거할까요?')) {
        await FamilySharingService.removeMember(remove);
        await FamilySharingService.refresh({ force: true, reason: 'remove-member', notifySource: 'user-action' });
      }
      renderFamilySharing();
    } catch (err) { setFamilyError(err.message); }
  });
  $('family-leave-btn')?.addEventListener('click', async () => {
    try {
      const family = FamilySharingService.getActiveFamily();
      const members = Array.isArray(family?.members) ? family.members : [];
      if (family?.role === 'owner' && members.length === 1) {
        if (!window.confirm('혼자 남은 가족 공유를 삭제하고 개인 모드로 돌아갈까요? 개인 원본 데이터는 유지됩니다.')) return;
      }
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
      familyWizardStep = 'start';
      renderFamilySharing();
    } catch (err) {
      console.error('[FamilySharing] delete button failed', {
        code: err?.code || '',
        status: err?.status || 0,
        message: err?.message || String(err),
      });
      setFamilyError(err.message);
    }
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
  const nameInput = $('profile-display-name');
  const bioInput = $('profile-bio');

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
    leaveProfileManagePage();
    signOutFlow(event);
  }, { capture: true });
  saveNameBtn?.addEventListener('click', saveFullProfile);
  saveProfileBtn?.addEventListener('click', saveFullProfile);
  avatarPicker?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-avatar-type]');
    if (!btn || btn.disabled) return;
    const type = btn.dataset.avatarType;
    if (type === 'upload') {
      const fileInput = $('profile-avatar-file');
      if (!ProfileImageService.isAvailable()) {
        setProfileAvatarStatus('사진 업로드 저장소가 아직 준비되지 않았어요.', { isError: true });
        return;
      }
      fileInput?.click();
      return;
    }
    setProfileAvatarStatus('');
    saveProfileAvatarType(type).catch(() => {});
  });
  $('profile-avatar-file')?.addEventListener('change', (event) => {
    const file = event.target?.files?.[0];
    event.target.value = '';
    if (!file) return;
    handleProfileAvatarUpload(file);
  });
  nameInput?.addEventListener('input', syncProfilePreviewFromInputs);
  bioInput?.addEventListener('input', syncProfilePreviewFromInputs);
  window.addEventListener('profile-manage-open', () => {
    const user = resolveAuthUser();
    if (!user) return;
    ensureDeferredUserDataSync(['settings']);
    ensureAdminSync();
    updateProfileMenuContent(user, cachedUserProfile);
    refreshProfileQuota();
  });
  bindFamilySharingUi();
  bindAccountDeleteUi();

  window.__authSignOut = signOutFlow;
  window.__authSignInGoogle = signInWithGoogleFlow;
  window.__ensureDeferredUserDataSync = ensureDeferredUserDataSync;
  window.__ensureAdminSync = ensureAdminSync;
}

async function bootstrap() {
  console.log('[firebase-bootstrap] start', {
    configured: isFirebaseConfigured(),
    authReady: Boolean(auth),
    hostname: location.hostname,
  });

  // 재료 동의어·기본 재료는 동기 API를 유지한다. Firestore 동기화가 시작되기 전에
  // 한 번 준비해, 저장·일치 계산 시 JSON을 반복 요청하지 않도록 한다.
  await window.IngredientNormalizer?.loadIngredientAliases?.();
  await window.IngredientNormalizer?.loadDefaultIngredients?.();

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
    FirestoreSettingsService: FirestoreUserDataSync.settings,
    FamilySharingService,
    ProfileImageService,
    AnalysisQuotaService,
    getDisplayName,
    getCachedUserProfile: () => cachedUserProfile,
    refreshHeaderQuota,
    ensureDeferredUserDataSync,
    ensureAdminSync,
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

window.addEventListener('family-sharing-changed', (event) => {
  const source = event?.detail?.source || 'user-action';
  // 초기 hydration notify는 이벤트는 유지하되 force sync/refresh 루프만 차단
  if (source === 'hydration' || householdHydrationInProgress) {
    console.log('[HouseholdPerf] skip-resync', { source, hydration: householdHydrationInProgress });
    return;
  }
  const user = resolveAuthUser();
  if (!user?.uid || authState.isLoggingOut) return;
  // user-data-sync-restarted 는 syncUserData finally에서 발행 (deferred 재구독)
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
