import { Router } from 'express';
import { handleExtractVideoRecipeUnified } from '../lib/handlers/extract-video-recipe-unified.js';
import { resolveIdTokenFromHeaders } from '../lib/analysis-quota.js';
import {
  createVideoExtractTrace,
  getTraceReport,
  logVideoExtractStep,
  mapExtractErrorCode,
  runWithVideoExtractTrace,
  summarizeExtractLengths,
} from '../lib/video-extract-trace.js';

const router = Router();

router.post('/extract-video-recipe', async (req, res) => {
  const trace = createVideoExtractTrace();
  res.setHeader('X-Video-Extract-Request-Id', trace.requestId);

  return runWithVideoExtractTrace(trace, async () => {
    try {
      logVideoExtractStep('01 request received', {
        ok: true,
        nodeVersion: process.version,
        hasUrl: Boolean(req.body?.url),
        userTextLength: String(req.body?.userText || req.body?.pastedText || '').trim().length,
        hasAuthorization: Boolean(
          req.headers?.authorization || req.headers?.Authorization || req.headers?.['x-firebase-token'],
        ),
      });

      const result = await handleExtractVideoRecipeUnified({
        url: req.body?.url,
        userId: req.body?.userId || req.headers['x-user-id'],
        idToken: resolveIdTokenFromHeaders(req.headers),
        userText: req.body?.userText,
        caption: req.body?.caption,
        description: req.body?.description,
        pastedText: req.body?.pastedText,
      });

      const recipe = result?.body && result.body.success ? result.body : null;
      logVideoExtractStep('12 response sent', {
        httpStatus: result.status,
        ok: Boolean(result?.body?.success),
        errorCode: result?.body?.error || null,
        ...summarizeExtractLengths(recipe || {}),
        ...getTraceReport(),
      });

      if (result?.body && typeof result.body === 'object') {
        result.body.requestId = trace.requestId;
        result.body.trace = getTraceReport({
          lastSuccessfulStep: trace.lastStep,
        });
      }

      return res.status(result.status).json(result.body);
    } catch (err) {
      const errorCode = mapExtractErrorCode(err);
      logVideoExtractStep('12 response sent', {
        ok: false,
        errorCode,
        httpStatus: 500,
        ...getTraceReport(),
      });
      return res.status(500).json({
        success: false,
        error: errorCode,
        message: err?.message || '레시피 추출 중 오류가 발생했습니다.',
        requestId: trace.requestId,
        trace: getTraceReport({
          lastSuccessfulStep: trace.lastStep,
          firstFailedStep: errorCode,
        }),
      });
    }
  });
});

export default router;
