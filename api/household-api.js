/**
 * Single Vercel entry for non-explicit /api/households/* routes.
 * Path is passed via rewrite query (`householdRoute`) because destination
 * rewrites may replace req.url with /api/household-api.
 */
import { runVercelHouseholdDispatch } from '../server/lib/vercel-household-entry.js';

function routePartsFromReq(req) {
  const q = req.query || {};
  const fromQuery = q.householdRoute;
  if (typeof fromQuery === 'string' && fromQuery.trim()) {
    const parts = fromQuery.split('/').filter(Boolean);
    if (q.uid) parts.push(String(Array.isArray(q.uid) ? q.uid[0] : q.uid));
    return parts;
  }
  if (Array.isArray(fromQuery) && fromQuery.length) {
    return fromQuery.map(String).filter(Boolean);
  }

  const rawUrl = String(req.url || '');
  const pathOnly = rawUrl.split('?')[0] || '';
  const marker = '/api/households';
  const idx = pathOnly.indexOf(marker);
  if (idx === -1) return [];
  const rest = pathOnly.slice(idx + marker.length).replace(/^\/+|\/+$/g, '');
  if (!rest) return [];
  return rest.split('/').filter(Boolean);
}

export default async function handler(req, res) {
  const routeParts = routePartsFromReq(req);
  const leaf = routeParts.length ? routeParts.join('-') : 'root';
  return runVercelHouseholdDispatch(req, res, {
    routeParts,
    handlerName: `router-v3:${leaf}`,
    methods: 'GET, POST, PATCH, DELETE, OPTIONS',
  });
}
