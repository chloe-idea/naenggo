import { Router } from 'express';
import { handleAiUsage } from '../lib/handlers/ai-usage.js';

const router = Router();

function resolveUserId(req) {
  return String(req.query?.userId || req.body?.userId || req.headers['x-user-id'] || '').trim();
}

router.get('/ai-usage', (req, res) => {
  const result = handleAiUsage({ userId: resolveUserId(req) });
  return res.status(result.status).json(result.body);
});

export default router;
