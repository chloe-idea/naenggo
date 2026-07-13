/**
 * 작성자 SNS / 웹사이트 URL 검증·정규화
 */

const BLOCKED_SCHEMES = /^(javascript|data|vbscript|file|about):/i;

const HOST_RULES = {
  youtube: (host) => host === 'youtube.com' || host === 'www.youtube.com'
    || host === 'm.youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com'),
  instagram: (host) => host === 'instagram.com' || host === 'www.instagram.com'
    || host === 'm.instagram.com' || host.endsWith('.instagram.com'),
  tiktok: (host) => host === 'tiktok.com' || host === 'www.tiktok.com'
    || host === 'vm.tiktok.com' || host === 'm.tiktok.com' || host.endsWith('.tiktok.com'),
  website: () => true,
};

function stripDangerous(raw) {
  return String(raw || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
}

/**
 * @param {string} raw
 * @param {'youtube'|'instagram'|'tiktok'|'website'} kind
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function normalizeSocialUrl(raw, kind) {
  const trimmed = stripDangerous(raw);
  if (!trimmed) return { ok: true, url: '' };

  if (BLOCKED_SCHEMES.test(trimmed)) {
    return { ok: false, error: '허용되지 않는 링크 형식입니다.' };
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate.replace(/^\/+/, '')}`;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: '올바른 URL 형식이 아닙니다.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'https:// 로 시작하는 링크만 저장할 수 있어요.' };
  }

  const host = parsed.hostname.toLowerCase();
  const rule = HOST_RULES[kind];
  if (!rule || !rule(host)) {
    const hints = {
      youtube: 'YouTube 링크(youtube.com / youtu.be)만 입력해 주세요.',
      instagram: 'Instagram 링크(instagram.com)만 입력해 주세요.',
      tiktok: 'TikTok 링크(tiktok.com)만 입력해 주세요.',
      website: '올바른 웹사이트 주소를 입력해 주세요.',
    };
    return { ok: false, error: hints[kind] || '올바른 링크를 입력해 주세요.' };
  }

  parsed.hash = '';
  return { ok: true, url: parsed.toString() };
}

/**
 * @param {Record<string, string>|null|undefined} links
 * @returns {{ ok: true, socialLinks: object } | { ok: false, error: string }}
 */
export function normalizeSocialLinks(links = {}) {
  const keys = ['youtube', 'instagram', 'tiktok', 'website'];
  const out = {};
  for (const key of keys) {
    const result = normalizeSocialUrl(links[key], key);
    if (!result.ok) return result;
    if (result.url) out[key] = result.url;
  }
  return { ok: true, socialLinks: out };
}

export function socialLinkLabel(kind) {
  return ({
    youtube: 'YouTube',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    website: '웹사이트',
  })[kind] || kind;
}
