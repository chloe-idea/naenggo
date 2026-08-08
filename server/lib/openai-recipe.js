import { createOpenAiHttpError } from './openai-errors.js';
import { getOpenAiApiKey, getOpenAiEndpoint, getOpenAiModel } from './openai-config.js';
import {
  classifyMissingTextFailure,
  logOpenAiPromptDebug,
  logOpenAiResponseDebug,
  summarizeContentAvailability,
} from './video-extract-debug.js';
import {
  logExtractTextPreview,
  buildFullCombinedText,
  detectDishNameFromSource,
  dishNamesLikelyMismatch,
} from './video-text-priority.js';
import { VIDEO_EXTRACT_UI } from './video-pipeline/constants.js';
import { logVideoExtractPipeline } from './video-pipeline/debug.js';

const VALID_CATEGORIES = new Set([
  'korean', 'western', 'japanese', 'chinese', 'diet', 'high-protein',
]);
const VALID_DIFFICULTIES = new Set(['쉬움', '보통', '어려움']);

const PLATFORM_LABELS = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

function buildSystemPrompt(platform = 'youtube') {
  const label = PLATFORM_LABELS[platform] || '영상';
  return `당신은 요리 레시피 추출 전문가입니다. ${label} URL, 제목, 설명글, 자막/캡션, 사용자 입력 텍스트에서 레시피를 추출하세요.

반드시 JSON 객체 하나만 반환하세요. 스키마:
{
  "title": "문자열 (출처에서 확인된 요리명)",
  "description": "문자열 (짧은 요약, 없으면 빈 문자열)",
  "ingredients": [{ "name": "", "amount": "", "unit": "" }],
  "optionalIngredients": [{ "name": "", "amount": "", "unit": "" }],
  "substituteIngredients": ["재료 → 대체"],
  "steps": [{ "order": 1, "description": "" }],
  "cookingTime": 0,
  "difficulty": "쉬움|보통|어려움",
  "category": "korean|western|japanese|chinese|diet|high-protein",
  "sourceTitle": "영상/게시물 제목 그대로",
  "detectedDishName": "제목·캡션·자막에서 확인한 요리명",
  "confidence": 0,
  "sourceValidation": "passed|failed",
  "reason": "sourceValidation 판단 근거"
}

중요 규칙:
- steps는 반드시 배열이며, 각 항목은 order(숫자)와 description(문자열)을 포함하세요.
- ingredients / optionalIngredients도 배열이며, 각 항목은 name·amount·unit을 포함하세요. 양을 모르면 amount·unit은 빈 문자열로 두세요.
- 영상/캡션/자막/제목에서 확인된 정보만 사용하세요.
- 확인되지 않은 재료·조리순서는 추측하거나 일반적인 레시피로 채우지 마세요.
- 조리 순서를 확인할 수 없으면 steps는 빈 배열 []로 두고, 단계를 지어내지 마세요.
- 제목만 있고 재료·조리 정보가 없으면 sourceValidation을 "failed"로 하고 error에 "NOT_A_RECIPE"를 넣으세요.
- 다른 요리의 예시 레시피를 반환하지 마세요.
- 음악·예능·브이로그 등 요리와 무관한 영상이면 error에 "NOT_A_RECIPE"를 넣으세요.
- title은 detectedDishName과 일치하거나 포함 관계여야 합니다.`;
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((s) => String(s).trim()).filter(Boolean);
}

/** 재료 항목 → 앱 저장용 문자열 ("이름 양단위") */
function formatIngredientItem(item) {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item !== 'object') return String(item).trim();
  if (item.originalText) return String(item.originalText).trim();
  const name = String(item.name || item.ingredient || '').trim();
  const amount = String(item.amount ?? item.quantity ?? '').trim();
  const unit = String(item.unit || '').trim();
  const amountPart = amount ? (unit ? `${amount}${unit}` : amount) : unit;
  return [name, amountPart].filter(Boolean).join(' ').trim();
}

function normalizeIngredientsArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(formatIngredientItem).filter(Boolean);
}

/** step 항목 → description 문자열 */
function extractStepDescription(item) {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item !== 'object') return String(item).trim();
  return String(
    item.description
    || item.text
    || item.step
    || item.content
    || item.instruction
    || '',
  ).trim();
}

