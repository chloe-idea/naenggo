import {
  describeOpenAiKeyConfig,
  getOpenAiApiKey,
  getOpenAiEndpoint,
  getOpenAiModel,
} from '../server/lib/openai-config.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const info = describeOpenAiKeyConfig();

  if (!info.present) {
    return res.status(503).json({
      ok: false,
      keyPresent: false,
      keyValid: false,
      error: 'MISSING_OPENAI_KEY',
      message: 'OPENAI_API_KEY가 설정되지 않았습니다.',
    });
  }

  try {
    const apiKey = getOpenAiApiKey();
    const response = await fetch(getOpenAiEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getOpenAiModel(),
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });

    const bodyText = await response.text();
    let openaiCode = null;
    let openaiMessage = null;
    try {
      const parsed = JSON.parse(bodyText);
      openaiCode = parsed?.error?.code || null;
      openaiMessage = parsed?.error?.message || null;
    } catch {
      openaiMessage = bodyText.slice(0, 200);
    }

    if (response.ok) {
      return res.json({
        ok: true,
        keyPresent: true,
        keyValid: true,
        model: info.model,
        prefix: `${info.prefix}…`,
      });
    }

    return res.status(502).json({
      ok: false,
      keyPresent: true,
      keyValid: false,
      error: response.status === 401 ? 'OPENAI_AUTH_ERROR' : 'OPENAI_ERROR',
      openaiStatus: response.status,
      openaiCode,
      openaiMessage,
      prefix: `${info.prefix}…`,
      message: response.status === 401
        ? 'OpenAI가 API Key를 거부했습니다. platform.openai.com에서 새 키를 발급해 OPENAI_API_KEY를 교체하세요.'
        : `OpenAI API 오류 (${response.status})`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      keyPresent: true,
      keyValid: false,
      error: 'OPENAI_NETWORK_ERROR',
      message: err?.message || 'OpenAI 연결 실패',
    });
  }
}
