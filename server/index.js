import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import extractYoutubeRecipeRouter from './routes/extract-youtube-recipe.js';
import extractInstagramRecipeRouter from './routes/extract-instagram-recipe.js';
import aiUsageRouter from './routes/ai-usage.js';
import { getFirebaseAdminStatus } from './lib/firebase-admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });

const app = express();
const PORT = Number(process.env.PORT) || 8765;

app.use(express.json({ limit: '32kb' }));

app.use('/api', extractYoutubeRecipeRouter);
app.use('/api', extractInstagramRecipeRouter);
app.use('/api', aiUsageRouter);

app.use(express.static(ROOT, {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

app.listen(PORT, '0.0.0.0', () => {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
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
  console.log(`  API: POST /api/extract-youtube-recipe`);
  console.log(`       POST /api/extract-instagram-recipe`);
  console.log(`       GET  /api/ai-usage?userId=...`);
  console.log(`  OpenAI: ${hasKey ? '설정됨' : '⚠️  OPENAI_API_KEY 미설정 (.env 확인)'}`);
  console.log(`  Firebase Admin: ${firebaseLabel}`);
  console.log('============================================');
  console.log('');
});
