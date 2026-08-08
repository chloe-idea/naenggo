/**
 * YouTube watch HTML → ytInitialPlayerResponse 파싱
 * Vercel 등 datacenter IP에서 youtubei.js / get-youtube-transcript 가 빈 결과를
 * 줄 때의 metadata·caption track fallback용.
 */
import { isValidYouTubeVideoId } from './video-pipeline/platform.js';

const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function extractJsonAfter(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < html.length; j++) {
    const ch = html[j];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(i, j + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeLangCode(code) {
  return String(code || '').toLowerCase().split(/[-_]/)[0];
}

/**
 * Vercel datacenter IP 에서는 player 가 LOGIN_REQUIRED 로 videoDetails 가 비어도
 * ytInitialData engagement panel 에 description 이 남는 경우가 있다.
 */
function findDescriptionInTree(obj, depth = 0) {
  if (!obj || depth > 16) return '';
  if (typeof obj === 'string') return '';

  const attributed = obj?.attributedDescriptionBodyText?.content
    || obj?.expandedContent?.attributedDescriptionBodyText?.content;
  if (attributed && String(attributed).trim().length >= 20) {
    return String(attributed).trim();
  }
  if (obj.shortDescription && String(obj.shortDescription).trim().length >= 20) {
    return String(obj.shortDescription).trim();
  }
  if (obj.description?.simpleText && String(obj.description.simpleText).trim().length >= 20) {
    return String(obj.description.simpleText).trim();
  }
  if (Array.isArray(obj.description?.runs)) {
    const joined = obj.description.runs.map((r) => r?.text || '').join('').trim();
    if (joined.length >= 20) return joined;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findDescriptionInTree(item, depth + 1);
      if (found) return found;
    }
    return '';
  }

  for (const key of Object.keys(obj)) {
    if (key === 'responseContext' || key === 'trackingParams' || key === 'frameworkUpdates') {
      continue;
    }
    const found = findDescriptionInTree(obj[key], depth + 1);
    if (found) return found;
  }
  return '';
}

function findTitleInInitialData(initialData) {
  const contents = initialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
  if (!Array.isArray(contents)) return '';
  for (const item of contents) {
    const primary = item?.videoPrimaryInfoRenderer;
    if (!primary) continue;
    const runs = primary?.title?.runs;
    if (Array.isArray(runs)) {
      const title = runs.map((r) => r?.text || '').join('').trim();
      if (title) return title;
    }
    const simple = String(primary?.title?.simpleText || '').trim();
    if (simple) return simple;
  }
  return '';
}

function mapCaptionTracks(rawTracks) {
  if (!Array.isArray(rawTracks)) return [];
  return rawTracks.map((track) => ({
    languageCode: String(track.languageCode || '').trim(),
    kind: track.kind === 'asr' ? 'asr' : 'manual',
    name: String(track.name?.simpleText || track.name || '').trim(),
    baseUrl: String(track.baseUrl || '').trim(),
  })).filter((t) => t.baseUrl);
}

/**
 * @param {string} videoId
 * @returns {Promise<{
 *   ok: boolean,
 *   title: string,
 *   description: string,
 *   captionTracks: Array<{ languageCode: string, kind: string, name: string, baseUrl: string }>,
 *   error: string|null,
 *   source: string|null,
 * }>}
 */
export async function fetchYouTubeWatchPageData(videoId) {
  const empty = {
    ok: false,
    title: '',
    description: '',
    captionTracks: [],
    error: null,
    source: null,
  };

  if (!isValidYouTubeVideoId(videoId)) {
    return { ...empty, error: 'INVALID_VIDEO_ID' };
  }

  try {
    const watchRes = await fetch(
      `https://www.youtube.com/watch?v=${videoId}&hl=ko&bpctr=9999999999&has_verified=1`,
      {
        headers: {
          'User-Agent': WEB_UA,
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
          Cookie: 'CONSENT=YES+cb; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',
        },
      },
    );
    if (!watchRes.ok) {
      return { ...empty, error: `WATCH_HTTP_${watchRes.status}` };
    }

    const html = await watchRes.text();
    if (!html || html.length < 500) {
      return { ...empty, error: 'WATCH_HTML_EMPTY' };
    }

    const playerResponse = extractJsonAfter(html, 'ytInitialPlayerResponse = ')
      || extractJsonAfter(html, 'var ytInitialPlayerResponse = ');
    const initialData = extractJsonAfter(html, 'ytInitialData = ')
      || extractJsonAfter(html, 'var ytInitialData = ');

    const details = playerResponse?.videoDetails || {};
    let title = String(details.title || '').trim();
    let description = String(
      details.shortDescription
      || details.description
      || '',
    ).trim();
    let source = (title || description) ? 'ytInitialPlayerResponse' : null;

    const captionTracks = mapCaptionTracks(
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks,
    );

    // LOGIN_REQUIRED 등으로 player videoDetails 가 비어도 ytInitialData 에 설명이 있을 수 있음
    if (description.length < 20 && initialData) {
      const fromInitial = findDescriptionInTree(initialData);
      if (fromInitial.length > description.length) {
        description = fromInitial;
        source = source ? `${source}+ytInitialData` : 'ytInitialData';
      }
    }
    if (!title && initialData) {
      title = findTitleInInitialData(initialData);
      if (title && !source) source = 'ytInitialData';
    }

    if (!playerResponse && !initialData) {
      return { ...empty, error: 'PLAYER_RESPONSE_MISSING' };
    }

    return {
      ok: Boolean(title || description || captionTracks.length),
      title,
      description,
      captionTracks,
      error: null,
      source,
    };
  } catch (err) {
    console.warn('[youtube-watch-page] fetch failed:', err?.message || err);
    return { ...empty, error: err?.message || 'WATCH_FETCH_FAILED' };
  }
}

/**
 * caption track baseUrl → 자막 텍스트
 * @param {string} baseUrl
 */
export async function fetchCaptionTextFromBaseUrl(baseUrl) {
  if (!baseUrl) return '';
  try {
    const url = new URL(baseUrl);
    // json3 가 가장 파싱이 안정적
    if (!url.searchParams.get('fmt')) {
      url.searchParams.set('fmt', 'json3');
    }
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': WEB_UA,
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) return '';
    const body = await res.text();
    if (!body) return '';

    // json3
    try {
      const data = JSON.parse(body);
      const events = Array.isArray(data?.events) ? data.events : [];
      const parts = [];
      for (const event of events) {
        const segs = event?.segs;
        if (!Array.isArray(segs)) continue;
        for (const seg of segs) {
          const t = String(seg?.utf8 || '').trim();
          if (t) parts.push(t);
        }
      }
      const text = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (text) return text;
    } catch {
      // fall through to XML / plain
    }

    // srv3 / ttml-ish: strip tags
    const stripped = body
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    return stripped.length >= 20 ? stripped : '';
  } catch (err) {
    console.warn('[youtube-watch-page] caption baseUrl fetch failed:', err?.message || err);
    return '';
  }
}

