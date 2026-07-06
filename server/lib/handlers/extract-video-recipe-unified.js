/**
 * 통합 영상 레시피 추출 핸들러 (플랫폼 registry)
 */
import { validateVideoUrl } from '../video-pipeline/platform.js';
import { fetchVideoMetadata } from '../video-pipeline/metadata.js';
import { buildAnalysisContextFromMetadata } from '../video-pipeline/context.js';
import { parseRecipeFromText } from '../video-pipeline/parse-recipe.js';
import {
  VideoPlatform,
  VIDEO_EXTRACT_UI,
  getPlatformHint,
} from '../video-pipeline/constants.js';
import { handleExtractVideoRecipe } from './extract-video-recipe-shared.js';

function createPartialContent(url, validation) {
  return {
    platform: validation.platform,
    videoId: validation.videoId,
    title: '',
    thumbnailUrl: null,
    sourceUrl: url,
    extractedDescription: '',
    extractedCaption: '',
    extractedTranscript: '',
    combinedText: '',
    apiStatus: 'partial',
    autoExtractFailed: true,
  };
}

export async function handleExtractVideoRecipeUnified(params) {
  const validation = validateVideoUrl(params.url);
  if (!validation.ok) {
    return {
      status: validation.error === 'MISSING_URL' ? 400 : 400,
      body: {
        success: false,
        error: validation.error,
        message: validation.message,
      },
    };
  }

  const platform = validation.platform;
  const autoExtractWarning = platform === VideoPlatform.INSTAGRAM_REELS
    ? VIDEO_EXTRACT_UI.AUTO_EXTRACT_FAILED
    : VIDEO_EXTRACT_UI.AUTO_EXTRACT_FAILED;

  return handleExtractVideoRecipe({
    ...params,
    userInputs: {
      userText: params.userText,
      caption: params.caption,
      description: params.description,
      pastedText: params.pastedText,
    },
    invalidUrlMessage: validation.message,
    autoExtractWarning,
    infoHint: getPlatformHint(platform),
    validateUrl() {
      return {
        ok: true,
        platform,
        videoId: validation.videoId,
        createPartialContent: (u) => createPartialContent(u, validation),
      };
    },
    fetchContent: fetchVideoMetadata,
    buildContext: ({ content, url, userInputs }) => buildAnalysisContextFromMetadata({
      metadata: content,
      url,
      userInputs,
    }),
    analyzeRecipe: parseRecipeFromText,
  });
}
