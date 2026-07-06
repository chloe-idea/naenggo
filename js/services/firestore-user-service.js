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
import { sanitizeFirestorePayload } from './firestore-payload.js';

const USERS_COLLECTION = 'users';
const AVATAR_TYPES = new Set(['initial', 'fridge', 'google']);

function userDocRef(uid) {
  if (!db || !uid) return null;
  return doc(db, USERS_COLLECTION, uid);
}

function normalizeAvatarType(value, authUser) {
  const type = String(value || '').trim();
  if (AVATAR_TYPES.has(type)) return type;
  return authUser?.photoURL ? 'google' : 'fridge';
}

export function resolveProfileAvatar(profile, authUser) {
  const displayName = String(
    profile?.displayName || authUser?.displayName || authUser?.email?.split('@')[0] || '회원',
  ).trim();
  const initial = (displayName.charAt(0) || '냉').toUpperCase();
  const avatarType = normalizeAvatarType(profile?.avatarType, authUser);

  if (avatarType === 'google' && authUser?.photoURL) {
    return { mode: 'image', src: authUser.photoURL, initial, displayName, avatarType };
  }
  if (profile?.profileImage) {
    return { mode: 'image', src: profile.profileImage, initial, displayName, avatarType: 'custom' };
  }
  if (avatarType === 'fridge') {
    return { mode: 'emoji', emoji: '🧊', initial, displayName, avatarType };
  }
  return { mode: 'initial', initial, displayName, avatarType: 'initial' };
}

export const FirestoreUserService = {
  async ensureUserDocument(user) {
    if (!user?.uid) return null;
    const ref = userDocRef(user.uid);
    if (!ref) return null;

    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existing = snap.data();
      if (!existing.email && user.email) {
        await setDoc(
          ref,
          sanitizeFirestorePayload({ email: user.email }, 'FirestoreUserService.ensureUserDocument'),
          { merge: true },
        );
        return { ...existing, email: user.email };
      }
      return existing;
    }

    const payload = {
      freeAnalysisRemaining: FREE_ANALYSIS_LIMIT,
      createdAt: serverTimestamp(),
      displayName: user.displayName || user.email?.split('@')[0] || '',
      email: user.email || '',
      profileImage: user.photoURL || '',
      avatarType: user.photoURL ? 'google' : 'fridge',
    };
    await setDoc(
      ref,
      sanitizeFirestorePayload(payload, 'FirestoreUserService.ensureUserDocument'),
    );
    return {
      ...payload,
      freeAnalysisRemaining: FREE_ANALYSIS_LIMIT,
    };
  },

  async getUserDocument(uid) {
    if (!uid) return null;
    const ref = userDocRef(uid);
    if (!ref) return null;
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  },

  async updateProfile(uid, updates = {}) {
    if (!uid) return null;
    const ref = userDocRef(uid);
    if (!ref) return null;

    const payload = { updatedAt: serverTimestamp() };
    if (typeof updates.displayName === 'string') payload.displayName = updates.displayName.trim().slice(0, 20);
    if (typeof updates.profileImage === 'string') payload.profileImage = updates.profileImage.trim();
    if (typeof updates.avatarType === 'string' && AVATAR_TYPES.has(updates.avatarType)) {
      payload.avatarType = updates.avatarType;
    }
    if (typeof updates.email === 'string') payload.email = updates.email.trim();

    await setDoc(
      ref,
      sanitizeFirestorePayload(payload, 'FirestoreUserService.updateProfile'),
      { merge: true },
    );
    return this.getUserDocument(uid);
  },

  async getFreeAnalysisRemaining(uid) {
    const data = await this.getUserDocument(uid);
    if (!data) return FREE_ANALYSIS_LIMIT;
    const remaining = Number(data.freeAnalysisRemaining);
    return Number.isFinite(remaining) ? Math.max(0, remaining) : FREE_ANALYSIS_LIMIT;
  },

  toUsageDisplay(remaining) {
    const safe = Math.max(0, Number(remaining) || 0);
    return {
      remaining: safe,
      limit: FREE_ANALYSIS_LIMIT,
      used: Math.max(0, FREE_ANALYSIS_LIMIT - safe),
      source: 'firestore',
    };
  },
};
