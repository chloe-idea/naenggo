import admin from 'firebase-admin';

let initialized = false;
let lastEnvDebug = null;

/**
 * Firebase Admin 자격 증명
 *
 * 우선순위 (실제 코드):
 * 1. FIREBASE_SERVICE_ACCOUNT_BASE64 — JSON 전체를 base64
 * 2. FIREBASE_SERVICE_ACCOUNT_JSON — JSON 문자열
 * GOOGLE_APPLICATION_CREDENTIALS 는 사용하지 않음.
 *
 * BASE64가 있으나 파싱에 실패하면 JSON으로 폴스루한다.
 */
function normalizePrivateKey(serviceAccount) {
  if (!serviceAccount || typeof serviceAccount !== 'object') return serviceAccount;
  const key = serviceAccount.private_key;
  if (typeof key !== 'string') return serviceAccount;
  // Vercel/dotenv often store PEM with literal \n sequences.
  if (key.includes('\\n') && !key.includes('\n')) {
    return { ...serviceAccount, private_key: key.replace(/\\n/g, '\n') };
  }
  return serviceAccount;
}

function looksLikeServiceAccount(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.project_id
    && value.private_key
    && value.client_email,
  );
}

function tryParseJsonString(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { ok: false, value: null, error: null, empty: true };
  }

  try {
    let parsed = JSON.parse(trimmed);
    // Handle accidentally double-encoded JSON: "\"{...}\"" → object
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed.trim());
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        value: null,
        error: new Error('Parsed JSON is not an object'),
        empty: false,
      };
    }
    return { ok: true, value: normalizePrivateKey(parsed), error: null, empty: false };
  } catch (err) {
    return { ok: false, value: null, error: err, empty: false };
  }
}

function buildEnvDebug({
  hasJsonEnv,
  jsonLength,
  hasBase64Env,
  base64Length,
  parseSucceeded,
  serviceAccount,
  initError = null,
  source = null,
}) {
  const privateKey = typeof serviceAccount?.private_key === 'string'
    ? serviceAccount.private_key
    : '';
  return {
    hasJsonEnv: Boolean(hasJsonEnv),
    jsonLength: Number(jsonLength) || 0,
    hasBase64Env: Boolean(hasBase64Env),
    base64Length: Number(base64Length) || 0,
    parseSucceeded: Boolean(parseSucceeded),
    projectIdPresent: Boolean(serviceAccount?.project_id),
    clientEmailPresent: Boolean(serviceAccount?.client_email),
    privateKeyPresent: Boolean(privateKey),
    privateKeyHasEscapedNewlines: privateKey.includes('\\n'),
    privateKeyHasRealNewlines: privateKey.includes('\n'),
    source: source || null,
    initErrorName: initError?.name || null,
    initErrorMessage: initError?.message ? String(initError.message).slice(0, 200) : null,
  };
}

function logFirebaseAdminEnvDebug(debug) {
  lastEnvDebug = debug;
  console.info([
    '[FIREBASE ADMIN ENV DEBUG]',
    `hasJsonEnv: ${debug.hasJsonEnv}`,
    `jsonLength: ${debug.jsonLength}`,
    `hasBase64Env: ${debug.hasBase64Env}`,
    `base64Length: ${debug.base64Length}`,
    `parseSucceeded: ${debug.parseSucceeded}`,
    `projectIdPresent: ${debug.projectIdPresent}`,
    `clientEmailPresent: ${debug.clientEmailPresent}`,
    `privateKeyPresent: ${debug.privateKeyPresent}`,
    `privateKeyHasEscapedNewlines: ${debug.privateKeyHasEscapedNewlines}`,
    `privateKeyHasRealNewlines: ${debug.privateKeyHasRealNewlines}`,
    `source: ${debug.source || 'none'}`,
    `initErrorName: ${debug.initErrorName || ''}`,
    `initErrorMessage: ${debug.initErrorMessage || ''}`,
  ].join('\n'));
}

