/**
 * 일회성: soft-deleted household 공유 데이터 → 개인 영역 복구
 *
 * source: households/oCYRCUQp6Bk57M1gaEY6
 * target: users/1XJdJig29XbKTAaJ4Ygsk73bCTg2
 *
 * 사용:
 *   node scripts/recover-deleted-household-to-personal.mjs --dry-run
 *   node scripts/recover-deleted-household-to-personal.mjs --status
 *   node scripts/recover-deleted-household-to-personal.mjs --validate-write-payloads
 *   node scripts/recover-deleted-household-to-personal.mjs
 *
 * FieldValue 는 firebase-admin/firestore 에서 별도 import 하지 않는다.
 * 반드시 getFirestoreAdminContext() 가 반환한 admin 인스턴스의 FieldValue 만 사용한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { getFirestoreAdminContext } from '../server/lib/firebase-admin.js';
import { normalizeIngredientName } from '../server/lib/ingredient-normalizer.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'server/package.json'));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));
require.resolve('firebase-admin');

const { db, admin, FieldValue, Timestamp } = getFirestoreAdminContext();

const UID = '1XJdJig29XbKTAaJ4Ygsk73bCTg2';
const HOUSEHOLD_ID = 'oCYRCUQp6Bk57M1gaEY6';
const MIGRATION_DOC_ID = `household-${HOUSEHOLD_ID}`;
const DRY_RUN = process.argv.includes('--dry-run');
const STATUS_ONLY = process.argv.includes('--status');
const VALIDATE_PAYLOADS = process.argv.includes('--validate-write-payloads');

const ALLOWED_SENTINEL_PROTOS = new Set([
  Object.getPrototypeOf(FieldValue.serverTimestamp()),
  Object.getPrototypeOf(FieldValue.delete()),
]);

function ingredientDocumentId(normalizedName) {
  return encodeURIComponent(String(normalizedName || '').trim().toLocaleLowerCase());
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value._seconds != null) return Number(value._seconds) * 1000;
  if (value.seconds != null) return Number(value.seconds) * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function newerTimestamp(a, b) {
  const aMs = toMillis(a);
  const bMs = toMillis(b);
  if (aMs && bMs) return aMs >= bMs ? a : b;
  return a || b || null;
}

function earlierTimestamp(a, b) {
  const aMs = toMillis(a);
  const bMs = toMillis(b);
  if (aMs && bMs) return aMs <= bMs ? a : b;
  return a || b || null;
}

function isAdminTimestamp(value) {
  return value instanceof Timestamp
    || (value
      && typeof value === 'object'
      && typeof value.toMillis === 'function'
      && (value._seconds != null || value.seconds != null));
}

function isAllowedAdminSentinel(value) {
  if (!value || typeof value !== 'object') return false;
  return ALLOWED_SENTINEL_PROTOS.has(Object.getPrototypeOf(value));
}

function isForbiddenSentinel(value) {
  if (!value || typeof value !== 'object') return false;
  if (isAdminTimestamp(value)) return false;
  if (isAllowedAdminSentinel(value)) return false;
  const name = value.constructor?.name || '';
  if (
    name.includes('Transform')
    || name.includes('FieldOperate')
    || name === 'FieldValue'
    || name.includes('DeleteFieldValue')
    || name.includes('ServerTimestamp')
    || name.includes('DeleteTransform')
  ) {
    return true;
  }
  if (typeof value.isEqual === 'function' && /field/i.test(name)) return true;
  return false;
}

function assertWritablePayload(step, docPath, value, path = '') {
  if (value === undefined || value === null) return;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return;
  if (valueType !== 'object') {
    console.error('[RECOVERY PAYLOAD INVALID]', {
      step,
      path: docPath,
      field: path || '(root)',
      constructor: valueType,
    });
    throw new Error(`Invalid payload value type at ${path || '(root)'}: ${valueType}`);
  }
  if (isAdminTimestamp(value)) return;
  if (isAllowedAdminSentinel(value)) return;
  if (isForbiddenSentinel(value)) {
    console.error([
      '[RECOVERY PAYLOAD INVALID]',
      `step: ${step}`,
      `path: ${docPath}`,
      `field: ${path || '(root)'}`,
      `constructor: ${value.constructor?.name || 'unknown'}`,
    ].join('\n'));
    throw new Error(`Forbidden sentinel in payload at ${path || '(root)'}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertWritablePayload(step, docPath, item, `${path}[${index}]`);
    });
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    console.error([
      '[RECOVERY PAYLOAD INVALID]',
      `step: ${step}`,
      `path: ${docPath}`,
      `field: ${path || '(root)'}`,
      `constructor: ${value.constructor?.name || 'unknown'}`,
    ].join('\n'));
    throw new Error(`Custom prototype object in payload at ${path || '(root)'}`);
  }
  for (const [key, child] of Object.entries(value)) {
    assertWritablePayload(step, docPath, child, path ? `${path}.${key}` : key);
  }
}

/** write 전용: plain data + Admin Timestamp 만 남긴다. sentinel 은 붙이지 않는다. */
function sanitizePlainPayload(value, path = '') {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return value;
  if (valueType !== 'object') return undefined;
  if (isAdminTimestamp(value)) return value;
  if (isForbiddenSentinel(value) || isAllowedAdminSentinel(value)) {
    // 데이터 병합 결과에 섞인 sentinel 은 버린다. 필요한 sentinel 은 이후에 명시적으로 추가.
    console.warn('[sanitize] drop sentinel from source/merge data', {
      path,
      constructor: value.constructor?.name || null,
    });
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item, index) => sanitizePlainPayload(item, `${path}[${index}]`))
      .filter((item) => item !== undefined);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    console.warn('[sanitize] drop custom prototype', {
      path,
      constructor: value.constructor?.name || null,
    });
    return undefined;
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const next = sanitizePlainPayload(child, path ? `${path}.${key}` : key);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

