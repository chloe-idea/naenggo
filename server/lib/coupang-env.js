/**
 * 쿠팡파트너스 환경변수 조회 (값은 로그에 남기지 않음)
 */

function normalizeEnvValue(raw) {
  if (raw == null) return '';
  let value = String(raw).trim();
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function readFirstEnv(names) {
  for (const name of names) {
    const value = normalizeEnvValue(process.env[name]);
    if (value) return { name, value };
  }
  return { name: '', value: '' };
}

/** @returns {{ accessKey: string, secretKey: string, subId: string, accessKeyName: string, secretKeyName: string }} */
export function resolveCoupangPartnersCredentials() {
  const access = readFirstEnv([
    'COUPANG_PARTNERS_ACCESS_KEY',
    'COUPANG_ACCESS_KEY',
  ]);
  const secret = readFirstEnv([
    'COUPANG_PARTNERS_SECRET_KEY',
    'COUPANG_SECRET_KEY',
  ]);
  const sub = readFirstEnv([
    'COUPANG_PARTNERS_SUB_ID',
    'COUPANG_SUB_ID',
  ]);

  return {
    accessKey: access.value,
    secretKey: secret.value,
    subId: sub.value,
    accessKeyName: access.name,
    secretKeyName: secret.name,
  };
}

export function coupangKeysMissingPayload(creds) {
  return {
    success: false,
    error: 'COUPANG_KEYS_MISSING',
    message:
      '쿠팡파트너스 API 키가 없습니다. Vercel → Settings → Environment Variables에 '
      + 'COUPANG_PARTNERS_ACCESS_KEY / COUPANG_PARTNERS_SECRET_KEY 를 '
      + 'Production(및 Preview)에 등록한 뒤 Redeploy 하세요.',
    hint: {
      hasAccessKey: Boolean(creds?.accessKey),
      hasSecretKey: Boolean(creds?.secretKey),
      expected: ['COUPANG_PARTNERS_ACCESS_KEY', 'COUPANG_PARTNERS_SECRET_KEY'],
    },
  };
}
