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
import {
  fetchYouTubeCaptionTranscript,
  logYouTubeCaptionDebug,
} from './youtube-captions.js';

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

/** watch / youtu.be / shorts 모두 동일 canonical watch URL로 정규화 */
function normalizeYouTubeUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function createBaseContent(videoId) {
  return {
    platform: 'youtube',
    videoId,
    title: '',
    thumbnailUrl: getYouTubeThumbnail(videoId),
    sourceUrl: normalizeYouTubeUrl(videoId),
    extractedDescription: '',
    extractedTranscript: '',
    text: '',
    textSource: '',
    combinedText: '',
    apiStatus: 'pending',
    extractionMode: 'legacy-scraper',
    autoExtractFailed: false,
    availableCaptionLanguages: [],
    selectedCaptionLanguage: null,
    captionFetchError: null,
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

/**
 * youtubei.js Innertube — title/description 수집 (transcript는 PoToken 경로 사용)
 */
async function fetchLegacyInnertubeContent(videoId) {
  const out = { title: '', description: '' };
  try {
    const yt = await getInnertube();
    const info = await yt.getInfo(videoId);

    out.title = String(info.basic_info?.title || '').trim();
    out.description = String(
      info.basic_info?.short_description
      || info.basic_info?.description
      || '',
    ).trim();
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
    availableCaptionLanguages: result.availableCaptionLanguages || [],
    selectedCaptionLanguage: result.selectedCaptionLanguage || null,
    captionTextLength: result.extractedTranscript.length,
    transcriptLength: result.extractedTranscript.length,
    transcriptPreview: result.extractedTranscript
      ? `${result.extractedTranscript.slice(0, 300)}${result.extractedTranscript.length > 300 ? '…' : ''}`
      : '(없음)',
    combinedTextLength: result.combinedText.length,
    captionFetchError: result.captionFetchError || null,
  });

  logVideoExtractPipeline({
    phase: 'youtube-fetch',
    platform: 'youtube',
    videoId,
    apiStatus,
    extractionMode,
    title: result.title,
    description: result.extractedDescription,
    captionText: result.extractedTranscript,
    transcriptText: result.extractedTranscript,
    combinedText: result.combinedText,
  });
}

/**
 * 영상 메타데이터 수집
 * 1) YOUTUBE_API_KEY 있으면 Data API로 title/description (선택)
 * 2) 없거나 실패 시 youtubei.js로 title/description
 * 3) 자막은 PoToken 대응 caption 경로로 별도 수집 (수동·자동 모두)
 */
export async function fetchYouTubeContent(url) {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    const err = new Error('유효한 YouTube videoId를 찾을 수 없습니다.');
    err.code = 'INVALID_VIDEO_ID';
    throw err;
  }

  console.log('[YouTube Extract] normalized videoId', {
    inputUrl: String(url || '').slice(0, 200),
    videoId,
    canonicalUrl: normalizeYouTubeUrl(videoId),
  });

  const result = createBaseContent(videoId);
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

  const needsLegacyMeta = !result.title
    || !result.extractedDescription
    || result.extractedDescription.length < 20;

  if (needsLegacyMeta) {
    const legacy = await fetchLegacyInnertubeContent(videoId);
    if (legacy.title && !result.title) result.title = legacy.title;
    if (legacy.description && (!result.extractedDescription || result.extractedDescription.length < legacy.description.length)) {
      result.extractedDescription = legacy.description;
    }
    if (extractionMode !== 'youtube-api' && (legacy.description || legacy.title)) {
      extractionMode = 'legacy-scraper';
    }
  }

  // 자막: Data API/innertube getTranscript 대신 PoToken 대응 경로 (항상 시도)
  const captionResult = await fetchYouTubeCaptionTranscript(videoId);
  result.availableCaptionLanguages = captionResult.availableCaptionLanguages;
  result.selectedCaptionLanguage = captionResult.selectedCaptionLanguage;
  result.captionFetchError = captionResult.error;
  if (captionResult.text && captionResult.text.length >= 20) {
    result.extractedTranscript = captionResult.text;
  }
  logYouTubeCaptionDebug({
    videoId,
    availableCaptionLanguages: captionResult.availableCaptionLanguages,
    selectedCaptionLanguage: captionResult.selectedCaptionLanguage,
    selectedCaptionKind: captionResult.selectedCaptionKind,
    captionTextLength: captionResult.captionTextLength,
    transcriptLength: captionResult.transcriptLength,
    transcriptText: captionResult.text,
    error: captionResult.error,
  });

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
