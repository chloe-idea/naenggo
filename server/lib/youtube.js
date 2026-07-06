import { logYouTubeFetchDebug } from './video-extract-debug.js';
import {
  resolveExtractTextPriority,
  logExtractTextPreview,
} from './video-text-priority.js';
import { combineRecipeText, mergeUserTextInput } from './video-pipeline/recipe-text.js';
import {
  extractYouTubeVideoId,
  getYouTubeThumbnail,
  isValidYouTubeVideoId,
} from './video-pipeline/platform.js';
import { VIDEO_EXTRACT_UI } from './video-pipeline/constants.js';
import { buildAnalysisContextFromMetadata } from './video-pipeline/context.js';
import { logVideoExtractPipeline } from './video-pipeline/debug.js';

export {
  extractYouTubeVideoId,
  getYouTubeThumbnail,
  isValidYouTubeVideoId,
  mergeUserTextInput,
  combineRecipeText,
};

export const VIDEO_AUTO_EXTRACT_FAILED_WARNING = VIDEO_EXTRACT_UI.AUTO_EXTRACT_FAILED;
export const VIDEO_EXTRACT_HINT = VIDEO_EXTRACT_UI.PARTIAL_CAPTION_HINT;
export const YOUTUBE_DESCRIPTION_FETCH_FAILED_MSG = VIDEO_EXTRACT_UI.FALLBACK_MSG;

/** @typedef {'youtube-api'|'legacy-scraper'|'manual-text'|'failed'} ExtractionMode */

let innertubeClient = null;