/**
 * OpenAI가 steps / instructions / cookingSteps / directions 중 어떤 키로
 * 주든, 앱 저장 구조(string[])로 정규화한다.
 */
function normalizeStepsFromParsed(raw) {
  const candidates = [
    { key: 'steps', value: raw?.steps },
    { key: 'instructions', value: raw?.instructions },
    { key: 'cookingSteps', value: raw?.cookingSteps },
    { key: 'directions', value: raw?.directions },
  ];

  let chosenKey = null;
  let arr = null;
  for (const candidate of candidates) {
    if (Array.isArray(candidate.value)) {
      chosenKey = candidate.key;
      arr = candidate.value;
      if (candidate.value.length > 0) break;
    }
  }

  if (!Array.isArray(arr)) {
    return { steps: [], sourceField: null, rawCount: 0 };
  }

  const normalized = arr
    .map((item, index) => ({
      order: (item && typeof item === 'object' && Number(item.order) > 0)
        ? Number(item.order)
        : index + 1,
      description: extractStepDescription(item),
    }))
    .filter((item) => item.description)
    .sort((a, b) => a.order - b.order)
    .map((item) => item.description);

  return {
    steps: normalized,
    sourceField: chosenKey,
    rawCount: arr.length,
  };
}

function logStepsNormalization(parsed, normalized) {
  console.log('[VideoExtract] steps normalization', {
    parsedKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
    hasSteps: Array.isArray(parsed?.steps),
    hasInstructions: Array.isArray(parsed?.instructions),
    hasCookingSteps: Array.isArray(parsed?.cookingSteps),
    hasDirections: Array.isArray(parsed?.directions),
    sourceField: normalized.sourceField,
    rawCount: normalized.rawCount,
    normalizedCount: normalized.steps.length,
    normalizedPreview: normalized.steps.slice(0, 3),
  });
}

function normalizeRecipe(raw, meta) {
  const title = String(raw.title || meta.title || '영상 레시피').trim().slice(0, 80);
  const category = VALID_CATEGORIES.has(raw.category) ? raw.category : 'korean';
  const platform = meta.sourcePlatform || 'youtube';
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  const stepsNormalized = normalizeStepsFromParsed(raw);
  logStepsNormalization(raw, stepsNormalized);

  return {
    title,
    description: String(raw.description || '').trim().slice(0, 500),
    sourceUrl: meta.sourceUrl,
    sourcePlatform: platform,
    thumbnailUrl: meta.thumbnailUrl,
    ingredients: normalizeIngredientsArray(raw.ingredients),
    optionalIngredients: normalizeIngredientsArray(raw.optionalIngredients),
    substituteIngredients: cleanStringArray(raw.substituteIngredients),
    steps: stepsNormalized.steps,
    cookingTime: Math.max(0, Number(raw.cookingTime) || 0),
    difficulty: VALID_DIFFICULTIES.has(raw.difficulty) ? raw.difficulty : '보통',
    category,
    sourceTitle: String(raw.sourceTitle || meta.title || '').trim().slice(0, 120),
    detectedDishName: String(raw.detectedDishName || '').trim().slice(0, 80),
    confidence,
    sourceValidation: raw.sourceValidation === 'passed' ? 'passed' : raw.sourceValidation === 'failed' ? 'failed' : '',
    sourceValidationReason: String(raw.reason || '').trim().slice(0, 300),
  };
}

function throwInsufficientRecipeError({
  userContent = '',
  content = '',
  parsed = null,
  reason,
  code = 'INSUFFICIENT_RECIPE_SOURCE',
} = {}) {
  const err = new Error(VIDEO_EXTRACT_UI.INSUFFICIENT_MSG);
  err.code = code;
  err.failureReason = code;
  err.failureReasonLabel = reason || 'transcript·description 모두 부족';
  err.openaiPromptPreview = userContent ? userContent.slice(0, 500) : null;
  err.openaiResponsePreview = content ? content.slice(0, 500) : null;
  err.fallback = true;
  throw err;
}

/** title-only 등 AI에 넘길 레시피 본문이 있는지 */
export function hasRecipeSourceText(context) {
  const userText = String(context?.userText || '').trim();
  const desc = String(context?.extractedDescription || '').trim();
  const transcript = String(context?.extractedTranscript || '').trim();
  const caption = String(context?.extractedCaption || '').trim();
  return userText.length >= 20
    || desc.length >= 20
    || transcript.length >= 20
    || caption.length >= 20;
}

