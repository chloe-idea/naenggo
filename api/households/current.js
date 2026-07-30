/**
 * GET|PATCH|DELETE /api/households/current
 * Explicit Vercel file (non-Next). Do not rely on [...route] catch-all.
 */
import { runVercelHouseholdDispatch } from '../../server/lib/vercel-household-entry.js';

export default async function handler(req, res) {
  return runVercelHouseholdDispatch(req, res, {
    routeParts: ['current'],
    handlerName: 'current-v3',
    methods: 'GET, PATCH, DELETE, OPTIONS',
  });
}
