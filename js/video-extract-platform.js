/**
 * 영상 플랫폼 감지 · videoId 추출 (클라이언트 — server/lib/video-pipeline/platform.js 와 동기화)
 */
(function initVideoExtractPlatform(global) {
  const VideoPlatform = {
    YOUTUBE: 'youtube',
    YOUTUBE_SHORTS: 'youtube_shorts',
    INSTAGRAM_REELS: 'instagram_reels',
    TIKTOK: 'tiktok',
    UNKNOWN: 'unknown',
  };

  const PLATFORM_LABELS = {
    youtube: 'YouTube',
    youtube_shorts: 'YouTube Shorts',
    instagram_reels: 'Instagram Reels',
    tiktok: 'TikTok',
    unknown: '영상',
  };

  const VIDEO_EXTRACT_UI = {
    FALLBACK_MSG:
      '자동 추출이 어려운 영상이에요. 영상 설명글, 자막, 고정 댓글을 붙여넣으면 정리해드릴게요.',
    YOUTUBE_AUTO_HINT: 'YouTube·Shorts는 링크만으로 자동 추출을 시도합니다.',
    INSTAGRAM_HINT:
      'Instagram Reels는 링크만으로는 캡션을 가져오기 어려울 수 있어요. 캡션을 함께 붙여넣으면 정확합니다.',
    TIKTOK_HINT:
      'TikTok은 링크만으로는 추출이 어려울 수 있어요. 캡션·설명을 붙여넣어 주세요.',
    PARTIAL_CAPTION_HINT: '영상 설명글, 자막, 고정 댓글을 함께 붙여넣으면 더 정확합니다.',
  };

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

  function isYouTubeHost(hostname) {
    const host = String(hostname || '').replace(/^www\./, '');
    if (YOUTUBE_HOSTS.has(host)) return true;
    return host.endsWith('.youtube.com');
  }

  function isValidYouTubeVideoId(id) {
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

  function extractYouTubeVideoId(rawUrl) {
    try {
      const normalized = normalizeUrl(rawUrl);
      if (!normalized) return null;
      return extractYouTubeVideoIdFromParsedUrl(new URL(normalized));
    } catch {
      return null;
    }
  }

  function extractInstagramShortcode(rawUrl) {
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

  function extractTikTokVideoId(rawUrl) {
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

  function detectVideoPlatform(rawUrl) {
    try {
      const normalized = normalizeUrl(rawUrl);
      if (!normalized) return VideoPlatform.UNKNOWN;
      const url = new URL(normalized);
      const host = url.hostname.replace(/^www\./, '');

      if (TIKTOK_HOSTS.has(host) || host.endsWith('.tiktok.com')) return VideoPlatform.TIKTOK;
      if (host === 'instagram.com') {
        return extractInstagramShortcode(normalized) ? VideoPlatform.INSTAGRAM_REELS : VideoPlatform.UNKNOWN;
      }
      if (isYouTubeHost(url.hostname)) {
        if (/\/shorts\//i.test(url.pathname)) {
          return extractYouTubeVideoIdFromParsedUrl(url) ? VideoPlatform.YOUTUBE_SHORTS : VideoPlatform.UNKNOWN;
        }
        return extractYouTubeVideoIdFromParsedUrl(url) ? VideoPlatform.YOUTUBE : VideoPlatform.UNKNOWN;
      }
      return VideoPlatform.UNKNOWN;
    } catch {
      return VideoPlatform.UNKNOWN;
    }
  }

  function extractVideoId(rawUrl, platform) {
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

  function validateVideoUrl(rawUrl) {
    const url = String(rawUrl || '').trim();
    if (!url) return { ok: false, error: '영상 링크를 입력해 주세요.' };
    let parsedHref;
    try {
      parsedHref = new URL(normalizeUrl(url)).href;
    } catch {
      return { ok: false, error: '올바른 URL 형식이 아닙니다.' };
    }
    const platform = detectVideoPlatform(parsedHref);
    if (platform === VideoPlatform.UNKNOWN) {
      return { ok: false, error: 'YouTube, YouTube Shorts, Instagram Reels, TikTok 링크만 지원합니다.', errorCode: 'INVALID_URL' };
    }
    const videoId = extractVideoId(parsedHref, platform);
    const label = PLATFORM_LABELS[platform] || platform;
    if ((platform === VideoPlatform.YOUTUBE || platform === VideoPlatform.YOUTUBE_SHORTS) && !videoId) {
      return { ok: false, error: '올바른 YouTube 영상 링크가 아닙니다. (watch?v=, youtu.be/, shorts/ 형식)', errorCode: 'INVALID_URL' };
    }
    if (platform === VideoPlatform.INSTAGRAM_REELS && !videoId) {
      return { ok: false, error: '올바른 Instagram 릴스/게시물 링크가 아닙니다.', errorCode: 'INVALID_URL' };
    }
    return { ok: true, url: parsedHref, platform, platformLabel: label, videoId };
  }

  function getYouTubeThumbnail(videoId) {
    if (!videoId || !isValidYouTubeVideoId(videoId)) return null;
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }

  function supportsAutoExtract(platform) {
    return platform === VideoPlatform.YOUTUBE || platform === VideoPlatform.YOUTUBE_SHORTS;
  }

  function getPlatformHint(platform) {
    if (platform === VideoPlatform.YOUTUBE || platform === VideoPlatform.YOUTUBE_SHORTS) {
      return VIDEO_EXTRACT_UI.YOUTUBE_AUTO_HINT;
    }
    if (platform === VideoPlatform.INSTAGRAM_REELS) return VIDEO_EXTRACT_UI.INSTAGRAM_HINT;
    if (platform === VideoPlatform.TIKTOK) return VIDEO_EXTRACT_UI.TIKTOK_HINT;
    return VIDEO_EXTRACT_UI.PARTIAL_CAPTION_HINT;
  }

  const TRACKING_PARAMS = new Set([
    'fbclid', 'gclid', 'si', 'feature', 'igsh', 'igshid', 'ref', 'ref_src', 'ref_src_tws',
  ]);

  function shouldStripParam(key) {
    const lower = String(key || '').toLowerCase();
    if (TRACKING_PARAMS.has(lower)) return true;
    return lower.startsWith('utm_');
  }

  function stripTrackingParamsFromUrl(rawUrl) {
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

  function normalizeVideoSource(rawUrl) {
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

  function resolveRecipeNormalizedVideoId(recipe) {
    if (!recipe || typeof recipe !== 'object') return null;
    if (recipe.normalizedVideoId) return String(recipe.normalizedVideoId);
    const candidates = [recipe.sourceUrl, recipe.videoUrl, recipe.sourcePostUrl].filter(Boolean);
    for (const raw of candidates) {
      const norm = normalizeVideoSource(raw);
      if (norm?.normalizedVideoId) return norm.normalizedVideoId;
    }
    return null;
  }

  global.VideoExtractPlatform = {
    VideoPlatform,
    PLATFORM_LABELS,
    VIDEO_EXTRACT_UI,
    detectVideoPlatform,
    extractVideoId,
    extractYouTubeVideoId,
    extractInstagramShortcode,
    validateVideoUrl,
    getYouTubeThumbnail,
    supportsAutoExtract,
    getPlatformHint,
    normalizeVideoSource,
    resolveRecipeNormalizedVideoId,
    stripTrackingParamsFromUrl,
    isYouTubeHost,
    isValidYouTubeVideoId,
  };
})(typeof window !== 'undefined' ? window : globalThis);
