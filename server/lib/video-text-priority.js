/**
 * 영상 metadata(description/caption) 우선 · transcript fallback 텍스트 선택
 */

const LOG_PREFIX = '[VideoExtract]';

const RECIPE_SIGNAL_PATTERNS = [
  /재료/i,
  /ingredients?/i,
  /조리(?:법|순서)?/i,
  /만드는\s*법/i,
  /recipe/i,
  /steps?/i,
  /^\s*[-•*]\s+/m,
  /^\s*\d+[\.)]\s+/m,
  /(?:큰술|작은술|티스푼|컵|ml|g\b)/i,
];

const COOKING_TITLE_PATTERNS = [
  /레시피/i,
  /요리/i,
  /만들(?:기|어|었)/,
  /cooking/i,
  /recipe/i,
  /먹방/i,
  /한\s*끼/i,
  /반찬/i,
  /(?:찌개|볶음|국|탕|전|조림|구이|튀김|덮밥|파스타|라면|김치|계란|닭|돼지|소고기)/,
];

export function looksLikeCookingTitle(title) {
  const value = String(title || '').trim();
  if (value.length < 3) return false;
  return COOKING_TITLE_PATTERNS.some((pattern) => pattern.test(value));
}

export function looksLikeCookingContent(text) {
  const value = String(text || '').trim();
  if (value.length < 20) return false;
  if (looksLikeRecipeText(value)) return true;
  const hasCookingAction = /(?:볶|끓|굽|데치|썰|넣|섞|간|절|무침|튀김|찜|데우|불|팬|냄비|오븐|전자레인지)/.test(value);
  const hasMeasure = /(?:큰술|작은술|티스푼|컵|ml|g\b|스푼|조금|적당)/i.test(value);
  return (hasCookingAction && hasMeasure) || (looksLikeCookingTitle(value) && value.length >= 40);
}

export function shouldRetryRecipeExtraction(context) {
  const desc = String(context?.extractedDescription || '').trim();
  const transcript = String(context?.extractedTranscript || '').trim();
  const userText = String(context?.userText || '').trim();
  const caption = String(context?.extractedCaption || '').trim();
  const hasSubstantialMetadata = desc.length >= 20
    || transcript.length >= 20
    || userText.length >= 20
    || caption.length >= 20;
  if (!hasSubstantialMetadata) return false;

  const title = String(context?.title || context?.rawTitle || '').trim();
  const combined = String(
    context?.combinedText || context?.primaryAnalysisText || '',
  ).trim();
  if (looksLikeCookingTitle(title)) return true;
  if (looksLikeRecipeText(combined)) return true;
  if (looksLikeCookingContent(combined)) return true;
  return combined.length >= 80 && /(?:재료|양념|조리|만드)/.test(combined);
}

export function looksLikeRecipeText(text) {
  const value = String(text || '').trim();
  if (value.length < 20) return false;

  const signalHits = RECIPE_SIGNAL_PATTERNS.filter((pattern) => pattern.test(value)).length;
  const hasIngredientSection = /재료|ingredients?/i.test(value);
  const hasStepSection = /조리|만드는\s*법|순서|steps?/i.test(value);

  return signalHits >= 2 || (hasIngredientSection && hasStepSection);
}

