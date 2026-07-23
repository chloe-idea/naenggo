import { resolveIdTokenFromHeaders } from '../../server/lib/analysis-quota.js';
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
} from '../../server/lib/household-service.js';

function routeParts(req) {
  const value = req.query?.route;
  return Array.isArray(value) ? value : (value ? [value] : []);
}

function context(req) {
  return {
    idToken: resolveIdTokenFromHeaders(req.headers),
    headers: req.headers,
    ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
  };
}

function sendError(res, err) {
  const result = toHouseholdErrorResponse(err);
  return res.status(result.status).json(result.body);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const [first, second, third] = routeParts(req);
  try {
    if (req.method === 'POST' && !first) {
      const household = await createHousehold({ ...context(req), name: req.body?.name });
      return res.status(201).json({ success: true, household });
    }
    if (req.method === 'GET' && first === 'current') {
      const household = await getCurrentHousehold(context(req));
      if (!household) return res.status(404).json({ success: false, error: 'HOUSEHOLD_NOT_FOUND', message: '참여 중인 가족 그룹이 없습니다.' });
      return res.json({ success: true, household });
    }
    if (req.method === 'POST' && first === 'invites') {
      if (req.body?.action === 'reissue') {
        const invites = await reissueInvites({
          ...context(req),
          householdId: req.body?.householdId,
          expiresAt: req.body?.expiresAt,
          maxUses: req.body?.maxUses,
        });
        return res.status(201).json({ success: true, invites });
      }
      const invite = await issueInvite({
        ...context(req),
        householdId: req.body?.householdId,
        kind: req.body?.kind,
        expiresAt: req.body?.expiresAt,
        maxUses: req.body?.maxUses,
      });
      return res.status(201).json({ success: true, invite });
    }
    if (req.method === 'POST' && first === 'join') {
      const household = await joinHousehold({ ...context(req), kind: req.body?.kind, secret: req.body?.secret });
      return res.json({ success: true, household });
    }
    if (req.method === 'POST' && first === 'transfer-owner') {
      await transferOwnership({ ...context(req), householdId: req.body?.householdId, toUid: req.body?.toUid });
      return res.json({ success: true });
    }
    if (req.method === 'PATCH' && first === 'current') {
      const household = await renameHousehold({
        ...context(req),
        householdId: req.body?.householdId,
        name: req.body?.name,
      });
      return res.json({ success: true, household });
    }
    if (req.method === 'POST' && first === 'migrate-copy') {
      const migration = await copyPersonalDataToHousehold({
        ...context(req),
        householdId: req.body?.householdId,
        scopes: req.body?.scopes,
      });
      return res.json({ success: true, migration });
    }
    if (req.method === 'POST' && first === 'activate') {
      const household = await activateHousehold({
        ...context(req),
        householdId: req.body?.householdId,
        migrationMode: req.body?.migrationMode,
      });
      return res.json({ success: true, household });
    }
    if (req.method === 'POST' && first === 'cancel-pending') {
      await cancelPendingHousehold({ ...context(req), householdId: req.body?.householdId });
      return res.status(204).end();
    }
    if (req.method === 'DELETE' && first === 'members' && third === undefined && second) {
      await removeMember({
        ...context(req),
        householdId: req.body?.householdId || req.query?.householdId,
        memberUid: second,
      });
      return res.status(204).end();
    }
    if (req.method === 'POST' && first === 'leave') {
      await leaveHousehold({ ...context(req), householdId: req.body?.householdId });
      return res.status(204).end();
    }
    if (req.method === 'DELETE' && first === 'current') {
      await deleteLastOwnerHousehold({
        ...context(req),
        householdId: req.body?.householdId || req.query?.householdId,
      });
      return res.status(202).json({ success: true, status: 'deleted' });
    }
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED', message: '지원하지 않는 household API 요청입니다.' });
  } catch (err) {
    return sendError(res, err);
  }
}
