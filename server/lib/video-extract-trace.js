/**
 * Production/local 공통 — AI 레시피 추출 단계 추적 (민감 본문 미기록)
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

const storage = new AsyncLocalStorage();

export function createVideoExtractTrace(requestId) {
  const id = String(requestId || '').trim() || randomBytes(4).toString('hex');
  return {
    requestId: id,
    startedAt: Date.now(),
    lastStep: null,
    steps: [],
  };
}

export function runWithVideoExtractTrace(trace, fn) {
  return storage.run(trace, fn);
}

export function getVideoExtractTrace() {
  return storage.getStore() || null;
}

function textLen(value) {
  return String(value || '').trim().length;
}

/** 본문 없이 길이·카운트만 남기는 안전한 요약 */
export function summarizeExtractLengths(input = {}) {
  const out = {};
  if (input.title != null || input.titleLength != null) {
    out.titleLength = input.titleLength ?? textLen(input.title);
  }
  if (input.description != null || input.descriptionLength != null || input.extractedDescription != null) {
    out.descriptionLength = input.descriptionLength
      ?? textLen(input.description ?? input.extractedDescription);
  }
  if (input.transcript != null || input.transcriptLength != null || input.extractedTranscript != null) {
    out.transcriptLength = input.transcriptLength
      ?? textLen(input.transcript ?? input.extractedTranscript);
  }
  if (input.combinedText != null || input.combinedTextLength != null) {
    out.combinedTextLength = input.combinedTextLength ?? textLen(input.combinedText);
  }
  if (input.userText != null || input.userTextLength != null) {
    out.userTextLength = input.userTextLength ?? textLen(input.userText);
  }
  if (Array.isArray(input.ingredients) || input.ingredientCount != null) {
    out.ingredientCount = input.ingredientCount ?? (input.ingredients?.length ?? 0);
  }
  if (Array.isArray(input.steps) || input.stepCount != null) {
    out.stepCount = input.stepCount ?? (input.steps?.length ?? 0);
  }
  if (input.platform) out.platform = input.platform;
  if (input.videoId) out.videoId = input.videoId;
  if (input.apiStatus) out.apiStatus = input.apiStatus;
  if (input.extractionMode) out.extractionMode = input.extractionMode;
  if (input.errorCode) out.errorCode = input.errorCode;
  if (input.httpStatus != null) out.httpStatus = input.httpStatus;
  if (input.ok != null) out.ok = input.ok;
  return out;
}

/**
 * @param {string} stepLabel e.g. "01 request received"
 * @param {object} [detail]
 */
export function logVideoExtractStep(stepLabel, detail = {}) {
  const trace = getVideoExtractTrace();
  const requestId = trace?.requestId || 'no-trace';
  const now = Date.now();
  const durationMs = trace ? now - trace.startedAt : null;
  const stepDurationMs = trace?.lastAt ? now - trace.lastAt : 0;
  if (trace) {
    trace.lastStep = stepLabel;
    trace.lastAt = now;
    trace.steps.push({ step: stepLabel, durationMs, stepDurationMs });
  }

  const safe = summarizeExtractLengths(detail);
  console.log(`[VideoExtract][${requestId}] ${stepLabel}`, {
    durationMs,
    stepDurationMs,
    ...safe,
    ...Object.fromEntries(
      Object.entries(detail).filter(([key, value]) => (
        !['title', 'description', 'transcript', 'combinedText', 'userText', 'extractedDescription', 'extractedTranscript', 'ingredients', 'steps'].includes(key)
        && (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')
        && String(key).length < 40
        && String(value).length < 120
      )),
    ),
  });
}

export function getTraceReport(extra = {}) {
  const trace = getVideoExtractTrace();
  if (!trace) return { requestId: null, ...extra };
  return {
    requestId: trace.requestId,
    lastStep: trace.lastStep,
    totalDurationMs: Date.now() - trace.startedAt,
    stepCount: trace.steps.length,
    ...extra,
  };
}

export function mapExtractErrorCode(err) {
  const code = String(err?.code || err?.failureReason || '').trim();
  if (code === 'MISSING_OPENAI_KEY') return 'OPENAI_NOT_CONFIGURED';
  if (code === 'OPENAI_PARSE' || code === 'OPENAI_EMPTY') return 'OPENAI_INVALID_RESPONSE';
  if (OPENAI_FAIL.has(code)) return 'OPENAI_REQUEST_FAILED';
  if (code === 'MISSING_CAPTION_TEXT' || code === 'INPUT_TEXT_EMPTY') return 'INPUT_TEXT_EMPTY';
  if (code === 'YOUTUBE_METADATA_FAILED' || code === 'INVALID_VIDEO_ID') return 'YOUTUBE_METADATA_FAILED';
  if (code === 'YOUTUBE_TRANSCRIPT_FAILED') return 'YOUTUBE_TRANSCRIPT_FAILED';
  if (code === 'FUNCTION_TIMEOUT' || /timeout/i.test(String(err?.message || ''))) return 'FUNCTION_TIMEOUT';
  if (code) return code;
  return 'INTERNAL_ERROR';
}

const OPENAI_FAIL = new Set([
  'OPENAI_AUTH_ERROR',
  'OPENAI_FORBIDDEN',
  'OPENAI_MODEL_NOT_FOUND',
  'OPENAI_RATE_LIMIT',
  'OPENAI_SERVER_ERROR',
  'OPENAI_ERROR',
  'OPENAI_RESPONSE_FAILED',
]);
