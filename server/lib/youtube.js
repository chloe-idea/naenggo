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
import {
  fetchYouTubeWatchPageData,
  fetchInnerTubePlayerMeta,
  fetchCaptionTextFromBaseUrl,
  pickPreferredCaptionTrack,
} from './youtube-watch-page.js';
import { logVideoExtractStep, summarizeExtractLengths } from './video-extract-trace.js';

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

/** @type {Map<string, any>} */
const innertubeClients = new Map();

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

async function getInnertube(clientType = 'WEB') {
  const key = String(clientType || 'WEB');
  if (innertubeClients.has(key)) return innertubeClients.get(key);

  const mod = await import('youtubei.js');
  const { Innertube, ClientType } = mod;
  const resolvedType = ClientType?.[key] || ClientType?.WEB || key;
  const client = await Innertube.create({
    retrieve_player: false,
    lang: 'ko',
    location: 'KR',
    ...(resolvedType ? { client_type: resolvedType } : {}),
  });
  innertubeClients.set(key, client);
  return client;
}

/**
 * youtubei.js 내부 console.error 스택을 warn 한 줄로 낮춘다.
 * LOGIN_REQUIRED / parser 실패는 정상 provider failure.
 */
async function withQuietYoutubeiLogs(fn) {
  const originalError = console.error;
  console.error = (...args) => {
    const joined = args.map((a) => {
      if (a instanceof Error) return a.message || String(a);
      return typeof a === 'string' ? a : String(a);
    }).join(' ');
    if (/YOUTUBEJS|InnertubeError|PlayerErrorCommand/i.test(joined)) {
      console.warn('[youtube] youtubei.js provider failed:', joined.slice(0, 180));
      return;
    }
    originalError.apply(console, args);
  };
  try {
    return await fn();
  } finally {
    console.error = originalError;
  }
}

/**
 * youtubei.js Innertube — title/description 수집
 * Vercel datacenter IP 에서는 WEB 클라이언트가 빈 결과를 줄 수 있어
 * ANDROID / TV 순으로 재시도한다. 실패는 warn 후 다음 metadata provider로.
 */
