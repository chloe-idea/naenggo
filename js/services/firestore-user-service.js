/**
 * Firestore users/{uid} 문서 관리
 */
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { FREE_ANALYSIS_LIMIT, db } from '../firebase.js';
import { buildUsageDisplay, normalizeWeeklyUsageRecord } from '../lib/analysis-quota-core.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';
import { normalizeSocialLinks } from '../lib/social-url.js';
import {
  getDisplayName,
  nicknameDualWriteFields,
  normalizeSiteNickname,
} from '../lib/display-name.js';
import { FirestorePublicProfilesService } from './firestore-public-profiles-service.js';

const USERS_COLLECTION = 'users';
/** letter(글자) | upload(사진 업로드) | google — legacy: initial→letter, fridge→letter */
const AVATAR_TYPES = new Set(['letter', 'upload', 'google', 'initial', 'fridge']);

function userDocRef(uid) {
  if (!db || !uid) return null;
  return doc(db, USERS_COLLECTION, uid);
}

export function normalizeAvatarType(value, authUser) {
  const type = String(value || '').trim();
  if (type === 'initial' || type === 'fridge') return 'letter';
  if (type === 'letter' || type === 'upload' || type === 'google') return type;
  if (AVATAR_TYPES.has(type)) return type === 'fridge' || type === 'initial' ? 'letter' : type;
  return authUser?.photoURL ? 'google' : 'letter';
}

/** 선택 타입에 따른 공개 표시용 이미지 URL (letter면 빈 문자열) */
export function resolveEffectivePhotoURL(profile, authUser) {
  const avatarType = normalizeAvatarType(profile?.avatarType ?? profile?.profileImageType, authUser);
  const uploaded = String(profile?.uploadedPhotoURL || '').trim()
    || String(profile?.profileImageUrl || profile?.profileImage || '').trim();
  const google = String(profile?.googlePhotoURL || authUser?.photoURL || '').trim();

  if (avatarType === 'letter') return '';
  if (avatarType === 'upload') return String(profile?.uploadedPhotoURL || '').trim() || uploaded;
  if (avatarType === 'google') return google;
  // 타입이 모호할 때: 업로드 > Google > 글자
  return String(profile?.uploadedPhotoURL || '').trim() || google || '';
}

export function resolveProfileAvatar(profile, authUser) {
  const displayName = getDisplayName({
    userProfile: profile,
    authUser,
    fallback: '사용자',
  });
  const initial = (displayName.charAt(0) || '냉').toUpperCase();
  const avatarType = normalizeAvatarType(profile?.avatarType ?? profile?.profileImageType, authUser);
  const photoURL = resolveEffectivePhotoURL(profile, authUser);

  if (avatarType === 'letter') {
    return { mode: 'initial', initial, displayName, avatarType: 'letter', src: '' };
  }
  if (photoURL) {
    return { mode: 'image', src: photoURL, initial, displayName, avatarType };
  }
  return { mode: 'initial', initial, displayName, avatarType: 'letter', src: '' };
}

function emptySocialLinks() {
  return { youtube: '', instagram: '', tiktok: '', website: '' };
}

