/**
 * 가족 공유 상태 및 household Admin API 클라이언트.
 * 화면에는 household 대신 "가족 공유"만 노출한다.
 *
 * 초기 로딩 최적화:
 * - refresh in-flight dedupe
 * - 세션 메모리 캐시 (검증된 activeFamily)
 * - sessionStorage hint (구독 경로 가속용, 권한 판정 금지)
 */
import { AuthService } from './auth-service.js';

const HINT_STORAGE_KEY = 'naengjanggo_family_hint_v1';
const MUTATION_REASONS = new Set([
  'mutation',
  'create',
  'join',
  'leave',
  'activate',
  'delete',
  'cancel',
  'transfer',
  'remove-member',
  'rename',
  'load-members',
]);

let activeFamily = null;
/** 이번 세션에서 /current 검증을 통과한 상태인지 */
let sessionValidated = false;
/** @type {Promise<ReturnType<typeof FamilySharingService.getActiveFamily>> | null} */
let refreshInFlight = null;

const perf = {
  refreshCalls: 0,
  fetchCalls: 0,
  cacheHits: 0,
  lastCacheHit: false,
  lastResolutionPath: null,
  lastDurationMs: null,
};

const listeners = new Set();

function apiUrl(path = '') {
  return `/api/households${path}`;
}

