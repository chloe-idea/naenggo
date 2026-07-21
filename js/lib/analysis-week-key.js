/**
 * AI 분석 주간 한도 — Asia/Seoul 기준 ISO 주차 (월요일 00:00~)
 */
export const ANALYSIS_QUOTA_TIMEZONE = 'Asia/Seoul';

export function getWeeklyLimit() {
  const fromConfig = typeof APP_CONFIG !== 'undefined'
    ? Number(APP_CONFIG?.videoExtract?.weeklyLimit ?? APP_CONFIG?.videoExtract?.dailyLimit)
    : NaN;
  if (Number.isFinite(fromConfig) && fromConfig > 0) return fromConfig;
  return 5;
}

export function getZonedDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ANALYSIS_QUOTA_TIMEZONE }).format(date);
}

export function getCurrentWeekKey(date = new Date()) {
  const dateKey = getZonedDateKey(date);
  const [year, month, day] = dateKey.split('-').map(Number);
  const local = new Date(year, month - 1, day);
  local.setHours(0, 0, 0, 0);

  const thursday = new Date(local);
  thursday.setDate(local.getDate() + 3 - ((local.getDay() + 6) % 7));

  const weekYear = thursday.getFullYear();
  const week1 = new Date(weekYear, 0, 4);
  week1.setHours(0, 0, 0, 0);
  const weekNo = 1 + Math.round(
    ((thursday - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7,
  );

  return `${weekYear}-W${String(weekNo).padStart(2, '0')}`;
}
