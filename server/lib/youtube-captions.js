/**
 * YouTube 자막(caption/transcript) 수집
 * - watch / youtu.be / shorts → 동일 videoId
 * - 수동·자동생성 자막 모두 시도 (ko 우선 → en → 사용 가능 첫 자막)
 * - YouTube PoToken(BotGuard) 대응: get-youtube-transcript
 */

import { getTranscript } from 'get-youtube-transcript';
import { isValidYouTubeVideoId } from './video-pipeline/platform.js';

const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const PREFERRED_LANGUAGES = ['ko', 'en'];

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
 * watch 페이지에서 caption track 목록만 수집 (언어 로그용)
 * @returns {Promise<Array<{ languageCode: string, kind: string, name: string }>>}
 */
export async function listYouTubeCaptionTracks(videoId) {
  if (!isValidYouTubeVideoId(videoId)) return [];

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
    if (!watchRes.ok) return [];
    const html = await watchRes.text();
    const playerResponse = extractJsonAfter(html, 'ytInitialPlayerResponse = ');
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return tracks.map((track) => ({
      languageCode: String(track.languageCode || '').trim(),
      kind: track.kind === 'asr' ? 'asr' : 'manual',
      name: String(track.name?.simpleText || track.name || '').trim(),
    }));
  } catch (err) {
    console.warn('[youtube-captions] list tracks failed:', err?.message || err);
    return [];
  }
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
  };

  if (!isValidYouTubeVideoId(videoId)) {
    return { ...empty, error: 'INVALID_VIDEO_ID' };
  }

  const tracks = await listYouTubeCaptionTracks(videoId);
  const availableCaptionLanguages = [...new Set(
    tracks.map((t) => {
      const code = normalizeLangCode(t.languageCode) || t.languageCode;
      return t.kind === 'asr' ? `${code}(asr)` : code;
    }).filter(Boolean),
  )];

  if (!tracks.length) {
    return {
      ...empty,
      availableCaptionLanguages,
      error: 'NO_CAPTION_TRACKS',
    };
  }

  try {
    const result = await getTranscript(videoId, { languages: PREFERRED_LANGUAGES });
    const text = String(result?.text || '').replace(/\s+/g, ' ').trim();
    return {
      text,
      availableCaptionLanguages,
      selectedCaptionLanguage: result?.language || null,
      selectedCaptionKind: result?.kind || null,
      captionTextLength: text.length,
      transcriptLength: text.length,
      error: text.length >= 20 ? null : 'EMPTY_TRANSCRIPT',
    };
  } catch (err) {
    console.warn('[youtube-captions] getTranscript failed:', err?.message || err);
    return {
      ...empty,
      availableCaptionLanguages,
      error: err?.message || 'CAPTION_FETCH_FAILED',
    };
  }
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
} = {}) {
  const preview = String(transcriptText || '').slice(0, 300);
  console.log('[YouTube Captions]', {
    videoId: videoId || null,
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
