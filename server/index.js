import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import extractVideoRecipeRouter from './routes/extract-video-recipe.js';
import extractYoutubeRecipeRouter from './routes/extract-youtube-recipe.js';
import extractInstagramRecipeRouter from './routes/extract-instagram-recipe.js';
import aiUsageRouter from './routes/ai-usage.js';
import openaiHealthRouter from './routes/openai-health.js';
import { getFirebaseAdminStatus } from './lib/firebase-admin.js';
import { describeOpenAiKeyConfig, logOpenAiKeyConfig } from './lib/openai-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });

const app = express();
const PORT = Number(process.env.PORT) || 8765;

app.use(express.json({ limit: '32kb' }));

app.use('/api', extractVideoRecipeRouter);
app.use('/api', extractYoutubeRecipeRouter);
app.use('/api', extractInstagramRecipeRouter);
app.use('/api', aiUsageRouter);
app.use('/api', openaiHealthRouter);

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

app.listen(PORT, '0.0.0.0', () => {
  const openAiInfo = describeOpenAiKeyConfig();
  const firebaseStatus = getFirebaseAdminStatus();
  const firebaseLabel = {
    'configured (json)': '설정됨 (JSON)',
    'configured (base64)': '설정됨 (Base64)',
    'invalid (json)': '⚠️  JSON 형식 오류',
    'invalid (base64)': '⚠️  Base64 형식 오류',
    'not set': '⚠️  FIREBASE_SERVICE_ACCOUNT_* 미설정',
  }[firebaseStatus] || firebaseStatus;
  console.log('');
  console.log('============================================');
  console.log('  냉장GO 서버 (정적 + API)');
  console.log('============================================');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  API: POST /api/extract-video-recipe  (통합 — 권장)`);
  console.log(`       POST /api/extract-youtube-recipe (레거시 alias)`);
  console.log(`       POST /api/extract-instagram-recipe`);
  console.log(`       GET  /api/ai-usage?userId=...`);
  console.log(`       GET  /api/openai-health`);
  console.log(`  OpenAI: ${openAiInfo.present ? '설정됨' : '⚠️  OPENAI_API_KEY 미설정 (.env 확인)'}`);
  if (openAiInfo.present) {
    logOpenAiKeyConfig('startup');
  }
  console.log(`  Firebase Admin: ${firebaseLabel}`);
  console.log('============================================');
  console.log('');
});
