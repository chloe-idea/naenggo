import {
  assertCanUseAnalysis,
  recordAnalysisUsage,
} from '../analysis-quota.js';

/**
 * YouTube / Instagram 등 플랫폼 공통 레시피 추출 핸들러
 */
export async function handleExtractVideoRecipe({
  url,
  userId,
  idToken,
  userInputs,
  validateUrl,
  fetchContent,
  buildContext,
  analyzeRecipe,
  autoExtractWarning,
  infoHint,
  invalidUrlMessage,
  missingUrlMessage = '영상 링크(url)가 필요합니다.',
}) {
  const trimmedUrl = String(url || '').trim();
  const trimmedUserId = String(userId || '').trim();
  const token = String(idToken || '').trim();

  if (!token && !trimmedUserId) {
    return {
      status: 400,
      body: { success: false, error: 'MISSING_USER_ID', message: 'userId가 필요합니다.' },
    };
  }

  if (!trimmedUrl) {
    return {
      status: 400,
      body: { success: false, error: 'MISSING_URL', message: missingUrlMessage },
    };
  }

  const urlValidation = validateUrl(trimmedUrl);
  if (!urlValidation.ok) {
    return {
      status: 400,
      body: {
        success: false,
        error: urlValidation.error || 'INVALID_URL',
        message: urlValidation.message || invalidUrlMessage,
      },
    };
  }

  try {
    let platformContent;
    try {
      platformContent = await fetchContent(trimmedUrl, urlValidation);
    } catch (fetchErr) {
      console.warn('[extract-video-recipe] fetchContent failed:', fetchErr?.message || fetchErr);
      if (fetchErr.code === 'INVALID_SHORTCODE' || fetchErr.code === 'INVALID_VIDEO_ID') {
        return {
          status: 400,
          body: {
            success: false,
            error: fetchErr.code,
            message: invalidUrlMessage,
          },
        };
      }
      platformContent = urlValidation.createPartialContent(trimmedUrl, urlValidation);
    }

    const context = buildContext({
      content: platformContent,
      url: trimmedUrl,
      userInputs,
    });

    try {
      await assertCanUseAnalysis({ userId: trimmedUserId, idToken: token });
    } catch (limitErr) {
      if (limitErr.code === 'ANALYSIS_LIMIT_EXCEEDED' || limitErr.code === 'DAILY_LIMIT_EXCEEDED') {
        return {
          status: 429,
          body: {
            success: false,
            error: 'ANALYSIS_LIMIT_EXCEEDED',
            message: limitErr.message,
            aiUsage: limitErr.aiUsage,
          },
        };
      }
      if (limitErr.code === 'INVALID_ID_TOKEN') {
        return {
          status: 401,
          body: { success: false, error: limitErr.code, message: limitErr.message },
        };
      }
      throw limitErr;
    }

    let recipe;
    try {
      recipe = await analyzeRecipe(context);
    } catch (aiErr) {
      if (aiErr.fallback) {
        return {
          status: 422,
          body: {
            success: false,
            error: aiErr.code || 'EXTRACTION_FAILED',
            message: aiErr.message,
            fallback: true,
            warning: context.autoExtractFailed ? autoExtractWarning : null,
            infoHint: infoHint || context.infoHint || null,
          },
        };
      }
      throw aiErr;
    }

    const aiUsage = await recordAnalysisUsage({ userId: trimmedUserId, idToken: token });
    const warning = context.autoExtractFailed ? autoExtractWarning : null;

    return {
      status: 200,
      body: {
        success: true,
        ...recipe,
        aiUsage,
        warning,
        infoHint: infoHint || context.infoHint || null,
        pipelineSteps: platformContent?.pipelineSteps || null,
      },
    };
  } catch (err) {
    console.error('[extract-video-recipe]', err.code || err.message, err.details || '');

    if (err.code === 'ANALYSIS_LIMIT_EXCEEDED' || err.code === 'DAILY_LIMIT_EXCEEDED') {
      return {
        status: 429,
        body: {
          success: false,
          error: 'ANALYSIS_LIMIT_EXCEEDED',
          message: err.message,
          aiUsage: err.aiUsage,
        },
      };
    }

    if (err.code === 'INVALID_ID_TOKEN') {
      return {
        status: 401,
        body: { success: false, error: err.code, message: err.message },
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
