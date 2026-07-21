/**
 * AI 무료 분석 횟수 — 로그인(Firestore) / 게스트(LocalStorage + 서버 API)
 */
import { AuthService } from './auth-service.js';
import { FirestoreUserService } from './firestore-user-service.js';
import { FREE_ANALYSIS_LIMIT } from '../firebase.js';
import {
  buildUsageDisplay,
  getWeeklyLimit,
  normalizeWeeklyUsageRecord,
} from '../lib/analysis-quota-core.js';
import { getCurrentWeekKey } from '../lib/analysis-week-key.js';

const GUEST_QUOTA_KEY = 'naengjanggo_guest_analysis_quota';
const LEGACY_GUEST_QUOTA_KEY = 'naengjanggo_guest_free_analysis_remaining';

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

function readGuestLocalRecord() {
  try {
    const raw = localStorage.getItem(GUEST_QUOTA_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          analysisQuotaWeekKey: parsed.currentWeekKey || parsed.analysisQuotaWeekKey,
          analysisQuotaUsed: parsed.weeklyUsageCount ?? parsed.analysisQuotaUsed,
        };
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const legacyRaw = localStorage.getItem(LEGACY_GUEST_QUOTA_KEY);
    if (legacyRaw) {
      localStorage.removeItem(LEGACY_GUEST_QUOTA_KEY);
    }
  } catch {
    /* ignore */
  }

  return {};
}

function writeGuestLocalUsage(usage) {
  localStorage.setItem(GUEST_QUOTA_KEY, JSON.stringify({
    currentWeekKey: usage.currentWeekKey || getCurrentWeekKey(),
    weeklyUsageCount: Math.max(0, Number(usage.weeklyUsageCount ?? usage.used) || 0),
    remaining: Math.max(0, Number(usage.remaining) || 0),
    updatedAt: new Date().toISOString(),
  }));
}

export const AnalysisQuotaService = {
  isLoggedIn() {
    return AuthService.isLoggedIn();
  },

  getDailyLimit() {
    return getWeeklyLimit();
  },

  getWeeklyLimit() {
    return getWeeklyLimit();
  },

  getAdminUnlimitedUsage() {
    return { ...ADMIN_UNLIMITED_USAGE };
  },

  isAdmin() {
    return isAdminUser();
  },

  /** 게스트: LocalStorage 기준 남은 횟수 (주간 리셋) */
  getGuestLocalUsage() {
    const normalized = normalizeWeeklyUsageRecord(readGuestLocalRecord(), getWeeklyLimit());
    return buildUsageDisplay(normalized, 'guest-local');
  },

  /** 로그인: Firestore에서 읽기 */
  async fetchLoggedInUsage() {
    if (isAdminUser()) return this.getAdminUnlimitedUsage();
    const uid = AuthService.getUid();
    if (!uid) return null;
    return FirestoreUserService.fetchAnalysisUsage(uid);
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
      if (usage) writeGuestLocalUsage(usage);
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
      writeGuestLocalUsage(aiUsage);
      return;
    }
    const current = this.getGuestLocalUsage();
    writeGuestLocalUsage({
      ...current,
      weeklyUsageCount: (current.weeklyUsageCount || current.used || 0) + 1,
      remaining: Math.max(0, (current.remaining || 0) - 1),
    });
  },

  async getIdTokenForApi(options = {}) {
    if (!this.isLoggedIn()) return null;
    return AuthService.acquireIdTokenForApi(options);
  },
};
