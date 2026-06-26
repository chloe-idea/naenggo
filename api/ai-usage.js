import { handleAiUsage } from '../server/lib/handlers/ai-usage.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED', message: 'GET만 지원합니다.' });
  }

  const result = handleAiUsage({
    userId: req.query?.userId || req.headers['x-user-id'],
  });

  return res.status(result.status).json(result.body);
}
