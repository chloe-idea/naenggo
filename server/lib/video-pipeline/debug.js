/** 영상 레시피 추출 파이프라인 디버그 로그 */

export function logVideoExtractPipeline({
  phase = 'pipeline',
  platform = null,
  videoId = null,
  apiStatus = null,
  extractionMode = null,
  title = '',
  description = '',
  captionText = '',
  transcriptText = '',
  userPastedText = '',
  combinedText = '',
  parsedIngredientsCount = null,
  parsedStepsCount = null,
} = {}) {
  console.log('[VideoExtract Pipeline]', {
    phase,
    platform: platform || '(unknown)',
    videoId: videoId || null,
    extractionMode: extractionMode || null,
    apiStatus: apiStatus ?? null,
    titleLength: String(title || '').length,
    descriptionLength: String(description || '').length,
    captionTextLength: String(captionText || '').length,
    transcriptLength: String(transcriptText || '').length,
    userPastedTextLength: String(userPastedText || '').length,
    combinedTextLength: String(combinedText || '').length,
    ...(parsedIngredientsCount != null ? { ingredientsCount: parsedIngredientsCount } : {}),
    ...(parsedStepsCount != null ? { stepsCount: parsedStepsCount } : {}),
  });
}
