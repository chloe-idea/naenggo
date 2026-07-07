import { VIDEO_EXTRACT_UI } from './video-pipeline/constants.js';

const LOG_PREFIX = '[VideoExtract]';

export const EXTRACT_FAILURE = {
  NO_VIDEO_METADATA: {
    code: 'NO_VIDEO_METADATA',
    label: '영상 메타데이터 없음',
    userMessage: '설명을 가져오지 못했습니다. 직접 붙여넣기 해주세요.',
  },
  NO_DESCRIPTION: {
    code: 'NO_DESCRIPTION',
    label: '설명(description) 없음',
    userMessage: '설명을 가져오지 못했습니다. 직접 붙여넣기 해주세요.',
  },
  NO_TRANSCRIPT: {
    code: 'NO_TRANSCRIPT',
    label: '자막(transcript) 없음',
    userMessage: '영상 자막(transcript)을 가져오지 못했습니다. 설명글이나 캡션을 붙여넣어 주세요.',
  },
  MISSING_CAPTION_TEXT: {
    code: 'MISSING_CAPTION_TEXT',
    label: '분석 가능한 텍스트 없음',
    userMessage: '설명을 가져오지 못했습니다. 직접 붙여넣기 해주세요.',
  },
  OPENAI_RESPONSE_FAILED: {
    code: 'OPENAI_RESPONSE_FAILED',
    label: 'OpenAI 응답 실패',
    userMessage: 'OpenAI 레시피 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  },
  OPENAI_NOT_A_RECIPE: {
    code: 'OPENAI_NOT_A_RECIPE',
    label: '레시피 정보 부족',
    userMessage: VIDEO_EXTRACT_UI.INSUFFICIENT_MSG,
  },
  INCOMPLETE_RECIPE: {
    code: 'INCOMPLETE_RECIPE',
    label: '레시피 정보 부족',
    userMessage: VIDEO_EXTRACT_UI.INSUFFICIENT_MSG,
  },
};

const OPENAI_FAIL_CODES = new Set([
  'MISSING_OPENAI_KEY',
  'OPENAI_AUTH_ERROR',
  'OPENAI_FORBIDDEN',
  'OPENAI_MODEL_NOT_FOUND',
  'OPENAI_RATE_LIMIT',
  'OPENAI_SERVER_ERROR',
  'OPENAI_ERROR',
  'OPENAI_EMPTY',
  'OPENAI_PARSE',
]);

function preview(text, max = 500) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… (${s.length}자)`;
}

/** @param {object} context */
export function summarizeContentAvailability(context = {}) {
  const title = String(context.title || '').trim();
  const description = String(context.extractedDescription || '').trim();
  const transcript = String(context.extractedTranscript || '').trim();
  const caption = String(context.extractedCaption || '').trim();
  const userText = String(context.userText || '').trim();

  return {
    title: title || '(없음)',
    descriptionLength: description.length,
    hasDescription: description.length >= 20,
    transcriptLength: transcript.length,
    hasTranscript: transcript.length >= 20,
    captionLength: caption.length,
    hasCaptions: caption.length >= 20,
    userTextLength: userText.length,
    hasUserText: userText.length >= 20,
    combinedTextLength: String(context.combinedText || '').trim().length,
    autoExtractFailed: Boolean(context.autoExtractFailed),
    apiStatus: context.apiStatus || null,
    hasAnalyzableText: String(context.combinedText || '').trim().length > 0
      || userText.length > 0
      || description.length > 0
      || transcript.length > 0
      || caption.length > 0
      || title.length > 0,
  };
}

/** @param {object} youtubeContent */
export function logYouTubeFetchDebug(youtubeContent, url) {
  const title = String(youtubeContent?.title || '').trim();
  const description = String(youtubeContent?.extractedDescription || '').trim();
  const transcript = String(youtubeContent?.extractedTranscript || '').trim();

  console.log(`${LOG_PREFIX} YouTube fetch result`, {
    url,
    videoId: youtubeContent?.videoId || null,
    apiStatus: youtubeContent?.apiStatus || null,
    title: title || '(없음)',
    titleLength: title.length,
    rawDescriptionPreview: description
      ? `${description.slice(0, 300)}${description.length > 300 ? '…' : ''}`
      : '(없음)',
    descriptionLength: description.length,
    hasDescription: description.length >= 20,
    transcriptLength: transcript.length,
    hasTranscript: transcript.length >= 20,
    textSource: youtubeContent?.textSource || '(없음)',
    combinedTextLength: String(youtubeContent?.combinedText || '').length,
    autoExtractFailed: Boolean(youtubeContent?.autoExtractFailed),
  });
}

/** @param {object} context */
export function logAnalysisContextDebug(context) {
  const summary = summarizeContentAvailability(context);
  console.log(`${LOG_PREFIX} analysis context`, {
    ...summary,
    textSource: context.textSource || '(없음)',
    combinedTextLength: String(context.combinedText || '').length,
    combinedTextPreview: preview(context.combinedText, 300),
  });
}

export function logOpenAiPromptDebug(systemPrompt, userContent) {
  console.log(`${LOG_PREFIX} OpenAI prompt (preview)`, {
    systemPromptLength: String(systemPrompt || '').length,
    userPromptPreview: preview(userContent, 500),
    userPromptLength: String(userContent || '').length,
  });
}

export function logOpenAiResponseDebug(rawContent, parsed) {
  console.log(`${LOG_PREFIX} OpenAI response`, {
    rawPreview: preview(rawContent, 500),
    rawLength: String(rawContent || '').length,
    parsedKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
    parsedError: parsed?.error || null,
    ingredientCount: Array.isArray(parsed?.ingredients) ? parsed.ingredients.length : 0,
    stepCount: Array.isArray(parsed?.steps) ? parsed.steps.length : 0,
  });
}

/**
 * @param {object} context
 * @returns {{ code: string, label: string, userMessage: string }}
 */
export function classifyMissingTextFailure(context) {
  const availability = summarizeContentAvailability(context);
  if (!availability.hasAnalyzableText) {
    return EXTRACT_FAILURE.NO_VIDEO_METADATA;
  }
  return EXTRACT_FAILURE.MISSING_CAPTION_TEXT;
}

/**
 * @param {Error} err
 * @param {object} [context]
 */
export function resolveExtractFailure(err, context = null) {
  const code = err?.code || 'UNKNOWN';

  if (code === 'MISSING_CAPTION_TEXT' && context) {
    return classifyMissingTextFailure(context);
  }
  if (code === 'NOT_A_RECIPE') {
    return EXTRACT_FAILURE.OPENAI_NOT_A_RECIPE;
  }
  if (code === 'INCOMPLETE_RECIPE') {
    return EXTRACT_FAILURE.INCOMPLETE_RECIPE;
  }
  if (OPENAI_FAIL_CODES.has(code)) {
    return {
      ...EXTRACT_FAILURE.OPENAI_RESPONSE_FAILED,
      userMessage: err?.message || EXTRACT_FAILURE.OPENAI_RESPONSE_FAILED.userMessage,
    };
  }

  const known = EXTRACT_FAILURE[code];
  if (known) return known;

  return {
    code: code || 'EXTRACTION_FAILED',
    label: '레시피 추출 실패',
    userMessage: err?.message || '레시피 추출에 실패했습니다.',
  };
}

/** @param {object} params */
export function buildExtractDebugPayload({
  context,
  youtubeContent,
  promptPreview,
  openaiResponsePreview,
  failure,
  availability,
}) {
  return {
    failureReason: failure?.code || null,
    failureReasonLabel: failure?.label || null,
    contentAvailability: availability || (context ? summarizeContentAvailability(context) : null),
    youtubeFetch: youtubeContent
      ? {
        videoId: youtubeContent.videoId || null,
        title: youtubeContent.title || '(없음)',
        descriptionLength: String(youtubeContent.extractedDescription || '').length,
        hasDescription: String(youtubeContent.extractedDescription || '').trim().length >= 20,
        hasTranscript: String(youtubeContent.extractedTranscript || '').trim().length >= 20,
        hasCaptions: String(youtubeContent.extractedTranscript || '').trim().length >= 20,
        textSource: youtubeContent.textSource || null,
        autoExtractFailed: Boolean(youtubeContent.autoExtractFailed),
      }
      : null,
    openaiPromptPreview: promptPreview || null,
    openaiResponsePreview: openaiResponsePreview || null,
  };
}

export function logExtractFailure(err, context, extra = {}) {
  const failure = resolveExtractFailure(err, context);
  console.error(`${LOG_PREFIX} failure`, {
    failureReason: failure.code,
    failureReasonLabel: failure.label,
    message: err?.message,
    errCode: err?.code,
    ...extra,
    contentAvailability: context ? summarizeContentAvailability(context) : null,
  });
}
