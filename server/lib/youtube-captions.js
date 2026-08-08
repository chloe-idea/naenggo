/**
 * YouTube 자막(caption/transcript) 수집
 * fallback: get-youtube-transcript → watch-html timedtext
 * LOGIN_REQUIRED 등 datacenter IP 차단은 정상 provider failure (warn)로 처리
 */

import { getTranscript } from 'get-youtube-transcript';
import { isValidYouTubeVideoId } from './video-pipeline/platform.js';
import {
  fetchCaptionTextFromBaseUrl,
  fetchYouTubeWatchPageData,
  pickPreferredCaptionTrack,
  normalizeLangCode,
} from './youtube-watch-page.js';

const PREFERRED_LANGUAGES = ['ko', 'en'];

function classifyCaptionProviderError(err) {
  const raw = String(err?.message || err || '');
  if (/LOGIN_REQUIRED/i.test(raw)) return 'LOGIN_REQUIRED';
  if (/no captions/i.test(raw)) return 'NO_CAPTION_TRACKS';
  if (/rate-limiting|Could not parse the watch page/i.test(raw)) return 'WATCH_PAGE_BLOCKED';
  if (/Empty transcript/i.test(raw)) return 'EMPTY_TRANSCRIPT';
  return 'CAPTION_PROVIDER_FAILED';
}

/**
 * @param {string} videoId
 * @returns {Promise<{
 *   text: string,
 *   availableCaptionLanguages: string[],
 *   selectedCaptionLanguage: string|null,
 *   selectedCaptionKind: string|null,
 *   captionTextLength: number,
 *   transcriptLength: number,
 *   error: string|null,
 *   provider: string|null,
 * }>}
 */
export async function fetchYouTubeCaptionTranscript(videoId) {
  const empty = {
    text: '',
    availableCaptionLanguages: [],
    selectedCaptionLanguage: null,
    selectedCaptionKind: null,
    captionTextLength: 0,
    transcriptLength: 0,
    error: null,
    provider: null,
  };

  if (!isValidYouTubeVideoId(videoId)) {
    return { ...empty, error: 'INVALID_VIDEO_ID' };
  }

  // 1) watch HTML track list (metadata에도 재사용 가능하도록 먼저)
  const watchPage = await fetchYouTubeWatchPageData(videoId);
  const tracks = watchPage.captionTracks || [];
  const availableCaptionLanguages = [...new Set(
    tracks.map((t) => {
      const code = normalizeLangCode(t.languageCode) || t.languageCode;
      return t.kind === 'asr' ? `${code}(asr)` : code;
    }).filter(Boolean),
  )];

  // 2) get-youtube-transcript — track list 실패와 무관하게 항상 시도
  try {
    const result = await getTranscript(videoId, { languages: PREFERRED_LANGUAGES });
    const text = String(result?.text || '').replace(/\s+/g, ' ').trim();
    if (text.length >= 20) {
      return {
        text,
        availableCaptionLanguages: availableCaptionLanguages.length
          ? availableCaptionLanguages
          : (result?.language ? [result.language] : []),
        selectedCaptionLanguage: result?.language || null,
        selectedCaptionKind: result?.kind || null,
        captionTextLength: text.length,
        transcriptLength: text.length,
        error: null,
        provider: 'get-youtube-transcript',
      };
    }
  } catch (err) {
    const code = classifyCaptionProviderError(err);
    console.warn('[youtube-captions] get-youtube-transcript provider failed:', code);
  }

  // 3) watch HTML captionTracks.baseUrl 직접 fetch
  const preferred = pickPreferredCaptionTrack(tracks);
  if (preferred?.baseUrl) {
    const text = await fetchCaptionTextFromBaseUrl(preferred.baseUrl);
    if (text.length >= 20) {
      return {
        text,
        availableCaptionLanguages,
        selectedCaptionLanguage: preferred.languageCode || null,
        selectedCaptionKind: preferred.kind || null,
        captionTextLength: text.length,
        transcriptLength: text.length,
        error: null,
        provider: 'watch-html-timedtext',
      };
    }
  }

  // 4) 남은 track 순회
  for (const track of tracks) {
    if (preferred && track.baseUrl === preferred.baseUrl) continue;
    const text = await fetchCaptionTextFromBaseUrl(track.baseUrl);
    if (text.length >= 20) {
      return {
        text,
        availableCaptionLanguages,
        selectedCaptionLanguage: track.languageCode || null,
        selectedCaptionKind: track.kind || null,
        captionTextLength: text.length,
        transcriptLength: text.length,
        error: null,
        provider: 'watch-html-timedtext',
      };
    }
  }

  let error = 'NO_CAPTION_TRACKS';
  if (tracks.length) error = 'EMPTY_TRANSCRIPT';
  else if (watchPage.error) error = watchPage.error;

  console.warn('[youtube-captions] transcript unavailable, falling back to description:', error);

  return {
    ...empty,
    availableCaptionLanguages,
    error,
    provider: null,
  };
}

/**
 * 자막 수집 결과 디버그 로그 (토큰/키 출력 금지)
 */
export function logYouTubeCaptionDebug({
  videoId,
  availableCaptionLanguages = [],
  selectedCaptionLanguage = null,
  selectedCaptionKind = null,
  captionTextLength = 0,
  transcriptLength = 0,
  transcriptText = '',
  error = null,
  provider = null,
} = {}) {
  const preview = String(transcriptText || '').slice(0, 300);
  console.log('[YouTube Captions]', {
    videoId: videoId || null,
    provider: provider || null,
    availableCaptionLanguages,
    selectedCaptionLanguage,
    selectedCaptionKind,
    captionTextLength,
    transcriptLength,
    transcriptPreview: preview
      ? `${preview}${String(transcriptText || '').length > 300 ? '…' : ''}`
      : '(없음)',
    error: error || null,
  });
}
