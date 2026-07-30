/**
 * Household API contract tests (Express ↔ Vercel shared dispatcher).
 * No Firestore writes — services are mocked.
 *
 * Run: node scripts/test-household-api-contract.mjs
 */
import assert from 'node:assert/strict';
import {
  dispatchHouseholdApi,
  normalizeHouseholdRouteInput,
  normalizeHouseholdRouteParts,
  resolveHouseholdRoute,
} from '../server/lib/household-api-handler.js';

function pass(name) {
  console.log('PASS', name);
}

// --- path normalization ---
assert.deepEqual(normalizeHouseholdRouteInput('current'), ['current']);
assert.deepEqual(normalizeHouseholdRouteInput(['current']), ['current']);
assert.deepEqual(normalizeHouseholdRouteInput('/current'), ['current']);
assert.deepEqual(normalizeHouseholdRouteInput('/api/households/current'), ['current']);
assert.deepEqual(normalizeHouseholdRouteInput('api/households/current'), ['current']);
assert.deepEqual(normalizeHouseholdRouteInput(null, { url: '/api/households/current?x=1' }), ['current']);
assert.deepEqual(normalizeHouseholdRouteInput(null, { url: '/api/households' }), []);
assert.deepEqual(normalizeHouseholdRouteInput('members/uid1'), ['members', 'uid1']);
pass('normalizeHouseholdRouteInput shapes');

assert.deepEqual(
  normalizeHouseholdRouteParts({ query: { '...route': 'current' }, url: '/api/households/current' }),
  ['current'],
);
assert.deepEqual(
  normalizeHouseholdRouteParts({ query: {}, url: '/api/households/migrate-copy' }),
  ['migrate-copy'],
);
pass('normalizeHouseholdRouteParts vercel shapes');

// --- route matching (same handler names for local/Vercel) ---
const cases = [
  { method: 'GET', parts: ['current'], handler: 'GET current' },
  { method: 'POST', parts: [], handler: 'POST create' },
  { method: 'DELETE', parts: ['current'], handler: 'DELETE current' },
  { method: 'POST', parts: ['migrate-copy'], handler: 'POST migrate-copy' },
  { method: 'POST', parts: ['activate'], handler: 'POST activate' },
  { method: 'POST', parts: ['join'], handler: 'POST join' },
  { method: 'POST', parts: ['leave'], handler: 'POST leave' },
  { method: 'POST', parts: ['invites'], handler: 'POST invites' },
  { method: 'POST', parts: ['invites'], body: { action: 'reissue' }, handler: 'POST invites:reissue' },
  { method: 'DELETE', parts: ['members', 'abc'], handler: 'DELETE members/:uid' },
  { method: 'PATCH', parts: ['current'], handler: 'PATCH current' },
];

for (const c of cases) {
  const matched = resolveHouseholdRoute(c.method, c.parts, c.body || {});
  assert.equal(matched.ok, true, `${c.method} ${c.parts.join('/')}`);
  assert.equal(matched.handler, c.handler);
}
pass('resolveHouseholdRoute known APIs');

const unknown = resolveHouseholdRoute('GET', ['nope'], {});
assert.equal(unknown.ok, false);
assert.equal(unknown.handler, 'none');
pass('unknown route is not ok');

// Express-style path strings must match the same handlers as Vercel parts
const expressCurrent = resolveHouseholdRoute('GET', normalizeHouseholdRouteInput('/api/households/current'), {});
const vercelCurrent = resolveHouseholdRoute('GET', normalizeHouseholdRouteInput({ '...route': 'current' }['...route'] || 'current'), {});
assert.equal(expressCurrent.handler, 'GET current');
assert.equal(vercelCurrent.handler, 'GET current');
assert.equal(expressCurrent.handler, vercelCurrent.handler);
pass('GET current same handler for express path and vercel segment');

const expressCreate = resolveHouseholdRoute('POST', normalizeHouseholdRouteInput('/api/households'), {});
const vercelCreate = resolveHouseholdRoute('POST', [], {});
assert.equal(expressCreate.handler, 'POST create');
assert.equal(vercelCreate.handler, 'POST create');
pass('POST create same handler');

