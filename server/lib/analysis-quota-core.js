import { getCurrentWeekKey, getWeeklyLimit } from './analysis-week-key.js';

export { getCurrentWeekKey, getWeeklyLimit };

/**
 * Firestore / 게스트 저장소 레코드를 현재 주 기준 usage로 정규화
 * @param {Record<string, unknown>|null|undefined} record
 * @param {number} [limit]
 */
export function normalizeWeeklyUsageRecord(record = {}, limit = getWeeklyLimit()) {
  const currentWeekKey = getCurrentWeekKey();
  const storedWeekKey = String(record?.analysisQuotaWeekKey || record?.weekKey || '').trim();
  const safeLimit = Math.max(1, Number(limit) || getWeeklyLimit());

  let weeklyUsageCount = 0;

  if (storedWeekKey === currentWeekKey) {
    if (record?.analysisQuotaUsed != null || record?.weeklyUsageCount != null) {
      weeklyUsageCount = Math.max(
        0,
        Number(record.analysisQuotaUsed ?? record.weeklyUsageCount) || 0,
      );
    } else if (record?.freeAnalysisRemaining != null) {
      weeklyUsageCount = Math.max(0, safeLimit - (Number(record.freeAnalysisRemaining) || 0));
    }
  } else if (storedWeekKey && storedWeekKey !== currentWeekKey) {
    weeklyUsageCount = 0;
  } else if (record?.freeAnalysisRemaining != null) {
    // 레거시(주차 키 없음): 새 주간 한도로 초기화 — 0회 고착 버그 방지
    weeklyUsageCount = 0;
  }

  weeklyUsageCount = Math.min(Math.max(0, weeklyUsageCount), safeLimit);
  const remaining = Math.max(0, safeLimit - weeklyUsageCount);

  return {
    currentWeekKey,
    weeklyUsageCount,
    remaining,
    limit: safeLimit,
    used: weeklyUsageCount,
    needsMigration:
      storedWeekKey !== currentWeekKey
      || Number(record?.analysisQuotaUsed ?? record?.weeklyUsageCount ?? -1) !== weeklyUsageCount
      || Number(record?.freeAnalysisRemaining ?? -1) !== remaining,
  };
}

export function buildUsageDisplay(normalized, source = 'firestore') {
  return {
    remaining: normalized.remaining,
    limit: normalized.limit,
    used: normalized.used,
    currentWeekKey: normalized.currentWeekKey,
    weeklyUsageCount: normalized.weeklyUsageCount,
    source,
  };
}

export function buildQuotaWritePayload(normalized) {
  return {
    analysisQuotaWeekKey: normalized.currentWeekKey,
    analysisQuotaUsed: normalized.weeklyUsageCount,
    freeAnalysisRemaining: normalized.remaining,
  };
}