/**
 * ko → en → 나머지 순으로 track 선택
 * @param {Array<{ languageCode: string, kind: string, baseUrl: string }>} tracks
 */
export function pickPreferredCaptionTrack(tracks = []) {
  if (!Array.isArray(tracks) || !tracks.length) return null;
  const preferred = ['ko', 'en'];
  for (const lang of preferred) {
    const manual = tracks.find((t) => normalizeLangCode(t.languageCode) === lang && t.kind !== 'asr');
    if (manual) return manual;
    const asr = tracks.find((t) => normalizeLangCode(t.languageCode) === lang);
    if (asr) return asr;
  }
  return tracks[0] || null;
}

/**
 * youtubei.js 파서를 거치지 않는 raw InnerTube player 호출.
 * Vercel datacenter IP 에서는 key 없는 player 요청이 400 이 되는 경우가 많아
 * YouTube WEB 클라이언트가 쓰는 공개 Innertube API key 를 붙인다.
 */
export async function fetchInnerTubePlayerMeta(videoId) {
  const empty = { ok: false, title: '', description: '', captionTracks: [], error: null };
  if (!isValidYouTubeVideoId(videoId)) {
    return { ...empty, error: 'INVALID_VIDEO_ID' };
  }

  // YouTube WEB 임베드/클라이언트가 사용하는 공개 Innertube key (비밀키 아님)
  const INNERTUBE_WEB_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

  const clients = [
    {
      clientName: 'WEB',
      clientVersion: '2.20240411.09.00',
      headers: {
        'User-Agent': WEB_UA,
        'X-Youtube-Client-Name': '1',
        'X-Youtube-Client-Version': '2.20240411.09.00',
        Origin: 'https://www.youtube.com',
        Referer: 'https://www.youtube.com/',
      },
      extra: {},
    },
    {
      clientName: 'ANDROID',
      clientVersion: '19.09.37',
      headers: {
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
        'X-Youtube-Client-Name': '3',
        'X-Youtube-Client-Version': '19.09.37',
      },
      extra: { androidSdkVersion: 30 },
    },
  ];

  let lastError = null;
  for (const client of clients) {
    try {
      const endpoint = `https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=${INNERTUBE_WEB_KEY}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
          ...client.headers,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: client.clientName,
              clientVersion: client.clientVersion,
              hl: 'ko',
              gl: 'KR',
              ...client.extra,
            },
          },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });

      if (!res.ok) {
        lastError = `PLAYER_HTTP_${res.status}`;
        continue;
      }

      const data = await res.json();
      const details = data?.videoDetails || {};
      const title = String(details.title || '').trim();
      const description = String(details.shortDescription || details.description || '').trim();
      const rawTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      const captionTracks = rawTracks.map((track) => ({
        languageCode: String(track.languageCode || '').trim(),
        kind: track.kind === 'asr' ? 'asr' : 'manual',
        name: String(track.name?.simpleText || track.name || '').trim(),
        baseUrl: String(track.baseUrl || '').trim(),
      })).filter((t) => t.baseUrl);

      if (title || description || captionTracks.length) {
        return {
          ok: true,
          title,
          description,
          captionTracks,
          error: null,
          clientName: client.clientName,
          playability: data?.playabilityStatus?.status || null,
        };
      }
      lastError = `PLAYER_EMPTY_${client.clientName}`;
    } catch (err) {
      lastError = err?.message || 'PLAYER_FETCH_FAILED';
      console.warn('[youtube-watch-page] innertube player failed:', client.clientName, lastError);
    }
  }

  return { ...empty, error: lastError || 'PLAYER_EMPTY' };
}

export { normalizeLangCode };
