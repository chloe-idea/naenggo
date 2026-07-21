/**
 * 영상 URL 정규화 — 중복 판별용 (server/lib/video-pipeline/platform.js 와 동기화)
 */
import { VideoPlatform } from './video-pipeline/constants.js';
import { validateVideoUrl } from './video-pipeline/platform.js';

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'si', 'feature', 'igsh', 'igshid', 'ref', 'ref_src', 'ref_src_tws',
]);

function shouldStripParam(key) {
  const lower = String(key || '').toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  return lower.startsWith('utm_');
}

export function stripTrackingParamsFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    [...url.searchParams.keys()].forEach((key) => {
      if (shouldStripParam(key)) url.searchParams.delete(key);
    });
    url.hash = '';
    let out = url.href;
    if (out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return String(rawUrl || '').trim();
  }
}

/**
 * @returns {{
 *   normalizedVideoId: string,
 *   normalizedSourceUrl: string,
 *   platform: string,
 *   videoId: string,
 *   sourceUrl: string,
 * } | null}
 */
export function normalizeVideoSource(rawUrl) {
  const validation = validateVideoUrl(rawUrl);
  if (!validation.ok) return null;

  const { platform, videoId, url } = validation;
  let normalizedVideoId = null;
  let normalizedSourceUrl = null;

  if (
    (platform === VideoPlatform.YOUTUBE || platform === VideoPlatform.YOUTUBE_SHORTS)
    && videoId
  ) {
    normalizedVideoId = `youtube:${videoId}`;
    normalizedSourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
  } else if (platform === VideoPlatform.INSTAGRAM_REELS && videoId) {
    normalizedVideoId = `instagram:${videoId}`;
    normalizedSourceUrl = `https://www.instagram.com/reel/${videoId}/`;
  } else if (platform === VideoPlatform.TIKTOK && videoId) {
    normalizedVideoId = `tiktok:${videoId}`;
    normalizedSourceUrl = stripTrackingParamsFromUrl(url);
  }

  if (!normalizedVideoId) return null;

  return {
    normalizedVideoId,
    normalizedSourceUrl,
    platform,
    videoId,
    sourceUrl: url,
  };
}

export function resolveRecipeNormalizedVideoId(recipe) {
  if (!recipe || typeof recipe !== 'object') return null;
  if (recipe.normalizedVideoId) return String(recipe.normalizedVideoId);
  const candidates = [recipe.sourceUrl, recipe.videoUrl, recipe.sourcePostUrl].filter(Boolean);
  for (const raw of candidates) {
    const norm = normalizeVideoSource(raw);
    if (norm?.normalizedVideoId) return norm.normalizedVideoId;
  }
  return null;
}
