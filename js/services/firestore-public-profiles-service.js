/**
 * publicProfiles/{uid} — 공개 작성자 프로필 (비로그인 포함 읽기)
 * SNS·소개는 프로필에만 저장하고 레시피에는 authorId로 연결합니다.
 */
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  query,
  where,
  documentId,
  serverTimestamp,
  increment,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { db } from '../firebase.js';
import { timestampToIso, nowIso } from './firestore-timestamp.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';
import { normalizeSocialLinks } from '../lib/social-url.js';

const COLLECTION = 'publicProfiles';
const DEFAULT_DISPLAY_NAME = '냉장GO 사용자';

/** @type {Map<string, { profile: object|null, fetchedAt: number }>} */
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function profileRef(uid) {
  if (!db || !uid) return null;
  return doc(db, COLLECTION, uid);
}

function mapPublicProfile(uid, data = {}) {
  const socialLinks = data.socialLinks && typeof data.socialLinks === 'object'
    ? {
      youtube: data.socialLinks.youtube || '',
      instagram: data.socialLinks.instagram || '',
      tiktok: data.socialLinks.tiktok || '',
      website: data.socialLinks.website || '',
    }
    : {};

  return {
    id: uid,
    displayName: String(data.displayName || '').trim() || DEFAULT_DISPLAY_NAME,
    profileImageUrl: String(data.profileImageUrl || data.profileImage || '').trim(),
    bio: String(data.bio || '').trim().slice(0, 80),
    socialLinks,
    publicRecipeCount: Math.max(0, Number(data.publicRecipeCount) || 0),
    createdAt: timestampToIso(data.createdAt) || nowIso(),
    updatedAt: timestampToIso(data.updatedAt) || nowIso(),
  };
}

function cacheGet(uid) {
  const entry = cache.get(uid);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(uid);
    return undefined;
  }
  return entry.profile;
}

function cacheSet(uid, profile) {
  cache.set(uid, { profile, fetchedAt: Date.now() });
}

/** 카드용 경량 정보만 */
export function toAuthorCardInfo(profile, fallback = {}) {
  const displayName = String(
    profile?.displayName
    || fallback.authorName
    || fallback.nickname
    || fallback.displayName
    || '',
  ).trim() || DEFAULT_DISPLAY_NAME;

  const profileImageUrl = String(
    profile?.profileImageUrl
    || fallback.profileImageUrl
    || fallback.profileImage
    || fallback.authorGooglePhotoURL
    || '',
  ).trim();

  return {
    authorId: profile?.id || fallback.authorId || '',
    displayName,
    profileImageUrl,
  };
}

