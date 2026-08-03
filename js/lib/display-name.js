/**
 * 사이트 대표 표시명 결정 (닉네임 우선).
 * 우선순위:
 * userProfile.nickname → publicProfile.nickname →
 * user/public displayName(레거시) → storedName →
 * authUser.displayName → email @앞 → "사용자"
 */

export const DEFAULT_SITE_DISPLAY_NAME = '사용자';

export function emailLocalPart(email) {
  const raw = String(email || '').trim();
  if (!raw || !raw.includes('@')) return '';
  return raw.split('@')[0].trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

/**
 * @param {object} [opts]
 * @param {object|null} [opts.userProfile]
 * @param {object|null} [opts.publicProfile]
 * @param {object|null} [opts.authUser]
 * @param {string} [opts.storedName] authorName / savedBy name 등 스냅샷
 * @param {string} [opts.email]
 * @param {string} [opts.fallback]
 */
export function getDisplayName({
  userProfile = null,
  publicProfile = null,
  authUser = null,
  storedName = '',
  email = '',
  fallback = DEFAULT_SITE_DISPLAY_NAME,
} = {}) {
  const resolvedEmail = firstNonEmpty(
    email,
    userProfile?.email,
    authUser?.email,
  );
  return firstNonEmpty(
    userProfile?.nickname,
    publicProfile?.nickname,
    userProfile?.displayName,
    publicProfile?.displayName,
    storedName,
    authUser?.displayName,
    emailLocalPart(resolvedEmail),
    fallback,
  ) || fallback;
}

/** 프로필 문서에 저장할 nickname/displayName 페어 (dual-write) */
export function normalizeSiteNickname(value, { maxLen = 20, fallback = '' } = {}) {
  const text = String(value ?? '').trim().slice(0, maxLen);
  if (text) return text;
  return String(fallback || '').trim().slice(0, maxLen);
}

export function nicknameDualWriteFields(nickname) {
  const name = String(nickname || '').trim();
  if (!name) return {};
  return { nickname: name, displayName: name };
}
