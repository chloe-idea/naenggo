/**
 * users/{uid}/settings/preferences — 통화, 장보기 리스트, 저장한 레시피 ID
 *
 * grocery.byWeek는 주차 맵이다. setDoc(merge)만으로 현재 주만 쓰면 다른 주는 유지되지만,
 * updateDoc으로 grocery 전체를 빈 byWeek로 바꾸면 전 주가 삭제된다.
 * → 저장 시 서버 기존 byWeek와 클라이언트를 병합한 뒤 grocery 필드를 통째로 교체한다.
 * 레거시 ISO 키(2026-W29)는 읽을 때 YYYY-MM-DD로 접는다.
 */
import {
  doc,
  collection,
  deleteField,
  getDoc,
  getDocFromServer,
  onSnapshot,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';
import { FamilySharingService } from './family-sharing-service.js';
import { StartupPerf } from './startup-perf.js';
import {
  budgetForMonth,
  currentMonthKey,
  getMonthKey,
  normalizeBudgetByMonth,
  resolveBudgetByMonthFromSettings,
  toMonthKey,
} from '../lib/budget-by-month.js';

export {
  budgetForMonth,
  currentMonthKey,
  getMonthKey,
  normalizeBudgetByMonth,
  resolveBudgetByMonthFromSettings,
  toMonthKey,
};

function settingsFirestorePathLabel(uid) {
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (householdId) return `households/{householdId}/grocery/preferences`;
  return `users/{uid}/settings/preferences`;
}

const SUBCOLLECTION = 'settings';
const DOC_ID = 'preferences';

let snapshotUnsubscribe = null;
let familyBudgetHydrationAttempted = false;
let budgetByMonthMigrationAttempted = false;

function settingsDoc(uid) {
  if (!db || !uid) return null;
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (householdId) return doc(db, 'households', householdId, 'grocery', DOC_ID);
  return doc(db, 'users', uid, SUBCOLLECTION, DOC_ID);
}

function savedRecipesCollection() {
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (!db || !householdId) return null;
  return collection(db, 'households', householdId, 'savedRecipes');
}

function isFamilyScope() {
  return Boolean(FamilySharingService.getActiveHouseholdId());
}

async function hydrateMissingFamilyBudget(uid, familyPreferenceData = {}) {
  if (familyBudgetHydrationAttempted || !isFamilyScope()) return;
  const familyResolved = resolveBudgetByMonthFromSettings(familyPreferenceData);
  const familyHasBudget = Object.keys(familyResolved.budgetByMonth).length > 0
    || Number(familyPreferenceData.monthlyFoodBudget) > 0;
  if (familyHasBudget) return;
  familyBudgetHydrationAttempted = true;

  try {
    const personalRef = doc(db, 'users', uid, SUBCOLLECTION, DOC_ID);
    const personalSnap = await getDocFromServer(personalRef).catch(() => getDoc(personalRef));
    const personalData = personalSnap.exists() ? personalSnap.data() || {} : {};
    const personalResolved = resolveBudgetByMonthFromSettings(personalData);
    const personalBudget = Number(personalData.monthlyFoodBudget) || 0;
    const personalMap = Object.keys(personalResolved.budgetByMonth).length
      ? personalResolved.budgetByMonth
      : (personalResolved.migrationMap || {});
    if ((!Object.keys(personalMap).length && personalBudget <= 0) || !isFamilyScope()) return;

    await setDoc(settingsDoc(uid), sanitizeFirestorePayload({
      activeWeekKey: familyPreferenceData.activeWeekKey || '',
      byWeek: familyPreferenceData.byWeek || {},
      currency: familyPreferenceData.currency || personalData.currency || 'KRW',
      monthlyFoodBudget: personalBudget,
      budgetByMonth: personalMap,
      updatedAt: serverTimestamp(),
    }, 'FirestoreSettingsService.hydrateMissingFamilyBudget'), { merge: true });
  } catch (error) {
    console.warn('[FirestoreSettingsService] family budget hydration skipped', {
      code: error?.code || '',
      message: error?.message || String(error),
    });
  }
}

async function persistMigratedBudgetByMonth(uid, budgetByMonth, legacyMonthly) {
  if (budgetByMonthMigrationAttempted || !uid) return;
  budgetByMonthMigrationAttempted = true;
  const ref = settingsDoc(uid);
  if (!ref) return;
  try {
    // 이미 budgetByMonth가 있으면(사용자 저장 포함) 절대 덮어쓰지 않음
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists() ? (snap.data() || {}) : {};
      const existingMap = normalizeBudgetByMonth(existing.budgetByMonth);
      if (Object.keys(existingMap).length) return;
      const nextMap = normalizeBudgetByMonth(budgetByMonth);
      if (!Object.keys(nextMap).length) return;
      tx.set(ref, sanitizeFirestorePayload({
        budgetByMonth: nextMap,
        monthlyFoodBudget: budgetForMonth(nextMap, currentMonthKey()) || Number(legacyMonthly) || 0,
        updatedAt: serverTimestamp(),
      }, 'FirestoreSettingsService.migrateBudgetByMonth'), { merge: true });
    });
  } catch (error) {
    console.warn('[FirestoreSettingsService] budgetByMonth migration write skipped', {
      code: error?.code || '',
      message: error?.message || String(error),
    });
  }
}

