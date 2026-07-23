import { Router } from 'express';
import { resolveIdTokenFromRequest } from '../lib/analysis-quota.js';
import {
  activateHousehold,
  cancelPendingHousehold,
  copyPersonalDataToHousehold,
  createHousehold,
  deleteLastOwnerHousehold,
  getCurrentHousehold,
  issueInvite,
  joinHousehold,
  leaveHousehold,
  removeMember,
  reissueInvites,
  renameHousehold,
  toHouseholdErrorResponse,
  transferOwnership,
} from '../lib/household-service.js';

const router = Router();

function requestContext(req) {
  return {
    idToken: resolveIdTokenFromRequest(req),
    headers: req.headers,
    ip: req.ip,
  };
}

function sendError(res, err) {
  const result = toHouseholdErrorResponse(err);
  return res.status(result.status).json(result.body);
}

router.post('/households', async (req, res) => {
  try {
    const household = await createHousehold({ ...requestContext(req), name: req.body?.name });
    return res.status(201).json({ success: true, household });
  } catch (err) {
    return sendError(res, err);
  }
});

router.get('/households/current', async (req, res) => {
  try {
    const household = await getCurrentHousehold(requestContext(req));
    if (!household) return res.status(404).json({ success: false, error: 'HOUSEHOLD_NOT_FOUND', message: '참여 중인 가족 그룹이 없습니다.' });
    return res.json({ success: true, household });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/households/invites', async (req, res) => {
  try {
    if (req.body?.action === 'reissue') {
      const invites = await reissueInvites({
        ...requestContext(req),
        householdId: req.body?.householdId,
        expiresAt: req.body?.expiresAt,
        maxUses: req.body?.maxUses,
      });
      return res.status(201).json({ success: true, invites });
    }
    const invite = await issueInvite({
      ...requestContext(req),
      householdId: req.body?.householdId,
      kind: req.body?.kind,
      expiresAt: req.body?.expiresAt,
      maxUses: req.body?.maxUses,
    });
    return res.status(201).json({ success: true, invite });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/households/join', async (req, res) => {
  try {
    const household = await joinHousehold({
      ...requestContext(req),
      kind: req.body?.kind,
      secret: req.body?.secret,
    });
    return res.json({ success: true, household });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/households/transfer-owner', async (req, res) => {
  try {
    await transferOwnership({
      ...requestContext(req),
      householdId: req.body?.householdId,
      toUid: req.body?.toUid,
    });
    return res.json({ success: true });
  } catch (err) {
    return sendError(res, err);
  }
});

router.patch('/households/current', async (req, res) => {
  try {
    const household = await renameHousehold({
      ...requestContext(req),
      householdId: req.body?.householdId,
      name: req.body?.name,
    });
    return res.json({ success: true, household });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/households/migrate-copy', async (req, res) => {
  try {
    const result = await copyPersonalDataToHousehold({
      ...requestContext(req),
      householdId: req.body?.householdId,
      scopes: req.body?.scopes,
    });
    return res.json({ success: true, migration: result });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/households/activate', async (req, res) => {
  try {
    const household = await activateHousehold({
      ...requestContext(req),
      householdId: req.body?.householdId,
      migrationMode: req.body?.migrationMode,
    });
    return res.json({ success: true, household });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/households/cancel-pending', async (req, res) => {
  try {
    await cancelPendingHousehold({
      ...requestContext(req),
      householdId: req.body?.householdId,
    });
    return res.status(204).end();
  } catch (err) {
    return sendError(res, err);
  }
});

router.delete('/households/members/:uid', async (req, res) => {
  try {
    await removeMember({
      ...requestContext(req),
      householdId: req.body?.householdId || req.query?.householdId,
      memberUid: req.params.uid,
    });
    return res.status(204).end();
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/households/leave', async (req, res) => {
  try {
    await leaveHousehold({ ...requestContext(req), householdId: req.body?.householdId });
    return res.status(204).end();
  } catch (err) {
    return sendError(res, err);
  }
});

router.delete('/households/current', async (req, res) => {
  try {
    await deleteLastOwnerHousehold({ ...requestContext(req), householdId: req.body?.householdId || req.query?.householdId });
    return res.status(202).json({ success: true, status: 'deleted' });
  } catch (err) {
    return sendError(res, err);
  }
});

export default router;
