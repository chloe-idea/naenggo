import { Router } from 'express';
import { handleAiUsage } from '../lib/handlers/ai-usage.js';
import { resolveIdTokenFromRequest } from '../lib/analysis-quota.js';

const router = Router();

function resolveUserId(req) {
  return String(req.query?.userId || req.body?.userId || req.headers['x-user-id'] || '').trim();
}

router.get('/ai-usage', async (req, res) => {
  const result = await handleAiUsage({
    userId: resolveUserId(req),
    idToken: resolveIdTokenFromRequest(req),
  });
  return res.status(result.status).json(result.body);
});

export default router;