function buildPromptContent(context) {
  const {
    platform = 'youtube',
    sourceUrl,
    title,
    extractedDescription,
    extractedTranscript,
    extractedCaption,
    userText,
  } = context;

  const platformLabel = PLATFORM_LABELS[platform] || '영상';
  const titleText = String(title || '').trim();
  const descriptionText = String(extractedDescription || '').trim();
  const captionText = String(extractedCaption || '').trim();
  const transcriptText = String(extractedTranscript || '').trim();
  const userTextValue = String(userText || '').trim();
  const hasTranscript = transcriptText.length >= 20;

  const parts = [`${platformLabel} URL: ${sourceUrl}`];

  if (hasTranscript) {
    // 자막 성공 시 title + description + transcript를 명시적으로 전달
    if (titleText) parts.push(`[title]\n${titleText.slice(0, 500)}`);
    if (descriptionText) parts.push(`[description]\n${descriptionText.slice(0, 6000)}`);
    if (captionText) parts.push(`[caption]\n${captionText.slice(0, 3000)}`);
    parts.push(`[transcript]\n${transcriptText.slice(0, 10000)}`);
    if (userTextValue) parts.push(`[userText]\n${userTextValue.slice(0, 4000)}`);
  } else {
    // transcript 없을 때만 description 기반 부분 추출 fallback
    const fallbackText = buildFullCombinedText({
      title: titleText,
      description: descriptionText,
      caption: captionText,
      transcript: '',
      userText: userTextValue,
    });
    if (fallbackText) {
      parts.push(`[description-fallback — transcript 없음]\n${fallbackText.slice(0, 12000)}`);
    } else if (titleText) {
      parts.push(`영상 제목(참고): ${titleText}`);
    }
  }

  return parts.filter(Boolean).join('\n\n');
}

/** OpenAI 호출 전 분석 가능한 텍스트가 있는지 확인 — 완전히 빈 경우만 거부 */
export function hasAnalyzableText(context) {
  const combined = String(context?.combinedText || '').trim();
  if (combined.length > 0) return true;

  const userText = String(context?.userText || '').trim();
  const desc = String(context?.extractedDescription || '').trim();
  const transcript = String(context?.extractedTranscript || '').trim();
  const caption = String(context?.extractedCaption || '').trim();
  const title = String(context?.title || '').trim();
  return Boolean(userText || desc || transcript || caption || title);
}

async function requestOpenAiRecipe({ systemPrompt, userContent, apiKey, model, endpoint }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const httpErr = createOpenAiHttpError(response, body);
    httpErr.failureReason = 'OPENAI_RESPONSE_FAILED';
    httpErr.failureReasonLabel = 'OpenAI 응답 실패';
    httpErr.openaiPromptPreview = userContent.slice(0, 500);
    httpErr.openaiResponsePreview = body.slice(0, 500);
    throw httpErr;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    const err = new Error('OpenAI 응답이 비어 있습니다.');
    err.code = 'OPENAI_EMPTY';
    console.error('[OpenAI] empty response:', { data });
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (parseErr) {
    const err = new Error('OpenAI 응답 JSON 파싱에 실패했습니다.');
    err.code = 'OPENAI_PARSE';
    err.failureReason = 'OPENAI_RESPONSE_FAILED';
    err.failureReasonLabel = 'OpenAI 응답 실패';
    err.responseBody = content;
    err.openaiPromptPreview = userContent.slice(0, 500);
    err.openaiResponsePreview = content.slice(0, 500);
    logOpenAiResponseDebug(content, null);
    console.error('[OpenAI] JSON parse failed:', { content: content.slice(0, 500), parseErr });
    throw err;
  }

  logOpenAiResponseDebug(content, parsed);
  return { content, parsed };
}

function throwNotARecipeError({ userContent, content, parsed }) {
  const err = new Error(VIDEO_EXTRACT_UI.FALLBACK_MSG);
  err.code = 'NOT_A_RECIPE';
  err.failureReason = 'OPENAI_NOT_A_RECIPE';
  err.failureReasonLabel = '레시피 정보 부족';
  err.openaiPromptPreview = userContent.slice(0, 500);
  err.openaiResponsePreview = content.slice(0, 500);
  err.fallback = true;
  throw err;
}