export const FirestorePublicProfilesService = {
  DEFAULT_DISPLAY_NAME,

  clearCache(uid = null) {
    if (uid) cache.delete(uid);
    else cache.clear();
  },

  /** 동기 캐시 조회 (카드 렌더용) — 없으면 undefined */
  peek(uid) {
    if (!uid) return undefined;
    return cacheGet(uid);
  },

  async getById(uid, { force = false, includeSocial = true } = {}) {
    if (!uid || !db) return null;
    if (!force) {
      const cached = cacheGet(uid);
      if (cached !== undefined) {
        if (!includeSocial && cached) {
          return {
            id: cached.id,
            displayName: cached.displayName,
            profileImageUrl: cached.profileImageUrl,
            publicRecipeCount: cached.publicRecipeCount,
          };
        }
        return cached;
      }
    }

    const ref = profileRef(uid);
    if (!ref) return null;
    const snap = await getDoc(ref);
    const profile = snap.exists() ? mapPublicProfile(uid, snap.data()) : null;
    cacheSet(uid, profile);
    if (!includeSocial && profile) {
      return {
        id: profile.id,
        displayName: profile.displayName,
        profileImageUrl: profile.profileImageUrl,
        publicRecipeCount: profile.publicRecipeCount,
      };
    }
    return profile;
  },

  /**
   * authorId 목록을 묶어 일괄 조회 (Firestore `in` 최대 30개씩)
   * @returns {Map<string, object|null>}
   */
  async getMany(uids = [], { force = false } = {}) {
    const result = new Map();
    const unique = [...new Set((uids || []).map((id) => String(id || '').trim()).filter(Boolean))];
    const missing = [];

    for (const uid of unique) {
      if (!force) {
        const cached = cacheGet(uid);
        if (cached !== undefined) {
          result.set(uid, cached);
          continue;
        }
      }
      missing.push(uid);
    }

    if (!db || !missing.length) return result;

    const chunkSize = 30;
    for (let i = 0; i < missing.length; i += chunkSize) {
      const chunk = missing.slice(i, i + chunkSize);
      try {
        const q = query(
          collection(db, COLLECTION),
          where(documentId(), 'in', chunk),
        );
        const snap = await getDocs(q);
        const found = new Set();
        snap.docs.forEach((d) => {
          const profile = mapPublicProfile(d.id, d.data());
          cacheSet(d.id, profile);
          result.set(d.id, profile);
          found.add(d.id);
        });
        chunk.forEach((uid) => {
          if (!found.has(uid)) {
            cacheSet(uid, null);
            result.set(uid, null);
          }
        });
      } catch (err) {
        console.warn('[FirestorePublicProfilesService] getMany failed, falling back', err);
        await Promise.all(chunk.map(async (uid) => {
          const profile = await this.getById(uid, { force: true });
          result.set(uid, profile);
        }));
      }
    }

    return result;
  },

  /**
   * 소유자 프로필 → publicProfiles 동기화
   */
  async syncFromUserProfile(uid, userDoc = {}, options = {}) {
    if (!uid || !db) return null;
    const ref = profileRef(uid);
    if (!ref) return null;

    const linksResult = normalizeSocialLinks(userDoc.socialLinks || {});
    if (!linksResult.ok) {
      const err = new Error(linksResult.error);
      err.code = 'INVALID_SOCIAL_URL';
      throw err;
    }

    const displayName = String(userDoc.displayName || '').trim().slice(0, 20);
    const profileImageUrl = String(
      userDoc.profileImageUrl || userDoc.profileImage || '',
    ).trim();
    const bio = String(userDoc.bio || '').trim().slice(0, 80);

    const existing = await getDoc(ref);
    const payload = {
      displayName: displayName || DEFAULT_DISPLAY_NAME,
      profileImageUrl,
      bio,
      socialLinks: linksResult.socialLinks,
      updatedAt: serverTimestamp(),
    };

    if (!existing.exists()) {
      payload.createdAt = serverTimestamp();
      if (typeof options.publicRecipeCount === 'number') {
        payload.publicRecipeCount = Math.max(0, options.publicRecipeCount);
      } else {
        payload.publicRecipeCount = 0;
      }
    } else if (typeof options.publicRecipeCount === 'number') {
      payload.publicRecipeCount = Math.max(0, options.publicRecipeCount);
    }

    await setDoc(
      ref,
      sanitizeFirestorePayload(payload, 'FirestorePublicProfilesService.syncFromUserProfile'),
      { merge: true },
    );

    const synced = mapPublicProfile(uid, {
      ...payload,
      publicRecipeCount: payload.publicRecipeCount
        ?? existing.data()?.publicRecipeCount
        ?? 0,
      createdAt: existing.exists() ? existing.data()?.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    cacheSet(uid, synced);
    return synced;
  },

  async adjustPublicRecipeCount(uid, delta) {
    if (!uid || !db || !delta) return;
    const ref = profileRef(uid);
    if (!ref) return;
    await setDoc(
      ref,
      sanitizeFirestorePayload({
        publicRecipeCount: increment(delta),
        updatedAt: serverTimestamp(),
      }, 'FirestorePublicProfilesService.adjustPublicRecipeCount'),
      { merge: true },
    );
    cache.delete(uid);
  },
};
