/**
 * POST /api/account/delete — Vercel entry
 */
import { resolveIdTokenFromHeaders } from '../../server/lib/analysis-quota.js';
import {
  deleteAccount,
  toAccountDeletionErrorResponse,
} from '../../server/lib/account-deletion-service.js';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Token');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'POST만 지원합니다.',
    });
  }

  try {
    // body.uid 신뢰 금지
    void readBody(req);
    const idToken = resolveIdTokenFromHeaders(req.headers)
      || (typeof req.body?.idToken === 'string' ? req.body.idToken : '');
    const result = await deleteAccount({ idToken });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[api/account/delete]', err?.code || err?.name, err?.message || err);
    const { status, body } = toAccountDeletionErrorResponse(err);
    return res.status(status).json(body);
  }
}
