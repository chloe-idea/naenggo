/**
 * 가족 공유 상태 및 household Admin API 클라이언트.
 * 화면에는 household 대신 "가족 공유"만 노출한다.
 */
import { AuthService } from './auth-service.js';

let activeFamily = null;
const listeners = new Set();

function apiUrl(path = '') {
  return `/api/households${path}`;
}

function notify() {
  listeners.forEach((listener) => {
    try { listener(activeFamily); } catch (err) { console.warn('[FamilySharingService] listener failed:', err); }
  });
  window.dispatchEvent(new CustomEvent('family-sharing-changed', { detail: activeFamily }));
}

function clearFamilySetupCache() {
  try {
    sessionStorage.removeItem('pending-family-link-invite');
  } catch {
    // Storage access can be unavailable in private browser contexts.
  }
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

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  async refresh() {
    if (!AuthService.isLoggedIn()) {
      activeFamily = null;
      notify();
      return null;
    }
    const previousKey = JSON.stringify(activeFamily);
    try {
      const data = await request('/current');
      activeFamily = data.household || null;
    } catch (err) {
      // 서버가 membership 없는 pending/active 참조를 정리한 경우 클라이언트
      // 메모리에도 남기지 않는다. 새 setup은 서버에도 pending 문서가 있으므로
      // /current가 404가 될 이유가 없다.
      if (err.status === 404) {
        activeFamily = null;
        clearFamilySetupCache();
      } else throw err;
    }
    if (previousKey !== JSON.stringify(activeFamily)) notify();
    return this.getActiveFamily();
  },

  clear() {
    activeFamily = null;
    clearFamilySetupCache();
    notify();
  },

  async createFamily(name = '우리 가족') {
    const data = await request('', { method: 'POST', body: { name } });
    // 선택이 끝나기 전에는 scope를 바꾸지 않는다.
    activeFamily = { ...data.household, pendingSetup: true };
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
    const data = await request('/join', { method: 'POST', body: { kind, secret } });
    activeFamily = { ...data.household, pendingSetup: true };
    return data.household;
  },

  async rename(name) {
    const family = this.getActiveFamily();
    const data = await request('/current', {
      method: 'PATCH',
      body: { householdId: family?.householdId, name },
    });
    activeFamily = { ...family, ...data.household };
    notify();
    return this.getActiveFamily();
  },

  async transferOwner(toUid) {
    const family = this.getActiveFamily();
    await request('/transfer-owner', { method: 'POST', body: { householdId: family?.householdId, toUid } });
    return this.refresh();
  },

  async removeMember(uid) {
    const family = this.getActiveFamily();
    await request(`/members/${encodeURIComponent(uid)}?householdId=${encodeURIComponent(family?.householdId || '')}`, { method: 'DELETE' });
  },

  async leave() {
    const family = this.getActiveFamily();
    await request('/leave', { method: 'POST', body: { householdId: family?.householdId } });
    activeFamily = null;
    clearFamilySetupCache();
    notify();
  },

  async deleteFamily() {
    const family = this.getActiveFamily();
    await request(`/current?householdId=${encodeURIComponent(family?.householdId || '')}`, { method: 'DELETE' });
    activeFamily = null;
    clearFamilySetupCache();
    notify();
  },

  async copyCurrentData(scopes) {
    const family = this.getActiveFamily();
    return request('/migrate-copy', {
      method: 'POST',
      body: { householdId: family?.householdId, scopes },
    });
  },

  async cancelPendingSetup() {
    const family = this.getActiveFamily();
    await request('/cancel-pending', {
      method: 'POST',
      body: { householdId: family?.householdId },
    });
    activeFamily = null;
    clearFamilySetupCache();
    notify();
  },

  async activate({ migrationMode } = {}) {
    const family = this.getActiveFamily();
    await request('/activate', {
      method: 'POST',
      body: { householdId: family?.householdId, migrationMode },
    });
    activeFamily = { ...family, pendingSetup: false };
    return this.refresh();
  },
};
