/** YYYY-MM 월 예산 헬퍼 (순수 함수 — 클라이언트/테스트 공유) */

/** @param {number} year @param {number} monthIndex0 0=1월 … 11=12월 (Date#getMonth) */
export function toMonthKey(year, monthIndex0) {
  const y = Number(year);
  const m = Number(monthIndex0) + 1;
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return '';
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** 로컬 달력 기준 YYYY-MM (UTC 변환 사용 금지) */
export function getMonthKey(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return toMonthKey(date.getFullYear(), date.getMonth());
}

/** @deprecated 이름 호환 — getMonthKey와 동일 */
export function currentMonthKey(date = new Date()) {
  return getMonthKey(date);
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
 * setDoc(merge)에 `budgetByMonth.YYYY-MM` 점 표기 키를 넣으면
 * nested map이 아니라 리터럴 필드명으로 저장된다.
 * 문서 전체에서 올바른 map + 잘못된 dotted 필드를 합쳐 복구한다.
 */
export function coerceBudgetByMonthFromDoc(data = {}) {
  const map = normalizeBudgetByMonth(data?.budgetByMonth);
  if (!data || typeof data !== 'object') return map;
  Object.entries(data).forEach(([key, value]) => {
    const match = /^budgetByMonth\.(\d{4}-\d{2})$/.exec(key);
    if (!match) return;
    const monthKey = match[1];
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return;
    if (!Object.prototype.hasOwnProperty.call(map, monthKey)) {
      map[monthKey] = amount;
    }
  });
  return map;
}

/** 문서에 남은 잘못된 dotted 필드명 목록 */
export function listDottedBudgetFieldKeys(data = {}) {
  if (!data || typeof data !== 'object') return [];
  return Object.keys(data).filter((key) => /^budgetByMonth\.\d{4}-\d{2}$/.test(key));
}

/**
 * 레거시 monthlyFoodBudget → 서버 마이그레이션용 페이로드만 계산.
 * 클라이언트 state에 가짜 월 키를 주입하지 않는다 (migrated여도 budgetByMonth는 원본 map).
 */
export function resolveBudgetByMonthFromSettings(data = {}, fallbackMonthKey = getMonthKey()) {
  const map = coerceBudgetByMonthFromDoc(data);
  if (Object.keys(map).length > 0) {
    return { budgetByMonth: map, migrated: false, migrationMap: null };
  }
  const legacy = Number(data.monthlyFoodBudget);
  if (Number.isFinite(legacy) && legacy > 0 && fallbackMonthKey) {
    return {
      budgetByMonth: map,
      migrated: true,
      migrationMap: { [fallbackMonthKey]: legacy },
    };
  }
  return { budgetByMonth: map, migrated: false, migrationMap: null };
}

/**
 * @param {Record<string, number>} budgetByMonth
 * @param {string} monthKey
 * @param {{ legacyMonthly?: number, legacyOnlyForMonthKey?: string }} [options]
 *   legacy는 legacyOnlyForMonthKey(기본: 오늘 월)에만 적용. 다른 달에 복사하지 않음.
 */
export function budgetForMonth(budgetByMonth, monthKey, options = {}) {
  if (!monthKey) return 0;
  if (
    budgetByMonth
    && typeof budgetByMonth === 'object'
    && Object.prototype.hasOwnProperty.call(budgetByMonth, monthKey)
  ) {
    const amount = Number(budgetByMonth[monthKey]);
    return Number.isFinite(amount) && amount >= 0 ? amount : 0;
  }
  const legacyMonth = options.legacyOnlyForMonthKey || getMonthKey();
  const legacy = Number(options.legacyMonthly);
  if (monthKey === legacyMonth && Number.isFinite(legacy) && legacy > 0) {
    return legacy;
  }
  return 0;
}
