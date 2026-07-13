/**
 * 쿠팡파트너스 Deeplink API
 * 검색 URL → 추적 가능한 제휴 단축 URL 변환
 *
 * Endpoint (Partners Open API):
 * POST https://api-gateway.coupang.com/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink
 * Body: { coupangUrls: ["https://www.coupang.com/np/search?component=&q=...&channel=user"] }
 */
import { generateCoupangPartnersAuthorization } from '../coupang-hmac.js';
import {
  resolveCoupangPartnersCredentials,
  coupangKeysMissingPayload,
} from '../coupang-env.js';

const DOMAIN = 'https://api-gateway.coupang.com';
const DEEPLINK_PATH = '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';

function buildCoupangSearchUrl(keyword) {
  const q = encodeURIComponent(String(keyword || '').trim());
  return `https://www.coupang.com/np/search?component=&q=${q}&channel=user`;
}

function pickAffiliateUrl(item) {
  if (!item || typeof item !== 'object') return '';
  return String(item.shortenUrl || item.landingUrl || '').trim();
}

/**
 * @param {{ keyword?: string }} params
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleCoupangSearch({ keyword } = {}) {
  const creds = resolveCoupangPartnersCredentials();
  const { accessKey, secretKey, subId } = creds;
  const cleaned = String(keyword || '').trim();

  if (!cleaned) {
    return {
      status: 400,
      body: { success: false, error: 'KEYWORD_REQUIRED', message: 'keyword가 필요합니다.' },
    };
  }

  if (!accessKey || !secretKey) {
    console.warn('[coupang-search] keys missing', {
      hasAccessKey: Boolean(accessKey),
      hasSecretKey: Boolean(secretKey),
      vercelEnv: process.env.VERCEL_ENV || null,
    });
    return {
      status: 503,
      body: coupangKeysMissingPayload(creds),
    };
  }

  const searchUrl = buildCoupangSearchUrl(cleaned);
  const body = { coupangUrls: [searchUrl] };
  if (subId) body.subId = subId;

  let authorization;
  try {
    authorization = generateCoupangPartnersAuthorization('POST', DEEPLINK_PATH, secretKey, accessKey);
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
    const url = pickAffiliateUrl(rows[0]);

    if (rCode !== '0' || !url) {
      console.error('[coupang-search] unexpected payload', {
        rCode,
        rMessage: payload?.rMessage,
      });
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