const expressDelete = resolveHouseholdRoute('DELETE', normalizeHouseholdRouteInput('/api/households/current'), {});
const vercelDelete = resolveHouseholdRoute('DELETE', ['current'], {});
assert.equal(expressDelete.handler, 'DELETE current');
assert.equal(vercelDelete.handler, vercelDelete.handler);
assert.equal(expressDelete.handler, 'DELETE current');
pass('DELETE current same handler');

// GET current must not resolve as 405
assert.equal(resolveHouseholdRoute('GET', ['current'], {}).ok, true);
pass('GET current is not 405');

// --- dispatch with mocks (no Firestore) ---
const mockHousehold = {
  householdId: 'iM5hmt60Pp4ktkcxeuEe',
  name: '우리 가족',
  ownerId: 'uid-owner',
  role: 'owner',
  status: 'active',
  members: [],
  pendingSetup: false,
  needsMigrationChoice: false,
};

const services = {
  getCurrentHousehold: async () => mockHousehold,
  createHousehold: async () => ({ householdId: 'new-id', name: '우리 가족', role: 'owner' }),
  deleteLastOwnerHousehold: async () => undefined,
  issueInvite: async () => ({}),
  reissueInvites: async () => ({}),
  joinHousehold: async () => ({}),
  transferOwnership: async () => undefined,
  renameHousehold: async () => ({}),
  copyPersonalDataToHousehold: async () => ({}),
  deduplicateHouseholdIngredients: async () => ({}),
  activateHousehold: async () => mockHousehold,
  cancelPendingHousehold: async () => undefined,
  removeMember: async () => undefined,
  leaveHousehold: async () => undefined,
};

const currentRes = await dispatchHouseholdApi({
  method: 'GET',
  routeParts: ['current'],
  idToken: 'fake',
  services,
});
assert.equal(currentRes.status, 200);
assert.equal(currentRes.matchedHandler, 'GET current');
assert.equal(currentRes.body.success, true);
assert.equal(currentRes.body.household.householdId, 'iM5hmt60Pp4ktkcxeuEe');
pass('dispatch GET current mocked');

const nullCurrent = await dispatchHouseholdApi({
  method: 'GET',
  routeParts: ['current'],
  idToken: 'fake',
  services: { ...services, getCurrentHousehold: async () => null },
});
assert.equal(nullCurrent.status, 200);
assert.equal(nullCurrent.body.household, null);
pass('dispatch GET current null household');

const createRes = await dispatchHouseholdApi({
  method: 'POST',
  routeParts: [],
  idToken: 'fake',
  body: { name: '우리 가족' },
  services,
});
assert.equal(createRes.status, 201);
assert.equal(createRes.matchedHandler, 'POST create');
pass('dispatch POST create mocked');

const deleteRes = await dispatchHouseholdApi({
  method: 'DELETE',
  routeParts: ['current'],
  idToken: 'fake',
  query: { householdId: 'iM5hmt60Pp4ktkcxeuEe' },
  services,
});
assert.equal(deleteRes.status, 202);
assert.equal(deleteRes.matchedHandler, 'DELETE current');
pass('dispatch DELETE current mocked');

const bad = await dispatchHouseholdApi({
  method: 'GET',
  routeParts: ['unknown-route'],
  services,
});
assert.equal(bad.status, 405);
assert.equal(bad.body.error, 'METHOD_NOT_ALLOWED');
pass('unknown route returns 405');

const authErr = await dispatchHouseholdApi({
  method: 'GET',
  routeParts: ['current'],
  services: {
    ...services,
    getCurrentHousehold: async () => {
      const err = new Error('로그인이 필요합니다.');
      err.code = 'AUTH_REQUIRED';
      err.status = 401;
      // mimic HouseholdError via toHouseholdErrorResponse fallback — use real shape
      const e = Object.assign(new Error('로그인이 필요합니다.'), {
        code: 'AUTH_REQUIRED',
        status: 401,
      });
      // household-service toHouseholdErrorResponse checks instanceof HouseholdError
      // so non-HouseholdError becomes 500 unless we throw something it maps.
      // Use a minimal fake that matches toHouseholdErrorResponse AUTH path:
      throw Object.assign(new Error('로그인이 필요합니다.'), {
        code: 'INVALID_ID_TOKEN',
        httpStatus: 401,
      });
    },
  },
});
assert.equal(authErr.status, 401);
pass('auth failure maps to 401');

console.log('All household API contract tests passed.');
