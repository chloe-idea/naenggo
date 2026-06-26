/**
 * Firebase 웹 앱 설정 예시
 * 1. Firebase Console → 프로젝트 설정 → 내 앱 → SDK 설정 복사
 * 2. firebase-config.js 로 복사 후 값 입력
 * 3. Authentication → Google 로그인 활성화
 * 4. Firestore 데이터베이스 생성
 */
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: '123456789012',
  appId: '1:123456789012:web:abcdef123456',
};
