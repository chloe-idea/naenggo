/** YYYY-MM 월 예산 헬퍼 (순수 함수 — 클라이언트/테스트 공유) */

export function toMonthKey(year, monthIndex0) {
  const y = Number(year);
  const m = Number(monthIndex0) + 1;
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return '';
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function currentMonthKey(date = new Date()) {
  return toMonthKey(date.getFullYear(), date.getMonth());
}

export function normalizeBudgetByMonth(raw) {
  const map = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return map;
  Object.entries(raw).forEach(([key, value]) => {
    const match = /^(\d{4})-(\d{2})$/.exec(key);
    if (!match) return;
    const month = Number(match[2]);
    if (month < 1 || month > 12) return;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return;
    map[key] = amount;
  });
  return map;
}

/**
 * 레거시 monthlyFoodBudget → budgetByMonth[현재월] 1회 투영.
 * 기존 monthlyFoodBudget 필드는 삭제하지 않는다.
 */
export function resolveBudgetByMonthFromSettings(data = {}, fallbackMonthKey = currentMonthKey()) {
  const map = normalizeBudgetByMonth(data.budgetByMonth);
  const hasMap = Object.keys(map).length > 0;
  if (hasMap) {
    return { budgetByMonth: map, migrated: false };
  }
  const legacy = Number(data.monthlyFoodBudget);
  if (Number.isFinite(legacy) && legacy > 0 && fallbackMonthKey) {
    return {
      budgetByMonth: { [fallbackMonthKey]: legacy },
      migrated: true,
    };
  }
  return { budgetByMonth: map, migrated: false };
}

export function budgetForMonth(budgetByMonth, monthKey) {
  if (!monthKey) return 0;
  const amount = Number(budgetByMonth?.[monthKey]);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}