function normalizeSavedByMembers(data = {}) {
  const members = Array.isArray(data.savedByMembers) ? data.savedByMembers : [];
  const legacy = data.savedBy ? [{
    uid: data.savedBy,
    name: data.savedByName || '냉장GO 사용자',
    savedAt: data.savedAt || null,
  }] : [];
  return [...members, ...legacy].reduce((result, member) => {
    const uid = String(member?.uid || '').trim();
    if (uid && !result.some((item) => item.uid === uid)) {
      result.push({ uid, name: String(member.name || '냉장GO 사용자'), savedAt: member.savedAt || null });
    }
    return result;
  }, []);
}

function readSettingsData(data = {}) {
  if (!isFamilyScope()) return data;
  return {
    currency: data.currency,
    monthlyFoodBudget: data.monthlyFoodBudget,
    budgetByMonth: data.budgetByMonth,
    grocery: { activeWeekKey: data.activeWeekKey, byWeek: data.byWeek },
  };
}

const DEFAULT_SETTINGS = {
  currency: 'KRW',
  monthlyFoodBudget: 0,
  budgetByMonth: {},
  grocery: {
    activeWeekKey: '',
    byWeek: {},
    budget: '',
    items: {},
    manualItems: [],
    completedKeys: [],
    purchasedLedger: [],
  },
  savedRecipeIds: [],
};

function parseDateStr(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getWeekStartDate(dateLike) {
  const base = dateLike instanceof Date ? new Date(dateLike) : parseDateStr(dateLike);
  const day = base.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  base.setDate(base.getDate() + diff);
  base.setHours(0, 0, 0, 0);
  return base;
}

/** 레거시 ISO(2026-W29) → 주 시작일 YYYY-MM-DD */
function normalizeGroceryWeekKey(weekKey) {
  const raw = String(weekKey || '').trim();
  if (!raw) return toDateStr(getWeekStartDate(new Date()));
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return toDateStr(getWeekStartDate(raw));
  const iso = /^(\d{4})-W(\d{1,2})$/i.exec(raw);
  if (iso) {
    const year = Number(iso[1]);
    const weekNo = Number(iso[2]);
    const jan4 = new Date(year, 0, 4);
    const start = getWeekStartDate(jan4);
    start.setDate(start.getDate() + (weekNo - 1) * 7);
    return toDateStr(start);
  }
  return toDateStr(getWeekStartDate(raw));
}

function isCanonicalWeekKey(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''));
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

