import { resolveIdTokenFromHeaders } from '../../server/lib/analysis-quota.js';
import { createHousehold, toHouseholdErrorResponse } from '../../server/lib/household-service.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED', message: 'POST만 지원합니다.' });
  }

  try {
    const household = await createHousehold({
      idToken: resolveIdTokenFromHeaders(req.headers),
      name: req.body?.name,
      headers: req.headers,
      ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
    });
    return res.status(201).json({ success: true, household });
  } catch (err) {
    const result = toHouseholdErrorResponse(err);
    return res.status(result.status).json(result.body);
  }
}
