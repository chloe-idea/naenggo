/**
 * Firebase 앱 초기화 (Auth + Firestore)
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';

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
  if (!isConfigReady()) return null;
  if (!app) app = initializeApp(firebaseConfig);
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
