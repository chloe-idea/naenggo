import { Innertube } from 'youtubei.js';

const YOUTUBE_HOSTS = new Set(['youtu.be', 'youtube.com', 'm.youtube.com', 'music.youtube.com']);
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

let innertubeClient = null;

async function getInnertube() {
  if (!innertubeClient) {
    innertubeClient = await Innertube.create({ retrieve_player: false });
  }
  return innertubeClient;
}

export function isValidYouTubeVideoId(id) {
  return VIDEO_ID_RE.test(String(id || ''));
}

export function extractYouTubeVideoId(rawUrl) {
  try {
    const url = new URL(String(rawUrl).trim().startsWith('http') ? rawUrl : `https://${rawUrl}`);
    const host = url.hostname.replace(/^www\./, '');
    if (!YOUTUBE_HOSTS.has(host)) return null;

    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split(/[/?#&]/)[0];
      return isValidYouTubeVideoId(id) ? id : null;
    }

    const fromQuery = url.searchParams.get('v');
    if (fromQuery && isValidYouTubeVideoId(fromQuery)) return fromQuery;

    const pathMatch = url.pathname.match(/\/(?:embed|shorts|live|v)\/([^/?#&]+)/);
    if (pathMatch && isValidYouTubeVideoId(pathMatch[1])) return pathMatch[1];
  } catch {
    return null;
  }
  return null;
}

export function getYouTubeThumbnail(videoId) {
  if (!isValidYouTubeVideoId(videoId)) return null;
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

function transcriptToText(transcriptInfo) {
  const segments = transcriptInfo?.transcript?.content?.body?.initial_segments;
  if (!segments?.length) return '';
  return segments
    .map((seg) => seg.snippet?.text || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchTranscriptText(info) {
  try {
    let transcriptInfo = await info.getTranscript();
    const preferredLangs = ['한국어', 'Korean', 'English', 'English (auto-generated)', '日本語'];

    for (const lang of preferredLangs) {
      if (!transcriptInfo.languages?.includes(lang)) continue;
      try {
        transcriptInfo = await transcriptInfo.selectLanguage(lang);
        break;
      } catch {
        /* try next language label */
      }
    }

    const text = transcriptToText(transcriptInfo);
    if (text.length >= 20) {
      return {
        text,
        source: 'transcript',
        language: transcriptInfo.selectedLanguage || 'auto',
      };
    }
  } catch {
    /* no transcript available */
  }

  return null;
}

/**
 * 영상 메타데이터 + 자막/설명 텍스트 수집 (영상 파일 다운로드 없음)
 */
export async function fetchYouTubeContent(url) {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    const err = new Error('유효한 YouTube videoId를 찾을 수 없습니다.');
    err.code = 'INVALID_VIDEO_ID';
    throw err;
  }

  const yt = await getInnertube();
  let info;
  try {
    info = await yt.getInfo(videoId);
  } catch (cause) {
    const err = new Error('YouTube 영상 정보를 가져오지 못했습니다.');
    err.code = 'VIDEO_UNAVAILABLE';
    err.cause = cause;
    throw err;
  }

  const title = info.basic_info?.title || '';
  const description = String(info.basic_info?.short_description || '').trim();
  const thumbnailUrl = getYouTubeThumbnail(videoId);

  const transcriptResult = await fetchTranscriptText(info);
  let text = '';
  let textSource = '';

  if (transcriptResult) {
    text = transcriptResult.text;
    textSource = `transcript:${transcriptResult.language}`;
  } else if (description.length >= 20) {
    text = description;
    textSource = 'description';
  }

  if (text.length < 20) {
    const err = new Error(
      '아직 이 영상의 자막/설명을 자동으로 가져오지 못했어요. 영상 설명이나 자막을 붙여넣으면 레시피로 정리해드릴게요.'
    );
    err.code = 'NO_TEXT';
    err.fallback = true;
    throw err;
  }

  return {
    videoId,
    title,
    thumbnailUrl,
    sourceUrl: normalizeYouTubeUrl(videoId, url),
    text,
    textSource,
  };
}

function normalizeYouTubeUrl(videoId, originalUrl) {
  try {
    return new URL(originalUrl).href;
  } catch {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
}
