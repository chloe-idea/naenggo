#!/usr/bin/env node
/**
 * OPENAI_API_KEY 유효성 검사 (키 전체 출력하지 않음)
 * 사용: node scripts/verify-openai-key.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  describeOpenAiKeyConfig,
  getOpenAiApiKey,
  getOpenAiEndpoint,
  getOpenAiModel,
} from '../server/lib/openai-config.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const envCandidates = ['.env', '.env.local', '.env.production', '.env.development'];
const shellKeyBeforeLoad = process.env.OPENAI_API_KEY;

const envFileStatus = Object.fromEntries(
  envCandidates.map((name) => [name, fs.existsSync(path.join(root, name))]),
);

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] != null) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const resolvedKey = getOpenAiApiKey();
console.log('환경변수 로드 정보:', {
  envFileRead: envPath,
  envFilesPresent: envFileStatus,
  loadSource: shellKeyBeforeLoad
    ? '셸/터미널 OPENAI_API_KEY ( .env보다 우선 )'
    : '프로젝트 .env 파일',
  notUsed: ['.env.local', '.env.production', '.env.development'].filter((name) => !envFileStatus[name]),
});
if (resolvedKey) {
  console.log('읽은 API Key fingerprint:', {
    length: resolvedKey.length,
    first10: resolvedKey.slice(0, 10),
    last4: resolvedKey.slice(-4),
  });
}
console.log('');

const info = describeOpenAiKeyConfig();

if (!info.present) {
  console.error('❌ OPENAI_API_KEY가 .env 또는 환경변수에 없습니다.');
  process.exit(1);
}

console.log('OpenAI 설정:', {
  envVar: info.envVar,
  length: info.length,
  prefix: `${info.prefix}…`,
  suffix: `…${info.suffix}`,
  model: info.model,
  endpoint: info.endpoint,
  hadOuterWhitespace: info.hadOuterWhitespace,
  hadWrappingQuotes: info.hadWrappingQuotes,
});

const apiKey = getOpenAiApiKey();
const res = await fetch(getOpenAiEndpoint(), {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: getOpenAiModel(),
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
  }),
});

const body = await res.text();
let openaiCode = null;
let openaiMessage = null;
try {
  const parsed = JSON.parse(body);
  openaiCode = parsed?.error?.code || null;
  openaiMessage = parsed?.error?.message || null;
} catch {
  openaiMessage = body.slice(0, 200);
}

if (res.ok) {
  console.log('✅ OpenAI API Key가 유효합니다.');
  process.exit(0);
}

console.error('❌ OpenAI API Key 검증 실패');
console.error('   HTTP status:', res.status);
console.error('   OpenAI code:', openaiCode || '(none)');
console.error('   OpenAI message:', openaiMessage || '(none)');
console.error('');
console.error('조치:');
console.error('  1. https://platform.openai.com/api-keys 에서 새 Secret Key 발급');
console.error('  2. .env 의 OPENAI_API_KEY= 값을 새 키로 교체 (따옴표 없이)');
console.error('  3. Vercel 사용 시 Dashboard 환경변수도 업데이트 후 Redeploy');
console.error('  4. ./serve.sh 재시작');
process.exit(1);
