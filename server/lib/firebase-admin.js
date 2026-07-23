import admin from 'firebase-admin';

let initialized = false;

/**
 * Firebase Admin 자격 증명
 *
 * 우선순위:
 * 1. FIREBASE_SERVICE_ACCOUNT_JSON  — JSON 문자열 (한 줄)
 * 2. FIREBASE_SERVICE_ACCOUNT_BASE64  — JSON 파일 전체를 base64 인코딩 (Vercel 등록에 편함)
 *
 * JSON 파일을 repo에 두지 않습니다. 환경 변수만 사용하세요.
 */
function parseServiceAccount() {
  const base64 = String(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim();
  if (base64) {
    try {
      const json = Buffer.from(base64, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch (err) {
      console.error('[firebase-admin] FIREBASE_SERVICE_ACCOUNT_BASE64 parse failed:', err.message);
      return null;
    }
  }

  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON parse failed:', err.message);
    console.error('[firebase-admin] JSON이 한 줄인지, 따옴표가 올바른지 확인하세요.');
    return null;
  }
}

export function isFirebaseAdminConfigured() {
  const sa = parseServiceAccount();
  return Boolean(sa?.project_id && sa?.private_key && sa?.client_email);
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
      + 'FIREBASE_SERVICE_ACCOUNT_JSON 또는 FIREBASE_SERVICE_ACCOUNT_BASE64 를 설정하세요.'
    );
    err.code = 'FIREBASE_ADMIN_NOT_CONFIGURED';
    throw err;
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  initialized = true;
  console.log('[firebase-admin] initialized', {
    projectId: serviceAccount.project_id || null,
    clientEmail: serviceAccount.client_email || null,
  });
  return admin;
}

export function getFirestoreAdmin() {
  return getFirebaseAdmin().firestore();
}

export async function verifyFirebaseIdToken(idToken) {
  const token = String(idToken || '').trim();
  if (!token) return null;
  try {
    const decoded = await getFirebaseAdmin().auth().verifyIdToken(token);
    return decoded;
  } catch (err) {
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
