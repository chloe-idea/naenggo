import { runVercelHouseholdDispatch } from '../../server/lib/vercel-household-entry.js';

export default async function handler(req, res) {
  return runVercelHouseholdDispatch(req, res, {
    routeParts: ['leave'],
    handlerName: 'leave-v3',
    methods: 'POST, OPTIONS',
  });
}