function preferNewerCore(existing = {}, incoming = {}) {
  const existingMs = toMillis(existing.updatedAt) || toMillis(existing.createdAt);
  const incomingMs = toMillis(incoming.updatedAt) || toMillis(incoming.createdAt);
  const newerFirst = incomingMs >= existingMs;
  const primary = newerFirst ? incoming : existing;
  const secondary = newerFirst ? existing : incoming;
  const merged = { ...secondary, ...primary };
  for (const [key, value] of Object.entries(secondary)) {
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
      merged[key] = value;
    }
  }
  return merged;
}

function mergeIngredientDocs(existing = {}, incoming = {}) {
  const existingMs = toMillis(existing.updatedAt) || toMillis(existing.createdAt);
  const incomingMs = toMillis(incoming.updatedAt) || toMillis(incoming.createdAt);
  const newerFirst = incomingMs >= existingMs;
  const newer = newerFirst ? incoming : existing;
  const older = newerFirst ? existing : incoming;
  const merged = { ...older, ...newer };

  for (const [key, value] of Object.entries(older)) {
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
      merged[key] = value;
    }
  }

  for (const field of ['name', 'quantity', 'amount', 'unit', 'category', 'memo']) {
    const n = newer[field];
    const o = older[field];
    if (n !== undefined && n !== null && n !== '') merged[field] = n;
    else if (o !== undefined && o !== null && o !== '') merged[field] = o;
  }

  const dates = [existing.expiryDate, incoming.expiryDate]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort();
  if (dates[0]) merged.expiryDate = dates[0];
  else delete merged.expiryDate;

  const nameForNorm = merged.name || newer.name || older.name || '';
  merged.normalizedName = normalizeIngredientName(merged.normalizedName || nameForNorm)
    || merged.normalizedName
    || '';

  merged.createdAt = earlierTimestamp(existing.createdAt, incoming.createdAt);
  // 병합 문서 updatedAt: serverTimestamp 대신 실제 Timestamp 중 최신값
  const latest = newerTimestamp(existing.updatedAt, incoming.updatedAt)
    || newerTimestamp(existing.createdAt, incoming.createdAt);
  if (latest) merged.updatedAt = latest;
  else delete merged.updatedAt;

  delete merged.recoveredAt;
  return merged;
}

