import express from 'express';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import extractVideoRecipeRouter from './routes/extract-video-recipe.js';
import extractYoutubeRecipeRouter from './routes/extract-youtube-recipe.js';
import extractInstagramRecipeRouter from './routes/extract-instagram-recipe.js';
import aiUsageRouter from './routes/ai-usage.js';
import openaiHealthRouter from './routes/openai-health.js';
import userProfileRouter from './routes/user-profile.js';
import coupangSearchRouter from './routes/coupang-search.js';
import householdsRouter from './routes/households.js';
import accountRouter from './routes/account.js';
import bugReportRouter from './routes/bug-report.js';
import { getFirebaseAdminStatus } from './lib/firebase-admin.js';
import { describeOpenAiKeyConfig, logOpenAiKeyConfig } from './lib/openai-config.js';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });

const app = express();
const PORT = Number(process.env.PORT) || 8765;
/** 같은 Wi-Fi의 휴대폰 접속을 위해 모든 인터페이스에 바인딩 (localhost 전용 아님) */
const HOST = '0.0.0.0';

function getLanIPv4() {
  try {
    const nets = os.networkInterfaces();
    for (const entries of Object.values(nets)) {
      for (const net of entries || []) {
        const family = net.family === 'IPv4' || net.family === 4;
        if (!family || net.internal) continue;
        const address = String(net.address || '');
        if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(address)) {
          return address;
        }
      }
    }
    for (const entries of Object.values(nets)) {
      for (const net of entries || []) {
        const family = net.family === 'IPv4' || net.family === 4;
        if (family && !net.internal && net.address) return net.address;
      }
    }
  } catch {
    return null;
  }
  return null;
}

app.use((req, res, next) => {
  const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];
  const isBugReport = req.method === 'POST' && pathOnly === '/api/bug-report';
  return express.json({ limit: isBugReport ? '1.5mb' : '32kb' })(req, res, next);
});

app.use('/api', extractVideoRecipeRouter);
app.use('/api', extractYoutubeRecipeRouter);
app.use('/api', extractInstagramRecipeRouter);
app.use('/api', aiUsageRouter);
app.use('/api', openaiHealthRouter);
app.use('/api', userProfileRouter);
app.use('/api', coupangSearchRouter);
app.use('/api', householdsRouter);
app.use('/api', accountRouter);
app.use('/api', bugReportRouter);

app.use('/images/recipes', express.static(path.join(ROOT, 'public/images/recipes'), {
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (/\.(webp|png|jpe?g)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  },
}));

app.use(express.static(ROOT, {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (/\.(html?|js|css|json)$/.test(filePath) || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  },
}));

// 법률 문서 — 로그인 없이 정적 HTML로 제공 (OAuth 동의 화면 URL용)
app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(ROOT, 'privacy.html'));
});
app.get('/terms', (_req, res) => {
  res.sendFile(path.join(ROOT, 'terms.html'));
});

// 공유된 SPA 레시피 상세 URL도 앱 진입점으로 제공한다.
app.get('/recipes/:recipeId', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.listen(PORT, HOST, () => {
  const openAiInfo = describeOpenAiKeyConfig();
  const firebaseStatus = getFirebaseAdminStatus();
  const firebaseLabel = {
    'configured (json)': '설정됨 (JSON)',
    'configured (base64)': '설정됨 (Base64)',
    'invalid (json)': '⚠️  JSON 형식 오류',
    'invalid (base64)': '⚠️  Base64 형식 오류',
    'not set': '⚠️  FIREBASE_SERVICE_ACCOUNT_* 미설정',
  }[firebaseStatus] || firebaseStatus;
  const lanIp = getLanIPv4();
  console.log('');
  console.log('============================================');
  console.log('  냉장GO 서버 (정적 + API)');
  console.log('============================================');
  console.log(`  Local:   http://localhost:${PORT}`);
  if (lanIp) {
    console.log(`  Network: http://${lanIp}:${PORT}`);
  } else {
    console.log('  Network: (로컬 IP를 찾지 못했습니다 — Wi-Fi IP를 확인하세요)');
  }
  console.log(`  Listen:  ${HOST}:${PORT}`);
  console.log(`  API: POST /api/extract-video-recipe  (통합 — 권장)`);
  console.log(`       POST /api/extract-youtube-recipe (레거시 alias)`);
  console.log(`       POST /api/extract-instagram-recipe`);
  console.log(`       GET  /api/ai-usage?userId=...`);
  console.log(`       GET  /api/openai-health`);
  console.log(`       POST /api/user-profile`);
  console.log(`       GET  /api/coupang-search?keyword=...`);
  console.log(`       POST /api/households`);
  console.log(`       GET  /api/households/current`);
  console.log(`  OpenAI: ${openAiInfo.present ? '설정됨' : '⚠️  OPENAI_API_KEY 미설정 (.env 확인)'}`);
  if (openAiInfo.present) {
    logOpenAiKeyConfig('startup');
  }
  console.log(`  Firebase Admin: ${firebaseLabel}`);
  console.log('============================================');
  console.log('');
});
