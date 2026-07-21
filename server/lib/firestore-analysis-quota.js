import { FieldValue } from 'firebase-admin/firestore';
import {
  getFirestoreAdmin,
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
} from './firebase-admin.js';
import {
  ADMIN_UNLIMITED_USAGE,
  isActiveAdminUid,
  recordAdminAnalysisUsage,
} from './firestore-admin.js';
import {
  buildQuotaWritePayload,
  buildUsageDisplay,
  getWeeklyLimit,
  normalizeWeeklyUsageRecord,
} from './analysis-quota-core.js';

export const FREE_ANALYSIS_LIMIT = getWeeklyLimit();

const USERS_COLLECTION = 'users';

function usersRef(uid) {
  return getFirestoreAdmin().collection(USERS_COLLECTION).doc(uid);
}

async function maybeMigrateUserQuota(ref, data, normalized) {
  if (!normalized.needsMigration) return;
  try {
    await ref.set(buildQuotaWritePayload(normalized), { merge: true });
  } catch (err) {
    console.warn('[firestore-analysis-quota] migrate failed:', err?.message || err);
  }
}

export async function ensureFirestoreUser(uid, profile = {}) {
  const ref = usersRef(uid);
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() || {};
    const normalized = normalizeWeeklyUsageRecord(data, FREE_ANALYSIS_LIMIT);
    await maybeMigrateUserQuota(ref, data, normalized);
    return { ...data, ...buildQuotaWritePayload(normalized) };
  }

  const normalized = normalizeWeeklyUsageRecord({}, FREE_ANALYSIS_LIMIT);
  const payload = {
    ...buildQuotaWritePayload(normalized),
    createdAt: FieldValue.serverTimestamp(),
    displayName: String(profile.displayName || '').slice(0, 120),
    email: String(profile.email || '').slice(0, 200),
  };
  await ref.set(payload);
  return payload;
}

export async function getFirestoreAnalysisUsage(uid) {
  if (await isActiveAdminUid(uid)) {
    return { ...ADMIN_UNLIMITED_USAGE };
  }

  const ref = usersRef(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ensureFirestoreUser(uid);
    const normalized = normalizeWeeklyUsageRecord({}, FREE_ANALYSIS_LIMIT);
    return buildUsageDisplay(normalized, 'firestore');
  }

  const data = snap.data() || {};
  const normalized = normalizeWeeklyUsageRecord(data, FREE_ANALYSIS_LIMIT);
  await maybeMigrateUserQuota(ref, data, normalized);
  return buildUsageDisplay(normalized, 'firestore');
}

export async function assertCanUseFirestoreAnalysis(uid) {
  if (await isActiveAdminUid(uid)) {
    return { ...ADMIN_UNLIMITED_USAGE };
  }

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
  if (await isActiveAdminUid(uid)) {
    return recordAdminAnalysisUsage(uid);
  }

  const ref = usersRef(uid);
  let nextUsage = null;

  await getFirestoreAdmin().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const normalized = normalizeWeeklyUsageRecord(data, FREE_ANALYSIS_LIMIT);

    if (normalized.used >= normalized.limit) {
      const err = new Error('무료 AI 분석 횟수를 모두 사용했습니다.');
      err.code = 'ANALYSIS_LIMIT_EXCEEDED';
      err.aiUsage = buildUsageDisplay(normalized, 'firestore');
      throw err;
    }

    const next = {
      ...normalized,
      weeklyUsageCount: normalized.weeklyUsageCount + 1,
    };
    next.used = next.weeklyUsageCount;
    next.remaining = Math.max(0, next.limit - next.used);

    const payload = {
      ...buildQuotaWritePayload(next),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!snap.exists) {
      tx.set(ref, {
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
        displayName: '',
        email: '',
      });
    } else {
      tx.update(ref, payload);
    }

    nextUsage = buildUsageDisplay(next, 'firestore');
  });

  return nextUsage || getFirestoreAnalysisUsage(uid);
}

export async function resolveAuthUidFromToken(idToken) {
  if (!idToken || !isFirebaseAdminConfigured()) return null;
  const decoded = await verifyFirebaseIdToken(idToken);
  return decoded?.uid || null;
}
