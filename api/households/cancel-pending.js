import { runVercelHouseholdDispatch } from '../../server/lib/vercel-household-entry.js';

export default async function handler(req, res) {
  return runVercelHouseholdDispatch(req, res, {
    routeParts: ['cancel-pending'],
    handlerName: 'cancel-pending-v3',
    methods: 'POST, OPTIONS',
  });
}
