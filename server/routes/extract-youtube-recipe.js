import { Router } from 'express';
import { handleExtractYoutubeRecipe } from '../lib/handlers/extract-youtube-recipe.js';

const router = Router();

function resolveUserId(req) {
  return String(req.body?.userId || req.headers['x-user-id'] || '').trim();
}

router.post('/extract-youtube-recipe', async (req, res) => {
  const result = await handleExtractYoutubeRecipe({
    url: req.body?.url,
    userId: resolveUserId(req),
    userText: req.body?.userText,
    caption: req.body?.caption,
    description: req.body?.description,
    pastedText: req.body?.pastedText,
  });
  return res.status(result.status).json(result.body);
});

export default router;
