import { Router } from 'express';
import {
  submitBugReport,
  toBugReportErrorResponse,
  safeLogMessage,
} from '../lib/bug-report-service.js';

const router = Router();

router.post('/bug-report', async (req, res) => {
  try {
    const result = await submitBugReport(req);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[bug-report]', err?.code || err?.name, safeLogMessage(err));
    const { status, body } = toBugReportErrorResponse(err);
    return res.status(status).json(body);
  }
});

export default router;
