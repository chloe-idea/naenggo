import { handleExtractVideoRecipeUnified } from '../server/lib/handlers/extract-video-recipe-unified.js';
import { resolveIdTokenFromHeaders } from '../server/lib/analysis-quota.js';
import {
  createVideoExtractTrace,
  getTraceReport,
  logVideoExtractStep,
  mapExtractErrorCode,
  runWithVideoExtractTrace,
  summarizeExtractLengths,
} from '../server/lib/video-extract-trace.js';

/** Vercel: Node.js serverless only (youtubei.js is not Edge-compatible).
 *  hnd1: US datacenter IPs (iad1) often get YouTube LOGIN_REQUIRED / empty metadata. */
export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  regions: ['hnd1'],
};

function parseJsonBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return {};
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id, Authorization, X-Firebase-Token');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED', message: 'POST만 지원합니다.' });
  }

  const trace = createVideoExtractTrace();
  res.setHeader('X-Video-Extract-Request-Id', trace.requestId);

  return runWithVideoExtractTrace(trace, async () => {
    try {
      const body = parseJsonBody(req);
      logVideoExtractStep('01 request received', {
        ok: true,
        nodeVersion: process.version,
        hasUrl: Boolean(body?.url),
        userTextLength: String(body?.userText || body?.pastedText || '').trim().length,
        hasAuthorization: Boolean(
          req.headers?.authorization || req.headers?.Authorization || req.headers?.['x-firebase-token'],
        ),
      });

      const result = await handleExtractVideoRecipeUnified({
        url: body?.url,
        userId: body?.userId || req.headers['x-user-id'],
        idToken: resolveIdTokenFromHeaders(req.headers),
        userText: body?.userText,
        caption: body?.caption,
        description: body?.description,
        pastedText: body?.pastedText,
      });

      const recipe = result?.body && result.body.success ? result.body : null;
      const priorFailedStep = result?.body?.firstFailedStep
        || result?.body?.trace?.firstFailedStep
        || null;
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
          lastSuccessfulStep: priorFailedStep
            ? (result.body.trace?.lastStep || result.body.lastStep || null)
            : trace.lastStep,
          firstFailedStep: priorFailedStep,
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
      console.error('[VideoExtract] uncaught handler error', {
        ...getTraceReport({ errorCode }),
        message: err?.message || String(err),
        code: err?.code || null,
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
}
