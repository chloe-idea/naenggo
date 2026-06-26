import { handleExtractYoutubeRecipe } from '../server/lib/handlers/extract-youtube-recipe.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED', message: 'POST만 지원합니다.' });
  }

  const result = await handleExtractYoutubeRecipe({
    url: req.body?.url,
    userId: req.body?.userId || req.headers['x-user-id'],
    userText: req.body?.userText,
    caption: req.body?.caption,
    description: req.body?.description,
    pastedText: req.body?.pastedText,
  });

  return res.status(result.status).json(result.body);
}