function finalizeRecipeFromParsed(parsed, context, userContent, content) {
  const {
    platform = 'youtube',
    sourceUrl,
    title,
    thumbnailUrl,
  } = context;

  if (parsed.error === 'NOT_A_RECIPE') {
    throwNotARecipeError({ userContent, content, parsed });
  }

  if (parsed.sourceValidation === 'failed') {
    throwInsufficientRecipeError({
      userContent,
      content,
      parsed,
      reason: parsed.reason || '출처에서 레시피 확인 불가',
      code: 'INSUFFICIENT_RECIPE_SOURCE',
    });
  }

  const recipe = normalizeRecipe(parsed, {
    sourceUrl,
    thumbnailUrl,
    title,
    sourcePlatform: platform,
  });

  console.log('[VideoExtract] OpenAI vs final recipe', {
    openaiKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
    openaiStepCount: Array.isArray(parsed?.steps) ? parsed.steps.length : null,
    openaiInstructionCount: Array.isArray(parsed?.instructions) ? parsed.instructions.length : null,
    openaiCookingStepsCount: Array.isArray(parsed?.cookingSteps) ? parsed.cookingSteps.length : null,
    openaiDirectionsCount: Array.isArray(parsed?.directions) ? parsed.directions.length : null,
    openaiIngredientCount: Array.isArray(parsed?.ingredients) ? parsed.ingredients.length : null,
    finalStepCount: recipe.steps.length,
    finalIngredientCount: recipe.ingredients.length,
    stepsPreview: recipe.steps.slice(0, 3),
  });

  const sourceDetectedDish = detectDishNameFromSource({
    title: context.title || context.rawTitle,
    description: context.extractedDescription,
    caption: context.extractedCaption,
    transcript: context.extractedTranscript,
    userText: context.userText,
  });
  const detectedDish = recipe.detectedDishName || sourceDetectedDish || context.title || title || '';
  const transcriptLen = String(context.extractedTranscript || '').length;

  console.log('[VideoExtract] validation log', {
    inputUrl: sourceUrl,
    sourceTitle: recipe.sourceTitle || context.title || title || '',
    sourceCaptionLength: String(context.extractedCaption || '').length,
    sourceDescriptionLength: String(context.extractedDescription || '').length,
    transcriptLength: transcriptLen,
    detectedDishName: detectedDish,
    aiRecipeName: recipe.title,
    confidence: recipe.confidence,
    sourceValidation: recipe.sourceValidation,
    reason: recipe.sourceValidationReason,
  });

  const parsedIngredientsCount = recipe.ingredients.length;
  const parsedStepsCount = recipe.steps.length;

  console.log('[YouTube Extract] parse result', {
    videoId: context.videoId || null,
    apiStatus: context.apiStatus || null,
    titleLength: String(context.title || title || '').length,
    descriptionLength: String(context.extractedDescription || '').length,
    transcriptLength: transcriptLen,
    combinedTextLength: String(context.combinedText || '').length,
    parsedIngredientsCount,
    parsedStepsCount,
  });

  logVideoExtractPipeline({
    phase: 'openai-parse',
    platform: context.detectedPlatform || context.platform,
    videoId: context.videoId,
    apiStatus: context.apiStatus,
    title: context.title || title,
    description: context.extractedDescription,
    captionText: context.extractedCaption,
    transcriptText: context.extractedTranscript,
    userPastedText: context.userText,
    combinedText: context.combinedText,
    parsedIngredientsCount,
    parsedStepsCount,
  });

  if (parsedIngredientsCount === 0 && parsedStepsCount === 0) {
    throwInsufficientRecipeError({
      userContent,
      content,
      parsed,
      reason: '재료·조리순서 모두 없음',
      code: 'INSUFFICIENT_RECIPE_SOURCE',
    });
  }

  if (detectedDish && dishNamesLikelyMismatch(detectedDish, recipe.title)) {
    recipe.dishNameMismatch = true;
    recipe.sourceDetectedDishName = detectedDish;
    recipe.extractionWarning = `영상(${detectedDish})과 추출 결과(${recipe.title})가 다를 수 있어요. 내용을 확인해 주세요.`;
  }

  const hasTranscript = String(context.extractedTranscript || '').trim().length >= 20;
  recipe.extractStatus = 'full';
  recipe.partialReason = null;

  if (parsedIngredientsCount === 0 || parsedStepsCount === 0) {
    recipe.extractStatus = 'partial';
    if (parsedIngredientsCount === 0) {
      recipe.partialReason = 'MISSING_INGREDIENTS';
      recipe.extractionWarning = VIDEO_EXTRACT_UI.PARTIAL_INGREDIENTS;
    } else if (!hasTranscript) {
      // description-only에서 steps가 비면 transcript 실패로 구분 (추측 steps는 프롬프트에서 금지)
      recipe.partialReason = 'MISSING_TRANSCRIPT_FOR_STEPS';
      recipe.extractionWarning = VIDEO_EXTRACT_UI.MISSING_TRANSCRIPT_FOR_STEPS;
    } else {
      recipe.partialReason = 'MISSING_STEPS_IN_SOURCE';
      recipe.extractionWarning = VIDEO_EXTRACT_UI.PARTIAL_STEPS;
    }
  }

  if (!recipe.cookingTime) recipe.cookingTime = 20;

  return recipe;
}