/** 주차에 의미 있는 장보기 데이터가 있는지 */
function isGroceryWeekEmpty(weekState) {
  if (!weekState || typeof weekState !== 'object') return true;
  const budget = weekState.budget ?? weekState.weeklyBudget ?? '';
  if (budget !== '' && budget != null) return false;
  const items = weekState.items && typeof weekState.items === 'object'
    ? weekState.items
    : (weekState.groceryItems && typeof weekState.groceryItems === 'object' ? weekState.groceryItems : {});
  if (Object.keys(items).length > 0) return false;
  if (Array.isArray(weekState.manualItems) && weekState.manualItems.length > 0) return false;
  if (Array.isArray(weekState.completedKeys) && weekState.completedKeys.length > 0) return false;
  const ledger = Array.isArray(weekState.purchasedLedger)
    ? weekState.purchasedLedger
    : (Array.isArray(weekState.purchasedRecords) ? weekState.purchasedRecords : []);
  return ledger.length === 0;
}

/** 같은 주의 두 스냅샷 중 데이터가 있는 쪽을 고른다 */
function preferRicherWeekState(a, b, weekKey) {
  const aEmpty = isGroceryWeekEmpty(a);
  const bEmpty = isGroceryWeekEmpty(b);
  if (aEmpty && !bEmpty) return { ...cloneJson(b, {}), weekKey };
  if (!aEmpty && bEmpty) return { ...cloneJson(a, {}), weekKey };
  // 둘 다 있으면 나중에 온 값(b) 우선 — 호출부가 덮어쓰기 순서를 정함
  return { ...cloneJson(b && typeof b === 'object' ? b : {}, {}), weekKey };
}

/**
 * byWeek 키를 월요일 YYYY-MM-DD 하나로 접는다.
 * 같은 주가 ISO+날짜로 둘 다 있으면, 빈 값보다 데이터가 있는 쪽을 우선한다.
 */
function collapseByWeek(byWeek) {
  const entries = Object.entries(byWeek && typeof byWeek === 'object' ? byWeek : {});
  // 날짜 키를 뒤에 두되, 빈 날짜 키가 찬 ISO를 덮지 않도록 preferRicher 사용
  entries.sort(([a], [b]) => Number(isCanonicalWeekKey(a)) - Number(isCanonicalWeekKey(b)));
  const out = {};
  for (const [rawKey, weekState] of entries) {
    const key = normalizeGroceryWeekKey(rawKey);
    const cloned = cloneJson(weekState && typeof weekState === 'object' ? weekState : {}, {});
    if (out[key]) {
      out[key] = preferRicherWeekState(out[key], { ...cloned, weekKey: key }, key);
    } else {
      out[key] = { ...cloned, weekKey: key };
    }
  }
  return out;
}

/**
 * 서버 byWeek ← 클라이언트 byWeek 병합.
 * - 빈 클라이언트 주는 서버 non-empty를 덮지 않음
 * - 빈 클라이언트 주는 payload에서 빠져도 되므로, 여기 들어오면 스킵해 서버 유지
 */
function mergeByWeekProtectNonEmpty(existingByWeek, incomingByWeek) {
  const merged = { ...existingByWeek };
  Object.entries(incomingByWeek || {}).forEach(([key, incoming]) => {
    if (isGroceryWeekEmpty(incoming)) {
      // 빈 주로는 신규 키도 넣지 않음 — 새로고침 레이스의 빈 현재 주 삽입 방지
      return;
    }
    merged[key] = incoming;
  });
  return merged;
}

