import { Router } from 'express';
import { getAiUsage } from '../lib/ai-usage-limit.js';

const router = Router();

function resolveUserId(req) {
  return String(req.query?.userId || req.body?.userId || req.headers['x-user-id'] || '').trim();
}

router.get('/ai-usage', (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'MISSING_USER_ID',
      message: 'userId가 필요합니다.',
    });
  }

  return res.json({
    success: true,
    aiUsage: getAiUsage(userId),
  });
});

export default router;