export async function analyzeVideoTextToRecipe(context) {
  const {
    platform = 'youtube',
    sourceUrl,
    title,
    thumbnailUrl,
  } = context;

  if (!hasAnalyzableText(context)) {
    const failure = classifyMissingTextFailure(context);
    const availability = summarizeContentAvailability(context);
    console.warn('[OpenAI] analyzable text missing:', availability);
    const err = new Error(failure.userMessage);
    err.code = failure.code;
    err.failureReason = failure.code;
    err.failureReasonLabel = failure.label;
    err.contentAvailability = availability;
    err.fallback = true;
    throw err;
  }

  // title-only 등 transcript·description·userText 모두 부족하면 OpenAI 호출 없이 fallback
  if (!hasRecipeSourceText(context)) {
    console.warn('[OpenAI] insufficient recipe source (title-only or empty body)', {
      titleLength: String(context.title || '').length,
      descriptionLength: String(context.extractedDescription || '').length,
      transcriptLength: String(context.extractedTranscript || '').length,
      userTextLength: String(context.userText || '').length,
    });
    throwInsufficientRecipeError({
      reason: 'transcript·description 모두 부족',
      code: 'INSUFFICIENT_RECIPE_SOURCE',
    });
  }

  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    const err = new Error(
      '서버에 OpenAI API Key가 설정되지 않았습니다. Vercel 환경변수 OPENAI_API_KEY를 확인해 주세요.',
    );
    err.code = 'MISSING_OPENAI_KEY';
    throw err;
  }

  const model = getOpenAiModel();
  const endpoint = getOpenAiEndpoint();

  logExtractTextPreview({
    rawTitle: context.rawTitle || title,
    rawDescription: context.rawDescription || context.extractedDescription,
    combinedText: context.combinedText,
    textSource: context.textSource,
    phase: 'openai-analyze',
  });

  const userContent = buildPromptContent(context);
  const systemPrompt = buildSystemPrompt(platform);
  const transcriptText = String(context.extractedTranscript || '').trim();

  logOpenAiPromptDebug(systemPrompt, userContent);

  console.log('[VideoExtract] OpenAI source text', {
    videoId: context.videoId || null,
    availableCaptionLanguages: context.availableCaptionLanguages || [],
    selectedCaptionLanguage: context.selectedCaptionLanguage || null,
    captionTextLength: transcriptText.length,
    transcriptLength: transcriptText.length,
    transcriptPreview: transcriptText
      ? `${transcriptText.slice(0, 300)}${transcriptText.length > 300 ? '…' : ''}`
      : '(없음)',
    sourceTextLength: userContent.length,
    hasTranscript: transcriptText.length >= 20,
    model,
    endpoint,
  });

  const { content, parsed } = await requestOpenAiRecipe({
    systemPrompt,
    userContent,
    apiKey,
    model,
    endpoint,
  });

  return finalizeRecipeFromParsed(parsed, context, userContent, content);
}

/** @deprecated analyzeVideoTextToRecipe 사용 */
export const analyzeYouTubeTextToRecipe = analyzeVideoTextToRecipe;