function parseServiceAccount() {
  const base64Raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim();
  const jsonRaw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const hasBase64Env = Boolean(base64Raw);
  const hasJsonEnv = Boolean(jsonRaw);

  let serviceAccount = null;
  let parseSucceeded = false;
  let source = null;
  let initError = null;

  if (hasBase64Env) {
    try {
      const decoded = Buffer.from(base64Raw, 'base64').toString('utf8');
      const parsed = tryParseJsonString(decoded);
      if (parsed.ok && looksLikeServiceAccount(parsed.value)) {
        serviceAccount = parsed.value;
        parseSucceeded = true;
        source = 'base64';
      } else {
        initError = parsed.error || new Error('BASE64 decoded but service account fields incomplete');
        console.error('[firebase-admin] FIREBASE_SERVICE_ACCOUNT_BASE64 parse/validate failed:', initError.message);
      }
    } catch (err) {
      initError = err;
      console.error('[firebase-admin] FIREBASE_SERVICE_ACCOUNT_BASE64 decode failed:', err.message);
    }
  }

  // Fall through to JSON when BASE64 is missing or invalid.
  if (!serviceAccount && hasJsonEnv) {
    const parsed = tryParseJsonString(jsonRaw);
    if (parsed.ok && looksLikeServiceAccount(parsed.value)) {
      serviceAccount = parsed.value;
      parseSucceeded = true;
      source = 'json';
      initError = null;
    } else if (!initError) {
      initError = parsed.error || new Error('JSON parsed but service account fields incomplete');
      console.error('[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON parse/validate failed:', initError.message);
    }
  }

  const debug = buildEnvDebug({
    hasJsonEnv,
    jsonLength: jsonRaw.length,
    hasBase64Env,
    base64Length: base64Raw.length,
    parseSucceeded,
    serviceAccount,
    initError,
    source,
  });
  logFirebaseAdminEnvDebug(debug);

  return serviceAccount;
}

export function getLastFirebaseAdminEnvDebug() {
  return lastEnvDebug;
}

export function isFirebaseAdminConfigured() {
  const sa = parseServiceAccount();
  return looksLikeServiceAccount(sa);
}

export function getFirebaseAdminStatus() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim()) {
    return isFirebaseAdminConfigured() ? 'configured (base64)' : 'invalid (base64)';
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) {
    return isFirebaseAdminConfigured() ? 'configured (json)' : 'invalid (json)';
  }
  return 'not set';
}

export function getFirebaseAdmin() {
  if (initialized) return admin;

  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) {
    const err = new Error(
      'Firebase Admin 환경 변수가 없거나 JSON 형식이 올바르지 않습니다. '
      + 'FIREBASE_SERVICE_ACCOUNT_JSON 또는 FIREBASE_SERVICE_ACCOUNT_BASE64 를 설정하세요.',
    );
    err.code = 'FIREBASE_ADMIN_NOT_CONFIGURED';
    throw err;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
    console.log('[firebase-admin] initialized', {
      projectId: serviceAccount.project_id || null,
      clientEmailPresent: Boolean(serviceAccount.client_email),
    });
    return admin;
  } catch (err) {
    logFirebaseAdminEnvDebug(buildEnvDebug({
      hasJsonEnv: Boolean(String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim()),
      jsonLength: String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim().length,
      hasBase64Env: Boolean(String(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim()),
      base64Length: String(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim().length,
      parseSucceeded: true,
      serviceAccount,
      initError: err,
      source: 'initializeApp',
    }));
    const wrapped = new Error(
      'Firebase Admin 초기화에 실패했습니다. service account JSON / private_key 형식을 확인하세요.',
    );
    wrapped.code = 'FIREBASE_ADMIN_NOT_CONFIGURED';
    wrapped.cause = err;
    throw wrapped;
  }
}

export function getFirestoreAdmin() {
  return getFirebaseAdmin().firestore();
}

/**
 * db 와 동일한 firebase-admin 인스턴스의 FieldValue/Timestamp 를 함께 반환한다.
 * 스크립트에서 firebase-admin/firestore 를 별도 import 하면 이중 설치 시
 * ServerTimestampTransform 직렬화 오류가 날 수 있다.
 */
export function getFirestoreAdminContext() {
  const app = getFirebaseAdmin();
  return {
    admin: app,
    db: app.firestore(),
    FieldValue: app.firestore.FieldValue,
    Timestamp: app.firestore.Timestamp,
  };
}

export async function verifyFirebaseIdToken(idToken) {
  const token = String(idToken || '').trim();
  if (!token) return null;
  try {
    const decoded = await getFirebaseAdmin().auth().verifyIdToken(token);
    return decoded;
  } catch (err) {
    if (err?.code === 'FIREBASE_ADMIN_NOT_CONFIGURED') throw err;
    const firebaseCode = err?.code || err?.errorInfo?.code || null;
    const causeMessage = err?.message || String(err);
    console.warn('[firebase-admin] verifyIdToken failed:', {
      code: firebaseCode,
      message: causeMessage,
    });
    console.error('[firebase-admin] verifyIdToken stack:', err?.stack || causeMessage);
    const networkUnavailable = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(causeMessage);
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const error = new Error(
      isDevelopment
        ? `Firebase ID 토큰 검증 실패: ${causeMessage}`
        : (networkUnavailable
          ? 'Firebase 인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
          : '로그인 정보가 유효하지 않습니다. 다시 로그인해 주세요.'),
    );
    error.code = networkUnavailable ? 'FIREBASE_AUTH_UNAVAILABLE' : 'INVALID_ID_TOKEN';
    error.firebaseCode = firebaseCode;
    error.causeMessage = causeMessage;
    error.httpStatus = networkUnavailable ? 503 : (firebaseCode === 'auth/argument-error' ? 400 : 401);
    throw error;
  }
}
