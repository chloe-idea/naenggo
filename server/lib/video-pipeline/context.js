/**
 * 플랫폼 메타데이터 + 사용자 입력 → OpenAI 분석 컨텍스트
 */
import { combineRecipeText, mergeUserTextInput } from './recipe-text.js';
import { resolveExtractTextPriority, logExtractTextPreview } from '../video-text-priority.js';
import { VideoPlatform, VIDEO_EXTRACT_UI } from './constants.js';
import { detectVideoPlatform, extractVideoId } from './platform.js';
import { logVideoExtractPipeline } from './debug.js';

/**
 * @param {object} params
 * @returns {object}
 */
export function buildAnalysisContextFromMetadata({ metadata, url, userInputs = {} }) {
  const platform = metadata?.platform || detectVideoPlatform(url);
  const videoId = metadata?.videoId || extractVideoId(url, platform);
  const mergedUserText = mergeUserTextInput(userInputs);
  const hasUserPaste = mergedUserText.length >= 20;

  const title = String(metadata?.title || '').trim();
  const extractedDescription = String(
    metadata?.extractedDescription || metadata?.extractedCaption || '',
  ).trim();
  const extractedCaption = String(
    userInputs?.caption || metadata?.extractedCaption || '',
  ).trim();
  const extractedTranscript = String(metadata?.extractedTranscript || '').trim();
  const apiStatus = metadata?.apiStatus || 'unknown';

  const combinedText = combineRecipeText({
    title,
    description: extractedDescription,
    caption: extractedCaption,
    transcript: extractedTranscript,
    userPastedText: mergedUserText,
  });

  const resolved = resolveExtractTextPriority({
    title,
    extractedDescription,
    extractedCaption,
    extractedTranscript,
    userText: mergedUserText,
  });

  let extractionMode = metadata?.extractionMode || 'legacy-scraper';
  if (hasUserPaste && resolved.textSource === 'userText') {
    extractionMode = 'manual-text';
  } else if (!combinedText.trim() && !hasUserPaste) {
    extractionMode = 'failed';
  }

  logExtractTextPreview({
    rawTitle: resolved.rawTitle,
    rawDescription: resolved.rawDescription,
    combinedText,
    textSource: resolved.textSource,
    phase: `${platform}-analysis`,
  });

  console.log('[YouTube Extract]', {
    extractionMode,
    videoId,
    apiStatus,
    titleLength: title.length,
    descriptionLength: extractedDescription.length,
    userPastedTextLength: mergedUserText.length,
    combinedTextLength: combinedText.length,
    textSource: resolved.textSource,
  });

  logVideoExtractPipeline({
    phase: 'buildAnalysisContext',
    platform,
    videoId,
    apiStatus,
    extractionMode,
    title,
    description: extractedDescription,
    captionText: extractedCaption,
    transcriptText: extractedTranscript,
    userPastedText: mergedUserText,
    combinedText,
  });

  const backendPlatform = platform === VideoPlatform.INSTAGRAM_REELS
    ? 'instagram'
    : (platform === VideoPlatform.YOUTUBE_SHORTS ? 'youtube' : platform);

  const autoExtractFailed = Boolean(metadata?.autoExtractFailed && !hasUserPaste);

  return {
    platform: backendPlatform === VideoPlatform.UNKNOWN ? 'youtube' : backendPlatform,
    detectedPlatform: platform,
    videoId,
    apiStatus,
    extractionMode,
    sourceUrl: metadata?.sourceUrl || url,
    thumbnailUrl: metadata?.thumbnailUrl || null,
    title,
    rawTitle: resolved.rawTitle,
    rawDescription: resolved.rawDescription,
    combinedText,
    primaryAnalysisText: resolved.primaryAnalysisText,
    textSource: resolved.textSource,
    extractedDescription,
    extractedTranscript,
    extractedCaption,
    userText: mergedUserText,
    autoExtractFailed,
    hasUserText: hasUserPaste,
    infoHint: autoExtractFailed ? VIDEO_EXTRACT_UI.FALLBACK_MSG : null,
    pipelineSteps: metadata?.pipelineSteps || null,
  };
}
