/**
 * Express(localhost)와 Vercel(serverless)이 공유하는 household API dispatcher.
 * 라우팅·응답 스키마는 여기서만 정의하고, 양쪽 진입점은 이 모듈만 호출한다.
 */
import {
  activateHousehold,
  cancelPendingHousehold,
  copyPersonalDataToHousehold,
  createHousehold,
  deduplicateHouseholdIngredients,
  deleteLastOwnerHousehold,
  getCurrentHousehold,
  issueInvite,
  joinHousehold,
  leaveHousehold,
  removeMember,
  reissueInvites,
  renameHousehold,
  toHouseholdErrorResponse,
  transferOwnership,
} from './household-service.js';

const METHOD_NOT_ALLOWED_BODY = {
  success: false,
  error: 'METHOD_NOT_ALLOWED',
  message: '지원하지 않는 household API 요청입니다.',
};

const defaultServices = {
  createHousehold,
  getCurrentHousehold,
  issueInvite,
  reissueInvites,
  joinHousehold,
  transferOwnership,
  renameHousehold,
  copyPersonalDataToHousehold,
  deduplicateHouseholdIngredients,
  activateHousehold,
  cancelPendingHousehold,
  removeMember,
  leaveHousehold,
  deleteLastOwnerHousehold,
};

/**
 * 다양한 입력 형태를 동일한 route parts 배열로 정규화한다.
 * 예: "current" | ["current"] | "/current" | "/api/households/current"
 */
export function normalizeHouseholdRouteInput(input, { url } = {}) {
  let raw = input;

  if ((raw == null || raw === '') && typeof url === 'string') {
    const pathOnly = String(url).split('?')[0];
    const marker = '/households/';
    const idx = pathOnly.indexOf(marker);
    if (idx >= 0) raw = pathOnly.slice(idx + marker.length);
    else if (/\/households\/?$/.test(pathOnly)) raw = '';
  }

  if (Array.isArray(raw)) {
    return raw
      .map(String)
      .flatMap((part) => part.split('/'))
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.replace(/^\/+|\/+$/g, ''))
      .filter(Boolean);
  }

  if (typeof raw === 'string') {
    let text = raw.trim();
    if (!text) return [];
    text = text.replace(/^\/+/, '');
    if (text.startsWith('api/households/')) text = text.slice('api/households/'.length);
    else if (text.startsWith('households/')) text = text.slice('households/'.length);
    else if (text === 'api/households' || text === 'households') return [];
    return text.split('/').map((part) => part.trim()).filter(Boolean);
  }

  return [];
}

/** Vercel req / Express-like req 에서 route parts 추출 */
export function normalizeHouseholdRouteParts(req) {
  const q = req?.query || {};
  const raw = q.route ?? q['...route'] ?? q.path ?? q['...path'] ?? null;
  return normalizeHouseholdRouteInput(raw, { url: req?.url });
}

