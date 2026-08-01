import { Router } from 'express';
import { resolveIdTokenFromRequest } from '../lib/analysis-quota.js';
import {
  deleteAccount,
  toAccountDeletionErrorResponse,
} from '../lib/account-deletion-service.js';

const router = Router();

router.post('/account/delete', async (req, res) => {
  try {
    // body.uid 등은 무시 — token uid만 사용
    const idToken = resolveIdTokenFromRequest(req);
    const result = await deleteAccount({ idToken });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[account/delete]', err?.code || err?.name, err?.message || err);
    const { status, body } = toAccountDeletionErrorResponse(err);
    return res.status(status).json(body);
  }
});

export default router;
