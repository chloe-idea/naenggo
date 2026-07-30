/**
 * Explicit GET|PATCH|DELETE /api/households/current
 * Kept as a dedicated file so production matching is unambiguous.
 */
import { runVercelHouseholdDispatch } from '../../server/lib/vercel-household-entry.js';

export default async function handler(req, res) {
  return runVercelHouseholdDispatch(req, res, {
    routeParts: ['current'],
    handlerName: 'current-v3',
    methods: 'GET, PATCH, DELETE, OPTIONS',
  });
}
