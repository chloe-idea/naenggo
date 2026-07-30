import { Router } from 'express';
import { resolveIdTokenFromRequest } from '../lib/analysis-quota.js';
import {
  applyHouseholdApiResult,
  dispatchHouseholdApi,
  logHouseholdRouteDebug,
} from '../lib/household-api-handler.js';

const router = Router();

async function runHousehold(req, res, routeParts) {
  const result = await dispatchHouseholdApi({
    method: req.method,
    routeParts,
    idToken: resolveIdTokenFromRequest(req),
    headers: req.headers,
    ip: req.ip,
    body: req.body,
    query: req.query,
  });
  logHouseholdRouteDebug({
    method: req.method,
    url: req.originalUrl || req.url,
    query: req.query,
    normalizedRoute: result.normalizedRoute,
    matchedHandler: `express:${result.matchedHandler}`,
  });
  return applyHouseholdApiResult(res, result);
}

router.post('/households', (req, res) => runHousehold(req, res, []));
router.get('/households/current', (req, res) => runHousehold(req, res, ['current']));
router.post('/households/invites', (req, res) => runHousehold(req, res, ['invites']));
router.post('/households/join', (req, res) => runHousehold(req, res, ['join']));
router.post('/households/transfer-owner', (req, res) => runHousehold(req, res, ['transfer-owner']));
router.patch('/households/current', (req, res) => runHousehold(req, res, ['current']));
router.post('/households/migrate-copy', (req, res) => runHousehold(req, res, ['migrate-copy']));
router.post('/households/deduplicate-ingredients', (req, res) => runHousehold(req, res, ['deduplicate-ingredients']));
router.post('/households/activate', (req, res) => runHousehold(req, res, ['activate']));
router.post('/households/cancel-pending', (req, res) => runHousehold(req, res, ['cancel-pending']));
router.delete('/households/members/:uid', (req, res) => runHousehold(req, res, ['members', req.params.uid]));
router.post('/households/leave', (req, res) => runHousehold(req, res, ['leave']));
router.delete('/households/current', (req, res) => runHousehold(req, res, ['current']));

export default router;
