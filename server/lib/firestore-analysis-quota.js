import { FieldValue } from 'firebase-admin/firestore';
import {
  getFirestoreAdmin,
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
} from './firebase-admin.js';

export const FREE_ANALYSIS_LIMIT = Math.max(
  1,
  Number(process.env.FREE_ANALYSIS_LIMIT) || 5
);

const USERS_COLLECTION = 'users';

function usersRef(uid) {
  return getFirestoreAdmin().collection(USERS_COLLECTION).doc(uid);
}

export async function ensureFirestoreUser(uid, profile = {}) {
  const ref = usersRef(uid);
  const snap = await ref.get();
  if (snap.exists) return snap.data();

  const payload = {
    freeAnalysisRemaining: FREE_ANALYSIS_LIMIT,
    createdAt: FieldValue.serverTimestamp(),
    displayName: String(profile.displayName || '').slice(0, 120),
    email: String(profile.email || '').slice(0, 200),
  };
  await ref.set(payload);
  return payload;
}

export async function getFirestoreAnalysisUsage(uid) {
  const ref = usersRef(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ensureFirestoreUser(uid);
    return {
      remaining: FREE_ANALYSIS_LIMIT,
      limit: FREE_ANALYSIS_LIMIT,
      used: 0,
      source: 'firestore',
    };
  }

  const data = snap.data() || {};
  const remaining = Math.max(0, Number(data.freeAnalysisRemaining) || 0);
  return {
    remaining,
    limit: FREE_ANALYSIS_LIMIT,
    used: Math.max(0, FREE_ANALYSIS_LIMIT - remaining),
    source: 'firestore',
  };
}

export async function assertCanUseFirestoreAnalysis(uid) {
  const usage = await getFirestoreAnalysisUsage(uid);
  if (usage.remaining <= 0) {
    const err = new Error('무료 AI 분석 횟수를 모두 사용했습니다. 로그인 계정의 분석 한도를 확인해 주세요.');
    err.code = 'ANALYSIS_LIMIT_EXCEEDED';
    err.aiUsage = usage;
    throw err;
  }
  return usage;
}

export async function recordFirestoreAnalysisUsage(uid) {
  const ref = usersRef(uid);
  await getFirestoreAdmin().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, {
        freeAnalysisRemaining: FREE_ANALYSIS_LIMIT - 1,
        createdAt: FieldValue.serverTimestamp(),
        displayName: '',
        email: '',
      });
      return;
    }
    const current = Math.max(0, Number(snap.data()?.freeAnalysisRemaining) || 0);
    if (current <= 0) {
      const err = new Error('무료 AI 분석 횟수를 모두 사용했습니다.');
      err.code = 'ANALYSIS_LIMIT_EXCEEDED';
      throw err;
    }
    tx.update(ref, {
      freeAnalysisRemaining: current - 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return getFirestoreAnalysisUsage(uid);
}

export async function resolveAuthUidFromToken(idToken) {
  if (!idToken || !isFirebaseAdminConfigured()) return null;
  const decoded = await verifyFirebaseIdToken(idToken);
  return decoded?.uid || null;
}
