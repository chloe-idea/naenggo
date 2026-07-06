import { Router } from 'express';
import { handleExtractVideoRecipeUnified } from '../lib/handlers/extract-video-recipe-unified.js';
import { resolveIdTokenFromHeaders } from '../lib/analysis-quota.js';

const router = Router();

router.post('/extract-video-recipe', async (req, res) => {
  const result = await handleExtractVideoRecipeUnified({
    url: req.body?.url,
    userId: req.body?.userId || req.headers['x-user-id'],
    idToken: resolveIdTokenFromHeaders(req.headers),
    userText: req.body?.userText,
    caption: req.body?.caption,
    description: req.body?.description,
    pastedText: req.body?.pastedText,
  });
  res.status(result.status).json(result.body);
});

export default router;