export const FirestoreUserService = {
  async ensureUserDocument(user) {
    if (!user?.uid) return null;
    const ref = userDocRef(user.uid);
    if (!ref) return null;

    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existing = snap.data();
      const patch = {};
      if (!existing.email && user.email) patch.email = user.email;
      // 레거시: displayName만 있는 문서에 nickname dual-write
      if (!String(existing.nickname || '').trim() && String(existing.displayName || '').trim()) {
        Object.assign(patch, nicknameDualWriteFields(existing.displayName.trim().slice(0, 20)));
      }
      if (Object.keys(patch).length) {
        await setDoc(
          ref,
          sanitizeFirestorePayload(patch, 'FirestoreUserService.ensureUserDocument'),
          { merge: true },
        );
        return { ...existing, ...patch };
      }
      return existing;
    }

    const siteName = normalizeSiteNickname(
      user.displayName || user.email?.split('@')[0] || '',
      { fallback: '사용자' },
    );
    const nameFields = nicknameDualWriteFields(siteName);
    const googlePhotoURL = user.photoURL || '';
    const avatarType = googlePhotoURL ? 'google' : 'letter';
    const profileImageUrl = avatarType === 'google' ? googlePhotoURL : '';
    const normalized = normalizeWeeklyUsageRecord({}, FREE_ANALYSIS_LIMIT);
    const payload = {
      analysisQuotaWeekKey: normalized.currentWeekKey,
      analysisQuotaUsed: normalized.weeklyUsageCount,
      freeAnalysisRemaining: normalized.remaining,
      createdAt: serverTimestamp(),
      ...nameFields,
      email: user.email || '',
      profileImage: profileImageUrl,
      profileImageUrl,
      photoURL: profileImageUrl,
      uploadedPhotoURL: '',
      googlePhotoURL,
      profileImageType: avatarType,
      bio: '',
      socialLinks: emptySocialLinks(),
      publicRecipeCount: 0,
      avatarType,
    };
    await setDoc(
      ref,
      sanitizeFirestorePayload(payload, 'FirestoreUserService.ensureUserDocument'),
    );

    try {
      await FirestorePublicProfilesService.syncFromUserProfile(user.uid, {
        ...nameFields,
        profileImageUrl,
        bio: '',
        socialLinks: {},
      });
    } catch (err) {
      console.warn('[FirestoreUserService] public profile sync on ensure failed:', err);
    }

    return {
      ...payload,
      freeAnalysisRemaining: normalized.remaining,
      analysisQuotaWeekKey: normalized.currentWeekKey,
      analysisQuotaUsed: normalized.weeklyUsageCount,
    };
  },

  async getUserDocument(uid) {
    if (!uid) return null;
    const ref = userDocRef(uid);
    if (!ref) return null;
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  },

  async updateProfile(uid, updates = {}, options = {}) {
    if (!uid) return null;
    const ref = userDocRef(uid);
    if (!ref) return null;

    const payload = { updatedAt: serverTimestamp() };
    if (typeof updates.nickname === 'string' || typeof updates.displayName === 'string') {
      const siteName = normalizeSiteNickname(
        updates.nickname ?? updates.displayName,
      );
      if (siteName) Object.assign(payload, nicknameDualWriteFields(siteName));
    }
    if (typeof updates.profileImage === 'string') {
      payload.profileImage = updates.profileImage.trim();
      payload.profileImageUrl = payload.profileImage;
    }
    if (typeof updates.profileImageUrl === 'string') {
      payload.profileImageUrl = updates.profileImageUrl.trim();
      payload.profileImage = payload.profileImageUrl;
    }
    if (typeof updates.photoURL === 'string') payload.photoURL = updates.photoURL.trim();
    if (typeof updates.uploadedPhotoURL === 'string') {
      payload.uploadedPhotoURL = updates.uploadedPhotoURL.trim();
    }
    if (typeof updates.googlePhotoURL === 'string') {
      payload.googlePhotoURL = updates.googlePhotoURL.trim();
    }
    if (typeof updates.bio === 'string') payload.bio = updates.bio.trim().slice(0, 80);
    if (typeof updates.avatarType === 'string' || typeof updates.profileImageType === 'string') {
      const nextType = normalizeAvatarType(
        updates.avatarType ?? updates.profileImageType,
        { photoURL: options.photoURL || updates.googlePhotoURL },
      );
      payload.avatarType = nextType;
      payload.profileImageType = nextType;
    }
    if (typeof updates.email === 'string') payload.email = updates.email.trim();

    if (updates.socialLinks && typeof updates.socialLinks === 'object') {
      const linksResult = normalizeSocialLinks(updates.socialLinks);
      if (!linksResult.ok) {
        const err = new Error(linksResult.error);
        err.code = 'INVALID_SOCIAL_URL';
        throw err;
      }
      payload.socialLinks = linksResult.socialLinks;
    }

    await setDoc(
      ref,
      sanitizeFirestorePayload(payload, 'FirestoreUserService.updateProfile'),
      { merge: true },
    );

    const updated = await this.getUserDocument(uid);

    if (options.syncPublic !== false) {
      try {
        const authLike = { photoURL: options.photoURL || updated?.googlePhotoURL || '' };
        const effective = resolveEffectivePhotoURL(updated, authLike);
        await FirestorePublicProfilesService.syncFromUserProfile(uid, {
          ...(updated || payload),
          profileImageUrl: effective,
          profileImage: effective,
          photoURL: effective,
        });
      } catch (err) {
        console.warn('[FirestoreUserService] public profile sync failed:', err);
        if (err?.code === 'INVALID_SOCIAL_URL') throw err;
      }
    }

    return updated;
  },

  async getFreeAnalysisRemaining(uid) {
    const usage = await this.fetchAnalysisUsage(uid);
    return usage?.remaining ?? FREE_ANALYSIS_LIMIT;
  },

  async fetchAnalysisUsage(uid) {
    const data = await this.getUserDocument(uid);
    if (!data) {
      const normalized = normalizeWeeklyUsageRecord({}, FREE_ANALYSIS_LIMIT);
      return buildUsageDisplay(normalized, 'firestore');
    }
    return this.toUsageDisplay(data);
  },

  toUsageDisplay(data) {
    const normalized = normalizeWeeklyUsageRecord(data || {}, FREE_ANALYSIS_LIMIT);
    return buildUsageDisplay(normalized, 'firestore');
  },
};
