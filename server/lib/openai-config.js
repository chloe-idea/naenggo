/**
 * OpenAI 환경변수 — OPENAI_API_KEY 만 사용 (다른 이름 fallback 없음)
 */

function stripWrappingQuotes(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** @returns {string} */
export function getOpenAiApiKey() {
  return stripWrappingQuotes(process.env.OPENAI_API_KEY);
}

export function getOpenAiModel() {
  return stripWrappingQuotes(process.env.OPENAI_MODEL) || 'gpt-4o-mini';
}

export function getOpenAiEndpoint() {
  return stripWrappingQuotes(process.env.OPENAI_ENDPOINT)
    || 'https://api.openai.com/v1/chat/completions';
}

/** 서버 시작 시 키 상태 확인용 — 키 전체는 출력하지 않음 */
export function describeOpenAiKeyConfig() {
  const raw = process.env.OPENAI_API_KEY;
  const apiKey = getOpenAiApiKey();

  if (!raw) {
    return {
      envVar: 'OPENAI_API_KEY',
      present: false,
      message: 'OPENAI_API_KEY 미설정',
    };
  }

  const rawStr = String(raw);
  const hadOuterWhitespace = rawStr !== rawStr.trim();
  const hadQuotes = rawStr.trim() !== apiKey;
  const validPrefix = /^sk-(proj-)?[A-Za-z0-9]/.test(apiKey);

  return {
    envVar: 'OPENAI_API_KEY',
    present: true,
    length: apiKey.length,
    prefix: apiKey.slice(0, 12),
    suffix: apiKey.length > 4 ? apiKey.slice(-4) : '',
    hadOuterWhitespace,
    hadWrappingQuotes: hadQuotes,
    validPrefix,
    model: getOpenAiModel(),
    endpoint: getOpenAiEndpoint(),
    otherEnvNamesChecked: ['OPENAI_KEY', 'OPENAI_SECRET', 'VITE_OPENAI_API_KEY'],
    otherEnvNamesUsed: ['OPENAI_KEY', 'OPENAI_SECRET', 'VITE_OPENAI_API_KEY']
      .filter((name) => Boolean(process.env[name])),
  };
}

export function logOpenAiKeyConfig(phase = 'startup') {
  const info = describeOpenAiKeyConfig();
  if (!info.present) {
    console.warn(`[OpenAI:${phase}]`, info.message);
    return info;
  }
  console.log(`[OpenAI:${phase}]`, {
    envVar: info.envVar,
    length: info.length,
    prefix: `${info.prefix}…`,
    suffix: `…${info.suffix}`,
    hadOuterWhitespace: info.hadOuterWhitespace,
    hadWrappingQuotes: info.hadWrappingQuotes,
    validPrefix: info.validPrefix,
    model: info.model,
    endpoint: info.endpoint,
    ignoredAlternateEnvVars: info.otherEnvNamesUsed,
  });
  if (info.hadOuterWhitespace || info.hadWrappingQuotes) {
    console.warn(`[OpenAI:${phase}] 키 앞뒤 공백/따옴표가 제거되었습니다. .env/Vercel 값을 따옴표 없이 등록하세요.`);
  }
  if (!info.validPrefix) {
    console.warn(`[OpenAI:${phase}] 키 형식이 sk- 로 시작하지 않습니다. 잘못된 값일 수 있습니다.`);
  }
  return info;
}