function deepMergeObjects(base = {}, patch = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && !isAdminTimestamp(value)
      && !isForbiddenSentinel(value)
      && !isAllowedAdminSentinel(value)
      && typeof out[key] === 'object'
      && out[key]
      && !Array.isArray(out[key])
      && !isAdminTimestamp(out[key])
    ) {
      out[key] = deepMergeObjects(out[key], value);
    } else if (out[key] === undefined || out[key] === null || out[key] === '') {
      out[key] = value;
    } else if (typeof value !== 'object' || Array.isArray(value) || isAdminTimestamp(value)) {
      const newer = preferNewerCore(
        { value: out[key], updatedAt: base.updatedAt },
        { value, updatedAt: patch.updatedAt },
      );
      out[key] = newer.value;
    } else {
      out[key] = deepMergeObjects(out[key], value);
    }
  }
  return out;
}

async function listDocs(colRef) {
  const snap = await colRef.get();
  return snap.docs;
}

function buildWriteOps(plan) {
  const dstRoot = db.collection('users').doc(UID);
  const ops = [];

  for (const action of plan.ingredients.actions) {
    const targetRef = dstRoot.collection('ingredients').doc(action.targetId);
    if (action.type === 'create') {
      const data = sanitizePlainPayload({
        ...action.sourceData,
        normalizedName: normalizeIngredientName(
          action.sourceData.normalizedName || action.sourceData.name || '',
        ) || action.sourceData.normalizedName || '',
        recoveredFromHouseholdId: HOUSEHOLD_ID,
      });
      ops.push({
        step: `ingredients:create:${action.targetId}`,
        ref: targetRef,
        payload: {
          ...data,
          recoveredAt: FieldValue.serverTimestamp(),
        },
      });
    } else {
      const merged = sanitizePlainPayload({
        ...mergeIngredientDocs(action.targetData, action.sourceData),
        recoveredFromHouseholdId: HOUSEHOLD_ID,
      });
      ops.push({
        step: `ingredients:merge:${action.targetId}`,
        ref: targetRef,
        payload: {
          ...merged,
          recoveredAt: FieldValue.serverTimestamp(),
          // updatedAt 은 mergeIngredientDocs 가 실제 Timestamp 로 채움
        },
      });
    }
  }

  for (const action of plan.shopping.actions) {
    const targetRef = dstRoot.collection('shopping').doc(action.targetId);
    if (action.type === 'create') {
      const data = sanitizePlainPayload({
        ...action.sourceData,
        recoveredFromHouseholdId: HOUSEHOLD_ID,
      });
      ops.push({
        step: `shopping:create:${action.targetId}`,
        ref: targetRef,
        payload: {
          ...data,
          recoveredAt: FieldValue.serverTimestamp(),
        },
      });
    } else {
      const mergedRaw = preferNewerCore(action.targetData, action.sourceData);
      const latest = newerTimestamp(action.targetData.updatedAt, action.sourceData.updatedAt)
        || newerTimestamp(action.targetData.createdAt, action.sourceData.createdAt);
      delete mergedRaw.recoveredAt;
      const data = sanitizePlainPayload({
        ...mergedRaw,
        updatedAt: latest || mergedRaw.updatedAt,
        recoveredFromHouseholdId: HOUSEHOLD_ID,
      });
      ops.push({
        step: `shopping:merge:${action.targetId}`,
        ref: targetRef,
        payload: {
          ...data,
          recoveredAt: FieldValue.serverTimestamp(),
        },
      });
    }
  }

  for (const action of plan.mealCalendar.actions) {
    const targetRef = dstRoot.collection('mealCalendar').doc(action.targetId);
    if (action.type === 'create') {
      const data = sanitizePlainPayload({
        ...action.sourceData,
        recoveredFromHouseholdId: HOUSEHOLD_ID,
      });
      ops.push({
        step: `mealCalendar:create:${action.targetId}`,
        ref: targetRef,
        payload: {
          ...data,
          recoveredAt: FieldValue.serverTimestamp(),
        },
      });
    } else {
      const mergedRaw = preferNewerCore(action.targetData, action.sourceData);
      const latest = newerTimestamp(action.targetData.updatedAt, action.sourceData.updatedAt)
        || newerTimestamp(action.targetData.createdAt, action.sourceData.createdAt);
      delete mergedRaw.recoveredAt;
      const data = sanitizePlainPayload({
        ...mergedRaw,
        updatedAt: latest || mergedRaw.updatedAt,
        recoveredFromHouseholdId: HOUSEHOLD_ID,
      });
      ops.push({
        step: `mealCalendar:merge:${action.targetId}`,
        ref: targetRef,
        payload: {
          ...data,
          recoveredAt: FieldValue.serverTimestamp(),
        },
      });
    }
  }

  if (plan.mealPlans.sourceData) {
    const targetRef = dstRoot.collection('mealPlans').doc('default');
    if (!plan.mealPlans.targetData) {
      const data = sanitizePlainPayload({
        ...plan.mealPlans.sourceData,
        recoveredFromHouseholdId: HOUSEHOLD_ID,
      });
      ops.push({
        step: 'mealPlans:default:create',
        ref: targetRef,
        payload: {
          ...data,
          recoveredAt: FieldValue.serverTimestamp(),
        },
      });
    } else {
      const sourcePlans = plan.mealPlans.sourceData.plans && typeof plan.mealPlans.sourceData.plans === 'object'
        ? plan.mealPlans.sourceData.plans
        : {};
      const targetPlans = plan.mealPlans.targetData.plans && typeof plan.mealPlans.targetData.plans === 'object'
        ? plan.mealPlans.targetData.plans
        : {};
      const mergedPlans = deepMergeObjects(targetPlans, sourcePlans);
      const mergedRaw = preferNewerCore(plan.mealPlans.targetData, plan.mealPlans.sourceData);
      const latest = newerTimestamp(plan.mealPlans.targetData.updatedAt, plan.mealPlans.sourceData.updatedAt)
        || newerTimestamp(plan.mealPlans.targetData.createdAt, plan.mealPlans.sourceData.createdAt);
      delete mergedRaw.recoveredAt;
      const data = sanitizePlainPayload({
        ...mergedRaw,
        plans: mergedPlans,
        updatedAt: latest || mergedRaw.updatedAt,
        recoveredFromHouseholdId: HOUSEHOLD_ID,
      });
      ops.push({
        step: 'mealPlans:default:merge',
        ref: targetRef,
        payload: {
          ...data,
          recoveredAt: FieldValue.serverTimestamp(),
        },
      });
    }
  }

  if (plan.grocerySettings.sourceData) {
    const targetRef = dstRoot.collection('settings').doc('preferences');
    const source = plan.grocerySettings.sourceData;
    const target = plan.grocerySettings.targetData || {};
    const sourceGrocery = {
      activeWeekKey: source.activeWeekKey || '',
      byWeek: source.byWeek && typeof source.byWeek === 'object' ? source.byWeek : {},
      budget: source.budget ?? source.weeklyBudget ?? '',
      items: source.items && typeof source.items === 'object' ? source.items : {},
      manualItems: Array.isArray(source.manualItems) ? source.manualItems : [],
      completedKeys: Array.isArray(source.completedKeys) ? source.completedKeys : [],
      purchasedLedger: Array.isArray(source.purchasedLedger)
        ? source.purchasedLedger
        : (Array.isArray(source.purchasedRecords) ? source.purchasedRecords : []),
    };
    const targetGrocery = target.grocery && typeof target.grocery === 'object' ? target.grocery : {};
    const mergedGrocery = deepMergeObjects(targetGrocery, sourceGrocery);
    const patch = {
      grocery: mergedGrocery,
      recoveredFromHouseholdId: HOUSEHOLD_ID,
    };
    if (source.currency != null && target.currency == null) patch.currency = source.currency;
    if (source.monthlyFoodBudget != null && (target.monthlyFoodBudget == null || target.monthlyFoodBudget === 0)) {
      patch.monthlyFoodBudget = source.monthlyFoodBudget;
    } else if (source.monthlyFoodBudget != null) {
      const newer = preferNewerCore(
        { monthlyFoodBudget: target.monthlyFoodBudget, updatedAt: target.updatedAt },
        { monthlyFoodBudget: source.monthlyFoodBudget, updatedAt: source.updatedAt },
      );
      patch.monthlyFoodBudget = newer.monthlyFoodBudget;
    }
    const latest = newerTimestamp(target.updatedAt, source.updatedAt);
    const data = sanitizePlainPayload({
      ...patch,
      updatedAt: latest || undefined,
    });
    ops.push({
      step: 'settings:preferences',
      ref: targetRef,
      payload: {
        ...data,
        recoveredAt: FieldValue.serverTimestamp(),
      },
    });
  }

  const userPatch = {
    updatedAt: FieldValue.serverTimestamp(),
    pendingHouseholdId: FieldValue.delete(),
  };
  if (plan.userActiveHouseholdId === HOUSEHOLD_ID) {
    userPatch.activeHouseholdId = FieldValue.delete();
  }
  ops.push({
    step: 'users:cleanup-activeHouseholdId',
    ref: dstRoot,
    payload: userPatch,
  });

  if (plan.memberExists) {
    ops.push({
      step: 'household-members:deactivate',
      ref: db.collection('households').doc(HOUSEHOLD_ID).collection('members').doc(UID),
      payload: {
        active: false,
        deactivatedReason: 'deleted-household-recovery',
        deactivatedAt: FieldValue.serverTimestamp(),
      },
    });
  }

  ops.push({
    step: 'users:migrations:completed',
    ref: dstRoot.collection('migrations').doc(MIGRATION_DOC_ID),
    payload: {
      type: 'deleted-household-recovery',
      sourceHouseholdId: HOUSEHOLD_ID,
      status: 'completed',
      recoveredAt: FieldValue.serverTimestamp(),
      counts: {
        ingredients: plan.ingredients.sourceCount,
        shopping: plan.shopping.sourceCount,
        mealCalendar: plan.mealCalendar.sourceCount,
        mealPlans: plan.mealPlans.sourceExists ? 1 : 0,
        grocerySettings: plan.grocerySettings.sourceExists ? 1 : 0,
        ingredientsCreate: plan.ingredients.willCreate,
        ingredientsMerge: plan.ingredients.willMerge,
        shoppingCreate: plan.shopping.willCreate,
        shoppingMerge: plan.shopping.willMerge,
        mealCalendarCreate: plan.mealCalendar.willCreate,
        mealCalendarMerge: plan.mealCalendar.willMerge,
      },
    },
  });

  return ops;
}

