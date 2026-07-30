/**
 * DELETE /api/households/members/:uid
 * Single dynamic segment — supported on non-Next Vercel (unlike [...catchAll]).
 */
import { runVercelHouseholdDispatch } from '../../../server/lib/vercel-household-entry.js';

export default async function handler(req, res) {
  const uid = req.query?.uid;
  const memberUid = Array.isArray(uid) ? uid[0] : uid;
  return runVercelHouseholdDispatch(req, res, {
    routeParts: ['members', String(memberUid || '')],
    handlerName: 'members-uid-v3',
    methods: 'DELETE, OPTIONS',
  });
}
