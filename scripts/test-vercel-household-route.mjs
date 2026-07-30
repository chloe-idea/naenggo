/**
 * Vercel household route parsing unit test (no Firestore writes).
 * Prefer the fuller contract suite: node scripts/test-household-api-contract.mjs
 *
 * Run: node scripts/test-vercel-household-route.mjs
 */
import assert from 'node:assert/strict';
import { normalizeHouseholdRouteParts } from '../server/lib/household-api-handler.js';

function check(name, req, expected) {
  const actual = normalizeHouseholdRouteParts(req);
  assert.deepEqual(actual, expected, name);
  console.log('PASS', name, actual);
}

check('next-style array', { query: { route: ['current'] }, url: '/api/households/current' }, ['current']);
check('next-style string', { query: { route: 'current' }, url: '/api/households/current' }, ['current']);
check('vercel ...route string', { query: { '...route': 'current' }, url: '/api/households/current' }, ['current']);
check('vercel ...route nested', { query: { '...route': 'members/uid123' }, url: '/api/households/members/uid123' }, ['members', 'uid123']);
check('url fallback only', { query: {}, url: '/api/households/current?x=1' }, ['current']);
check('url migrate-copy', { query: {}, url: '/api/households/migrate-copy' }, ['migrate-copy']);
check('root create path empty', { query: {}, url: '/api/households' }, []);
check('root create with trailing slash', { query: {}, url: '/api/households/' }, []);

console.log('All vercel household route parsing tests passed.');
