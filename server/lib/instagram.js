import {
  PipelineStageId,
  runVideoExtractPipeline,
  runSttStage,
  runOcrStage,
} from './video-pipeline/pipeline.js';
import { mergeUserTextInput } from './youtube.js';

const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,20}$/;

export const INSTAGRAM_REELS_EXTRACT_HINT =
  '릴스 자동 분석이 제한될 수 있어 캡션을 함께 붙여넣으면 정확합니다';

export const INSTAGRAM_AUTO_EXTRACT_FAILED_WARNING =
  '릴스 정보를 자동으로 읽지 못해 입력된 캡션 기준으로 분석했습니다';

export function isInstagramHost(hostname) {
  return String(hostname || '').replace(/^www\./, '') === 'instagram.com';
}

export function extractInstagramShortcode(rawUrl) {
  try {
    const url = new URL(String(rawUrl).trim().startsWith('http') ? rawUrl : `https://${rawUrl}`);
    const host = url.hostname.replace(/^www\./, '');
    if (host !== 'instagram.com') return null;

    const segments = url.pathname.split('/').filter(Boolean);
    const typeIdx = segments.findIndex((seg) => ['reel', 'reels', 'p', 'tv'].includes(seg.toLowerCase()));
    if (typeIdx >= 0 && segments[typeIdx + 1]) {
      const code = segments[typeIdx + 1].split(/[?#&]/)[0];
      return SHORTCODE_RE.test(code) ? code : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function isInstagramReelsUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl).trim().startsWith('http') ? rawUrl : `https://${rawUrl}`);
    return /\/reels?\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function normalizeInstagramUrl(rawUrl, shortcode) {
  try {
    return new URL(rawUrl).href;
  } catch {
    return shortcode ? `https://www.instagram.com/reel/${shortcode}/` : rawUrl;
  }
}

function createBaseContent(shortcode, url) {
  return {
    platform: 'instagram',
    shortcode,
    title: '',
    thumbnailUrl: null,
    sourceUrl: normalizeInstagramUrl(url, shortcode),
    extractedCaption: '',
    extractedDescription: '',
    sttText: '',
    ocrText: '',
    autoExtractFailed: false,
  };
}

async function fetchInstagramOEmbed(url) {
  try {
    const res = await fetch(
      `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}&omitscript=true`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: String(data.title || data.author_name || '').trim(),
      thumbnailUrl: data.thumbnail_url || null,
      caption: String(data.title || '').trim(),
    };
  } catch (err) {
    console.warn('[instagram] oembed failed:', err?.message || err);
    return null;
  }
}

async function fetchOgMetadata(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NaengjangGoBot/1.0)',
        Accept: 'text/html',
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();
    const pick = (prop) => {
      const re = new RegExp(`property=["']og:${prop}["'][^>]*content=["']([^"']+)["']`, 'i');
      const alt = new RegExp(`content=["']([^"']+)["'][^>]*property=["']og:${prop}["']`, 'i');
      return (html.match(re)?.[1] || html.match(alt)?.[1] || '').trim();
    };
    return {
      title: pick('title'),
      description: pick('description'),
      thumbnailUrl: pick('image') || null,
    };
  } catch (err) {
    console.warn('[instagram] og fetch failed:', err?.message || err);
    return null;
  }
}

async function runMetadataStage(context) {
  const { url, shortcode } = context;
  const result = createBaseContent(shortcode, url);
  let gotText = false;

  const oembed = await fetchInstagramOEmbed(result.sourceUrl);
  if (oembed?.title) result.title = oembed.title;
  if (oembed?.thumbnailUrl) result.thumbnailUrl = oembed.thumbnailUrl;
  if (oembed?.caption && oembed.caption.length >= 10) {
    result.extractedCaption = oembed.caption;
    gotText = true;
  }

  if (!gotText || !result.thumbnailUrl) {
    const og = await fetchOgMetadata(result.sourceUrl);
    if (og?.title && !result.title) result.title = og.title;
    if (og?.thumbnailUrl && !result.thumbnailUrl) result.thumbnailUrl = og.thumbnailUrl;
    if (og?.description && og.description.length >= 10) {
      result.extractedDescription = og.description;
      if (!result.extractedCaption) result.extractedCaption = og.description;
      gotText = true;
    }
  }

  if (!gotText) {
    result.autoExtractFailed = true;
  }

  return result;
}

/**
 * 릴스 URL → 메타데이터 수집 (스크래핑 실패해도 throw 없음)
 * 2차: STT/OCR stage hook 포함
 */
export async function fetchInstagramReelsContent(url, options = {}) {
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) {
    const err = new Error('유효한 Instagram 릴스/게시물 shortcode를 찾을 수 없습니다.');
    err.code = 'INVALID_SHORTCODE';
    throw err;
  }

  const enableFutureStages = Boolean(options.enableStt || options.enableOcr);
  const stages = [
    { id: PipelineStageId.METADATA, run: runMetadataStage },
  ];

  if (enableFutureStages) {
    stages.push(
      { id: PipelineStageId.STT, run: runSttStage },
      { id: PipelineStageId.OCR, run: runOcrStage },
    );
  }

  const pipelineResult = await runVideoExtractPipeline(stages, { url, shortcode });
  const {
    pipelineSteps,
    platform,
    title,
    thumbnailUrl,
    sourceUrl,
    extractedCaption,
    extractedDescription,
    sttText,
    ocrText,
    autoExtractFailed,
  } = pipelineResult;

  return {
    platform: platform || 'instagram',
    shortcode,
    title: title || '',
    thumbnailUrl: thumbnailUrl || null,
    sourceUrl: sourceUrl || normalizeInstagramUrl(url, shortcode),
    extractedCaption: extractedCaption || '',
    extractedDescription: extractedDescription || '',
    sttText: sttText || '',
    ocrText: ocrText || '',
    autoExtractFailed: Boolean(autoExtractFailed),
    pipelineSteps: pipelineSteps || [],
  };
}

/** OpenAI 프롬프트용 구조화 컨텍스트 */
export function buildInstagramAnalysisContext({ instagramContent, url, userInputs = {} }) {
  const mergedUserText = mergeUserTextInput(userInputs);
  const extractedCaption = String(instagramContent?.extractedCaption || '').trim();
  const extractedDescription = String(instagramContent?.extractedDescription || '').trim();
  const sttText = String(instagramContent?.sttText || '').trim();
  const ocrText = String(instagramContent?.ocrText || '').trim();

  const autoExtractFailed = Boolean(
    instagramContent?.autoExtractFailed
    || (!extractedCaption && !extractedDescription && !sttText && !ocrText)
  );

  return {
    platform: 'instagram',
    sourceUrl: instagramContent?.sourceUrl || url,
    thumbnailUrl: instagramContent?.thumbnailUrl || null,
    title: instagramContent?.title || '',
    extractedDescription: extractedDescription || extractedCaption,
    extractedTranscript: [sttText, ocrText].filter(Boolean).join('\n\n'),
    extractedCaption,
    userText: mergedUserText,
    autoExtractFailed,
    hasUserText: mergedUserText.length >= 10,
    infoHint: INSTAGRAM_REELS_EXTRACT_HINT,
  };
}