function getYouTubeApiKey() {
  return String(process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

function normalizeYouTubeUrl(videoId, originalUrl) {
  try {
    return new URL(originalUrl).href;
  } catch {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
}

function createBaseContent(videoId, url) {
  return {
    platform: 'youtube',
    videoId,
    title: '',
    thumbnailUrl: getYouTubeThumbnail(videoId),
    sourceUrl: normalizeYouTubeUrl(videoId, url),
    extractedDescription: '',
    extractedTranscript: '',
    text: '',
    textSource: '',
    combinedText: '',
    apiStatus: 'pending',
    extractionMode: 'legacy-scraper',
    autoExtractFailed: false,
  };
}

async function getInnertube() {
  if (!innertubeClient) {
    const { Innertube } = await import('youtubei.js');
    innertubeClient = await Innertube.create({
      retrieve_player: false,
      lang: 'ko',
      location: 'KR',
    });
  }
  return innertubeClient;
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

async function fetchTranscriptFromInfo(info) {
  try {
    let transcriptInfo = await info.getTranscript();
    const preferredLangs = [
      '한국어',
      'Korean',
      'English',
      'English (auto-generated)',
      '日本語',
      'Auto-generated',
    ];

    const selectLanguage = async (lang) => {
      if (!transcriptInfo.languages?.includes(lang)) return null;
      try {
        return await transcriptInfo.selectLanguage(lang);
      } catch {
        return null;
      }
    };

    for (const lang of preferredLangs) {
      const selected = await selectLanguage(lang);
      if (selected) transcriptInfo = selected;
      const text = transcriptToText(transcriptInfo);
      if (text.length >= 20) {
        return {
          text,
          language: transcriptInfo.selectedLanguage || lang,
        };
      }
    }

    for (const lang of transcriptInfo.languages || []) {
      if (preferredLangs.includes(lang)) continue;
      const selected = await selectLanguage(lang);
      if (!selected) continue;
      transcriptInfo = selected;
      const text = transcriptToText(transcriptInfo);
      if (text.length >= 20) {
        return {
          text,
          language: lang,
        };
      }
    }
  } catch (err) {
    console.warn('[youtube] transcript unavailable:', err?.message || err);
  }
  return null;
}

/**
 * youtubei.js Innertube — API Key 없이 title/description/transcript 수집 (기존 방식)
 */
async function fetchLegacyInnertubeContent(videoId) {
  const out = { title: '', description: '', transcript: '' };
  try {
    const yt = await getInnertube();
    const info = await yt.getInfo(videoId);

    out.title = String(info.basic_info?.title || '').trim();
    out.description = String(
      info.basic_info?.short_description
      || info.basic_info?.description
      || '',
    ).trim();

    const transcriptResult = await fetchTranscriptFromInfo(info);
    if (transcriptResult) out.transcript = transcriptResult.text;
  } catch (err) {
    console.warn('[youtube] legacy innertube getInfo failed:', err?.message || err);
  }
  return out;
}

async function fetchYouTubeOEmbed(url) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
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

/**
 * YouTube Data API v3 (선택) — YOUTUBE_API_KEY 있을 때만 시도
 * @returns {Promise<object|null>}
 */
async function fetchVideoSnippetFromApi(videoId) {
  const apiKey = getYouTubeApiKey();
  if (!apiKey) return null;

  const apiUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  apiUrl.searchParams.set('part', 'snippet');
  apiUrl.searchParams.set('id', videoId);
  apiUrl.searchParams.set('key', apiKey);

  const res = await fetch(apiUrl);
  if (!res.ok) {
    const body = await res.text();
    console.warn('[youtube] YouTube Data API failed:', res.status, body.slice(0, 200));
    return null;
  }

  const data = await res.json();
  const item = data.items?.[0];
  if (!item?.snippet) return null;

  const snippet = item.snippet;
  return {
    title: String(snippet.title || '').trim(),
    description: String(snippet.description || '').trim(),
    thumbnailUrl: snippet.thumbnails?.high?.url
      || snippet.thumbnails?.medium?.url
      || snippet.thumbnails?.default?.url
      || getYouTubeThumbnail(videoId),
  };
}

function hasAutoExtractedContent(result) {
  return result.extractedDescription.length >= 20
    || result.extractedTranscript.length >= 20;
}

function logYouTubeExtraction({ extractionMode, videoId, result, apiStatus }) {
  console.log('[YouTube Extract]', {
    extractionMode,
    videoId,
    apiStatus,
    titleLength: result.title.length,
    descriptionLength: result.extractedDescription.length,
    transcriptLength: result.extractedTranscript.length,
    combinedTextLength: result.combinedText.length,
  });

  logVideoExtractPipeline({
    phase: 'youtube-fetch',
    platform: 'youtube',
    videoId,
    apiStatus,
    extractionMode,
    title: result.title,
    description: result.extractedDescription,
    transcriptText: result.extractedTranscript,
    combinedText: result.combinedText,
  });
}

/**
 * 영상 메타데이터 수집
 * 1) YOUTUBE_API_KEY 있으면 Data API 시도 (선택)
 * 2) 없거나 실패 시 youtubei.js legacy fallback (API Key 불필요)
 */
export async function fetchYouTubeContent(url) {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    const err = new Error('유효한 YouTube videoId를 찾을 수 없습니다.');
    err.code = 'INVALID_VIDEO_ID';
    throw err;
  }

  const result = createBaseContent(videoId, url);
  let extractionMode = 'legacy-scraper';
  let apiStatus = getYouTubeApiKey() ? 'api-attempted' : 'no-api-key';

  const apiSnippet = await fetchVideoSnippetFromApi(videoId);
  if (apiSnippet) {
    result.title = apiSnippet.title;
    result.extractedDescription = apiSnippet.description;
    if (apiSnippet.thumbnailUrl) result.thumbnailUrl = apiSnippet.thumbnailUrl;
    extractionMode = 'youtube-api';
    apiStatus = 'ok';
  }

  const needsLegacy = !result.title
    || !result.extractedDescription
    || result.extractedDescription.length < 20
    || !result.extractedTranscript;

  if (needsLegacy) {
    const legacy = await fetchLegacyInnertubeContent(videoId);
    if (legacy.title && !result.title) result.title = legacy.title;
    if (legacy.description && (!result.extractedDescription || result.extractedDescription.length < legacy.description.length)) {
      result.extractedDescription = legacy.description;
    }
    if (legacy.transcript && !result.extractedTranscript) {
      result.extractedTranscript = legacy.transcript;
    }
    if (extractionMode !== 'youtube-api' && (legacy.description || legacy.transcript || legacy.title)) {
      extractionMode = 'legacy-scraper';
    }
  }

  if (!result.title) {
    try {
      const oembed = await fetchYouTubeOEmbed(result.sourceUrl);
      if (oembed?.title) result.title = oembed.title;
      if (oembed?.thumbnailUrl) result.thumbnailUrl = oembed.thumbnailUrl;
    } catch (err) {
      console.warn('[youtube] oembed fallback failed:', err?.message || err);
    }
  }

  result.apiStatus = apiStatus;
  result.extractionMode = extractionMode;

  const combinedText = combineRecipeText({
    title: result.title,
    description: result.extractedDescription,
    transcript: result.extractedTranscript,
  });

  const resolved = resolveExtractTextPriority({
    title: result.title,
    extractedDescription: result.extractedDescription,
    extractedTranscript: result.extractedTranscript,
  });

  result.text = resolved.primaryAnalysisText;
  result.textSource = resolved.textSource;
  result.combinedText = combinedText;
  result.rawTitle = resolved.rawTitle;
  result.rawDescription = resolved.rawDescription;

  logExtractTextPreview({
    rawTitle: resolved.rawTitle,
    rawDescription: resolved.rawDescription,
    combinedText,
    textSource: resolved.textSource,
    phase: 'youtube-fetch',
  });

  result.autoExtractFailed = !hasAutoExtractedContent(result);

  if (result.autoExtractFailed && !combinedText.trim()) {
    result.extractionMode = 'failed';
  }

  logYouTubeExtraction({ extractionMode: result.extractionMode, videoId, result, apiStatus });
  logYouTubeFetchDebug(result, url);
  return result;
}

/** @deprecated buildAnalysisContextFromMetadata 사용 */
export function buildAnalysisContext({ youtubeContent, url, userInputs = {} }) {
  return buildAnalysisContextFromMetadata({
    metadata: youtubeContent,
    url,
    userInputs,
  });
}
