import { handleExtractVideoRecipeUnified } from '../server/lib/handlers/extract-video-recipe-unified.js';
import { resolveIdTokenFromHeaders } from '../server/lib/analysis-quota.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id, Authorization, X-Firebase-Token');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED', message: 'POST만 지원합니다.' });
  }

  const result = await handleExtractVideoRecipeUnified({
    url: req.body?.url,
    userId: req.body?.userId || req.headers['x-user-id'],
    idToken: resolveIdTokenFromHeaders(req.headers),
    userText: req.body?.userText,
    caption: req.body?.caption,
    description: req.body?.description,
    pastedText: req.body?.pastedText,
  });

  return res.status(result.status).json(result.body);
}