function dedupeChunks(chunks) {
  const seen = new Set();
  const unique = [];
  for (const chunk of chunks) {
    const trimmed = String(chunk || '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

/** title + description + caption + transcript + userText 전체 병합 (파싱용) */
export function buildFullCombinedText({
  title = '',
  description = '',
  caption = '',
  transcript = '',
  userText = '',
} = {}) {
  return dedupeChunks([
    String(title || '').trim(),
    String(description || '').trim(),
    String(caption || '').trim(),
    String(transcript || '').trim(),
    String(userText || '').trim(),
  ]).join('\n\n');
}

/** YouTube: title + description (레거시 호환) */
export function buildTitleDescriptionCombinedText(title = '', description = '') {
  const rawTitle = String(title || '').trim();
  const rawDescription = String(description || '').trim();
  if (rawTitle && rawDescription) return `${rawTitle}\n\n${rawDescription}`;
  return rawTitle || rawDescription;
}

/** buildFullCombinedText alias */
export { buildFullCombinedText as combineRecipeText };

/** description · caption · transcript · userText 등 metadata 전체 병합 */
export function buildCombinedMetadataText({
  title = '',
  description = '',
  caption = '',
  transcript = '',
  userText = '',
  extraBlocks = [],
} = {}) {
  const chunks = dedupeChunks([
    String(description || '').trim(),
    String(caption || '').trim(),
    ...extraBlocks.map((block) => String(block || '').trim()),
    String(transcript || '').trim(),
    String(userText || '').trim(),
  ]);

  const combined = chunks.join('\n\n').trim();
  if (combined) return combined;

  const titleOnly = String(title || '').trim();
  return titleOnly;
}

/**
 * description/caption에 레시피 정보가 있으면 최우선,
 * 없으면 transcript → 기존 combined fallback
 */
export function resolveExtractTextPriority({
  title = '',
  extractedDescription = '',
  extractedCaption = '',
  extractedTranscript = '',
  userText = '',
  extraMetadata = [],
} = {}) {
  const rawTitle = String(title || '').trim();
  const rawDescription = String(extractedDescription || '').trim();
  const rawCaption = String(extractedCaption || '').trim();
  const rawTranscript = String(extractedTranscript || '').trim();
  const rawUserText = String(userText || '').trim();

  const metadataText = dedupeChunks([rawDescription, rawCaption, ...extraMetadata]).join('\n\n').trim();
  const combinedText = buildFullCombinedText({
    title: rawTitle,
    description: rawDescription,
    caption: rawCaption,
    transcript: rawTranscript,
    userText: rawUserText,
  });

  let primaryAnalysisText = '';
  let textSource = 'fallback-combined';

  if (rawUserText.length >= 20) {
    primaryAnalysisText = rawUserText;
    textSource = 'userText';
  } else if (metadataText.length >= 20 && looksLikeRecipeText(metadataText)) {
    primaryAnalysisText = metadataText;
    textSource = 'description';
  } else if (rawTranscript.length >= 20 && looksLikeRecipeText(rawTranscript)) {
    primaryAnalysisText = rawTranscript;
    textSource = 'transcript';
  } else if (metadataText.length >= 20) {
    primaryAnalysisText = metadataText;
    textSource = 'description-fallback';
  } else if (rawTranscript.length >= 20) {
    primaryAnalysisText = rawTranscript;
    textSource = 'transcript-fallback';
  } else {
    primaryAnalysisText = combinedText || rawTitle;
    textSource = combinedText ? 'fallback-combined' : 'title-only';
  }

  return {
    rawTitle,
    rawDescription: metadataText || rawDescription,
    combinedText,
    primaryAnalysisText,
    textSource,
    metadataText,
  };
}

export function logExtractTextPreview({
  rawTitle = '',
  rawDescription = '',
  combinedText = '',
  textSource = '',
  phase = 'pre-extract',
} = {}) {
  console.log(`${LOG_PREFIX} extract text preview (${phase})`, {
    rawTitle: rawTitle || '(없음)',
    rawDescription: rawDescription
      ? `${rawDescription.slice(0, 500)}${rawDescription.length > 500 ? `… (${rawDescription.length}자)` : ''}`
      : '(없음)',
    combinedText: combinedText
      ? `${combinedText.slice(0, 500)}${combinedText.length > 500 ? `… (${combinedText.length}자)` : ''}`
      : '(없음)',
    textSource: textSource || '(없음)',
    rawDescriptionLength: String(rawDescription || '').length,
    combinedTextLength: String(combinedText || '').length,
  });
}
