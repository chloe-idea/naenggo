/**
 * Shared Vercel response helpers for household API entries.
 * Keep this outside api/ — Vercel treats every api/**/*.js as a serverless function.
 * Routing truth: server/lib/household-api-handler.js
 */
import { resolveIdTokenFromHeaders } from './analysis-quota.js';
import {
  applyHouseholdApiResult,
  dispatchHouseholdApi,
  logHouseholdRouteDebug,
} from './household-api-handler.js';

export const HOUSEHOLD_HANDLER_VERSION = 'household-api-v3-explicit';

export function setHouseholdDebugHeaders(res, handlerName) {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_REF
    || 'local-dev';
  res.setHeader('X-Household-Handler', handlerName);
  res.setHeader('X-Household-Handler-Version', HOUSEHOLD_HANDLER_VERSION);
  res.setHeader('X-Deploy-Commit', String(commit).slice(0, 12));
}

export function setHouseholdCors(res, methods = 'GET, POST, PATCH, DELETE, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Token');
}

/**
 * @param {object} req
 * @param {object} res
 * @param {{ routeParts: string[], handlerName: string, methods?: string }} options
 */
export async function runVercelHouseholdDispatch(req, res, {
  routeParts,
  handlerName,
  methods = 'GET, POST, PATCH, DELETE, OPTIONS',
} = {}) {
  setHouseholdCors(res, methods);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const result = await dispatchHouseholdApi({
    method: req.method,
    routeParts,
    idToken: resolveIdTokenFromHeaders(req.headers),
    headers: req.headers,
    ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
    body: req.body,
    query: req.query,
  });

  setHouseholdDebugHeaders(res, handlerName);
  // Temporary non-sensitive marker so production clients can confirm new code.
  if (result?.body && typeof result.body === 'object' && !Array.isArray(result.body)) {
    result.body.debugHandler = handlerName;
    result.body.debugVersion = HOUSEHOLD_HANDLER_VERSION;
  }

  logHouseholdRouteDebug({
    method: req.method || '',
    url: req.url || '',
    query: req.query || {},
    routeParam: Array.isArray(routeParts) ? routeParts.join('/') : String(routeParts || ''),
    normalizedRoute: result.normalizedRoute,
    matchedHandler: `${handlerName}:${result.matchedHandler}`,
  });

  return applyHouseholdApiResult(res, result);
}
