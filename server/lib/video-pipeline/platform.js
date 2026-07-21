/**
 * 플랫폼 감지 · videoId 추출 (서버/클라이언트 공통 로직)
 */
import { VideoPlatform } from './constants.js';

const YOUTUBE_HOSTS = new Set(['youtu.be', 'youtube.com', 'm.youtube.com', 'music.youtube.com']);
const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const INSTAGRAM_SHORTCODE_RE = /^[A-Za-z0-9_-]{5,20}$/;
const TIKTOK_HOSTS = new Set(['tiktok.com', 'vm.tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);

function normalizeUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;
  const href = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(href);
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.href;
  } catch {
    return href;
  }
}

export function isYouTubeHost(hostname) {
  const host = String(hostname || '').replace(/^www\./, '');
  if (YOUTUBE_HOSTS.has(host)) return true;
  return host.endsWith('.youtube.com');
}

export function isValidYouTubeVideoId(id) {
  return YOUTUBE_VIDEO_ID_RE.test(String(id || ''));
}

function extractYouTubeVideoIdFromParsedUrl(url) {
  const host = url.hostname.replace(/^www\./, '');
  if (!isYouTubeHost(url.hostname)) return null;

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split(/[/?#&]/)[0];
    return isValidYouTubeVideoId(id) ? id : null;
  }

  const fromQuery = url.searchParams.get('v');
  if (fromQuery) {
    const id = String(fromQuery).split(/[/?#&]/)[0];
    if (isValidYouTubeVideoId(id)) return id;
  }

  const pathMatch = url.pathname.match(/\/(?:embed|shorts|live|v)\/([^/?#&]+)/);
  if (pathMatch && isValidYouTubeVideoId(pathMatch[1])) return pathMatch[1];

  return null;
}

export function extractYouTubeVideoId(rawUrl) {
  try {
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) return null;
    return extractYouTubeVideoIdFromParsedUrl(new URL(normalized));
  } catch {
    return null;
  }
}

export function extractInstagramShortcode(rawUrl) {
  try {
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) return null;
    const url = new URL(normalized);
    if (url.hostname.replace(/^www\./, '') !== 'instagram.com') return null;

    const segments = url.pathname.split('/').filter(Boolean);
    const typeIdx = segments.findIndex((seg) => ['reel', 'reels', 'p', 'tv'].includes(seg.toLowerCase()));
    if (typeIdx >= 0 && segments[typeIdx + 1]) {
      const code = segments[typeIdx + 1].split(/[?#&]/)[0];
      return INSTAGRAM_SHORTCODE_RE.test(code) ? code : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function extractTikTokVideoId(rawUrl) {
  try {
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) return null;
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, '');
    if (!TIKTOK_HOSTS.has(host) && !host.endsWith('.tiktok.com')) return null;

    const pathMatch = url.pathname.match(/\/video\/(\d+)/);
    if (pathMatch) return pathMatch[1];

    const shortMatch = url.pathname.match(/\/(?:@[^/]+\/video|v)\/(\d+)/);
    if (shortMatch) return shortMatch[1];
  } catch {
    return null;
  }
  return null;
}

/**
 * @returns {'youtube'|'youtube_shorts'|'instagram_reels'|'tiktok'|'unknown'}
 */
export function detectVideoPlatform(rawUrl) {
  try {
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) return VideoPlatform.UNKNOWN;
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, '');

    if (TIKTOK_HOSTS.has(host) || host.endsWith('.tiktok.com')) {
      return VideoPlatform.TIKTOK;
    }

    if (host === 'instagram.com') {
      return extractInstagramShortcode(normalized)
        ? VideoPlatform.INSTAGRAM_REELS
        : VideoPlatform.UNKNOWN;
    }

    if (isYouTubeHost(url.hostname)) {
      if (/\/shorts\//i.test(url.pathname)) {
        return extractYouTubeVideoIdFromParsedUrl(url)
          ? VideoPlatform.YOUTUBE_SHORTS
          : VideoPlatform.UNKNOWN;
      }
      return extractYouTubeVideoIdFromParsedUrl(url)
        ? VideoPlatform.YOUTUBE
        : VideoPlatform.UNKNOWN;
    }

    return VideoPlatform.UNKNOWN;
  } catch {
    return VideoPlatform.UNKNOWN;
  }
}

/** 플랫폼별 고유 ID (YouTube videoId / Instagram shortcode / TikTok video id) */
export function extractVideoId(rawUrl, platform = null) {
  const resolved = platform || detectVideoPlatform(rawUrl);
  switch (resolved) {
    case VideoPlatform.YOUTUBE:
    case VideoPlatform.YOUTUBE_SHORTS:
      return extractYouTubeVideoId(rawUrl);
    case VideoPlatform.INSTAGRAM_REELS:
      return extractInstagramShortcode(rawUrl);
    case VideoPlatform.TIKTOK:
      return extractTikTokVideoId(rawUrl);
    default:
      return null;
  }
}

export function validateVideoUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) {
    return { ok: false, error: 'MISSING_URL', message: '영상 링크를 입력해 주세요.' };
  }

  let parsedHref;
  try {
    parsedHref = new URL(normalizeUrl(url)).href;
  } catch {
    return { ok: false, error: 'INVALID_URL', message: '올바른 URL 형식이 아닙니다.' };
  }

  const platform = detectVideoPlatform(parsedHref);
  if (platform === VideoPlatform.UNKNOWN) {
    return {
      ok: false,
      error: 'INVALID_URL',
      message: 'YouTube, YouTube Shorts, Instagram Reels, TikTok 링크만 지원합니다.',
    };
  }

  const videoId = extractVideoId(parsedHref, platform);
  if ((platform === VideoPlatform.YOUTUBE || platform === VideoPlatform.YOUTUBE_SHORTS) && !videoId) {
    return {
      ok: false,
      error: 'INVALID_VIDEO_ID',
      message: '올바른 YouTube 영상 링크가 아닙니다. (watch?v=, youtu.be/, shorts/ 형식)',
    };
  }
  if (platform === VideoPlatform.INSTAGRAM_REELS && !videoId) {
    return {
      ok: false,
      error: 'INVALID_SHORTCODE',
      message: '올바른 Instagram 릴스/게시물 링크가 아닙니다.',
    };
  }

  return {
    ok: true,
    url: parsedHref,
    platform,
    videoId,
  };
}

export function getYouTubeThumbnail(videoId) {
  if (!isValidYouTubeVideoId(videoId)) return null;
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}
