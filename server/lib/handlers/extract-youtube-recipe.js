import {
  extractYouTubeVideoId,
  fetchYouTubeContent,
  buildAnalysisContext,
  VIDEO_AUTO_EXTRACT_FAILED_WARNING,
} from '../youtube.js';
import { analyzeVideoTextToRecipe } from '../openai-recipe.js';
import { handleExtractVideoRecipe } from './extract-video-recipe-shared.js';

function createPartialYoutubeContent(videoId, url) {
  return {
    videoId,
    title: '',
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    sourceUrl: url,
    extractedDescription: '',
    extractedTranscript: '',
    text: '',
    textSource: '',
    autoExtractFailed: true,
  };
}

export async function handleExtractYoutubeRecipe(params) {
  return handleExtractVideoRecipe({
    ...params,
    userInputs: {
      userText: params.userText,
      caption: params.caption,
      description: params.description,
      pastedText: params.pastedText,
    },
    invalidUrlMessage: '유효한 YouTube 링크가 아닙니다.',
    autoExtractWarning: VIDEO_AUTO_EXTRACT_FAILED_WARNING,
    validateUrl(url) {
      const videoId = extractYouTubeVideoId(url);
      if (!videoId) {
        return {
          ok: false,
          error: 'INVALID_URL',
          message: '유효한 YouTube 링크가 아닙니다.',
        };
      }
      return {
        ok: true,
        videoId,
        createPartialContent: (u) => createPartialYoutubeContent(videoId, u),
      };
    },
    fetchContent: fetchYouTubeContent,
    buildContext: ({ content, url, userInputs }) => buildAnalysisContext({
      youtubeContent: content,
      url,
      userInputs,
    }),
    analyzeRecipe: analyzeVideoTextToRecipe,
  });
}