/** 저장용: activeWeekKey + byWeek(정규화)만. 레거시 flat은 한 주로 승격. */
function canonicalizeGroceryForSave(grocery) {
  if (!grocery || typeof grocery !== 'object') {
    return { activeWeekKey: '', byWeek: {} };
  }

  let byWeek = collapseByWeek(grocery.byWeek);
  if (!Object.keys(byWeek).length) {
    const hasFlat = grocery.budget != null && grocery.budget !== ''
      || (grocery.items && Object.keys(grocery.items).length)
      || (Array.isArray(grocery.manualItems) && grocery.manualItems.length)
      || (Array.isArray(grocery.purchasedLedger) && grocery.purchasedLedger.length)
      || (Array.isArray(grocery.purchasedRecords) && grocery.purchasedRecords.length);
    if (hasFlat) {
      const key = normalizeGroceryWeekKey(grocery.activeWeekKey || new Date());
      byWeek = {
        [key]: {
          weekKey: key,
          budget: grocery.budget ?? grocery.weeklyBudget ?? '',
          items: grocery.items && typeof grocery.items === 'object' ? grocery.items : {},
          manualItems: Array.isArray(grocery.manualItems) ? grocery.manualItems : [],
          completedKeys: Array.isArray(grocery.completedKeys) ? grocery.completedKeys : [],
          purchasedLedger: Array.isArray(grocery.purchasedLedger)
            ? grocery.purchasedLedger
            : (Array.isArray(grocery.purchasedRecords) ? grocery.purchasedRecords : []),
        },
      };
    }
  }

  const activeWeekKey = grocery.activeWeekKey
    ? normalizeGroceryWeekKey(grocery.activeWeekKey)
    : (Object.keys(byWeek)[0] || '');

  return cloneJson({ activeWeekKey, byWeek }, { activeWeekKey: '', byWeek: {} });
}

/** Firestore grocery → 앱 상태. byWeek 주차 구조를 유지·정규화한다. */
function normalizeGroceryFromFirestore(grocery) {
  if (!grocery || typeof grocery !== 'object') {
    return { ...DEFAULT_SETTINGS.grocery, byWeek: {}, items: {}, manualItems: [], completedKeys: [], purchasedLedger: [] };
  }

  const byWeek = grocery.byWeek && typeof grocery.byWeek === 'object' ? grocery.byWeek : null;
  if (byWeek && Object.keys(byWeek).length > 0) {
    const collapsed = collapseByWeek(byWeek);
    return {
      activeWeekKey: grocery.activeWeekKey
        ? normalizeGroceryWeekKey(grocery.activeWeekKey)
        : '',
      byWeek: collapsed,
    };
  }

  // 레거시 단일 주차 형식
  return {
    activeWeekKey: grocery.activeWeekKey
      ? normalizeGroceryWeekKey(grocery.activeWeekKey)
      : '',
    budget: grocery.budget ?? grocery.weeklyBudget ?? '',
    items: (grocery.items && typeof grocery.items === 'object')
      ? grocery.items
      : ((grocery.groceryItems && typeof grocery.groceryItems === 'object') ? grocery.groceryItems : {}),
    manualItems: Array.isArray(grocery.manualItems) ? grocery.manualItems : [],
    completedKeys: Array.isArray(grocery.completedKeys) ? grocery.completedKeys : [],
    purchasedLedger: Array.isArray(grocery.purchasedLedger)
      ? grocery.purchasedLedger
      : (Array.isArray(grocery.purchasedRecords) ? grocery.purchasedRecords : []),
  };
}

function weekPayloadForLog(grocery) {
  const key = grocery?.activeWeekKey || '';
  return {
    activeWeekKey: key,
    week: key && grocery?.byWeek ? grocery.byWeek[key] : null,
  };
}

