/**
 * LoginRequiredModal — 로그인 유도 공통 모달
 * redirectAfterLogin: 로그인 성공 후 자동 실행할 작업
 */
(function initLoginRequiredModal(global) {
  const PRESETS = {
    default: {
      title: '🍳 로그인하고 냉장GO를 시작해보세요',
    },
    videoRecipe: {
      title: '🔍 로그인하고 냉장GO를 시작해보세요',
    },
    aiFeature: {
      title: '🔍 로그인하고 냉장GO를 시작해보세요',
    },
  };

  const COPY = {
    quotaGuest: '로그인하면 매주 무료 AI 분석 5회를 제공합니다.',
    quotaChecking: '무료 분석 횟수를 확인하고 있어요…',
  };

  function $(id) {
    return document.getElementById(id);
  }

  function isLoggedIn() {
    const authSvc = global.FirebaseServices?.AuthService;
    if (authSvc?.isLoggedIn?.()) return true;
    return Boolean(global.FirebaseServices?.auth?.currentUser?.uid);
  }

  function normalizeOptions(input) {
    if (typeof input === 'function') {
      return { redirectAfterLogin: input, preset: 'default' };
    }
    return {
      preset: input?.preset || 'default',
      redirectAfterLogin: input?.redirectAfterLogin || input?.returnTo || null,
    };
  }

  const LoginRequiredModal = {
    redirectAfterLogin: null,
    activePreset: 'default',

    open(options = {}) {
      const normalized = normalizeOptions(options);
      if (normalized.redirectAfterLogin) this.redirectAfterLogin = normalized.redirectAfterLogin;
      this.activePreset = normalized.preset || 'default';
      this.applyPreset(this.activePreset);
      this.clearError();
      this.syncUi();
      this.show();
    },

    close(clearRedirect = true) {
      if (clearRedirect) this.redirectAfterLogin = null;
      this.clearError();
      this.hide();
    },

    dismiss() {
      this.close(true);
    },

    requireAuth(actionOrOptions) {
      const options = normalizeOptions(actionOrOptions);
      if (isLoggedIn()) {
        return options.redirectAfterLogin?.();
      }
      this.open(options);
      return undefined;
    },

    applyPreset(presetKey) {
      const preset = PRESETS[presetKey] || PRESETS.default;
      const titleEl = $('login-prompt-title');
      if (titleEl) titleEl.textContent = preset.title;
    },

    clearError() {
      const err = $('login-prompt-error');
      if (!err) return;
      err.hidden = true;
      err.textContent = '';
    },

    showError(message) {
      const err = $('login-prompt-error');
      if (!err || !message) return;
      err.hidden = false;
      err.textContent = message;
    },

    syncUi() {
      const quotaEl = $('login-prompt-quota');
      if (quotaEl) {
        quotaEl.textContent = isLoggedIn() ? COPY.quotaChecking : COPY.quotaGuest;
      }
      this.syncGoogleButton();
    },

    syncGoogleButton() {
      const btn = $('login-prompt-google-btn');
      if (!btn) return;
      const gate = global.__authGateState || {};
      const loading = Boolean(gate.isLoggingIn);
      const disabled = loading || gate.authLoading || gate.isLoggingOut;
      btn.disabled = disabled;
      btn.classList.toggle('btn--loading', loading);
      btn.setAttribute('aria-busy', loading ? 'true' : 'false');
    },

    show() {
      const modal = $('login-prompt-modal');
      if (!modal) return;
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      global.dispatchEvent(new CustomEvent('ui-modal-change'));
    },

    hide() {
      const modal = $('login-prompt-modal');
      if (!modal) return;
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
      if (typeof global.updateBodyScrollLock === 'function') {
        global.updateBodyScrollLock();
      } else {
        document.body.style.overflow = '';
      }
      global.dispatchEvent(new CustomEvent('ui-modal-change'));
    },

    isOpen() {
      const modal = $('login-prompt-modal');
      return Boolean(modal && !modal.hidden);
    },

    async handleGoogleLogin() {
      this.clearError();
      if (typeof global.__authSignInGoogle !== 'function') {
        this.showError('로그인을 준비 중입니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      try {
        await global.__authSignInGoogle();
      } catch (err) {
        this.showError(err?.message || '로그인에 실패했어요. 잠시 후 다시 시도해 주세요.');
      }
    },

    resumeRedirectAfterLogin() {
      if (!this.redirectAfterLogin || !isLoggedIn()) return;
      const action = this.redirectAfterLogin;
      this.redirectAfterLogin = null;
      this.hide();
      global.setTimeout(() => {
        try {
          const result = action();
          if (result?.then) {
            result.catch((err) => console.error('[LoginRequiredModal] redirectAfterLogin failed', err));
          }
        } catch (err) {
          console.error('[LoginRequiredModal] redirectAfterLogin failed', err);
        }
      }, 0);
    },

    bindEvents() {
      $('login-prompt-google-btn')?.addEventListener('click', () => this.handleGoogleLogin());
      $('login-prompt-dismiss-btn')?.addEventListener('click', () => this.dismiss());
      global.addEventListener('auth-gate-state', () => this.syncGoogleButton());
      global.addEventListener('auth-state-changed', (e) => {
        if (e.detail?.user) this.resumeRedirectAfterLogin();
      });
      global.addEventListener('login-prompt-open', () => this.open());
    },

    init() {
      this.bindEvents();
      global.openLoginPrompt = (options) => this.open(options);
      global.syncLoginPromptError = (message) => {
        if (this.isOpen()) this.showError(message);
      };
      global.LoginRequiredModal = this;
      global.LoginPrompt = this;
    },
  };

  LoginRequiredModal.init();
})(window);
