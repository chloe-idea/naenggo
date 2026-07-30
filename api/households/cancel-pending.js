import { runVercelHouseholdDispatch } from './_vercel-entry.js';

export default async function handler(req, res) {
  return runVercelHouseholdDispatch(req, res, {
    routeParts: ['cancel-pending'],
    handlerName: 'cancel-pending-v3',
    methods: 'POST, OPTIONS',
  });
}
