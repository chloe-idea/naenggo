#!/usr/bin/env node
/**
 * 다운로드한 Firebase 서비스 계정 JSON → 환경 변수 값 생성
 *
 * JSON 파일을 프로젝트 폴더에 복사하지 않아도 됩니다.
 * Downloads 등 임의 경로를 인자로 넘기세요.
 *
 * 사용법:
 *   node scripts/print-firebase-env.mjs ~/Downloads/your-project-firebase-adminsdk-xxxxx.json
 *
 * 출력:
 *   - .env 에 붙여넣을 FIREBASE_SERVICE_ACCOUNT_JSON=... (한 줄)
 *   - Vercel용 FIREBASE_SERVICE_ACCOUNT_BASE64=... (권장)
 *
 * ⚠️ 출력된 값은 터미널에만 표시됩니다. Git에 커밋하지 마세요.
 */
import fs from 'fs';
import path from 'path';

const filePath = process.argv[2];

if (!filePath) {
  console.error('사용법: node scripts/print-firebase-env.mjs <다운로드한-json-파일-경로>');
  process.exit(1);
}

const resolved = path.resolve(filePath.replace(/^~/, process.env.HOME || ''));

if (!fs.existsSync(resolved)) {
  console.error(`파일을 찾을 수 없습니다: ${resolved}`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
} catch (err) {
  console.error('JSON 파싱 실패:', err.message);
  process.exit(1);
}

if (parsed.type !== 'service_account' || !parsed.private_key || !parsed.client_email) {
  console.error('Firebase 서비스 계정 JSON이 아닌 것 같습니다.');
  process.exit(1);
}

const oneLineJson = JSON.stringify(parsed);
const base64 = Buffer.from(oneLineJson, 'utf8').toString('base64');

console.log('');
console.log('============================================');
console.log('  Firebase Admin 환경 변수 (복사용)');
console.log('============================================');
console.log('');
console.log('── 로컬 .env (방법 A: JSON 한 줄) ──');
console.log('');
console.log(`FIREBASE_SERVICE_ACCOUNT_JSON=${oneLineJson}`);
console.log('');
console.log('── Vercel / 로컬 .env (방법 B: Base64, 권장) ──');
console.log('');
console.log(`FIREBASE_SERVICE_ACCOUNT_BASE64=${base64}`);
console.log('');
console.log('※ JSON 파일은 프로젝트에 저장하거나 GitHub에 올리지 마세요.');
console.log('※ Vercel에는 방법 B(Base64) 등록을 권장합니다.');
console.log('============================================');
console.log('');
