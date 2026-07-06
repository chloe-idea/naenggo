import {
  assertCanUseAnalysis,
  recordAnalysisUsage,
} from '../analysis-quota.js';
import {
  OPENAI_ERROR_CODES,
  resolveOpenAiHttpStatus,
  toOpenAiErrorPayload,
} from '../openai-errors.js';
import {
  buildExtractDebugPayload,
  logAnalysisContextDebug,
  logExtractFailure,
  resolveExtractFailure,
} from '../video-extract-debug.js';

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

    logAnalysisContextDebug(context);

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
      const failure = resolveExtractFailure(aiErr, context);
      logExtractFailure(aiErr, context, {
        openaiStatus: aiErr?.httpStatus,
        openaiCode: aiErr?.openaiCode,
      });
      console.error('[extract-video-recipe] analyzeRecipe failed:', {
        failureReason: failure.code,
        failureReasonLabel: failure.label,
        code: aiErr?.code,
        message: aiErr?.message,
        httpStatus: aiErr?.httpStatus,
        openaiCode: aiErr?.openaiCode,
        openaiMessage: aiErr?.openaiMessage,
        contentAvailability: aiErr?.contentAvailability || null,
      });
      console.error(aiErr);

      const debug = buildExtractDebugPayload({
        context,
        youtubeContent: context.platform === 'youtube' ? platformContent : null,
        promptPreview: aiErr?.openaiPromptPreview || null,
        openaiResponsePreview: aiErr?.openaiResponsePreview || null,
        failure,
      });

      if (aiErr.fallback) {
        return {
          status: 422,
          body: {
            success: false,
            error: aiErr.failureReason || aiErr.code || 'EXTRACTION_FAILED',
            message: failure.userMessage,
            failureReason: failure.code,
            failureReasonLabel: failure.label,
            fallback: true,
            warning: context.autoExtractFailed ? autoExtractWarning : null,
            infoHint: infoHint || context.infoHint || null,
            debug,
          },
        };
      }
      throw aiErr;
    }

    const aiUsage = await recordAnalysisUsage({ userId: trimmedUserId, idToken: token });
    const warnings = [
      context.autoExtractFailed ? autoExtractWarning : null,
      recipe.extractionWarning || null,
    ].filter(Boolean);
    const warning = warnings.length ? warnings.join(' ') : null;

    return {
      status: 200,
      body: {
        success: true,
        ...recipe,
        aiUsage,
        warning,
        extractionWarning: recipe.extractionWarning || null,
        infoHint: infoHint || context.infoHint || null,
        pipelineSteps: platformContent?.pipelineSteps || null,
      },
    };
  } catch (err) {
    console.error('[extract-video-recipe]', {
      code: err.code,
      message: err.message,
      stack: err.stack,
      details: err.details,
    });

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

    if (OPENAI_ERROR_CODES.has(err.code)) {
      const failure = resolveExtractFailure(err, null);
      return {
        status: resolveOpenAiHttpStatus(err),
        body: {
          success: false,
          error: err.failureReason || err.code,
          message: err.message,
          failureReason: failure.code,
          failureReasonLabel: failure.label,
          ...toOpenAiErrorPayload(err),
          debug: buildExtractDebugPayload({
            promptPreview: err.openaiPromptPreview || null,
            openaiResponsePreview: err.openaiResponsePreview || err.details?.slice?.(0, 500) || null,
            failure,
          }),
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
