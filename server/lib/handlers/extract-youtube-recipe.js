import { extractYouTubeVideoId, fetchYouTubeContent } from '../youtube.js';
import { analyzeYouTubeTextToRecipe } from '../openai-recipe.js';
import { assertCanUseAi, recordAiUsage } from '../ai-usage-limit.js';

export async function handleExtractYoutubeRecipe({ url, userId }) {
  const trimmedUrl = String(url || '').trim();
  const trimmedUserId = String(userId || '').trim();

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
    const youtubeContent = await fetchYouTubeContent(trimmedUrl);

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

    const recipe = await analyzeYouTubeTextToRecipe(youtubeContent);
    const aiUsage = recordAiUsage(trimmedUserId);

    return {
      status: 200,
      body: { success: true, ...recipe, aiUsage },
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

    if (err.fallback) {
      return {
        status: 422,
        body: {
          success: false,
          error: err.code || 'EXTRACTION_FAILED',
          message: err.message,
          fallback: true,
        },
      };
    }

    if (err.code === 'INVALID_VIDEO_ID' || err.code === 'INVALID_URL') {
      return { status: 400, body: { success: false, error: err.code, message: err.message } };
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

    if (err.code === 'NO_TEXT') {
      return {
        status: 422,
        body: { success: false, error: err.code, message: err.message, fallback: true },
      };
    }

    if (err.code === 'VIDEO_UNAVAILABLE') {
      return {
        status: 404,
        body: {
          success: false,
          error: err.code,
          message: 'YouTube 영상을 찾을 수 없거나 접근할 수 없습니다.',
          fallback: true,
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
