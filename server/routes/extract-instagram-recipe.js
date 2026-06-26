import { Router } from 'express';
import { handleExtractInstagramRecipe } from '../lib/handlers/extract-instagram-recipe.js';
import { resolveIdTokenFromRequest } from '../lib/analysis-quota.js';

const router = Router();

function resolveUserId(req) {
  return String(req.body?.userId || req.headers['x-user-id'] || '').trim();
}

router.post('/extract-instagram-recipe', async (req, res) => {
  const result = await handleExtractInstagramRecipe({
    url: req.body?.url,
    userId: resolveUserId(req),
    idToken: resolveIdTokenFromRequest(req),
    userText: req.body?.userText,
    caption: req.body?.caption,
    description: req.body?.description,
    pastedText: req.body?.pastedText,
  });
  return res.status(result.status).json(result.body);
});

export default router;