async function fetchLegacyInnertubeContent(videoId) {
  const out = { title: '', description: '', clientType: null };
  const clientOrder = ['WEB', 'ANDROID', 'TV'];

  for (const clientType of clientOrder) {
    try {
      const info = await withQuietYoutubeiLogs(async () => {
        const yt = await getInnertube(clientType);
        return typeof yt.getBasicInfo === 'function'
          ? await yt.getBasicInfo(videoId)
          : await yt.getInfo(videoId);
      });

      const title = String(info.basic_info?.title || '').trim();
      const description = String(
        info.basic_info?.short_description
        || info.basic_info?.description
        || '',
      ).trim();

      if (title && !out.title) out.title = title;
      if (description && description.length > out.description.length) {
        out.description = description;
      }
      if (title || description) {
        out.clientType = clientType;
        console.log('[youtube] innertube meta ok', {
          clientType,
          titleLength: title.length,
          descriptionLength: description.length,
        });
      }
      if (out.description.length >= 20) break;
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 180);
      console.warn(`[youtube] youtubei.js:${clientType} provider failed:`, msg);
    }
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
 * YouTube source 수집 (local/prod 동일 순서)
 *
 * Metadata fallback:
 *   1) YOUTUBE_API_KEY 있으면 Data API (optional, title/description only — transcript 아님)
 *   2) youtubei.js (WEB → ANDROID → TV)
 *   3) raw InnerTube player
 *   4) watch HTML (ytInitialPlayerResponse → ytInitialData description)
 *   5) oembed (title only)
 *
 * Transcript fallback (별도):
 *   1) get-youtube-transcript
 *   2) watch-html / player captionTracks timedtext
 *   실패 시 description-only 로 AI 진행 (steps 추측 금지)
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
  let metadataProvider = null;
  let transcriptProvider = null;

  logVideoExtractStep('04 youtube metadata start', { videoId, apiStatus });

  const apiSnippet = await fetchVideoSnippetFromApi(videoId);
  if (apiSnippet) {
    result.title = apiSnippet.title;
    result.extractedDescription = apiSnippet.description;
    if (apiSnippet.thumbnailUrl) result.thumbnailUrl = apiSnippet.thumbnailUrl;
    extractionMode = 'youtube-api';
    apiStatus = 'ok';
    metadataProvider = 'youtube-data-api';
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
      metadataProvider = legacy.clientType
        ? `youtubei.js:${legacy.clientType}`
        : 'youtubei.js';
    }
  }

  // Vercel: youtubei.js 파서/WEB 클라이언트 실패 시 raw InnerTube player → watch HTML
  let playerCaptionTracks = [];
  if (!result.extractedDescription || result.extractedDescription.length < 20) {
    const playerMeta = await fetchInnerTubePlayerMeta(videoId);
    if (playerMeta.title && !result.title) result.title = playerMeta.title;
    if (playerMeta.description && playerMeta.description.length > result.extractedDescription.length) {
      result.extractedDescription = playerMeta.description;
      if (extractionMode !== 'youtube-api') {
        extractionMode = 'legacy-scraper';
        metadataProvider = `innertube-player:${playerMeta.clientName || 'WEB'}`;
      }
    }
    playerCaptionTracks = playerMeta.captionTracks || [];
    console.log('[youtube] innertube-player meta fallback', {
      ok: playerMeta.ok,
      error: playerMeta.error || null,
      clientName: playerMeta.clientName || null,
      playability: playerMeta.playability || null,
      titleLength: String(playerMeta.title || '').length,
      descriptionLength: String(playerMeta.description || '').length,
      captionTrackCount: playerCaptionTracks.length,
    });
  }

  if (!result.extractedDescription || result.extractedDescription.length < 20) {
    const watchPage = await fetchYouTubeWatchPageData(videoId);
    if (watchPage.title && !result.title) result.title = watchPage.title;
    if (watchPage.description && watchPage.description.length > result.extractedDescription.length) {
      result.extractedDescription = watchPage.description;
      if (extractionMode !== 'youtube-api') {
        extractionMode = 'legacy-scraper';
        metadataProvider = watchPage.source
          ? `watch-html:${watchPage.source}`
          : 'watch-html';
      }
    }
    if (!playerCaptionTracks.length && watchPage.captionTracks?.length) {
      playerCaptionTracks = watchPage.captionTracks;
    }
    console.log('[youtube] watch-html meta fallback', {
      ok: watchPage.ok,
      error: watchPage.error || null,
      source: watchPage.source || null,
      titleLength: String(watchPage.title || '').length,
      descriptionLength: String(watchPage.description || '').length,
      captionTrackCount: watchPage.captionTracks?.length || 0,
    });
  }

  logVideoExtractStep('05 youtube metadata complete', {
    ...summarizeExtractLengths({
      title: result.title,
      description: result.extractedDescription,
      videoId,
      apiStatus,
      extractionMode,
      ok: Boolean(result.title || result.extractedDescription),
    }),
    metadataProvider,
  });

  // 자막: get-youtube-transcript → watch-html timedtext
  logVideoExtractStep('06 transcript start', { videoId });
  const captionResult = await fetchYouTubeCaptionTranscript(videoId);
  result.availableCaptionLanguages = captionResult.availableCaptionLanguages;
  result.selectedCaptionLanguage = captionResult.selectedCaptionLanguage;
  result.captionFetchError = captionResult.error;
  transcriptProvider = captionResult.provider || null;
  if (captionResult.text && captionResult.text.length >= 20) {
    result.extractedTranscript = captionResult.text;
  }

  // get-youtube-transcript / watch-html 실패 시 InnerTube player captionTracks 사용
  if (result.extractedTranscript.length < 20 && playerCaptionTracks.length) {
    const preferred = pickPreferredCaptionTrack(playerCaptionTracks);
    const ordered = preferred
      ? [preferred, ...playerCaptionTracks.filter((t) => t.baseUrl !== preferred.baseUrl)]
      : playerCaptionTracks;
    for (const track of ordered) {
      const text = await fetchCaptionTextFromBaseUrl(track.baseUrl);
      if (text.length >= 20) {
        result.extractedTranscript = text;
        result.availableCaptionLanguages = [...new Set(
          playerCaptionTracks.map((t) => t.languageCode).filter(Boolean),
        )];
        result.selectedCaptionLanguage = track.languageCode || null;
        result.captionFetchError = null;
        transcriptProvider = 'innertube-player-timedtext';
        break;
      }
    }
  }

  logVideoExtractStep('07 transcript complete', {
    videoId,
    transcriptLength: result.extractedTranscript.length,
    captionTextLength: result.extractedTranscript.length,
    ok: result.extractedTranscript.length >= 20,
    errorCode: result.extractedTranscript.length >= 20
      ? null
      : (captionResult.error || 'YOUTUBE_TRANSCRIPT_FAILED'),
    transcriptProvider,
  });
  logYouTubeCaptionDebug({
    videoId,
    availableCaptionLanguages: result.availableCaptionLanguages,
    selectedCaptionLanguage: result.selectedCaptionLanguage,
    selectedCaptionKind: captionResult.selectedCaptionKind,
    captionTextLength: result.extractedTranscript.length,
    transcriptLength: result.extractedTranscript.length,
    transcriptText: result.extractedTranscript,
    error: result.extractedTranscript.length >= 20 ? null : (captionResult.error || null),
    provider: transcriptProvider,
  });

  if (!result.title) {
    try {
      const oembed = await fetchYouTubeOEmbed(result.sourceUrl);
      if (oembed?.title) {
        result.title = oembed.title;
        if (!metadataProvider) metadataProvider = 'oembed';
      }
      if (oembed?.thumbnailUrl) result.thumbnailUrl = oembed.thumbnailUrl;
    } catch (err) {
      console.warn('[youtube] oembed fallback failed:', err?.message || err);
    }
  }

  result.apiStatus = apiStatus;
  result.extractionMode = extractionMode;
  result.metadataProvider = metadataProvider || 'none';
  result.transcriptProvider = transcriptProvider || 'none';

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

  const finalSourceFields = [
    result.title ? 'title' : null,
    result.extractedDescription.length >= 20 ? 'description' : null,
    result.extractedTranscript.length >= 20 ? 'transcript' : null,
  ].filter(Boolean);

  console.log('[YouTube SourceCompare]', {
    videoId,
    titleLength: result.title.length,
    descriptionLength: result.extractedDescription.length,
    captionTextLength: result.extractedTranscript.length,
    transcriptLength: result.extractedTranscript.length,
    combinedTextLength: result.combinedText.length,
    metadataProvider: result.metadataProvider,
    transcriptProvider: result.transcriptProvider,
    finalSourceFieldsUsed: finalSourceFields,
    textSource: result.textSource,
    autoExtractFailed: result.autoExtractFailed,
  });

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
