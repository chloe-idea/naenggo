import { getAiUsage, assertCanUseAi, recordAiUsage } from './ai-usage-limit.js';
import {
  assertCanUseFirestoreAnalysis,
  getFirestoreAnalysisUsage,
  recordFirestoreAnalysisUsage,
  resolveAuthUidFromToken,
} from './firestore-analysis-quota.js';
import { isFirebaseAdminConfigured } from './firebase-admin.js';

function mapDailyLimitError(err) {
  if (err.code === 'DAILY_LIMIT_EXCEEDED') {
    err.code = 'ANALYSIS_LIMIT_EXCEEDED';
    err.message = '오늘 무료 AI 분석 5회를 모두 사용했습니다.';
  }
  return err;
}

/**
 * @param {{ userId?: string, idToken?: string }} params
 */
export async function getAnalysisUsage({ userId, idToken } = {}) {
  const token = String(idToken || '').trim();
  if (token && isFirebaseAdminConfigured()) {
    const uid = await resolveAuthUidFromToken(token);
    if (uid) return getFirestoreAnalysisUsage(uid);
  }
  return getAiUsage(String(userId || '').trim());
}

/**
 * @param {{ userId?: string, idToken?: string }} params
 */
export async function assertCanUseAnalysis({ userId, idToken } = {}) {
  const token = String(idToken || '').trim();
  if (token && isFirebaseAdminConfigured()) {
    const uid = await resolveAuthUidFromToken(token);
    if (uid) return assertCanUseFirestoreAnalysis(uid);
  }

  try {
    return assertCanUseAi(String(userId || '').trim());
  } catch (err) {
    throw mapDailyLimitError(err);
  }
}

/**
 * @param {{ userId?: string, idToken?: string }} params
 */
export async function recordAnalysisUsage({ userId, idToken } = {}) {
  const token = String(idToken || '').trim();
  if (token && isFirebaseAdminConfigured()) {
    const uid = await resolveAuthUidFromToken(token);
    if (uid) return recordFirestoreAnalysisUsage(uid);
  }

  return recordAiUsage(String(userId || '').trim());
}

export function resolveIdTokenFromRequest(req) {
  const authHeader = String(req?.headers?.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return String(req?.body?.idToken || req?.headers?.['x-firebase-token'] || '').trim();
}

export function resolveIdTokenFromHeaders(headers = {}) {
  const authHeader = String(headers.authorization || headers.Authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return String(headers['x-firebase-token'] || '').trim();
}
