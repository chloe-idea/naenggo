import {
  extractYouTubeVideoId,
  fetchYouTubeContent,
  buildAnalysisContext,
  VIDEO_AUTO_EXTRACT_FAILED_WARNING,
} from '../youtube.js';
import { analyzeYouTubeTextToRecipe } from '../openai-recipe.js';
import { assertCanUseAi, recordAiUsage } from '../ai-usage-limit.js';

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

export async function handleExtractYoutubeRecipe({
  url,
  userId,
  userText,
  caption,
  description,
  pastedText,
}) {
  const trimmedUrl = String(url || '').trim();
  const trimmedUserId = String(userId || '').trim();
  const userInputs = { userText, caption, description, pastedText };

  if (!trimmedUserId) {
    return {
      status: 400,
      body: { success: false, error: 'MISSING_USER_ID', message: 'userId가 필요합니다.' },
    };
  }

  if (!trimmedUrl) {
    return {
      status: 400,
      body: { success: false, error: 'MISSING_URL', message: '영상 링크(url)가 필요합니다.' },
    };
  }

  const videoId = extractYouTubeVideoId(trimmedUrl);
  if (!videoId) {
    return {
      status: 400,
      body: { success: false, error: 'INVALID_URL', message: '유효한 YouTube 링크가 아닙니다.' },
    };
  }

  try {
    let youtubeContent;
    try {
      youtubeContent = await fetchYouTubeContent(trimmedUrl);
    } catch (fetchErr) {
      console.warn('[extract-youtube-recipe] fetchYouTubeContent failed:', fetchErr?.message || fetchErr);
      youtubeContent = createPartialYoutubeContent(videoId, trimmedUrl);
    }

    const context = buildAnalysisContext({
      youtubeContent,
      url: trimmedUrl,
      userInputs,
    });

    try {
      assertCanUseAi(trimmedUserId);
    } catch (limitErr) {
      if (limitErr.code === 'DAILY_LIMIT_EXCEEDED') {
        return {
          status: 429,
          body: {
            success: false,
            error: 'DAILY_LIMIT_EXCEEDED',
            message: limitErr.message,
            aiUsage: limitErr.aiUsage,
          },
        };
      }
      throw limitErr;
    }

    let recipe;
    try {
      recipe = await analyzeYouTubeTextToRecipe(context);
    } catch (aiErr) {
      if (aiErr.fallback) {
        return {
          status: 422,
          body: {
            success: false,
            error: aiErr.code || 'EXTRACTION_FAILED',
            message: aiErr.message,
            fallback: true,
            warning: context.autoExtractFailed ? VIDEO_AUTO_EXTRACT_FAILED_WARNING : null,
          },
        };
      }
      throw aiErr;
    }

    const aiUsage = recordAiUsage(trimmedUserId);
    const warning = context.autoExtractFailed ? VIDEO_AUTO_EXTRACT_FAILED_WARNING : null;

    return {
      status: 200,
      body: {
        success: true,
        ...recipe,
        aiUsage,
        warning,
      },
    };
  } catch (err) {
    console.error('[extract-youtube-recipe]', err.code || err.message, err.details || '');

    if (err.code === 'DAILY_LIMIT_EXCEEDED') {
      return {
        status: 429,
        body: {
          success: false,
          error: 'DAILY_LIMIT_EXCEEDED',
          message: err.message,
          aiUsage: err.aiUsage,
        },
      };
    }

    if (err.code === 'MISSING_OPENAI_KEY') {
      return {
        status: 503,
        body: {
          success: false,
          error: err.code,
          message: '서버 AI 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.',
        },
      };
    }

    return {
      status: 500,
      body: {
        success: false,
        error: err.code || 'SERVER_ERROR',
        message: '레시피 추출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      },
    };
  }
}
