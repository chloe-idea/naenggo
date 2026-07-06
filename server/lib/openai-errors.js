export function parseOpenAiErrorBody(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    const apiError = parsed?.error;
    if (typeof apiError === 'string') {
      return { openaiCode: null, openaiMessage: apiError, responseBody: parsed };
    }
    if (apiError && typeof apiError === 'object') {
      return {
        openaiCode: apiError.code || apiError.type || null,
        openaiMessage: apiError.message || null,
        responseBody: parsed,
      };
    }
    return { openaiCode: null, openaiMessage: null, responseBody: parsed };
  } catch {
    return {
      openaiCode: null,
      openaiMessage: bodyText?.slice(0, 500) || null,
      responseBody: bodyText,
    };
  }
}

export function getOpenAiErrorCode(httpStatus) {
  if (httpStatus === 401) return 'OPENAI_AUTH_ERROR';
  if (httpStatus === 403) return 'OPENAI_FORBIDDEN';
  if (httpStatus === 404) return 'OPENAI_MODEL_NOT_FOUND';
  if (httpStatus === 429) return 'OPENAI_RATE_LIMIT';
  if (httpStatus >= 500) return 'OPENAI_SERVER_ERROR';
  return 'OPENAI_ERROR';
}

export function getOpenAiUserMessage(httpStatus, { openaiCode, openaiMessage } = {}) {
  const detail = openaiMessage ? ` (${openaiMessage})` : '';
  switch (httpStatus) {
    case 401:
      return `OpenAI API Key 오류입니다. OPENAI_API_KEY를 확인해 주세요.${detail}`;
    case 403:
      return `OpenAI 접근이 거부되었습니다.${detail}`;
    case 404:
      return `OpenAI 모델을 찾을 수 없습니다. OPENAI_MODEL 설정을 확인해 주세요.${detail}`;
    case 429:
      return `OpenAI 사용량 한도를 초과했습니다. 잠시 후 다시 시도하거나 quota를 확인해 주세요.${detail}`;
    case 500:
    case 502:
    case 503:
      return `OpenAI 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.${detail}`;
    default:
      return `OpenAI API 오류 (${httpStatus})${detail}`;
  }
}

export function createOpenAiHttpError(response, bodyText) {
  const httpStatus = response.status;
  const { openaiCode, openaiMessage, responseBody } = parseOpenAiErrorBody(bodyText);
  const code = getOpenAiErrorCode(httpStatus);
  const message = getOpenAiUserMessage(httpStatus, { openaiCode, openaiMessage });

  const err = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  err.openaiCode = openaiCode;
  err.openaiMessage = openaiMessage;
  err.responseBody = responseBody;
  err.details = bodyText;

  console.error('[OpenAI] API error:', {
    httpStatus,
    openaiCode,
    openaiMessage,
    responseBody: bodyText,
  });
  console.error(err);

  return err;
}

export function toOpenAiErrorPayload(err) {
  return {
    openaiStatus: err.httpStatus ?? null,
    openaiCode: err.openaiCode ?? null,
    openaiMessage: err.openaiMessage ?? null,
    responseBody: err.details || err.responseBody || null,
  };
}

export const OPENAI_ERROR_CODES = new Set([
  'MISSING_OPENAI_KEY',
  'OPENAI_AUTH_ERROR',
  'OPENAI_FORBIDDEN',
  'OPENAI_MODEL_NOT_FOUND',
  'OPENAI_RATE_LIMIT',
  'OPENAI_SERVER_ERROR',
  'OPENAI_ERROR',
  'OPENAI_EMPTY',
  'OPENAI_PARSE',
]);

export function resolveOpenAiHttpStatus(err) {
  if (err.code === 'MISSING_OPENAI_KEY') return 503;
  if (err.httpStatus === 429) return 429;
  if (err.httpStatus === 401 || err.httpStatus === 403) return 502;
  return 502;
}
