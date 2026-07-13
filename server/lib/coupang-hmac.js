/**
 * 쿠팡파트너스 Open API HMAC Authorization
 * message = datetime + method + path + query (query는 ? 제외)
 * datetime = yyMMdd'T'HHmmss'Z' (GMT/UTC)
 */
import crypto from 'crypto';

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

/**
 * @param {string} method
 * @param {string} uri path + optional ?query
 * @param {string} secretKey
 * @param {string} accessKey
 */
export function generateCoupangPartnersAuthorization(method, uri, secretKey, accessKey) {
  const parts = String(uri || '').split('?');
  if (parts.length > 2) {
    throw new Error('incorrect uri format');
  }
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