async function buildPlan() {
  const srcRoot = db.collection('households').doc(HOUSEHOLD_ID);
  const dstRoot = db.collection('users').doc(UID);
  const migrationRef = dstRoot.collection('migrations').doc(MIGRATION_DOC_ID);

  const [
    householdSnap,
    memberSnap,
    userSnap,
    migrationSnap,
    srcIngredients,
    dstIngredients,
    srcShopping,
    dstShopping,
    srcMealCalendar,
    dstMealCalendar,
    srcMealPlan,
    dstMealPlan,
    srcGrocery,
    dstSettings,
    srcSavedRecipes,
    srcExtractedRecipes,
  ] = await Promise.all([
    srcRoot.get(),
    srcRoot.collection('members').doc(UID).get(),
    dstRoot.get(),
    migrationRef.get(),
    listDocs(srcRoot.collection('ingredients')),
    listDocs(dstRoot.collection('ingredients')),
    listDocs(srcRoot.collection('shopping')),
    listDocs(dstRoot.collection('shopping')),
    listDocs(srcRoot.collection('mealCalendar')),
    listDocs(dstRoot.collection('mealCalendar')),
    srcRoot.collection('mealPlans').doc('default').get(),
    dstRoot.collection('mealPlans').doc('default').get(),
    srcRoot.collection('grocery').doc('preferences').get(),
    dstRoot.collection('settings').doc('preferences').get(),
    listDocs(srcRoot.collection('savedRecipes')),
    listDocs(srcRoot.collection('extractedRecipes')),
  ]);

  const dstIngById = new Map(dstIngredients.map((docSnap) => [docSnap.id, docSnap]));
  const dstIngByNorm = new Map();
  for (const docSnap of dstIngredients) {
    const data = docSnap.data() || {};
    const norm = normalizeIngredientName(data.normalizedName || data.name || '');
    if (!norm) continue;
    const key = ingredientDocumentId(norm);
    if (!dstIngByNorm.has(key)) dstIngByNorm.set(key, []);
    dstIngByNorm.get(key).push(docSnap);
  }

  let ingredientIdCollisions = 0;
  let ingredientNameCollisions = 0;
  let ingredientsCreate = 0;
  let ingredientsMerge = 0;
  const ingredientActions = [];

  for (const srcDoc of srcIngredients) {
    const data = srcDoc.data() || {};
    const norm = normalizeIngredientName(data.normalizedName || data.name || '');
    const fixedId = norm ? ingredientDocumentId(norm) : srcDoc.id;
    const byId = dstIngById.get(srcDoc.id) || null;
    const byNormList = norm ? (dstIngByNorm.get(fixedId) || []) : [];
    const byNorm = byNormList[0] || null;
    const targetDoc = byId || byNorm;
    if (byId) ingredientIdCollisions += 1;
    if (byNorm) ingredientNameCollisions += 1;
    if (targetDoc) {
      ingredientsMerge += 1;
      ingredientActions.push({
        type: 'merge',
        sourceId: srcDoc.id,
        targetId: targetDoc.id,
        sourceData: data,
        targetData: targetDoc.data() || {},
      });
    } else {
      ingredientsCreate += 1;
      ingredientActions.push({
        type: 'create',
        sourceId: srcDoc.id,
        targetId: fixedId,
        sourceData: data,
        targetData: null,
      });
    }
  }

  function collectionActions(srcDocs, dstDocs) {
    const dstById = new Map(dstDocs.map((docSnap) => [docSnap.id, docSnap]));
    let idCollisions = 0;
    let create = 0;
    let merge = 0;
    const actions = [];
    for (const srcDoc of srcDocs) {
      const target = dstById.get(srcDoc.id);
      if (target) {
        idCollisions += 1;
        merge += 1;
        actions.push({
          type: 'merge',
          sourceId: srcDoc.id,
          targetId: srcDoc.id,
          sourceData: srcDoc.data() || {},
          targetData: target.data() || {},
        });
      } else {
        create += 1;
        actions.push({
          type: 'create',
          sourceId: srcDoc.id,
          targetId: srcDoc.id,
          sourceData: srcDoc.data() || {},
          targetData: null,
        });
      }
    }
    return {
      sourceCount: srcDocs.length,
      targetCount: dstDocs.length,
      idCollisions,
      willCreate: create,
      willMerge: merge,
      actions,
    };
  }

  const shopping = collectionActions(srcShopping, dstShopping);
  const mealCalendar = collectionActions(srcMealCalendar, dstMealCalendar);

  return {
    migrationAlreadyCompleted: migrationSnap.exists && migrationSnap.data()?.status === 'completed',
    migrationData: migrationSnap.exists ? migrationSnap.data() : null,
    householdStatus: householdSnap.data()?.status || null,
    householdOwnerId: householdSnap.data()?.ownerId || null,
    userActiveHouseholdId: userSnap.data()?.activeHouseholdId ?? null,
    memberExists: memberSnap.exists,
    memberActive: memberSnap.exists ? memberSnap.data()?.active : null,
    partialWriteStatus: {
      ingredientsWithRecoveryMarker: dstIngredients
        .filter((docSnap) => docSnap.data()?.recoveredFromHouseholdId === HOUSEHOLD_ID).length,
      shoppingWithRecoveryMarker: dstShopping
        .filter((docSnap) => docSnap.data()?.recoveredFromHouseholdId === HOUSEHOLD_ID).length,
      mealCalendarWithRecoveryMarker: dstMealCalendar
        .filter((docSnap) => docSnap.data()?.recoveredFromHouseholdId === HOUSEHOLD_ID).length,
      mealPlanRecoveryMarker: dstMealPlan.data()?.recoveredFromHouseholdId === HOUSEHOLD_ID,
      settingsRecoveryMarker: dstSettings.data()?.recoveredFromHouseholdId === HOUSEHOLD_ID,
      migrationExists: migrationSnap.exists,
      migrationStatus: migrationSnap.data()?.status || null,
      activeHouseholdId: userSnap.data()?.activeHouseholdId ?? null,
      memberActive: memberSnap.exists ? memberSnap.data()?.active : null,
    },
    ingredients: {
      sourcePath: `households/${HOUSEHOLD_ID}/ingredients`,
      targetPath: `users/${UID}/ingredients`,
      sourceCount: srcIngredients.length,
      targetCount: dstIngredients.length,
      idCollisions: ingredientIdCollisions,
      nameOrMergeKeyCollisions: ingredientNameCollisions,
      willCreate: ingredientsCreate,
      willMerge: ingredientsMerge,
      actions: ingredientActions,
    },
    shopping: {
      sourcePath: `households/${HOUSEHOLD_ID}/shopping`,
      targetPath: `users/${UID}/shopping`,
      ...shopping,
    },
    mealCalendar: {
      sourcePath: `households/${HOUSEHOLD_ID}/mealCalendar`,
      targetPath: `users/${UID}/mealCalendar`,
      ...mealCalendar,
    },
    mealPlans: {
      sourcePath: `households/${HOUSEHOLD_ID}/mealPlans/default`,
      targetPath: `users/${UID}/mealPlans/default`,
      sourceExists: srcMealPlan.exists,
      targetExists: dstMealPlan.exists,
      willCreate: srcMealPlan.exists && !dstMealPlan.exists ? 1 : 0,
      willMerge: srcMealPlan.exists && dstMealPlan.exists ? 1 : 0,
      sourceData: srcMealPlan.exists ? (srcMealPlan.data() || {}) : null,
      targetData: dstMealPlan.exists ? (dstMealPlan.data() || {}) : null,
    },
    grocerySettings: {
      sourcePath: `households/${HOUSEHOLD_ID}/grocery/preferences`,
      targetPath: `users/${UID}/settings/preferences`,
      sourceExists: srcGrocery.exists,
      targetExists: dstSettings.exists,
      willCreate: srcGrocery.exists && !dstSettings.exists ? 1 : 0,
      willMerge: srcGrocery.exists && dstSettings.exists ? 1 : 0,
      sourceData: srcGrocery.exists ? (srcGrocery.data() || {}) : null,
      targetData: dstSettings.exists ? (dstSettings.data() || {}) : null,
      note: 'household grocery flat doc → personal settings.preferences.grocery field',
    },
    householdOnlyReport: {
      savedRecipesCount: srcSavedRecipes.length,
      extractedRecipesCount: srcExtractedRecipes.length,
      note: 'myRecipes excluded. savedRecipes/extractedRecipes are household-only — not copied.',
    },
  };
}