/** 가족 해제 직전: 현재 uid가 저장한 레시피 ID만 확보 */
function captureMySavedRecipeIds() {
  try {
    const ids = window.AppServices?.SavedRecipeRepository?.getMySavedIds?.();
    return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * 개인 스코프 메모리만 내 저장분으로 정리.
 * Firestore 이관은 서버(copy/migrate)가 existingPersonal ∪ householdMine 으로 수행하므로
 * 여기서 preferences를 덮어쓰지 않는다 (가입 전 개인 저장분 유실 방지).
 * syncUserData clear 이후 복구용으로 pending에 남긴다.
 */
async function adoptPersonalSavedRecipeIds(ids) {
  const myIds = Array.isArray(ids) ? [...new Set(ids.map(String).filter(Boolean))] : [];
  window.__pendingPersonalSavedRecipeIds = myIds;
  // 서버 이관 스냅샷이 오기 전 persist가 불완전 목록으로 덮어쓰지 않도록
  window.__savedRecipesAwaitingPersonalHydration = true;
  try {
    window.AppServices?.SavedRecipeRepository?.replaceIds?.(myIds);
  } catch (error) {
    console.warn('[FamilySharing] local savedRecipes reset skipped', {
      message: error?.message || String(error),
    });
  }
}

function notify(source = 'user-action') {
  const family = activeFamily;
  listeners.forEach((listener) => {
    try { listener(family); } catch (err) { console.warn('[FamilySharingService] listener failed:', err); }
  });
  window.dispatchEvent(new CustomEvent('family-sharing-changed', {
    detail: { family, source },
  }));
}

function clearFamilySetupCache() {
  try {
    sessionStorage.removeItem('pending-family-link-invite');
  } catch {
    // Storage access can be unavailable in private browser contexts.
  }
}

function readSessionHint() {
  try {
    const raw = sessionStorage.getItem(HINT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      householdId: typeof parsed.householdId === 'string' ? parsed.householdId : null,
      pendingHouseholdId: typeof parsed.pendingHouseholdId === 'string' ? parsed.pendingHouseholdId : null,
      cachedAt: Number(parsed.cachedAt) || 0,
    };
  } catch {
    return null;
  }
}

function writeSessionHint(family) {
  try {
    if (!family?.householdId) {
      sessionStorage.removeItem(HINT_STORAGE_KEY);
      return;
    }
    const pending = Boolean(family.pendingSetup);
    sessionStorage.setItem(HINT_STORAGE_KEY, JSON.stringify({
      householdId: pending ? null : family.householdId,
      pendingHouseholdId: pending ? family.householdId : null,
      cachedAt: Date.now(),
    }));
  } catch {
    // ignore
  }
}

function clearSessionHint() {
  try {
    sessionStorage.removeItem(HINT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function invalidateSessionCache() {
  sessionValidated = false;
  clearSessionHint();
}

function logHouseholdPerf(extra = {}) {
  console.log('[HouseholdPerf]', {
    refreshCalls: perf.refreshCalls,
    fetchCalls: perf.fetchCalls,
    cacheHit: perf.lastCacheHit,
    resolutionPath: perf.lastResolutionPath,
    durationMs: perf.lastDurationMs,
    ...extra,
  });
}

async function authHeaders() {
  const token = await AuthService.acquireIdTokenForApi();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers: await authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    console.error('[FamilySharingService] network failure', {
      url: apiUrl(path),
      method,
      message: cause?.message || String(cause),
      cause,
    });
    throw cause;
  }
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[FamilySharingService] API failure', {
      url: apiUrl(path),
      method,
      status: response.status,
      response: payload,
    });
    const err = new Error(payload.message || '가족 공유 처리 중 오류가 발생했습니다.');
    err.code = payload.error || 'FAMILY_API_ERROR';
    err.status = response.status;
    err.retryAfterSeconds = Number(payload.retryAfterSeconds) || 0;
    err.debugMessage = payload.debugMessage || '';
    throw err;
  }
  return payload;
}

async function fetchCurrentHousehold({ includeMembers = false } = {}) {
  perf.fetchCalls += 1;
  const started = performance.now();
  const path = includeMembers ? '/current?includeMembers=1' : '/current';
  const data = await request(path);
  perf.lastDurationMs = Math.round(performance.now() - started);
  perf.lastResolutionPath = data?.resolutionPath || data?.household?.resolutionPath || null;
  return data;
}

async function runRefresh({
  force = false,
  reason = 'default',
  notifySource = 'user-action',
  includeMembers = false,
} = {}) {
  const started = performance.now();
  perf.refreshCalls += 1;
  perf.lastCacheHit = false;

  if (!AuthService.isLoggedIn()) {
    activeFamily = null;
    sessionValidated = false;
    clearSessionHint();
    notify(notifySource);
    perf.lastDurationMs = Math.round(performance.now() - started);
    logHouseholdPerf({ reason, loggedIn: false });
    return null;
  }

  const allowNetworkForce = Boolean(force && MUTATION_REASONS.has(reason));
  const needFullMembers = Boolean(includeMembers || reason === 'load-members');

  // 세션 캐시: mutation force가 아니면 검증된 결과 재사용
  // 단, 부분 members만 있을 때 전체 목록이 필요하면 네트워크 강제
  if (
    !allowNetworkForce
    && sessionValidated
    && !(needFullMembers && activeFamily?.membersPartial)
  ) {
    perf.lastCacheHit = true;
    perf.lastDurationMs = Math.round(performance.now() - started);
    perf.cacheHits += 1;
    logHouseholdPerf({ reason, fromCache: true });
    return FamilySharingService.getActiveFamily();
  }

  const previousKey = JSON.stringify(activeFamily);
  const hadHintOrFamily = Boolean(activeFamily?.householdId || readSessionHint()?.householdId);
  try {
    const data = await fetchCurrentHousehold({ includeMembers: needFullMembers });
    activeFamily = data.household || null;
    if (activeFamily && data.resolutionPath && !activeFamily.resolutionPath) {
      activeFamily = { ...activeFamily, resolutionPath: data.resolutionPath };
    }
    sessionValidated = true;
    writeSessionHint(activeFamily);
    // 서버가 deleted/stale pointer를 정리해 null을 준 경우 → 개인 모드 복구
    if (!activeFamily && hadHintOrFamily) {
      clearSessionHint();
      clearFamilySetupCache();
      console.info('[FamilySharing] stale household cleared → personal mode', {
        reason,
        hadHintOrFamily: true,
        resolutionPath: data?.resolutionPath || null,
      });
    }
  } catch (err) {
    if (err.status === 404) {
      activeFamily = null;
      sessionValidated = true;
      clearSessionHint();
      clearFamilySetupCache();
      console.info('[FamilySharing] household 404 → personal mode', { reason });
    } else {
      throw err;
    }
  }

  perf.lastDurationMs = Math.round(performance.now() - started);
  logHouseholdPerf({ reason, fromCache: false, includeMembers: needFullMembers });

  if (previousKey !== JSON.stringify(activeFamily)) {
    notify(notifySource);
  }
  return FamilySharingService.getActiveFamily();
}

export const FamilySharingService = {
  getActiveFamily() {
    return activeFamily ? { ...activeFamily } : null;
  },

  getActiveHouseholdId() {
    return activeFamily?.pendingSetup ? null : (activeFamily?.householdId || null);
  },

  isActive() {
    return Boolean(activeFamily?.householdId && !activeFamily.pendingSetup);
  },

  /** /current 검증을 통과한 세션인지 */
  isSessionValidated() {
    return Boolean(sessionValidated);
  },

  /**
   * 미검증 session hint scope만 메모리에서 제거한다.
   * Firestore users.activeHouseholdId / membership 은 변경하지 않는다.
   * (localhost API 실패 시 stale hint → household permission-denied → 빈 화면 고착 방지)
   */
  clearUnvalidatedHintScope() {
    if (sessionValidated) return false;
    if (!activeFamily?._fromHint) return false;
    console.warn('[FamilySharing] clearing unvalidated hint scope (no Firestore pointer write)', {
      hadHouseholdId: Boolean(activeFamily?.householdId),
      pendingSetup: Boolean(activeFamily?.pendingSetup),
    });
    activeFamily = null;
    clearSessionHint();
    return true;
  },

  /** 구독 경로 가속용 hint (권한 판정에 사용 금지) */
  getSessionHint() {
    return readSessionHint();
  },

  /**
   * hint로 임시 scope만 설정. sessionValidated=false 유지 → 뒤이어 /current 검증 필수.
   * @returns {{ householdId: string|null, fromHint: boolean }}
   */
  applySessionHintForScope() {
    if (sessionValidated) {
      return {
        householdId: this.getActiveHouseholdId(),
        fromHint: false,
      };
    }
    const hint = readSessionHint();
    if (!hint) {
      return { householdId: this.getActiveHouseholdId(), fromHint: false };
    }
    if (hint.householdId) {
      activeFamily = {
        householdId: hint.householdId,
        pendingSetup: false,
        _fromHint: true,
      };
      return { householdId: hint.householdId, fromHint: true };
    }
    if (hint.pendingHouseholdId) {
      activeFamily = {
        householdId: hint.pendingHouseholdId,
        pendingSetup: true,
        _fromHint: true,
      };
      return { householdId: null, fromHint: true };
    }
    return { householdId: null, fromHint: false };
  },

  getPerfSnapshot() {
    return { ...perf };
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * @param {{ force?: boolean, reason?: string, notifySource?: string }} [options]
   * force+mutation reason 일 때만 네트워크 강제. 그 외 force는 in-flight dedupe/캐시와 동일.
   */
  async refresh(options = {}) {
    const opts = typeof options === 'boolean'
      ? { force: options, reason: 'default' }
      : options;
    const force = Boolean(opts.force);
    const reason = opts.reason || 'default';
    const notifySource = opts.notifySource || (reason === 'hydration' ? 'hydration' : 'user-action');
    const includeMembers = Boolean(opts.includeMembers || reason === 'load-members');
    const allowNetworkForce = Boolean(force && MUTATION_REASONS.has(reason));
    const needNetworkForMembers = Boolean(includeMembers && activeFamily?.membersPartial);

    if (allowNetworkForce) {
      if (reason === 'load-members') {
        sessionValidated = false; // hint는 유지
      } else {
        invalidateSessionCache();
      }
    }

    if (refreshInFlight) {
      if (!allowNetworkForce && !needNetworkForMembers) {
        return refreshInFlight;
      }
      // mutation force / full members: 진행 중 요청이 끝난 뒤 한 번 더 검증
      await refreshInFlight;
      if (allowNetworkForce) {
        if (reason === 'load-members') sessionValidated = false;
        else invalidateSessionCache();
      }
    }

    refreshInFlight = runRefresh({
      force: allowNetworkForce || needNetworkForMembers,
      reason: needNetworkForMembers && !allowNetworkForce ? 'load-members' : reason,
      notifySource,
      includeMembers,
    }).finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  },

  clear() {
    activeFamily = null;
    invalidateSessionCache();
    clearFamilySetupCache();
    notify('user-action');
  },

  async createFamily(name = '우리 가족') {
    invalidateSessionCache();
    const data = await request('', { method: 'POST', body: { name } });
    activeFamily = { ...data.household, pendingSetup: true };
    sessionValidated = false;
    writeSessionHint(activeFamily);
    return data.household;
  },

  async createInvite({ householdId, kind, expiresAt, maxUses }) {
    const data = await request('/invites', {
      method: 'POST',
      body: { householdId, kind, expiresAt, maxUses },
    });
    return data.invite;
  },

  async reissueInvites({ householdId, expiresAt, maxUses }) {
    const data = await request('/invites', {
      method: 'POST',
      body: { action: 'reissue', householdId, expiresAt, maxUses },
    });
    return data.invites;
  },

  async join({ kind, secret }) {
    invalidateSessionCache();
    const data = await request('/join', { method: 'POST', body: { kind, secret } });
    activeFamily = { ...data.household, pendingSetup: true };
    sessionValidated = false;
    writeSessionHint(activeFamily);
    return data.household;
  },

  async rename(name) {
    const family = this.getActiveFamily();
    invalidateSessionCache();
    const data = await request('/current', {
      method: 'PATCH',
      body: { householdId: family?.householdId, name },
    });
    activeFamily = { ...family, ...data.household };
    sessionValidated = true;
    writeSessionHint(activeFamily);
    notify('user-action');
    return this.getActiveFamily();
  },

  async transferOwner(toUid) {
    const family = this.getActiveFamily();
    invalidateSessionCache();
    await request('/transfer-owner', { method: 'POST', body: { householdId: family?.householdId, toUid } });
    return this.refresh({ force: true, reason: 'transfer', notifySource: 'user-action' });
  },

  async removeMember(uid) {
    const family = this.getActiveFamily();
    invalidateSessionCache();
    await request(`/members/${encodeURIComponent(uid)}?householdId=${encodeURIComponent(family?.householdId || '')}`, { method: 'DELETE' });
  },

  async leave() {
    const family = this.getActiveFamily();
    const members = Array.isArray(family?.members) ? family.members : [];
    // 마지막 활성 관리자 → 서버 leave도 삭제로 위임하지만, UI 경로를 명시적으로 맞춤
    if (family?.role === 'owner' && members.length === 1) {
      return this.deleteFamily();
    }
    // isActive()가 false가 되기 전에 내 저장분만 캡처 (전체 household _ids 오염 방지)
    const mySavedIds = captureMySavedRecipeIds();
    invalidateSessionCache();
    await request('/leave', { method: 'POST', body: { householdId: family?.householdId } });
    activeFamily = null;
    sessionValidated = true;
    clearSessionHint();
    clearFamilySetupCache();
    await adoptPersonalSavedRecipeIds(mySavedIds);
    notify('user-action');
  },

  async deleteFamily() {
    const family = this.getActiveFamily();
    const householdId = family?.householdId || '';
    const mySavedIds = captureMySavedRecipeIds();
    invalidateSessionCache();
    console.info('[FamilySharing] deleteFamily start', {
      householdIdPresent: Boolean(householdId),
      role: family?.role || null,
      memberCount: Array.isArray(family?.members) ? family.members.length : null,
    });
    try {
      await request(`/current?householdId=${encodeURIComponent(householdId)}`, { method: 'DELETE' });
    } catch (error) {
      console.error('[FamilySharing] deleteFamily API failed', {
        code: error?.code || '',
        status: error?.status || 0,
        message: error?.message || String(error),
      });
      throw error;
    }
    activeFamily = null;
    sessionValidated = true;
    clearSessionHint();
    clearFamilySetupCache();
    await adoptPersonalSavedRecipeIds(mySavedIds);
    console.info('[FamilySharing] deleteFamily local clear done', {
      activeFamilyCleared: true,
      sessionHintCleared: true,
    });
    notify('user-action');
  },

  async copyCurrentData(scopes) {
    const family = this.getActiveFamily();
    return request('/migrate-copy', {
      method: 'POST',
      body: { householdId: family?.householdId, scopes },
    });
  },

  async deduplicateIngredients() {
    const family = this.getActiveFamily();
    if (!family?.householdId || family.pendingSetup) return null;
    return request('/deduplicate-ingredients', {
      method: 'POST',
      body: { householdId: family.householdId },
    });
  },

  async cancelPendingSetup() {
    const family = this.getActiveFamily();
    invalidateSessionCache();
    await request('/cancel-pending', {
      method: 'POST',
      body: { householdId: family?.householdId },
    });
    activeFamily = null;
    sessionValidated = true;
    clearSessionHint();
    clearFamilySetupCache();
    notify('user-action');
  },

  async activate({ migrationMode } = {}) {
    const family = this.getActiveFamily();
    invalidateSessionCache();
    await request('/activate', {
      method: 'POST',
      body: { householdId: family?.householdId, migrationMode },
    });
    activeFamily = { ...family, pendingSetup: false };
    return this.refresh({ force: true, reason: 'activate', notifySource: 'user-action' });
  },
};
