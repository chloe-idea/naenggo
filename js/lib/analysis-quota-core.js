import { getCurrentWeekKey, getWeeklyLimit } from './analysis-week-key.js';

export { getCurrentWeekKey, getWeeklyLimit };

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
