/**
 * Auth 게이트 상태 — authLoading / isLoggingIn / dataLoading 명확히 분리
 */
const STATUS = {
  authLoading: '냉장고를 불러오는 중…',
  isLoggingIn: '로그인 중입니다…',
  isLoggingOut: '로그아웃 중…',
  dataLoading: '내 재료를 불러오는 중…',
};

const DEFAULT_STATE = {
  authLoading: true,
  isLoggingIn: false,
  dataLoading: false,
  isLoggingOut: false,
  user: null,
  appReady: false,
};

function cloneState(state) {
  return { ...state, user: state.user ?? null };
}

export function createAuthGateController({ onUiSync, onStateChange } = {}) {
  let state = cloneState(DEFAULT_STATE);

  function getState() {
    return cloneState(state);
  }

  function resolveActivePhase(next) {
    if (next.authLoading) return 'authLoading';
    if (next.isLoggingIn) return 'isLoggingIn';
    if (next.isLoggingOut) return 'isLoggingOut';
    if (next.dataLoading) return 'dataLoading';
    return 'idle';
  }

  function patch(partial) {
    const next = cloneState({ ...state, ...partial });
    const prevPhase = resolveActivePhase(state);
    const nextPhase = resolveActivePhase(next);
    state = next;

    onUiSync?.(state, {
      phase: nextPhase,
      message: STATUS[nextPhase] || null,
      phaseChanged: prevPhase !== nextPhase,
    });

    onStateChange?.(getState());
    window.dispatchEvent(new CustomEvent('auth-gate-state', { detail: getState() }));
  }

  function resetForGuest() {
    patch({
      authLoading: false,
      isLoggingIn: false,
      dataLoading: false,
      isLoggingOut: false,
      user: null,
      appReady: false,
    });
  }

  return {
    getState,
    patch,
    resetForGuest,
    STATUS,
  };
}
