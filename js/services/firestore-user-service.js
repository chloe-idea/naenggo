/**
 * Firestore users/{uid} 문서 관리
 */
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { FREE_ANALYSIS_LIMIT, getFirebaseDb } from '../firebase.js';

const USERS_COLLECTION = 'users';

function userDocRef(uid) {
  const db = getFirebaseDb();
  if (!db || !uid) return null;
  return doc(db, USERS_COLLECTION, uid);
}

export const FirestoreUserService = {
  async ensureUserDocument(user) {
    if (!user?.uid) return null;
    const ref = userDocRef(user.uid);
    if (!ref) return null;

    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();

    const payload = {
      freeAnalysisRemaining: FREE_ANALYSIS_LIMIT,
      createdAt: serverTimestamp(),
      displayName: user.displayName || '',
      email: user.email || '',
    };
    await setDoc(ref, payload);
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
