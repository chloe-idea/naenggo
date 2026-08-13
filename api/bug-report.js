/**
 * POST /api/bug-report — Vercel entry (Resend)
 */
import {
  submitBugReport,
  toBugReportErrorResponse,
  safeLogMessage,
} from '../server/lib/bug-report-service.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1.5mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
    const result = await submitBugReport(req);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[api/bug-report]', err?.code || err?.name, safeLogMessage(err));
    const { status, body } = toBugReportErrorResponse(err);
    return res.status(status).json(body);
  }
}