function printDryRun(plan) {
  console.log('[RECOVERY DRY-RUN]');
  console.log(JSON.stringify({
    dryRun: true,
    uid: UID,
    sourceHouseholdId: HOUSEHOLD_ID,
    adminPackage: admin?.SDK_VERSION || 'firebase-admin',
    fieldValueSource: 'getFirestoreAdminContext().FieldValue',
    migrationAlreadyCompleted: plan.migrationAlreadyCompleted,
    householdStatus: plan.householdStatus,
    userActiveHouseholdId: plan.userActiveHouseholdId,
    memberActive: plan.memberActive,
    partialWriteStatus: plan.partialWriteStatus,
    ingredients: {
      sourceCount: plan.ingredients.sourceCount,
      targetCount: plan.ingredients.targetCount,
      idCollisions: plan.ingredients.idCollisions,
      nameOrMergeKeyCollisions: plan.ingredients.nameOrMergeKeyCollisions,
      willCreate: plan.ingredients.willCreate,
      willMerge: plan.ingredients.willMerge,
    },
    shopping: {
      sourceCount: plan.shopping.sourceCount,
      targetCount: plan.shopping.targetCount,
      idCollisions: plan.shopping.idCollisions,
      willCreate: plan.shopping.willCreate,
      willMerge: plan.shopping.willMerge,
    },
    mealCalendar: {
      sourceCount: plan.mealCalendar.sourceCount,
      targetCount: plan.mealCalendar.targetCount,
      idCollisions: plan.mealCalendar.idCollisions,
      willCreate: plan.mealCalendar.willCreate,
      willMerge: plan.mealCalendar.willMerge,
    },
    mealPlans: {
      sourceExists: plan.mealPlans.sourceExists,
      targetExists: plan.mealPlans.targetExists,
      willCreate: plan.mealPlans.willCreate,
      willMerge: plan.mealPlans.willMerge,
    },
    grocerySettings: {
      sourceExists: plan.grocerySettings.sourceExists,
      targetExists: plan.grocerySettings.targetExists,
      willCreate: plan.grocerySettings.willCreate,
      willMerge: plan.grocerySettings.willMerge,
    },
    householdOnlyReport: plan.householdOnlyReport,
  }, null, 2));
}

