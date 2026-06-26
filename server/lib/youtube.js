import { Innertube } from 'youtubei.js';

const YOUTUBE_HOSTS = new Set(['youtu.be', 'youtube.com', 'm.youtube.com', 'music.youtube.com']);
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export const VIDEO_AUTO_EXTRACT_FAILED_WARNING =
  '영상 정보를 자동으로 읽지 못해 입력된 텍스트 기준으로 분석했습니다';

export const VIDEO_EXTRACT_HINT =
  '영상 설명글/캡션을 함께 붙여넣으면 더 정확합니다';

let innertubeClient = null;

async function getInnertube() {
  if (!innertubeClient) {
    innertubeClient = await Innertube.create({
      retrieve_player: false,
      lang: 'ko',
      location: 'KR',
    });
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

function normalizeYouTubeUrl(videoId, originalUrl) {
  try {
    return new URL(originalUrl).href;
  } catch {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
}

async function fetchYouTubeOEmbed(url) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title || '',
      thumbnailUrl: data.thumbnail_url || null,
    };
  } catch {
    return null;
  }
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
        /* try next language */
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
  } catch (err) {
    console.warn('[youtube] transcript unavailable:', err?.message || err);
  }

  return null;
}

function createBaseContent(videoId, url) {
  return {
    videoId,
    title: '',
    thumbnailUrl: getYouTubeThumbnail(videoId),
    sourceUrl: normalizeYouTubeUrl(videoId, url),
    extractedDescription: '',
    extractedTranscript: '',
    text: '',
    textSource: '',
    autoExtractFailed: false,
  };
}

/**
 * 영상 메타데이터 + 자막/설명 수집 (영상 파일 다운로드 없음)
 * youtubei.js 실패 시에도 throw 없이 최소 정보 반환
 */
export async function fetchYouTubeContent(url) {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    const err = new Error('유효한 YouTube videoId를 찾을 수 없습니다.');
    err.code = 'INVALID_VIDEO_ID';
    throw err;
  }

  const result = createBaseContent(videoId, url);
  let innertubeFailed = false;

  try {
    const yt = await getInnertube();
    const info = await yt.getInfo(videoId);

    result.title = info.basic_info?.title || result.title;
    const description = String(info.basic_info?.short_description || '').trim();
    if (description) result.extractedDescription = description;

    const transcriptResult = await fetchTranscriptText(info);
    if (transcriptResult) {
      result.extractedTranscript = transcriptResult.text;
      result.text = transcriptResult.text;
      result.textSource = `transcript:${transcriptResult.language}`;
    } else if (description.length >= 20) {
      result.text = description;
      result.textSource = 'description';
    }
  } catch (err) {
    innertubeFailed = true;
    console.warn('[youtube] innertube getInfo failed:', err?.message || err);
  }

  if (!result.title || innertubeFailed) {
    try {
      const oembed = await fetchYouTubeOEmbed(result.sourceUrl);
      if (oembed?.title) result.title = oembed.title;
      if (oembed?.thumbnailUrl) result.thumbnailUrl = oembed.thumbnailUrl;
    } catch (err) {
      console.warn('[youtube] oembed fallback failed:', err?.message || err);
    }
  }

  if (!result.text || innertubeFailed) {
    result.autoExtractFailed = true;
  }

  return result;
}

/** API body의 여러 텍스트 필드를 하나로 병합 */
export function mergeUserTextInput({ userText, caption, description, pastedText } = {}) {
  const chunks = [userText, caption, description, pastedText]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  const seen = new Set();
  const unique = [];
  for (const chunk of chunks) {
    if (seen.has(chunk)) continue;
    seen.add(chunk);
    unique.push(chunk);
  }
  return unique.join('\n\n');
}

/** OpenAI 프롬프트용 구조화 컨텍스트 */
export function buildAnalysisContext({ youtubeContent, url, userInputs = {} }) {
  const mergedUserText = mergeUserTextInput(userInputs);
  const extractedDescription = String(youtubeContent?.extractedDescription || '').trim()
    || (youtubeContent?.textSource === 'description' ? String(youtubeContent?.text || '').trim() : '');
  const extractedTranscript = String(youtubeContent?.extractedTranscript || '').trim()
    || (String(youtubeContent?.textSource || '').startsWith('transcript')
      ? String(youtubeContent?.text || '').trim()
      : '');

  const autoExtractFailed = Boolean(
    youtubeContent?.autoExtractFailed
    || (!extractedTranscript && !extractedDescription)
  );

  return {
    platform: 'youtube',
    sourceUrl: youtubeContent?.sourceUrl || url,
    thumbnailUrl: youtubeContent?.thumbnailUrl || null,
    title: youtubeContent?.title || '',
    extractedDescription,
    extractedTranscript,
    userText: mergedUserText,
    autoExtractFailed,
    hasUserText: mergedUserText.length >= 10,
  };
}
