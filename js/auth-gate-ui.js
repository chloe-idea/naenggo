/**
 * AuthGateUI — 비로그인 시 잠금 배지·툴팁 표시 (로그인 후 자동 제거)
 */
(function initAuthGateUI(global) {
  const TOOLTIP_MSG = '로그인하면 이 기능을 사용할 수 있습니다.';

  function isLoggedIn() {
    const authSvc = global.FirebaseServices?.AuthService;
    if (authSvc?.isLoggedIn?.()) return true;
    if (global.__authGateState?.user?.uid) return true;
    return Boolean(global.FirebaseServices?.auth?.currentUser?.uid);
  }

  let longPressTimer = null;
  let tooltipDismissTimer = null;

  const AuthGateUI = {
    tooltipEl: null,

    init() {
      this.tooltipEl = document.getElementById('auth-gate-tooltip');
      this.bindTooltipEvents();
      global.addEventListener('auth-state-changed', () => this.sync());
      global.addEventListener('auth-gate-state', () => this.sync());
      this.sync();
    },

    sync() {
      const locked = !isLoggedIn();
      document.querySelectorAll('[data-auth-required]').forEach((el) => {
        el.classList.toggle('auth-gate-locked', locked);
        if (locked) {
          el.setAttribute('aria-describedby', 'auth-gate-tooltip');
        } else {
          el.removeAttribute('aria-describedby');
        }
        el.querySelectorAll('.auth-gate-badge').forEach((badge) => {
          badge.hidden = !locked;
        });
      });
    },

    showTooltip(target) {
      if (!this.tooltipEl || !target?.classList.contains('auth-gate-locked')) return;
      this.tooltipEl.textContent = TOOLTIP_MSG;
      this.tooltipEl.hidden = false;
      const rect = target.getBoundingClientRect();
      const tipW = this.tooltipEl.offsetWidth;
      const tipH = this.tooltipEl.offsetHeight;
      let left = rect.left + rect.width / 2 - tipW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
      let top = rect.top - tipH - 8;
      if (top < 8) top = rect.bottom + 8;
      this.tooltipEl.style.left = `${left}px`;
      this.tooltipEl.style.top = `${top}px`;
    },

    hideTooltip() {
      clearTimeout(tooltipDismissTimer);
      if (this.tooltipEl) this.tooltipEl.hidden = true;
    },

    scheduleTooltipDismiss() {
      clearTimeout(tooltipDismissTimer);
      tooltipDismissTimer = global.setTimeout(() => this.hideTooltip(), 2400);
    },

    bindTooltipEvents() {
      document.addEventListener('mouseover', (e) => {
        const el = e.target.closest('[data-auth-required].auth-gate-locked');
        if (el) {
          this.showTooltip(el);
          return;
        }
        if (!e.target.closest('#auth-gate-tooltip')) this.hideTooltip();
      });

      document.addEventListener('mouseout', (e) => {
        const from = e.target.closest('[data-auth-required]');
        const to = e.relatedTarget?.closest?.('[data-auth-required]');
        if (from && from !== to) this.hideTooltip();
      });

      document.addEventListener('touchstart', (e) => {
        const el = e.target.closest('[data-auth-required].auth-gate-locked');
        if (!el) return;
        clearTimeout(longPressTimer);
        longPressTimer = global.setTimeout(() => {
          this.showTooltip(el);
          this.scheduleTooltipDismiss();
        }, 480);
      }, { passive: true });

      document.addEventListener('touchend', () => clearTimeout(longPressTimer));
      document.addEventListener('touchmove', () => clearTimeout(longPressTimer));
      document.addEventListener('touchcancel', () => clearTimeout(longPressTimer));
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => AuthGateUI.init());
  } else {
    AuthGateUI.init();
  }

  global.AuthGateUI = AuthGateUI;
})(window);
