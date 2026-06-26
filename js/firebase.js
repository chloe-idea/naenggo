/**
 * Firebase 앱 초기화 (Auth + Firestore) — 싱글톤, 중복 initializeApp 방지
 */
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const FREE_ANALYSIS_LIMIT = 5;

let app = null;
let auth = null;
let db = null;
let googleProvider = null;

function isConfigReady() {
  return Boolean(
    firebaseConfig?.apiKey
    && firebaseConfig.apiKey !== 'YOUR_API_KEY'
    && firebaseConfig?.projectId
    && firebaseConfig.projectId !== 'YOUR_PROJECT_ID'
  );
}

export function getFirebaseApp() {
  if (!isConfigReady()) {
    console.warn('[firebase] config not ready — firebase-config.js 확인');
    return null;
  }
  if (app) return app;
  if (getApps().length > 0) {
    app = getApp();
    console.log('[firebase] reusing existing app instance');
    return app;
  }
  app = initializeApp(firebaseConfig);
  console.log('[firebase] initializeApp OK, project:', firebaseConfig.projectId);
  return app;
}

export function getFirebaseAuth() {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  if (!auth) auth = getAuth(firebaseApp);
  return auth;
}

export function getFirebaseDb() {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  if (!db) db = getFirestore(firebaseApp);
  return db;
}

export function getGoogleProvider() {
  if (!googleProvider) {
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });
  }
  return googleProvider;
}

export function isFirebaseConfigured() {
  return isConfigReady();
}
