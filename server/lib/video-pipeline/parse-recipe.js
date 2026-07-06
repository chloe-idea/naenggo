/**
 * combinedText → 레시피 파싱 (OpenAI + 부분 성공 허용)
 */
import { analyzeVideoTextToRecipe, hasAnalyzableText } from '../openai-recipe.js';
import { isCombinedTextEmpty } from './recipe-text.js';
import { logVideoExtractPipeline } from './debug.js';
import { VIDEO_EXTRACT_UI } from './constants.js';

export { hasAnalyzableText };

/**
 * @param {object} context — combinedText, platform, videoId, metadata fields
 */
export async function parseRecipeFromText(context) {
  const combinedText = String(context?.combinedText || '').trim();

  logVideoExtractPipeline({
    phase: 'parseRecipeFromText:before',
    platform: context.platform,
    videoId: context.videoId,
    apiStatus: context.apiStatus,
    extractionMode: context.extractionMode,
    title: context.title,
    description: context.extractedDescription,
    captionText: context.extractedCaption,
    transcriptText: context.extractedTranscript,
    userPastedText: context.userText,
    combinedText,
  });

  if (isCombinedTextEmpty(combinedText) && !hasAnalyzableText(context)) {
    console.log('[YouTube Extract]', { extractionMode: 'failed', videoId: context.videoId });
    const err = new Error(VIDEO_EXTRACT_UI.FALLBACK_MSG);
    err.code = 'MISSING_CAPTION_TEXT';
    err.failureReason = 'MISSING_CAPTION_TEXT';
    err.fallback = true;
    throw err;
  }

  const recipe = await analyzeVideoTextToRecipe(context);

  logVideoExtractPipeline({
    phase: 'parseRecipeFromText:after',
    platform: context.platform,
    videoId: context.videoId,
    apiStatus: context.apiStatus,
    extractionMode: context.extractionMode || 'legacy-scraper',
    title: context.title,
    description: context.extractedDescription,
    captionText: context.extractedCaption,
    transcriptText: context.extractedTranscript,
    userPastedText: context.userText,
    combinedText,
    parsedIngredientsCount: recipe.ingredients?.length ?? 0,
    parsedStepsCount: recipe.steps?.length ?? 0,
  });

  return recipe;
}
