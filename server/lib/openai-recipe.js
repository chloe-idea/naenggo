import { createOpenAiHttpError } from './openai-errors.js';
import { getOpenAiApiKey, getOpenAiEndpoint, getOpenAiModel } from './openai-config.js';
import {
  classifyMissingTextFailure,
  logOpenAiPromptDebug,
  logOpenAiResponseDebug,
  summarizeContentAvailability,
} from './video-extract-debug.js';
import {
  looksLikeRecipeText,
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

반드시 JSON 객체 하나만 반환하세요. 키:
- title (문자열, 레시피 이름 — 반드시 출처에서 확인된 요리명)
- ingredients (문자열 배열, 필수 재료 — 출처에 명시된 것만)
- optionalIngredients (문자열 배열, 선택 재료 — 출처에 명시된 것만)
- substituteIngredients (문자열 배열, "재료 → 대체" 형식)
- steps (문자열 배열, 조리 순서 — 출처에 명시된 것만)
- cookingTime (숫자, 분 — 출처에 없으면 0)
- difficulty ("쉬움"|"보통"|"어려움" — 판단 불가 시 "보통")
- category ("korean"|"western"|"japanese"|"chinese"|"diet"|"high-protein")
- sourceTitle (문자열, 영상/게시물 제목 그대로)
- detectedDishName (문자열, 제목·캡션·자막에서 확인한 요리명)
- confidence (0~1 숫자, 출처 근거 확실성)
- sourceValidation ("passed" | "failed")
- reason (문자열, sourceValidation 판단 근거)

중요 규칙:
- 영상/캡션/자막/제목에서 확인된 정보만 사용하세요.
- 확인되지 않은 재료·조리순서는 추측하거나 일반적인 레시피로 채우지 마세요.
- 제목만 있고 재료·조리 정보가 없으면 sourceValidation을 "failed"로 하고 error에 "NOT_A_RECIPE"를 넣으세요.
- 다른 요리의 예시 레시피를 반환하지 마세요.
- 음악·예능·브이로그 등 요리와 무관한 영상이면 error에 "NOT_A_RECIPE"를 넣으세요.
- title은 detectedDishName과 일치하거나 포함 관계여야 합니다.`;
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((s) => String(s).trim()).filter(Boolean);
}

function normalizeRecipe(raw, meta) {
  const title = String(raw.title || meta.title || '영상 레시피').trim().slice(0, 80);
  const category = VALID_CATEGORIES.has(raw.category) ? raw.category : 'korean';
  const platform = meta.sourcePlatform || 'youtube';
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));

  return {
    title,
    sourceUrl: meta.sourceUrl,
    sourcePlatform: platform,
    thumbnailUrl: meta.thumbnailUrl,
    ingredients: cleanStringArray(raw.ingredients),
    optionalIngredients: cleanStringArray(raw.optionalIngredients),
    substituteIngredients: cleanStringArray(raw.substituteIngredients),
    steps: cleanStringArray(raw.steps),
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

function throwInsufficientRecipeError({ userContent, content, parsed, reason }) {
  const err = new Error(VIDEO_EXTRACT_UI.INSUFFICIENT_MSG);
  err.code = 'INCOMPLETE_RECIPE';
  err.failureReason = 'INCOMPLETE_RECIPE';
  err.failureReasonLabel = reason || '레시피 정보 부족';
  err.openaiPromptPreview = userContent.slice(0, 500);
  err.openaiResponsePreview = content.slice(0, 500);
  err.fallback = true;
  throw err;
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
    textSource,
    combinedText,
  } = context;

  const platformLabel = PLATFORM_LABELS[platform] || '영상';
  const descriptionText = String(extractedDescription || '').trim();
  const captionText = String(extractedCaption || '').trim();
  const metadataText = [descriptionText, captionText].filter(Boolean).join('\n\n').trim();
  const fullCombinedText = String(combinedText || '').trim()
    || buildFullCombinedText({
      title,
      description: descriptionText,
      caption: captionText,
      transcript: extractedTranscript,
      userText,
    });
  const preferDescription = textSource === 'description'
    || textSource === 'description-fallback'
    || looksLikeRecipeText(metadataText);

  const parts = [`${platformLabel} URL: ${sourceUrl}`];

  if (fullCombinedText) {
    const label = preferDescription
      ? '[최우선 — title+description+caption+transcript+사용자 입력 (description/metadata 우선)]'
      : '[통합 텍스트 — title+description+caption+transcript+사용자 입력]';
    parts.push(`${label}\n${fullCombinedText.slice(0, 12000)}`);
  } else if (title) {
    parts.push(`영상 제목(참고): ${title}`);
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
    });
  }

  const recipe = normalizeRecipe(parsed, {
    sourceUrl,
    thumbnailUrl,
    title,
    sourcePlatform: platform,
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
      reason: '재료·조리순서 없음',
    });
  }

  if (detectedDish && dishNamesLikelyMismatch(detectedDish, recipe.title)) {
    recipe.dishNameMismatch = true;
    recipe.sourceDetectedDishName = detectedDish;
    recipe.extractionWarning = `영상(${detectedDish})과 추출 결과(${recipe.title})가 다를 수 있어요. 내용을 확인해 주세요.`;
  }

  if (parsedIngredientsCount === 0 || parsedStepsCount === 0) {
    recipe.extractionWarning = parsedIngredientsCount === 0
      ? VIDEO_EXTRACT_UI.PARTIAL_INGREDIENTS
      : VIDEO_EXTRACT_UI.PARTIAL_STEPS;
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

  logOpenAiPromptDebug(systemPrompt, userContent);

  console.log('[OpenAI:request] key fingerprint:', {
    first10: apiKey.slice(0, 10),
    last4: apiKey.slice(-4),
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