export function resolveHouseholdRoute(method, routeParts = [], body = {}) {
  const parts = normalizeHouseholdRouteInput(routeParts);
  const [first, second, third] = parts;
  const normalizedRoute = parts.join('/');
  const verb = String(method || '').toUpperCase();

  if (verb === 'POST' && !first) {
    return {
      ok: true,
      handler: 'POST create',
      normalizedRoute,
      run: async (services, ctx) => {
        const household = await services.createHousehold({
          ...ctx,
          name: body?.name,
        });
        return { status: 201, body: { success: true, household } };
      },
    };
  }

  if (verb === 'GET' && first === 'current' && !second) {
    return {
      ok: true,
      handler: 'GET current',
      normalizedRoute,
      run: async (services, ctx, { query } = {}) => {
        const includeMembers = String(query?.includeMembers || '') === '1'
          || String(query?.includeMembers || '').toLowerCase() === 'true';
        const household = await services.getCurrentHousehold({
          ...ctx,
          includeMembers,
        });
        return {
          status: 200,
          body: {
            success: true,
            household: household || null,
            resolutionPath: household?.resolutionPath || (household ? null : 'recovery'),
          },
        };
      },
    };
  }

  if (verb === 'POST' && first === 'invites' && !second) {
    return {
      ok: true,
      handler: body?.action === 'reissue' ? 'POST invites:reissue' : 'POST invites',
      normalizedRoute,
      run: async (services, ctx) => {
        if (body?.action === 'reissue') {
          const invites = await services.reissueInvites({
            ...ctx,
            householdId: body?.householdId,
            expiresAt: body?.expiresAt,
            maxUses: body?.maxUses,
          });
          return { status: 201, body: { success: true, invites } };
        }
        const invite = await services.issueInvite({
          ...ctx,
          householdId: body?.householdId,
          kind: body?.kind,
          expiresAt: body?.expiresAt,
          maxUses: body?.maxUses,
        });
        return { status: 201, body: { success: true, invite } };
      },
    };
  }

  if (verb === 'POST' && first === 'join' && !second) {
    return {
      ok: true,
      handler: 'POST join',
      normalizedRoute,
      run: async (services, ctx) => {
        const household = await services.joinHousehold({
          ...ctx,
          kind: body?.kind,
          secret: body?.secret,
        });
        return { status: 200, body: { success: true, household } };
      },
    };
  }

  if (verb === 'POST' && first === 'transfer-owner' && !second) {
    return {
      ok: true,
      handler: 'POST transfer-owner',
      normalizedRoute,
      run: async (services, ctx) => {
        await services.transferOwnership({
          ...ctx,
          householdId: body?.householdId,
          toUid: body?.toUid,
        });
        return { status: 200, body: { success: true } };
      },
    };
  }

  if (verb === 'PATCH' && first === 'current' && !second) {
    return {
      ok: true,
      handler: 'PATCH current',
      normalizedRoute,
      run: async (services, ctx) => {
        const household = await services.renameHousehold({
          ...ctx,
          householdId: body?.householdId,
          name: body?.name,
        });
        return { status: 200, body: { success: true, household } };
      },
    };
  }

  if (verb === 'POST' && first === 'migrate-copy' && !second) {
    return {
      ok: true,
      handler: 'POST migrate-copy',
      normalizedRoute,
      run: async (services, ctx) => {
        const migration = await services.copyPersonalDataToHousehold({
          ...ctx,
          householdId: body?.householdId,
          scopes: body?.scopes,
        });
        return { status: 200, body: { success: true, migration } };
      },
    };
  }

  if (verb === 'POST' && first === 'deduplicate-ingredients' && !second) {
    return {
      ok: true,
      handler: 'POST deduplicate-ingredients',
      normalizedRoute,
      run: async (services, ctx) => {
        const result = await services.deduplicateHouseholdIngredients({
          ...ctx,
          householdId: body?.householdId,
        });
        return { status: 200, body: { success: true, result } };
      },
    };
  }

  if (verb === 'POST' && first === 'activate' && !second) {
    return {
      ok: true,
      handler: 'POST activate',
      normalizedRoute,
      run: async (services, ctx) => {
        const household = await services.activateHousehold({
          ...ctx,
          householdId: body?.householdId,
          migrationMode: body?.migrationMode,
        });
        return { status: 200, body: { success: true, household } };
      },
    };
  }

  if (verb === 'POST' && first === 'cancel-pending' && !second) {
    return {
      ok: true,
      handler: 'POST cancel-pending',
      normalizedRoute,
      run: async (services, ctx) => {
        await services.cancelPendingHousehold({
          ...ctx,
          householdId: body?.householdId,
        });
        return { status: 204, body: null };
      },
    };
  }

  if (verb === 'DELETE' && first === 'members' && second && !third) {
    return {
      ok: true,
      handler: 'DELETE members/:uid',
      normalizedRoute,
      run: async (services, ctx, { query } = {}) => {
        await services.removeMember({
          ...ctx,
          householdId: body?.householdId || query?.householdId,
          memberUid: second,
        });
        return { status: 204, body: null };
      },
    };
  }

  if (verb === 'POST' && first === 'leave' && !second) {
    return {
      ok: true,
      handler: 'POST leave',
      normalizedRoute,
      run: async (services, ctx) => {
        await services.leaveHousehold({
          ...ctx,
          householdId: body?.householdId,
        });
        return { status: 204, body: null };
      },
    };
  }

  if (verb === 'DELETE' && first === 'current' && !second) {
    return {
      ok: true,
      handler: 'DELETE current',
      normalizedRoute,
      run: async (services, ctx, { query } = {}) => {
        await services.deleteLastOwnerHousehold({
          ...ctx,
          householdId: body?.householdId || query?.householdId,
        });
        return { status: 202, body: { success: true, status: 'deleted' } };
      },
    };
  }

  return {
    ok: false,
    handler: 'none',
    normalizedRoute,
    run: async () => ({ status: 405, body: { ...METHOD_NOT_ALLOWED_BODY } }),
  };
}

/**
 * @returns {Promise<{ status: number, body: object|null, matchedHandler: string, normalizedRoute: string }>}
 */
export async function dispatchHouseholdApi({
  method,
  routeParts = [],
  idToken = null,
  headers = {},
  ip = '',
  body = {},
  query = {},
  services = defaultServices,
} = {}) {
  const parts = normalizeHouseholdRouteInput(routeParts);
  const matched = resolveHouseholdRoute(method, parts, body || {});
  const ctx = {
    idToken,
    headers,
    ip,
  };

  try {
    const result = await matched.run(services, ctx, { query: query || {}, body: body || {} });
    return {
      status: result.status,
      body: result.body,
      matchedHandler: matched.handler,
      normalizedRoute: matched.normalizedRoute,
    };
  } catch (err) {
    const mapped = toHouseholdErrorResponse(err);
    return {
      status: mapped.status,
      body: mapped.body,
      matchedHandler: matched.handler,
      normalizedRoute: matched.normalizedRoute,
    };
  }
}

export function applyHouseholdApiResult(res, result) {
  if (!result) return res.status(500).json({ success: false, error: 'HOUSEHOLD_SERVER_ERROR' });
  if (result.status === 204) return res.status(204).end();
  return res.status(result.status).json(result.body);
}

export function logHouseholdRouteDebug(payload = {}) {
  console.info([
    '[HOUSEHOLD API ROUTE DEBUG]',
    `method: ${payload.method || ''}`,
    `url: ${payload.url || ''}`,
    `query: ${JSON.stringify(payload.query || {})}`,
    `routeParam: ${JSON.stringify(payload.routeParam ?? null)}`,
    `dotRouteParam: ${JSON.stringify(payload.dotRouteParam ?? null)}`,
    `normalizedRoute: ${payload.normalizedRoute || '(empty)'}`,
    `matchedHandler: ${payload.matchedHandler || 'pending'}`,
  ].join('\n'));
}
