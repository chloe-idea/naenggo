/**
 * 로그인 버튼 — ES module 실패 시에도 클릭이 동작하도록 보장 (non-module)
 */
(function authUiBridge() {
  function showErr(msg, hint) {
    const text = [msg, hint].filter(Boolean).join(' ');
    console.error('[auth-ui-bridge]', text);
    const el = document.getElementById('auth-error');
    if (el) {
      el.hidden = false;
      el.textContent = text;
    }
  }

  function setLoading(on) {
    const btn = document.getElementById('auth-login-btn');
    if (!btn) return;
    const label = btn.querySelector('.header-login-btn__label');
    btn.disabled = on;
    btn.classList.toggle('header-login-btn--loading', on);
    if (label) label.textContent = on ? '로그인 중…' : '로그인';
  }

  async function waitFirebase(timeoutMs) {
    if (window.FirebaseServices?.AuthService) return window.FirebaseServices;

    if (!window.__firebaseBootstrapPromise) {
      throw new Error('Firebase 모듈이 로드되지 않았습니다. 페이지를 새로고침 해 주세요.');
    }

    await Promise.race([
      window.__firebaseBootstrapPromise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Firebase 초기화 시간 초과 (15초). F12 콘솔 오류를 확인해 주세요.')), timeoutMs || 15000);
      }),
    ]);

    if (window.FirebaseServices?.AuthService) return window.FirebaseServices;
    throw new Error('Firebase Auth를 초기화하지 못했습니다. F12 콘솔 오류를 확인해 주세요.');
  }

  async function handleLoginClick(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    console.log('[auth-ui-bridge] login clicked');
    setLoading(true);

    const errEl = document.getElementById('auth-error');
    if (errEl) errEl.hidden = true;

    try {
      if (typeof window.__authSignInGoogle === 'function') {
        await window.__authSignInGoogle();
      } else {
        const services = await waitFirebase(15000);
        const user = await services.AuthService.signInWithGoogle();
        if (user && typeof window.__authHandleUser === 'function') {
          await window.__authHandleUser(user);
        }
      }
    } catch (err) {
      console.error('[auth-ui-bridge] login error:', err);
      const formatted = err?.authError;
      const msg = formatted?.message || err?.message || 'Google 로그인에 실패했습니다.';
      const hint = formatted?.hint || '';
      showErr(msg, hint);

      const code = formatted?.code || err?.code || '';
      if (code === 'auth/unauthorized-domain') {
        alert(`${msg}\n\nFirebase Console → Authentication → Settings → Authorized domains\n에 "${location.hostname}" 도메인을 추가해 주세요.`);
      }
    } finally {
      const loggedIn = window.FirebaseServices?.AuthService?.isLoggedIn?.();
      if (!loggedIn) setLoading(false);
    }
  }

  async function handleLogoutClick(event) {
    if (event) event.preventDefault();
    console.log('[auth-ui-bridge] logout clicked');
    try {
      if (typeof window.__authSignOut === 'function') {
        await window.__authSignOut();
      } else {
        const services = await waitFirebase(10000);
        await services.AuthService.signOut();
      }
    } catch (err) {
      console.error('[auth-ui-bridge] logout error:', err);
      showErr(err?.message || '로그아웃 실패');
    }
  }

  function bind() {
    const loginBtn = document.getElementById('auth-login-btn');
    const logoutBtn = document.getElementById('profile-logout-btn');

    if (!loginBtn) {
      console.error('[auth-ui-bridge] #auth-login-btn not found');
      return;
    }

    loginBtn.addEventListener('click', handleLoginClick);
    console.log('[auth-ui-bridge] click handler attached (guaranteed)');

    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogoutClick);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.__authUiBridgeReady = true;
})();
