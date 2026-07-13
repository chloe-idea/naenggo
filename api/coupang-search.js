/**
 * Vercel Serverless Function — GET /api/coupang-search?keyword=...
 * 쿠팡파트너스 Deeplink API로 검색 URL을 제휴 단축 URL로 변환합니다.
 * (키·HMAC은 이 서버 함수 안에서만 사용)
 */
import crypto from 'crypto';

const DOMAIN = 'https://api-gateway.coupang.com';
const DEEPLINK_PATH = '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';

function formatSignedDateUtc(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return `${yy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function generateAuthorization(method, uri, secretKey, accessKey) {
  const parts = String(uri || '').split('?');
  if (parts.length > 2) throw new Error('incorrect uri format');
  const path = parts[0] || '';
  const query = parts.length === 2 ? parts[1] : '';
  const signedDate = formatSignedDateUtc();
  const message = `${signedDate}${String(method || '').toUpperCase()}${path}${query}`;
  const signature = crypto
    .createHmac('sha256', String(secretKey || ''))
    .update(message)
    .digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`;
}

function buildCoupangSearchUrl(keyword) {
  const q = encodeURIComponent(String(keyword || '').trim());
  return `https://www.coupang.com/np/search?component=&q=${q}&channel=user`;
}

async function handleCoupangSearch(keyword) {
  const accessKey = String(process.env.COUPANG_PARTNERS_ACCESS_KEY || '').trim();
  const secretKey = String(process.env.COUPANG_PARTNERS_SECRET_KEY || '').trim();
  const subId = String(process.env.COUPANG_PARTNERS_SUB_ID || '').trim();
  const cleaned = String(keyword || '').trim();

  if (!cleaned) {
    return {
      status: 400,
      body: { success: false, error: 'KEYWORD_REQUIRED', message: 'keyword가 필요합니다.' },
    };
  }
  if (!accessKey || !secretKey) {
    return {
      status: 503,
      body: {
        success: false,
        error: 'COUPANG_KEYS_MISSING',
        message: '쿠팡파트너스 API 키가 설정되지 않았습니다.',
      },
    };
  }

  const searchUrl = buildCoupangSearchUrl(cleaned);
  const body = { coupangUrls: [searchUrl] };
  if (subId) body.subId = subId;

  let authorization;
  try {
    authorization = generateAuthorization('POST', DEEPLINK_PATH, secretKey, accessKey);
  } catch (err) {
    console.error('[coupang-search] HMAC failed:', err?.message || err);
    return {
      status: 500,
      body: { success: false, error: 'HMAC_FAILED', message: '서명 생성에 실패했습니다.' },
    };
  }

  try {
    const response = await fetch(`${DOMAIN}${DEEPLINK_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: JSON.stringify(body),
    });
    const rawText = await response.text();
    let payload = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      console.error('[coupang-search] upstream error', response.status, rawText?.slice(0, 300));
      return {
        status: 502,
        body: {
          success: false,
          error: 'UPSTREAM_ERROR',
          message: '쿠팡파트너스 API 호출에 실패했습니다.',
        },
      };
    }

    const rCode = payload?.rCode != null ? String(payload.rCode) : '';
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const url = String(rows[0]?.shortenUrl || rows[0]?.landingUrl || '').trim();

    if (rCode !== '0' || !url) {
      console.error('[coupang-search] unexpected payload', { rCode, rMessage: payload?.rMessage });
      return {
        status: 502,
        body: {
          success: false,
          error: 'INVALID_RESPONSE',
          message: '제휴 URL을 받지 못했습니다.',
        },
      };
    }

    return {
      status: 200,
      body: {
        success: true,
        url,
        originalUrl: String(rows[0]?.originalUrl || searchUrl).trim(),
      },
    };
  } catch (err) {
    console.error('[coupang-search] request failed:', err?.message || err);
    return {
      status: 502,
      body: {
        success: false,
        error: 'REQUEST_FAILED',
        message: '쿠팡파트너스 API 요청 중 오류가 발생했습니다.',
      },
    };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'GET만 지원합니다.',
    });
  }

  const keyword = typeof req.query?.keyword === 'string'
    ? req.query.keyword
    : Array.isArray(req.query?.keyword)
      ? req.query.keyword[0]
      : '';

  const result = await handleCoupangSearch(keyword);
  return res.status(result.status).json(result.body);
}
