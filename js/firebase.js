/**
 * Firebase 앱 초기화 (Auth + Firestore)
 * auth, db, googleProvider를 export — getter/전역 변수 의존 없이 import해서 사용
 */
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const FREE_ANALYSIS_LIMIT = 5;

function isConfigReady() {
  return Boolean(
    firebaseConfig?.apiKey
    && firebaseConfig.apiKey !== 'YOUR_API_KEY'
    && firebaseConfig?.projectId
    && firebaseConfig.projectId !== 'YOUR_PROJECT_ID',
  );
}

export function isFirebaseConfigured() {
  return isConfigReady() && Boolean(auth);
}

let app = null;
export let auth = null;
export let db = null;
export let googleProvider = null;

if (isConfigReady()) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });
    console.log('[firebase] initializeApp OK, project:', firebaseConfig.projectId);
  } catch (err) {
    console.error('[firebase] initializeApp failed:', err?.code || err?.name, err?.message, err);
    app = null;
    auth = null;
    db = null;
    googleProvider = null;
  }
} else {
  console.warn('[firebase] config not ready — js/firebase-config.js 확인');
}

export function assertAuthReady() {
  if (!isConfigReady()) {
    const err = new Error('Firebase 설정(firebase-config.js)이 완료되지 않았습니다.');
    err.code = 'auth/config-not-set';
    throw err;
  }
  if (!auth || !googleProvider) {
    const err = new Error('Firebase 인증 모듈을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
    err.code = 'auth/not-initialized';
    throw err;
  }
  return { auth, googleProvider };
}

/** @deprecated — import { auth } from './firebase.js' 사용 */
export function getFirebaseApp() { return app; }
export function getFirebaseAuth() { return auth; }
export function getFirebaseDb() { return db; }
export function getGoogleProvider() { return googleProvider; }
