/**
 * AI 무료 분석 횟수 — 로그인(Firestore) / 게스트(LocalStorage + 서버 API)
 */
import { AuthService } from './auth-service.js';
import { FirestoreUserService } from './firestore-user-service.js';
import { FREE_ANALYSIS_LIMIT } from '../firebase.js';

const GUEST_QUOTA_KEY = 'naengjanggo_guest_free_analysis_remaining';
const ADMIN_UNLIMITED_USAGE = {
  remaining: null,
  limit: null,
  used: 0,
  source: 'admin',
  unlimited: true,
};

function isAdminUser() {
  return window.FirebaseServices?.AdminService?.isAdmin?.() === true;
}

function readGuestLocalRemaining() {
  try {
    const raw = localStorage.getItem(GUEST_QUOTA_KEY);
    if (raw === null) return FREE_ANALYSIS_LIMIT;
    const parsed = JSON.parse(raw);
    const remaining = Number(parsed?.remaining);
    return Number.isFinite(remaining) ? Math.max(0, remaining) : FREE_ANALYSIS_LIMIT;
  } catch {
    return FREE_ANALYSIS_LIMIT;
  }
}

function writeGuestLocalRemaining(remaining) {
  localStorage.setItem(GUEST_QUOTA_KEY, JSON.stringify({
    remaining: Math.max(0, Number(remaining) || 0),
    updatedAt: new Date().toISOString(),
  }));
}

export const AnalysisQuotaService = {
  isLoggedIn() {
    return AuthService.isLoggedIn();
  },

  getDailyLimit() {
    return FREE_ANALYSIS_LIMIT;
  },

  getAdminUnlimitedUsage() {
    return { ...ADMIN_UNLIMITED_USAGE };
  },

  isAdmin() {
    return isAdminUser();
  },

  /** 게스트: LocalStorage 기준 남은 횟수 */
  getGuestLocalUsage() {
    const remaining = readGuestLocalRemaining();
    return {
      remaining,
      limit: FREE_ANALYSIS_LIMIT,
      used: Math.max(0, FREE_ANALYSIS_LIMIT - remaining),
      source: 'guest-local',
    };
  },

  /** 로그인: Firestore에서 읽기 */
  async fetchLoggedInUsage() {
    if (isAdminUser()) return this.getAdminUnlimitedUsage();
    const uid = AuthService.getUid();
    if (!uid) return null;
    const remaining = await FirestoreUserService.getFreeAnalysisRemaining(uid);
    return FirestoreUserService.toUsageDisplay(remaining);
  },

  /** 현재 사용자 기준 usage 조회 */
  async fetchUsage() {
    if (this.isLoggedIn()) {
      if (isAdminUser()) return this.getAdminUnlimitedUsage();
      return this.fetchLoggedInUsage();
    }

    const cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.videoExtract : {};
    const apiUrl = cfg.aiUsageApiUrl || '/api/ai-usage';
    const guestId = window.AppServices?.ClientUserService?.getUserId?.();
    if (!guestId) return this.getGuestLocalUsage();

    try {
      const res = await fetch(`${apiUrl}?userId=${encodeURIComponent(guestId)}`);
      if (!res.ok) return this.getGuestLocalUsage();
      const data = await res.json();
      const usage = data.aiUsage || null;
      if (usage) writeGuestLocalRemaining(usage.remaining);
      return usage || this.getGuestLocalUsage();
    } catch (err) {
      console.warn('[AnalysisQuotaService] guest API failed:', err);
      return this.getGuestLocalUsage();
    }
  },

  /** AI 분석 성공 후 게스트 LocalStorage 동기화 */
  syncGuestAfterSuccess(aiUsage) {
    if (this.isLoggedIn()) return;
    if (aiUsage?.unlimited) return;
    if (aiUsage && typeof aiUsage.remaining === 'number') {
      writeGuestLocalRemaining(aiUsage.remaining);
    } else {
      const current = readGuestLocalRemaining();
      writeGuestLocalRemaining(Math.max(0, current - 1));
    }
  },

  async getIdTokenForApi() {
    if (!this.isLoggedIn()) return null;
    return AuthService.getIdToken();
  },
};
