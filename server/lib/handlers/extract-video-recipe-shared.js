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
import { assertNoDuplicateFirestoreVideo } from '../firestore-video-duplicate.js';
import { resolveAuthUidFromToken } from '../firestore-analysis-quota.js';
import {
  getTraceReport,
  logVideoExtractStep,
  mapExtractErrorCode,
  summarizeExtractLengths,
} from '../video-extract-trace.js';

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
    let authUid = null;
    if (token) {
      authUid = await resolveAuthUidFromToken(token);
      logVideoExtractStep('02 auth verified', {
        ok: Boolean(authUid),
        hasToken: true,
      });
    } else {
      logVideoExtractStep('02 auth verified', {
        ok: true,
        hasToken: false,
        guestUserId: Boolean(trimmedUserId),
      });
    }

    logVideoExtractStep('03 url normalized', {
      platform: urlValidation.platform,
      videoId: urlValidation.videoId,
      ok: true,
    });

    if (authUid) {
      const dupCheck = await assertNoDuplicateFirestoreVideo(authUid, trimmedUrl);
      if (dupCheck.duplicate) {
        return {
          status: 409,
          body: {
            success: false,
            error: 'DUPLICATE_VIDEO_SOURCE',
            message: '이미 등록된 영상입니다.',
            duplicateRecipeId: dupCheck.recipeId || null,
            ...getTraceReport(),
          },
        };
      }
    }

    let platformContent;
    try {
      platformContent = await fetchContent(trimmedUrl, urlValidation);
    } catch (fetchErr) {
      console.warn('[extract-video-recipe] fetchContent failed:', {
        ...getTraceReport({ errorCode: mapExtractErrorCode(fetchErr) }),
        message: fetchErr?.message || String(fetchErr),
        code: fetchErr?.code || null,
      });
      if (fetchErr.code === 'INVALID_SHORTCODE' || fetchErr.code === 'INVALID_VIDEO_ID') {
        return {
          status: 400,
          body: {
            success: false,
            error: 'YOUTUBE_METADATA_FAILED',
            message: invalidUrlMessage,
            ...getTraceReport({ firstFailedStep: '04 youtube metadata start' }),
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

    logVideoExtractStep('08 combined text ready', summarizeExtractLengths({
      ...context,
      title: context.title,
      description: context.extractedDescription,
      transcript: context.extractedTranscript,
      combinedText: context.combinedText,
      userText: context.userText,
      platform: context.platform,
      videoId: context.videoId,
      apiStatus: context.apiStatus,
      extractionMode: context.extractionMode,
    }));

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
            ...getTraceReport(),
          },
        };
      }
      if (limitErr.code === 'INVALID_ID_TOKEN') {
        return {
          status: limitErr.httpStatus || 401,
          body: {
            success: false,
            error: limitErr.code,
            message: limitErr.message,
            firebaseCode: limitErr.firebaseCode || null,
            ...getTraceReport(),
          },
        };
      }
      throw limitErr;
    }

    let recipe;
    try {
      logVideoExtractStep('09 OpenAI request start', summarizeExtractLengths({
        combinedText: context.combinedText,
        userText: context.userText,
        platform: context.platform,
        videoId: context.videoId,
      }));
      recipe = await analyzeRecipe(context);
      logVideoExtractStep('10 OpenAI request complete', summarizeExtractLengths(recipe));
      logVideoExtractStep('11 response normalization complete', summarizeExtractLengths(recipe));
    } catch (aiErr) {
      const failure = resolveExtractFailure(aiErr, context);
      const mapped = mapExtractErrorCode(aiErr);
      logExtractFailure(aiErr, context, {
        openaiStatus: aiErr?.httpStatus,
        openaiCode: aiErr?.openaiCode,
      });
      console.error('[extract-video-recipe] analyzeRecipe failed:', {
        ...getTraceReport({ errorCode: mapped, firstFailedStep: '09 OpenAI request start' }),
        failureReason: failure.code,
        failureReasonLabel: failure.label,
        code: aiErr?.code,
        message: aiErr?.message,
        httpStatus: aiErr?.httpStatus,
        openaiCode: aiErr?.openaiCode,
        contentAvailability: aiErr?.contentAvailability || null,
      });

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
            error: aiErr.failureReason || aiErr.code || mapped || 'EXTRACTION_FAILED',
            message: failure.userMessage,
            failureReason: failure.code,
            failureReasonLabel: failure.label,
            fallback: true,
            warning: context.autoExtractFailed ? autoExtractWarning : null,
            infoHint: infoHint || context.infoHint || null,
            debug,
            ...getTraceReport({ firstFailedStep: mapped }),
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
        extractStatus: recipe.extractStatus || 'full',
        partialReason: recipe.partialReason || null,
        infoHint: infoHint || context.infoHint || null,
        pipelineSteps: platformContent?.pipelineSteps || null,
      },
    };
  } catch (err) {
    const mapped = mapExtractErrorCode(err);
    const expectedFallback = Boolean(err?.fallback)
      || ['INSUFFICIENT_RECIPE_SOURCE', 'INCOMPLETE_RECIPE', 'NOT_A_RECIPE', 'OPENAI_NOT_A_RECIPE'].includes(err?.code);
    if (expectedFallback) {
      console.warn('[extract-video-recipe] expected extract fallback:', {
        ...getTraceReport({ errorCode: mapped }),
        code: err.code,
        message: err.message,
      });
    } else {
      console.error('[extract-video-recipe]', {
        ...getTraceReport({ errorCode: mapped }),
        code: err.code,
        message: err.message,
        stack: err.stack,
        details: err.details,
      });
    }

    if (err.code === 'ANALYSIS_LIMIT_EXCEEDED' || err.code === 'DAILY_LIMIT_EXCEEDED') {
      return {
        status: 429,
        body: {
          success: false,
          error: 'ANALYSIS_LIMIT_EXCEEDED',
          message: err.message,
          aiUsage: err.aiUsage,
          ...getTraceReport(),
        },
      };
    }

    if (err.code === 'INVALID_ID_TOKEN') {
      return {
        status: err.httpStatus || 401,
        body: {
          success: false,
          error: err.code,
          message: err.message,
          firebaseCode: err.firebaseCode || null,
          ...getTraceReport(),
        },
      };
    }

    if (OPENAI_ERROR_CODES.has(err.code)) {
      const failure = resolveExtractFailure(err, null);
      return {
        status: resolveOpenAiHttpStatus(err),
        body: {
          success: false,
          error: mapped,
          message: err.message,
          failureReason: failure.code,
          failureReasonLabel: failure.label,
          ...toOpenAiErrorPayload(err),
          debug: buildExtractDebugPayload({
            promptPreview: err.openaiPromptPreview || null,
            openaiResponsePreview: err.openaiResponsePreview || err.details?.slice?.(0, 500) || null,
            failure,
          }),
          ...getTraceReport({ firstFailedStep: mapped }),
        },
      };
    }

    return {
      status: 500,
      body: {
        success: false,
        error: mapped || err.code || 'INTERNAL_ERROR',
        message: err.message || '레시피 추출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        ...getTraceReport({ firstFailedStep: mapped || 'INTERNAL_ERROR' }),
      },
    };
  }
}