async function applyRecovery(plan) {
  if (plan.migrationAlreadyCompleted) {
    console.info('[RECOVERY] already completed — skip copy');
    return plan.migrationData;
  }
  if (plan.householdStatus !== 'deleted') {
    throw new Error(`Expected household status deleted, got: ${plan.householdStatus}`);
  }
  if (plan.householdOwnerId !== UID) {
    throw new Error(`ownerId mismatch: ${plan.householdOwnerId}`);
  }

  const ops = buildWriteOps(plan);
  for (const op of ops) {
    assertWritablePayload(op.step, op.ref.path, op.payload);
    console.info('[RECOVERY WRITE]', { step: op.step, path: op.ref.path });
    try {
      await op.ref.set(op.payload, { merge: true });
    } catch (error) {
      console.error('[RECOVERY WRITE FAILED]', {
        step: op.step,
        path: op.ref.path,
        message: error?.message || String(error),
        code: error?.code || null,
      });
      throw error;
    }
  }
  console.info('[RECOVERY COMPLETED]', { ops: ops.length });
  return true;
}

const plan = await buildPlan();

if (STATUS_ONLY) {
  console.info('[RECOVERY STATUS / PARTIAL WRITE CHECK]', JSON.stringify({
    uid: UID,
    sourceHouseholdId: HOUSEHOLD_ID,
    partialWriteStatus: plan.partialWriteStatus,
    migrationAlreadyCompleted: plan.migrationAlreadyCompleted,
  }, null, 2));
  process.exit(0);
}

if (VALIDATE_PAYLOADS) {
  const ops = buildWriteOps(plan);
  for (const op of ops) {
    assertWritablePayload(op.step, op.ref.path, op.payload);
  }
  console.info('[RECOVERY VALIDATE WRITE PAYLOADS OK]', JSON.stringify({
    validatedOps: ops.length,
    writesPerformed: false,
    fieldValueFromSameAdmin: true,
    sampleSteps: ops.slice(0, 5).map((op) => op.step),
    lastSteps: ops.slice(-3).map((op) => op.step),
    partialWriteStatus: plan.partialWriteStatus,
  }, null, 2));
  process.exit(0);
}

printDryRun(plan);

if (DRY_RUN) {
  console.info('[RECOVERY] dry-run only — no writes performed');
  process.exit(0);
}

await applyRecovery(plan);
