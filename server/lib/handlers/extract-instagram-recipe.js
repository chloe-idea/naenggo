import {
  extractInstagramShortcode,
  fetchInstagramReelsContent,
  buildInstagramAnalysisContext,
  INSTAGRAM_AUTO_EXTRACT_FAILED_WARNING,
  INSTAGRAM_REELS_EXTRACT_HINT,
} from '../instagram.js';
import { analyzeVideoTextToRecipe } from '../openai-recipe.js';
import { handleExtractVideoRecipe } from './extract-video-recipe-shared.js';

function createPartialInstagramContent(shortcode, url) {
  return {
    platform: 'instagram',
    shortcode,
    title: '',
    thumbnailUrl: null,
    sourceUrl: url,
    extractedCaption: '',
    extractedDescription: '',
    sttText: '',
    ocrText: '',
    autoExtractFailed: true,
    pipelineSteps: [],
  };
}

export async function handleExtractInstagramRecipe(params) {
  return handleExtractVideoRecipe({
    ...params,
    userInputs: {
      userText: params.userText,
      caption: params.caption,
      description: params.description,
      pastedText: params.pastedText,
    },
    invalidUrlMessage: '유효한 Instagram 릴스/게시물 링크가 아닙니다.',
    autoExtractWarning: INSTAGRAM_AUTO_EXTRACT_FAILED_WARNING,
    infoHint: INSTAGRAM_REELS_EXTRACT_HINT,
    validateUrl(url) {
      const shortcode = extractInstagramShortcode(url);
      if (!shortcode) {
        return {
          ok: false,
          error: 'INVALID_URL',
          message: '유효한 Instagram 릴스/게시물 링크가 아닙니다.',
        };
      }
      return {
        ok: true,
        shortcode,
        createPartialContent: (u) => createPartialInstagramContent(shortcode, u),
      };
    },
    fetchContent: fetchInstagramReelsContent,
    buildContext: ({ content, url, userInputs }) => buildInstagramAnalysisContext({
      instagramContent: content,
      url,
      userInputs,
    }),
    analyzeRecipe: analyzeVideoTextToRecipe,
  });
}