export const FirestoreSettingsService = {
  stopSync() {
    if (snapshotUnsubscribe) {
      snapshotUnsubscribe();
      snapshotUnsubscribe = null;
    }
  },

  /** settings onSnapshot이 이미 돌고 있으면 true */
  isSyncActive() {
    return Boolean(snapshotUnsubscribe);
  },

  /**
   * 홈 브리핑용: 이번 주 grocery(예산·실지출)만 1회 getDoc.
   * settings 전체 onSnapshot / mealCalendar 구독과 분리한다.
   */
  async fetchGroceryWeekForBriefing(weekKey) {
    const uid = auth?.currentUser?.uid;
    if (!uid || !db) {
      return { ok: false, reason: 'no-auth' };
    }
    if (snapshotUnsubscribe) {
      return { ok: false, reason: 'sync-active' };
    }

    const key = normalizeGroceryWeekKey(weekKey || toDateStr(getWeekStartDate(new Date())));
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const ref = settingsDoc(uid);
    const snap = await getDoc(ref);
    const raw = snap.exists() ? (snap.data() || {}) : {};
    const preferenceData = readSettingsData(raw);
    const grocerySource = preferenceData.grocery && typeof preferenceData.grocery === 'object'
      ? preferenceData.grocery
      : raw;
    const normalized = normalizeGroceryFromFirestore(grocerySource);

    let weekState = null;
    if (normalized.byWeek && typeof normalized.byWeek === 'object') {
      weekState = normalized.byWeek[key] || null;
    }
    if (!weekState && (!normalized.byWeek || !Object.keys(normalized.byWeek).length)) {
      // 레거시 flat grocery
      weekState = {
        weekKey: key,
        budget: normalized.budget ?? '',
        items: normalized.items || {},
        manualItems: normalized.manualItems || [],
        completedKeys: normalized.completedKeys || [],
        purchasedLedger: normalized.purchasedLedger || [],
      };
    }
    if (!weekState) {
      weekState = {
        weekKey: key,
        budget: '',
        items: {},
        manualItems: [],
        completedKeys: [],
        purchasedLedger: [],
      };
    }

    const durationMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started,
    );
    console.log('[Startup] briefing grocery week fetch complete', {
      durationMs,
      weekKey: key,
      hasBudget: weekState.budget !== '' && weekState.budget != null,
      ledgerCount: Array.isArray(weekState.purchasedLedger) ? weekState.purchasedLedger.length : 0,
    });

    return {
      ok: true,
      weekKey: key,
      grocery: {
        activeWeekKey: key,
        byWeek: { [key]: { ...weekState, weekKey: key } },
      },
      currency: preferenceData.currency || raw.currency || null,
    };
  },

  startSync(onSettings, onError) {
    this.stopSync();
    familyBudgetHydrationAttempted = false;
    budgetByMonthMigrationAttempted = false;
    const uid = auth?.currentUser?.uid;
    if (!uid || !db) {
      onSettings?.({
        ...DEFAULT_SETTINGS,
        grocery: { ...DEFAULT_SETTINGS.grocery, byWeek: {}, items: {}, manualItems: [], completedKeys: [], purchasedLedger: [] },
        savedRecipeIds: [],
      });
      return null;
    }
    const prefsPath = isFamilyScope()
      ? 'households/{householdId}/grocery/preferences'
      : 'users/{uid}/settings/preferences';
    const savedPath = isFamilyScope()
      ? 'households/{householdId}/savedRecipes'
      : 'users/{uid}/settings/preferences.savedRecipeIds';
    const groceryStartMs = StartupPerf.begin('grocery loaded', prefsPath);
    const savedStartMs = StartupPerf.begin('saved recipes loaded', savedPath);
    StartupPerf.markListener(prefsPath);
    if (isFamilyScope()) StartupPerf.markListener(savedPath);

    const emit = (preferenceData, savedRecipes = []) => {
      const data = readSettingsData(preferenceData);
      const grocery = normalizeGroceryFromFirestore(data.grocery);
      const groceryItemCount = Array.isArray(grocery?.items)
        ? grocery.items.length
        : (grocery?.items && typeof grocery.items === 'object' ? Object.keys(grocery.items).length : 0);
      StartupPerf.end('grocery loaded', {
        documentCount: 1,
        firestorePath: `${prefsPath} (groceryKeys≈${groceryItemCount})`,
        startMs: groceryStartMs,
      });
      StartupPerf.end('saved recipes loaded', {
        documentCount: savedRecipes.length,
        firestorePath: savedPath,
        startMs: savedStartMs,
      });
      const resolved = resolveBudgetByMonthFromSettings(data);
      // 서버에만 1회 마이그레이션. 클라이언트 map에 오늘 월 키를 가짜로 넣지 않음.
      if (resolved.migrated && resolved.migrationMap) {
        void persistMigratedBudgetByMonth(uid, resolved.migrationMap, data.monthlyFoodBudget);
      }
      const todayKey = getMonthKey();
      const legacyMonthly = Number(data.monthlyFoodBudget) || 0;
      onSettings?.({
        currency: data.currency || DEFAULT_SETTINGS.currency,
        budgetByMonth: resolved.budgetByMonth,
        legacyMonthlyFoodBudget: legacyMonthly,
        // 표시용: map의 오늘 월 또는 레거시 단일 값 (다른 달에 복사하지 않음)
        monthlyFoodBudget: budgetForMonth(resolved.budgetByMonth, todayKey, {
          legacyMonthly,
          legacyOnlyForMonthKey: todayKey,
        }),
        grocery,
        savedRecipeIds: savedRecipes.map((item) => item.recipeId),
        savedRecipes,
      });
    };
    let preferenceData = {};
    let savedRecipes = [];
    const stopPreferences = onSnapshot(
      settingsDoc(uid),
      (snap) => {
        preferenceData = snap.exists() ? snap.data() : {};
        if (isFamilyScope()) hydrateMissingFamilyBudget(uid, preferenceData);
        savedRecipes = isFamilyScope()
          ? savedRecipes
          : (Array.isArray(preferenceData.savedRecipeIds) ? preferenceData.savedRecipeIds : []);
        emit(preferenceData, Array.isArray(savedRecipes)
          ? savedRecipes.map((item) => typeof item === 'string' ? { recipeId: item, savedByMembers: [] } : item)
          : []);
      },
      (err) => onError?.(err),
    );
    if (isFamilyScope()) {
      const stopSavedRecipes = onSnapshot(
        savedRecipesCollection(),
        (snap) => {
          savedRecipes = snap.docs.map((item) => ({
            recipeId: item.id,
            ...item.data(),
            savedByMembers: normalizeSavedByMembers(item.data()),
          }));
          emit(preferenceData, savedRecipes);
        },
        (err) => onError?.(err),
      );
      snapshotUnsubscribe = () => { stopPreferences(); stopSavedRecipes(); };
    } else {
      snapshotUnsubscribe = stopPreferences;
    }
    return snapshotUnsubscribe;
  },

  async saveSettings(partial) {
    const user = auth?.currentUser;
    if (!user?.uid || !db) throw new Error('로그인 후 설정을 저장할 수 있습니다.');

    if (isFamilyScope() && Object.prototype.hasOwnProperty.call(partial || {}, 'savedRecipeIds')) {
      const { savedRecipeIds, ...rest } = partial;
      await this.saveSavedRecipeIds(savedRecipeIds);
      if (!Object.keys(rest).length) return;
      partial = rest;
    }
    // grocery가 포함되면 전용 저장으로 주차 병합 처리
    if (partial && Object.prototype.hasOwnProperty.call(partial, 'grocery')) {
      const { grocery, ...rest } = partial;
      await this.saveGroceryState(grocery);
      if (rest && Object.keys(rest).length) {
        await setDoc(
          settingsDoc(user.uid),
          sanitizeFirestorePayload({
            ...rest,
            updatedAt: serverTimestamp(),
          }, 'FirestoreSettingsService.saveSettings'),
          { merge: true },
        );
      }
      return;
    }

    // 가족 scope의 grocery 문서는 flat 구조다. 통화·예산만 저장할 때
    // 빈 byWeek를 병합하면 기존 가족 장보기 주차가 통째로 사라진다.
    const payload = { ...partial, updatedAt: serverTimestamp() };
    await setDoc(
      settingsDoc(user.uid),
      sanitizeFirestorePayload(payload, 'FirestoreSettingsService.saveSettings'),
      { merge: true },
    );
  },

  /**
   * grocery 저장: 서버 기존 byWeek + 클라이언트 byWeek 병합 후 grocery 필드 교체.
   * 다른 주차는 유지하고, 클라이언트가 보낸 주차는 통째로 덮어쓴다.
   */
  async saveGroceryState(grocery) {
    const user = auth?.currentUser;
    if (!user?.uid || !db) throw new Error('로그인 후 설정을 저장할 수 있습니다.');
    const ref = settingsDoc(user.uid);
    const incoming = canonicalizeGroceryForSave(grocery);
    // 빈 주는 아예 보내지 않음 → 서버 기존 값 유지
    const incomingNonEmpty = {};
    Object.entries(incoming.byWeek || {}).forEach(([key, week]) => {
      if (!isGroceryWeekEmpty(week)) incomingNonEmpty[key] = week;
    });
    if (!Object.keys(incomingNonEmpty).length) {
      // 저장할 실데이터가 없으면 no-op (새로고침 직후 빈 persist가 서버를 건드리지 않음)
      return;
    }

    try {
      // 캐시에 남은 빈 스냅샷보다 서버 값을 우선
      let snap;
      try {
        snap = await getDocFromServer(ref);
      } catch {
        snap = await getDoc(ref);
      }
      const sourceGrocery = isFamilyScope() ? snap.data() : snap.data()?.grocery;
      let existingByWeek = snap.exists()
        ? collapseByWeek(sourceGrocery?.byWeek || {})
        : {};
      // 레거시 flat grocery도 한 주로 승격해 보호
      if (!Object.keys(existingByWeek).length && snap.exists()) {
        const g = sourceGrocery;
        if (g && typeof g === 'object' && !isGroceryWeekEmpty(g)) {
          const key = normalizeGroceryWeekKey(g.activeWeekKey || incoming.activeWeekKey || new Date());
          existingByWeek = {
            ...existingByWeek,
            [key]: {
              weekKey: key,
              budget: g.budget ?? g.weeklyBudget ?? '',
              items: g.items && typeof g.items === 'object' ? g.items : {},
              manualItems: Array.isArray(g.manualItems) ? g.manualItems : [],
              completedKeys: Array.isArray(g.completedKeys) ? g.completedKeys : [],
              purchasedLedger: Array.isArray(g.purchasedLedger)
                ? g.purchasedLedger
                : (Array.isArray(g.purchasedRecords) ? g.purchasedRecords : []),
            },
          };
        }
      }
      const mergedByWeek = mergeByWeekProtectNonEmpty(existingByWeek, incomingNonEmpty);
      const nextGrocery = {
        activeWeekKey: incoming.activeWeekKey || Object.keys(mergedByWeek)[0] || '',
        byWeek: mergedByWeek,
      };
      const payload = sanitizeFirestorePayload(isFamilyScope()
        ? { ...nextGrocery, updatedAt: serverTimestamp() }
        : { grocery: nextGrocery, updatedAt: serverTimestamp() },
      'FirestoreSettingsService.saveGroceryState');

      if (snap.exists()) {
        await updateDoc(ref, payload);
      } else {
        await setDoc(ref, payload);
      }
    } catch (error) {
      console.error('Failed to save grocery week', {
        uid: user.uid,
        weekKey: incoming.activeWeekKey,
        data: weekPayloadForLog({ ...incoming, byWeek: incomingNonEmpty }),
        error: {
          code: error?.code || '',
          message: error?.message || String(error),
        },
      });
      throw error;
    }
  },

  async saveCurrency(currency) {
    return this.saveSettings({ currency });
  },

  /**
   * 월 예산 저장 — budgetByMonth[YYYY-MM] 키만 갱신 (다른 달 맵을 통째로 교체하지 않음).
   * @param {number} monthlyFoodBudget
   * @param {{ monthKey?: string }} [options]
   */
  async saveMonthlyFoodBudget(monthlyFoodBudget, options = {}) {
    const user = auth?.currentUser;
    const hasAuth = Boolean(user?.uid);
    const householdId = FamilySharingService.getActiveHouseholdId();
    const firestorePath = settingsFirestorePathLabel(user?.uid);
    const amount = Number(monthlyFoodBudget) || 0;
    // 호출 시점의 monthKey를 캡처 — 비동기 중 달력 월 변경과 무관
    const monthKey = String(options.monthKey || getMonthKey()).trim();
    if (!user?.uid || !db) throw new Error('로그인 후 설정을 저장할 수 있습니다.');
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      throw new Error('월 예산 저장에 올바른 YYYY-MM 키가 필요합니다.');
    }
    const ref = settingsDoc(user.uid);
    if (!ref) throw new Error('설정 저장 경로를 만들 수 없습니다.');
    const todayKey = getMonthKey();
    const payload = {
      [`budgetByMonth.${monthKey}`]: amount,
      updatedAt: serverTimestamp(),
    };
    // 레거시 단일 필드는 "오늘 월"을 저장할 때만 맞춤 (다른 달 저장 시 덮어쓰지 않음)
    if (monthKey === todayKey) {
      payload.monthlyFoodBudget = amount;
    }
    try {
      await setDoc(
        ref,
        sanitizeFirestorePayload(payload, 'FirestoreSettingsService.saveMonthlyFoodBudget'),
        { merge: true },
      );
    } catch (error) {
      console.error('[monthlyBudget] Firestore write failed', {
        operation: 'setDoc',
        firestorePath,
        monthKey,
        hasAuth,
        uidPresent: Boolean(user?.uid),
        activeHouseholdIdPresent: Boolean(householdId),
        errorCode: error?.code || '',
        errorMessage: error?.message || String(error),
      });
      throw error;
    }
  },


  async saveSavedRecipeIds(savedRecipeIds) {
    if (!isFamilyScope()) return this.saveSettings({ savedRecipeIds });
    const user = auth?.currentUser;
    const col = savedRecipesCollection();
    if (!user?.uid || !col) throw new Error('로그인 후 저장한 레시피를 관리할 수 있습니다.');
    const wanted = new Set((Array.isArray(savedRecipeIds) ? savedRecipeIds : []).map(String));
    const existing = await getDoc(settingsDoc(user.uid)); // membership/rules check before collection write
    if (!existing.exists() && !FamilySharingService.isActive()) return;
    const displayName = String(user.displayName || user.email?.split('@')[0] || '냉장GO 사용자').slice(0, 40);
    const currentSnapshot = await new Promise((resolve, reject) => {
      const stop = onSnapshot(col, (snap) => { stop(); resolve(snap); }, reject);
    });
    const operations = [...new Set([...currentSnapshot.docs.map((item) => item.id), ...wanted])];
    await Promise.all(operations.map((id) => runTransaction(db, async (tx) => {
      const ref = doc(col, id);
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const members = normalizeSavedByMembers(data);
      const hasCurrentUser = members.some((member) => member.uid === user.uid);
      if (wanted.has(id) && !hasCurrentUser) {
        tx.set(ref, {
          recipeId: id,
          savedByMembers: [...members, { uid: user.uid, name: displayName, savedAt: new Date() }],
          savedBy: deleteField(),
          savedByName: deleteField(),
          savedAt: deleteField(),
        }, { merge: true });
      } else if (!wanted.has(id) && hasCurrentUser) {
        const remaining = members.filter((member) => member.uid !== user.uid);
        if (remaining.length) {
          tx.set(ref, {
            recipeId: id,
            savedByMembers: remaining,
            savedBy: deleteField(),
            savedByName: deleteField(),
            savedAt: deleteField(),
          }, { merge: true });
        }
        else tx.delete(ref);
      } else if (snap.exists() && data.savedBy && !data.savedByMembers) {
        // 기존 single-saver 문서는 다음 저장 동작에서 새 구조로 승격한다.
        tx.set(ref, {
          recipeId: id,
          savedByMembers: members,
          savedBy: deleteField(),
          savedByName: deleteField(),
          savedAt: deleteField(),
        }, { merge: true });
      }
    })));
  },
};
