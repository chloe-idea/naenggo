import { createHash, randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { normalizeIngredientName } from './ingredient-normalizer.js';
import {
  getFirestoreAdmin,
  getLastFirebaseAdminEnvDebug,
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
} from './firebase-admin.js';
import {
  migrateUidSavedRecipesToPersonal,
  purgeInactiveSavedRecipeMembers,
  removeUidFromHouseholdSavedRecipes,
} from './household-saved-recipes.js';
import { getDisplayName, emailLocalPart as displayEmailLocalPart } from './display-name.js';

const HOUSEHOLDS = 'households';
const INVITES = 'householdInvites';
const RATE_LIMITS = 'householdRateLimits';
const USERS = 'users';
const ROLE_OWNER = 'owner';
const ROLE_MEMBER = 'member';
const INVITE_LINK = 'link';
const INVITE_CODE = 'code';
const MIGRATION_COPY = 'copy';
const MIGRATION_EMPTY = 'empty';

class HouseholdError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** GET /current 단계별 계측 (최적화 전 병목 파악용) */
function createHouseholdTiming(label = 'GET /current') {
  const startedAt = Date.now();
  const steps = [];
  return {
    async step(name, fn) {
      const t0 = Date.now();
      try {
        return await fn();
      } finally {
        const durationMs = Date.now() - t0;
        steps.push({ step: name, durationMs });
        console.info('[household:timing]', { step: name, durationMs });
      }
    },
    /** Promise.all 내 개별 읽기 계측 (벽시계는 겹칠 수 있음) */
    trackPromise(name, promise) {
      const t0 = Date.now();
      return Promise.resolve(promise).finally(() => {
        const durationMs = Date.now() - t0;
        steps.push({ step: name, durationMs });
        console.info('[household:timing]', { step: name, durationMs });
      });
    },
    summary(extra = {}) {
      const totalMs = Date.now() - startedAt;
      const sorted = [...steps].sort((a, b) => b.durationMs - a.durationMs);
      console.info('[household:timing] summary', {
        label,
        totalMs,
        steps,
        slowest: sorted.slice(0, 5),
        ...extra,
      });
      return { totalMs, steps };
    },
  };
}

function requireAdmin() {
  if (!isFirebaseAdminConfigured()) {
    const envDebug = getLastFirebaseAdminEnvDebug();
    throw new HouseholdError(
      'FIREBASE_ADMIN_NOT_CONFIGURED',
      '서버 Firebase 설정이 완료되지 않았습니다.',
      503,
      envDebug ? { envDebug } : {},
    );
  }
}

export async function requireHouseholdUser(idToken) {
  requireAdmin();
  const decoded = await verifyFirebaseIdToken(idToken);
  if (!decoded?.uid) throw new HouseholdError('AUTH_REQUIRED', '로그인이 필요합니다.', 401);
  return decoded;
}

function normalizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 40) {
    throw new HouseholdError('INVALID_HOUSEHOLD_NAME', '가족 이름은 1~40자로 입력해 주세요.');
  }
  return name;
}

function normalizeInviteKind(value) {
  if (value === INVITE_LINK || value === INVITE_CODE) return value;
  throw new HouseholdError('INVALID_INVITE_KIND', '초대 방식은 link 또는 code여야 합니다.');
}

function normalizeExpiresAt(value) {
  // UI가 값을 생략해도 안전한 기본 만료 기간을 적용한다.
  const date = value ? new Date(value) : new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));
  const now = Date.now();
  const max = now + (30 * 24 * 60 * 60 * 1000);
  if (!date || Number.isNaN(date.getTime()) || date.getTime() <= now || date.getTime() > max) {
    throw new HouseholdError('INVALID_INVITE_EXPIRY', '초대 만료 시간은 현재부터 30일 이내여야 합니다.');
  }
  return Timestamp.fromDate(date);
}

function normalizeMaxUses(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new HouseholdError('INVALID_INVITE_MAX_USES', '최대 사용 횟수는 1~20회여야 합니다.');
  }
  return count;
}

function normalizeMigrationMode(value) {
  if (value === MIGRATION_COPY || value === MIGRATION_EMPTY) return value;
  throw new HouseholdError(
    'MIGRATION_CHOICE_REQUIRED',
    '기존 데이터를 가져오거나 빈 가족 냉장고로 시작할지 선택해 주세요.',
    400,
  );
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z2-9]/g, '');
}

function makeShortCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function makeInviteSecret(kind) {
  if (kind === INVITE_LINK) return randomBytes(32).toString('base64url');
  return makeShortCode();
}

function inviteHash(kind, secret) {
  const normalized = kind === INVITE_CODE ? normalizeCode(secret) : String(secret || '').trim();
  if (!normalized) throw new HouseholdError('INVALID_INVITE', '초대 코드 또는 링크가 필요합니다.');
  return sha256(`${kind}:${normalized}`);
}

function serializeTimestamp(value) {
  return value?.toDate ? value.toDate().toISOString() : null;
}

function activeHouseholdId(userData) {
  return String(userData?.activeHouseholdId || '').trim() || null;
}

function householdRef(db, householdId) {
  return db.collection(HOUSEHOLDS).doc(householdId);
}

function memberRef(db, householdId, uid) {
  return householdRef(db, householdId).collection('members').doc(uid);
}

function clientIp(headers = {}, fallback = '') {
  const forwarded = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(headers['x-real-ip'] || fallback || 'unknown').trim();
}

function rateLimitRef(db, scope, key) {
  return db.collection(RATE_LIMITS).doc(sha256(`${scope}:${key}`));
}

async function assertRateLimit(tx, db, scope, key, limit, windowMs, pendingWrites) {
  const ref = rateLimitRef(db, scope, key);
  const now = Timestamp.now();
  const snap = await tx.get(ref);
  const existing = snap.exists ? snap.data() : {};
  const startedAt = existing.windowStartedAt?.toMillis?.() || 0;
  const inWindow = startedAt > 0 && now.toMillis() - startedAt < windowMs;
  const count = inWindow ? Number(existing.count || 0) : 0;
  if (count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil(
      (windowMs - (now.toMillis() - startedAt)) / 1000,
    ));
    throw new HouseholdError('RATE_LIMITED', '잠시 후 다시 시도해 주세요.', 429, { retryAfterSeconds });
  }
  pendingWrites.push([ref, {
    scope,
    count: count + 1,
    windowStartedAt: inWindow ? existing.windowStartedAt : now,
    updatedAt: now,
    expiresAt: Timestamp.fromMillis(now.toMillis() + windowMs),
  }]);
}

function writeRateLimits(tx, pendingWrites) {
  pendingWrites.forEach(([ref, payload]) => tx.set(ref, payload, { merge: true }));
}

async function assertOwner(tx, db, householdId, uid) {
  const member = await tx.get(memberRef(db, householdId, uid));
  if (!member.exists || !isMemberActiveDoc(member.data()) || member.data()?.role !== ROLE_OWNER) {
    throw new HouseholdError('HOUSEHOLD_OWNER_REQUIRED', '가족 owner 권한이 필요합니다.', 403);
  }
  return member;
}

async function assertMember(tx, db, householdId, uid) {
  const member = await tx.get(memberRef(db, householdId, uid));
  if (!member.exists || !isMemberActiveDoc(member.data())) {
    throw new HouseholdError('HOUSEHOLD_MEMBER_REQUIRED', '가족 구성원 권한이 필요합니다.', 403);
  }
  return member;
}

function validateHouseholdId(value) {
  const householdId = String(value || '').trim();
  if (!householdId || householdId.length > 128 || householdId.includes('/')) {
    throw new HouseholdError('INVALID_HOUSEHOLD_ID', '유효하지 않은 가족 ID입니다.');
  }
  return householdId;
}

const USER_HOUSEHOLD_SETUP_FIELDS = [
  'activeHouseholdId',
  'pendingHouseholdId',
  'householdId',
  'householdSetupStatus',
  'migrationStatus',
  'setupStartedAt',
  'setupMode',
  'householdRole',
  'householdOwnerId',
];

function storedHouseholdId(value) {
  try {
    return validateHouseholdId(value);
  } catch {
    return null;
  }
}

function clearHouseholdSetupPayload() {
  return Object.fromEntries(USER_HOUSEHOLD_SETUP_FIELDS.map((field) => [field, FieldValue.delete()]));
}

/** 레거시 문서는 status가 없을 수 있다. deleted만 비활성으로 본다. */
function isHouseholdActiveDoc(data) {
  if (!data) return false;
  const status = data.status;
  if (status === 'deleted') return false;
  return status === 'active' || status == null || status === '';
}

/** active 필드가 없으면 레거시 active. 명시적 false만 비활성. */
function isMemberActiveDoc(data) {
  if (!data) return false;
  return data.active !== false;
}

function householdRecencyMs(data) {
  return data?.updatedAt?.toMillis?.()
    || data?.createdAt?.toMillis?.()
    || 0;
}

/**
 * stored active/pending ID는 membership까지 존재할 때만 유효하다.
 * 트랜잭션 호출자는 모든 읽기를 끝낸 뒤 cleanupPayload를 써야 한다.
 */
async function inspectUserHouseholdState(tx, db, userData, uid) {
  const activeId = storedHouseholdId(userData?.activeHouseholdId);
  const pendingId = storedHouseholdId(userData?.pendingHouseholdId);
  const ids = [...new Set([activeId, pendingId].filter(Boolean))];
  const snapshots = await Promise.all(ids.map(async (id) => {
    const [household, member] = await Promise.all([
      tx.get(householdRef(db, id)),
      tx.get(memberRef(db, id, uid)),
    ]);
    const householdData = household.exists ? household.data() : null;
    const memberData = member.exists ? member.data() : null;
    const valid = household.exists
      && isHouseholdActiveDoc(householdData)
      && member.exists
      && isMemberActiveDoc(memberData);
    console.info('[CURRENT HOUSEHOLD DEBUG] inspect pointer', {
      uid,
      id,
      householdExists: household.exists,
      householdStatus: householdData?.status ?? null,
      householdActiveDoc: household.exists ? isHouseholdActiveDoc(householdData) : false,
      memberExists: member.exists,
      memberActive: member.exists ? isMemberActiveDoc(memberData) : false,
      memberPath: memberRef(db, id, uid).path,
      valid,
    });
    return {
      id,
      valid,
      member,
      household,
    };
  }));
  const validIds = new Set(snapshots.filter((item) => item.valid).map((item) => item.id));
  const validActiveId = activeId && validIds.has(activeId) ? activeId : null;
  const validPendingId = pendingId && validIds.has(pendingId) && !validActiveId ? pendingId : null;
  const hasStaleReference = Boolean(
    (userData?.activeHouseholdId && !validActiveId)
    || (userData?.pendingHouseholdId && !validPendingId),
  );
  const hasLegacySetupResidue = USER_HOUSEHOLD_SETUP_FIELDS
    .filter((field) => field !== 'activeHouseholdId' && field !== 'pendingHouseholdId')
    .some((field) => userData?.[field] !== undefined);

  // clearHouseholdSetupPayload() 는 activeHouseholdId/pendingHouseholdId 를
  // FieldValue.delete() 로 넣고, 유효할 때만 아래에서 다시 채운다.
  // hasLegacySetupResidue 만으로도 cleanup 이 돌면 membership 검증 실패 시
  // 방금 저장한 activeHouseholdId 가 삭제될 수 있다.
  let cleanupPayload = hasStaleReference || hasLegacySetupResidue ? {
    ...clearHouseholdSetupPayload(),
    ...(validActiveId ? { activeHouseholdId: validActiveId } : {}),
    ...(validPendingId ? { pendingHouseholdId: validPendingId } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  } : null;

  if (cleanupPayload) {
    console.log('[CLEANUP PAYLOAD]', cleanupPayload);
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info('[household] setup state inspection', {
      uid,
      activeHouseholdId: activeId,
      pendingHouseholdId: pendingId,
      activeMembershipExists: Boolean(activeId && validIds.has(activeId)),
      pendingMembershipExists: Boolean(pendingId && validIds.has(pendingId)),
      migrationInProgress: Boolean(validPendingId && !validActiveId),
      joinBlockedReason: validActiveId ? 'active-membership' : (validPendingId ? 'pending-setup' : null),
      staleReference: hasStaleReference || hasLegacySetupResidue,
    });
  }
  return { activeId: validActiveId, pendingId: validPendingId, cleanupPayload };
}

/**
 * 기존 household 문서/멤버십/포인터만 보완한다.
 * - ingredients / shopping / mealPlans 등 공유 데이터는 건드리지 않는다.
 * - 이미 있는 members/{uid}·status는 덮어쓰지 않는다.
 * - owner가 아닌데 members 문서가 없으면 임의로 만들지 않는다.
 */
async function ensureMembershipAndActivePointer(db, uid, householdId, {
  allowCreateOwnerMember = false,
  setActiveIfMissing = true,
  forceActive = false,
} = {}) {
  const id = storedHouseholdId(householdId);
  if (!id) return null;
  const hRef = householdRef(db, id);
  const householdSnap = await hRef.get();
  if (!householdSnap.exists || !isHouseholdActiveDoc(householdSnap.data())) return null;
  const household = householdSnap.data() || {};
  const isOwner = household.ownerId === uid;
  const mRef = memberRef(db, id, uid);
  const memberSnap = await mRef.get();

  if (!memberSnap.exists) {
    if (!(allowCreateOwnerMember && isOwner)) return null;
    // Rules isHouseholdMember 는 members/{uid} 존재를 요구한다 (ownerId 단독 불가).
    await mRef.create({
      uid,
      role: ROLE_OWNER,
      active: true,
      joinedAt: FieldValue.serverTimestamp(),
      joinedBy: uid,
      repairedAt: FieldValue.serverTimestamp(),
    });
  } else if (!isMemberActiveDoc(memberSnap.data())) {
    // 제거/탈퇴로 비활성된 membership 은 자동 재연결하지 않는다.
    return null;
  }

  const householdPatch = {};
  if (household.status == null || household.status === '') {
    householdPatch.status = 'active';
  }
  if (Object.keys(householdPatch).length) {
    householdPatch.updatedAt = FieldValue.serverTimestamp();
    await hRef.set(householdPatch, { merge: true });
  }

  const userRef = db.collection(USERS).doc(uid);
  const userSnap = await userRef.get();
  const userData = userSnap.data() || {};
  const currentActive = storedHouseholdId(userData.activeHouseholdId);
  if (forceActive || (setActiveIfMissing && !currentActive)) {
    await userRef.set({
      activeHouseholdId: id,
      pendingHouseholdId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  const refreshedMember = memberSnap.exists ? memberSnap : await mRef.get();
  if (!refreshedMember.exists) return null;

  // 레거시 복구로 active를 확정할 때 마이그레이션 위저드를 다시 띄우지 않는다.
  // 기존 공유 데이터는 복사/삭제하지 않는다.
  if (forceActive && !refreshedMember.data()?.migrationChoiceCompletedAt) {
    await mRef.set({
      migrationChoiceCompletedAt: FieldValue.serverTimestamp(),
      migrationMode: refreshedMember.data()?.migrationMode || MIGRATION_EMPTY,
      repairedLegacyAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return { householdId: id, role: refreshedMember.data()?.role || (isOwner ? ROLE_OWNER : ROLE_MEMBER) };
}

function serializeDebugValue(value) {
  if (value == null) return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value?._seconds != null) {
    return new Date(value._seconds * 1000).toISOString();
  }
  return value;
}

/** users/{uid} 진단용 — 토큰·비밀값만 제외 */
function sanitizeUserDataForDebug(data) {
  if (!data || typeof data !== 'object') return null;
  const blocked = new Set([
    'idToken',
    'refreshToken',
    'accessToken',
    'password',
    'passwordHash',
    'tokenHash',
    'secret',
    'privateKey',
  ]);
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (blocked.has(key)) continue;
    out[key] = serializeDebugValue(value);
  }
  return out;
}

function logActiveHouseholdValidationDebug({
  userRefPath,
  userExists,
  activeHouseholdId,
  householdPath,
  householdExists,
  ownerId,
  name,
  memberPath,
  memberExists,
  memberData,
  ownerIdMatches,
  memberExistsFlag,
  memberUidMatches,
  memberRoleValid,
  memberActiveValid,
  householdActiveValid,
  membershipValid,
  enteredDiscovery,
  inspectedActiveId,
  inspectedPendingId,
  returnReason,
}) {
  console.info([
    '[ACTIVE HOUSEHOLD VALIDATION DEBUG]',
    `1. userRef.path: ${userRefPath}`,
    `2. userExists: ${userExists}`,
    `3. userData.activeHouseholdId: ${activeHouseholdId == null ? 'null' : activeHouseholdId}`,
    `4. active household document path: ${householdPath || ''}`,
    `5. household document exists: ${householdExists}`,
    `6. household.ownerId: ${ownerId == null ? 'null' : ownerId}`,
    `6. household.name: ${name == null ? 'null' : name}`,
    `7. member document path: ${memberPath || ''}`,
    `8. member document exists: ${memberExists}`,
    `9. member.uid: ${memberData?.uid == null ? 'null' : memberData.uid}`,
    `9. member.role: ${memberData?.role == null ? 'null' : memberData.role}`,
    `9. member.active: ${memberData?.active === undefined ? 'undefined' : memberData.active}`,
    `9. member.status: ${memberData?.status === undefined ? 'undefined' : memberData.status}`,
    `9. member.householdId: ${memberData?.householdId === undefined ? 'undefined' : memberData.householdId}`,
    `9. memberDataFull: ${JSON.stringify(memberData == null ? null : sanitizeUserDataForDebug(memberData))}`,
    `10. ownerIdMatches: ${ownerIdMatches}`,
    `10. memberExists: ${memberExistsFlag}`,
    `10. memberUidMatches: ${memberUidMatches}`,
    `10. memberRoleValid: ${memberRoleValid}`,
    `10. memberActiveValid: ${memberActiveValid}`,
    `10. householdActiveValid: ${householdActiveValid}`,
    `10. membershipValid: ${membershipValid}`,
    `enteredDiscovery: ${enteredDiscovery}`,
    `inspectedActiveId: ${inspectedActiveId == null ? 'null' : inspectedActiveId}`,
    `inspectedPendingId: ${inspectedPendingId == null ? 'null' : inspectedPendingId}`,
    `11. returnReason: ${returnReason}`,
  ].join('\n'));
}

async function buildActiveHouseholdValidationDebug(db, uid, {
  inspectedActiveId = null,
  inspectedPendingId = null,
  enteredDiscovery = false,
  returnReason = '',
} = {}) {
  const userRef = db.collection(USERS).doc(uid);
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};
  const activeHouseholdId = userData.activeHouseholdId ?? null;
  const activeId = storedHouseholdId(activeHouseholdId);
  const householdPath = activeId ? `${HOUSEHOLDS}/${activeId}` : '';
  const memberPath = activeId ? `${HOUSEHOLDS}/${activeId}/members/${uid}` : '';

  let householdExists = false;
  let ownerId = null;
  let name = null;
  let householdActiveValid = false;
  let memberExists = false;
  let memberData = null;

  if (activeId) {
    const [householdSnap, memberSnap] = await Promise.all([
      householdRef(db, activeId).get(),
      memberRef(db, activeId, uid).get(),
    ]);
    householdExists = householdSnap.exists;
    const householdData = householdExists ? (householdSnap.data() || {}) : {};
    ownerId = householdData.ownerId ?? null;
    name = householdData.name ?? null;
    householdActiveValid = householdExists && isHouseholdActiveDoc(householdData);
    memberExists = memberSnap.exists;
    memberData = memberExists ? (memberSnap.data() || {}) : null;
  }

  const ownerIdMatches = Boolean(activeId && ownerId === uid);
  const memberUidMatches = Boolean(memberExists && (memberData?.uid == null || memberData.uid === uid));
  const memberRoleValid = Boolean(memberExists && (memberData?.role === ROLE_OWNER || memberData?.role === ROLE_MEMBER));
  // member.active === false 이면 비활성. 필드 없음은 레거시 active.
  const memberActiveValid = Boolean(memberExists && isMemberActiveDoc(memberData));
  // 실제 membership 판정: household active + member.exists + member.active !== false
  const membershipValid = Boolean(householdActiveValid && memberExists && memberActiveValid);

  let reason = returnReason;
  if (!reason) {
    if (!userSnap.exists) reason = 'USER_DOC_MISSING';
    else if (!activeHouseholdId) reason = 'ACTIVE_HOUSEHOLD_ID_MISSING_ON_USER';
    else if (!activeId) reason = 'ACTIVE_HOUSEHOLD_ID_INVALID_FORMAT';
    else if (!householdExists) reason = 'HOUSEHOLD_DOC_MISSING';
    else if (!householdActiveValid) reason = 'HOUSEHOLD_DOC_NOT_ACTIVE';
    else if (!memberExists) reason = 'MEMBER_DOC_MISSING';
    else if (!memberUidMatches) reason = 'MEMBER_UID_MISMATCH';
    else if (!memberRoleValid) reason = 'MEMBER_ROLE_INVALID';
    else if (!memberActiveValid) reason = 'MEMBER_ACTIVE_FIELD_MISMATCH';
    else if (!membershipValid) reason = 'MEMBERSHIP_INVALID';
    else if (!inspectedActiveId && !inspectedPendingId) reason = 'INSPECT_CLEARED_ACTIVE_ID_DESPITE_RAW_POINTER';
    else reason = 'UNKNOWN';
  }

  logActiveHouseholdValidationDebug({
    userRefPath: userRef.path,
    userExists: userSnap.exists,
    activeHouseholdId,
    householdPath,
    householdExists,
    ownerId,
    name,
    memberPath,
    memberExists,
    memberData,
    ownerIdMatches,
    memberExistsFlag: memberExists,
    memberUidMatches,
    memberRoleValid,
    memberActiveValid,
    householdActiveValid,
    membershipValid,
    enteredDiscovery,
    inspectedActiveId,
    inspectedPendingId,
    returnReason: reason,
  });

  return { reason, membershipValid, activeId };
}

function logCurrentHouseholdDebug({
  uid,
  userExists,
  userData,
  activeHouseholdId,
  pendingHouseholdId,
  ownerHouseholds,
  memberHouseholds,
  inspectedActiveId = null,
  inspectedPendingId = null,
  returnReason,
}) {
  console.info([
    '[CURRENT HOUSEHOLD DEBUG]',
    `uid: ${uid}`,
    `userExists: ${userExists}`,
    `userData: ${JSON.stringify(userData)}`,
    `activeHouseholdId: ${activeHouseholdId == null ? 'null' : activeHouseholdId}`,
    `pendingHouseholdId: ${pendingHouseholdId == null ? 'null' : pendingHouseholdId}`,
    `inspectedActiveId: ${inspectedActiveId == null ? 'null' : inspectedActiveId}`,
    `inspectedPendingId: ${inspectedPendingId == null ? 'null' : inspectedPendingId}`,
    `ownerHouseholds: ${JSON.stringify(ownerHouseholds)}`,
    `ownerCount: ${ownerHouseholds.length}`,
    `memberHouseholds: ${JSON.stringify(memberHouseholds)}`,
    `memberCount: ${memberHouseholds.length}`,
    `returnReason: ${returnReason}`,
  ].join('\n'));
}

async function loadCurrentHouseholdDiagnostics(db, uid, timing = null, { userSnap: reusedUserSnap = null } = {}) {
  const run = timing
    ? (name, fn) => timing.step(name, fn)
    : (_name, fn) => fn();

  // fast miss 시 이미 읽은 users/{uid} 재사용 (fieldMask면 전체 재조회)
  let userSnap = reusedUserSnap;
  const reusedHasFullData = Boolean(
    userSnap
    && userSnap.exists
    && userSnap.data()
    && Object.keys(userSnap.data()).length > 2,
  );
  if (!reusedHasFullData) {
    userSnap = await run('users/{uid}', () => db.collection(USERS).doc(uid).get());
  } else {
    console.info('[household:timing]', { step: 'users/{uid}', durationMs: 0, reused: true });
  }
  const userDataRaw = userSnap.exists ? (userSnap.data() || {}) : null;
  const ownedSnap = await run('households?ownerId==uid', () => (
    db.collection(HOUSEHOLDS).where('ownerId', '==', uid).get()
  ));
  const ownerHouseholds = ownedSnap.docs.map((snap) => snap.id);

  let memberHouseholds = [];
  let memberQueryError = null;
  try {
    const memberHits = await run('collectionGroup(members)', () => (
      db.collectionGroup('members').where('uid', '==', uid).get()
    ));
    memberHouseholds = [...new Set(
      memberHits.docs
        .map((snap) => snap.ref.parent.parent?.id)
        .filter(Boolean),
    )];
  } catch (err) {
    memberQueryError = err?.message || String(err);
  }

  return {
    userExists: userSnap.exists,
    userData: sanitizeUserDataForDebug(userDataRaw),
    activeHouseholdId: storedHouseholdId(userDataRaw?.activeHouseholdId),
    pendingHouseholdId: storedHouseholdId(userDataRaw?.pendingHouseholdId),
    rawActiveHouseholdId: userDataRaw?.activeHouseholdId ?? null,
    rawPendingHouseholdId: userDataRaw?.pendingHouseholdId ?? null,
    ownerHouseholds,
    memberHouseholds,
    memberQueryError,
  };
}

/**
 * owner 후보 household 비교용 진단 로그.
 * 읽기만 하며 문서 생성/수정/삭제를 하지 않는다.
 */
async function logHouseholdCandidateDiagnostics(db, snap) {
  const householdId = snap.id;
  const data = snap.data() || {};
  const root = householdRef(db, householdId);

  const countCollection = async (name) => {
    try {
      const agg = await root.collection(name).count().get();
      return Number(agg.data().count || 0);
    } catch (err) {
      console.warn('[HOUSEHOLD CANDIDATE] count failed', {
        householdId,
        collection: name,
        message: err?.message || String(err),
      });
      return -1;
    }
  };

  const [
    ingredientsCount,
    shoppingCount,
    mealCalendarCount,
    membersCount,
    mealPlanSnap,
    groceryPrefsSnap,
  ] = await Promise.all([
    countCollection('ingredients'),
    countCollection('shopping'),
    countCollection('mealCalendar'),
    countCollection('members'),
    root.collection('mealPlans').doc('default').get().catch(() => null),
    root.collection('grocery').doc('preferences').get().catch(() => null),
  ]);

  console.info(
    [
      '[HOUSEHOLD CANDIDATE]',
      `id: ${householdId}`,
      `name: ${data.name ?? ''}`,
      `createdAt: ${serializeTimestamp(data.createdAt) || ''}`,
      `updatedAt: ${serializeTimestamp(data.updatedAt) || ''}`,
      `ingredientsCount: ${ingredientsCount}`,
      `shoppingCount: ${shoppingCount}`,
      `mealPlanExists: ${Boolean(mealPlanSnap?.exists)}`,
      `mealCalendarCount: ${mealCalendarCount}`,
      `groceryPreferencesExists: ${Boolean(groceryPrefsSnap?.exists)}`,
      `membersCount: ${membersCount}`,
    ].join('\n'),
  );
}

/**
 * ownerId === uid 인 active household 중 안전하게 하나만 고른다.
 * - preferredHouseholdId 가 후보에 있으면 최우선 (stale cleanup 직전 포인터)
 * - active owned 가 정확히 1개면 그것
 * - 여러 개면 "다른 활성 구성원이 있는" household 가 정확히 1개일 때만
 * 새 household 생성·데이터 이동/삭제 없음. owner membership 만 복구.
 */
async function selectOwnedHouseholdForRepair(db, uid, ownedSnaps, preferredHouseholdId = null) {
  const activeOwned = ownedSnaps.filter((snap) => isHouseholdActiveDoc(snap.data()));
  if (!activeOwned.length) return null;

  const preferredId = storedHouseholdId(preferredHouseholdId);
  if (preferredId) {
    const preferred = activeOwned.find((snap) => snap.id === preferredId);
    if (preferred && preferred.data()?.ownerId === uid) {
      return { snap: preferred, reason: 'preferred_pointer' };
    }
  }

  if (activeOwned.length === 1) {
    const only = activeOwned[0];
    if (only.data()?.ownerId !== uid) return null;
    return { snap: only, reason: 'sole_active_owned' };
  }

  const scored = [];
  for (const snap of activeOwned) {
    if (snap.data()?.ownerId !== uid) continue;
    const membersSnap = await snap.ref.collection('members').get();
    const otherActive = membersSnap.docs.filter(
      (docSnap) => docSnap.id !== uid && isMemberActiveDoc(docSnap.data()),
    ).length;
    scored.push({
      snap,
      otherActive,
      recency: householdRecencyMs(snap.data()),
    });
  }

  const inUse = scored.filter((item) => item.otherActive > 0);
  if (inUse.length === 1) {
    return { snap: inUse[0].snap, reason: 'sole_in_use_owned' };
  }

  console.info('[HOUSEHOLD DEBUG] auto-select skipped; ambiguous owner households', {
    uid,
    activeOwnedCount: activeOwned.length,
    inUseCount: inUse.length,
    preferredHouseholdId: preferredId,
    candidates: scored.map((item) => ({
      householdId: item.snap.id,
      otherActive: item.otherActive,
      recency: item.recency,
    })),
  });
  return null;
}

/**
 * active/pending 포인터가 없을 때 ownerId 또는 members 문서로 소속을 찾는다.
 * 새 household는 만들지 않는다.
 *
 * owner 후보가 있어도 members/{ownerUid} 누락·포인터 wipe 상태면
 * 검증된 단일 household 에 한해 membership + activeHouseholdId 만 복구한다.
 */
async function discoverAndRepairHouseholdForUser(db, uid, { preferredHouseholdId = null } = {}) {
  // 1) ownerId 후보 — 진단 + (안전할 때만) owner membership/pointer 복구
  // 쿼리: db.collection('households').where('ownerId', '==', uid)
  const ownedSnap = await db.collection(HOUSEHOLDS).where('ownerId', '==', uid).get();
  console.info('[HOUSEHOLD DEBUG]\nowner query uid:\n%s\n\nowner households:\n%s\n\nowner count:\n%d\n\nowner query:\n.where("ownerId","==",uid)\ncollection: households',
    uid,
    ownedSnap.docs.map((snap) => snap.id).join('\n') || '(none)',
    ownedSnap.size,
  );

  for (const snap of ownedSnap.docs) {
    await logHouseholdCandidateDiagnostics(db, snap);
  }

  if (ownedSnap.size > 0) {
    const selected = await selectOwnedHouseholdForRepair(
      db,
      uid,
      ownedSnap.docs,
      preferredHouseholdId,
    );
    if (!selected) {
      return null;
    }
    const householdId = selected.snap.id;
    const repaired = await ensureMembershipAndActivePointer(db, uid, householdId, {
      allowCreateOwnerMember: true,
      forceActive: true,
    });
    if (!repaired) {
      console.warn('[household] owned household repair failed', {
        uid,
        householdId,
        reason: selected.reason,
      });
      return null;
    }
    console.info('[household] repaired owned household membership/pointer', {
      uid,
      householdId,
      reason: selected.reason,
      source: 'ownerId',
    });
    return {
      ...repaired,
      recency: householdRecencyMs(selected.snap.data()),
      source: 'ownerId',
    };
  }

  // 2) owner 후보가 없을 때만 collectionGroup(members) 경로 유지
  const repairs = [];
  try {
    const memberHits = await db.collectionGroup('members').where('uid', '==', uid).get();
    for (const snap of memberHits.docs) {
      const householdId = snap.ref.parent.parent?.id;
      if (!householdId) continue;
      const repaired = await ensureMembershipAndActivePointer(db, uid, householdId, {
        allowCreateOwnerMember: false,
        setActiveIfMissing: false,
      });
      if (repaired) {
        const hSnap = await householdRef(db, repaired.householdId).get();
        repairs.push({
          ...repaired,
          recency: householdRecencyMs(hSnap.data()),
          source: 'members',
        });
      }
    }
  } catch (err) {
    console.warn('[household] collectionGroup(members) discovery failed', {
      uid,
      message: err?.message || String(err),
      code: err?.code || null,
    });
  }

  if (!repairs.length) {
    console.info('[household] membership discovery found nothing', { uid });
    return null;
  }

  const unique = new Map();
  for (const item of repairs) {
    const prev = unique.get(item.householdId);
    if (!prev || item.recency > prev.recency) unique.set(item.householdId, item);
  }
  const ranked = [...unique.values()].sort((a, b) => b.recency - a.recency);
  const chosen = ranked[0];
  if (ranked.length > 1) {
    console.warn('[household] multiple recoverable households; using most recent', {
      uid,
      chosen: chosen.householdId,
      candidates: ranked.map((item) => ({
        householdId: item.householdId,
        source: item.source,
        recency: item.recency,
      })),
    });
  } else {
    console.info('[household] repaired membership links', {
      uid,
      householdId: chosen.householdId,
      source: chosen.source,
    });
  }

  await ensureMembershipAndActivePointer(db, uid, chosen.householdId, {
    allowCreateOwnerMember: false,
    forceActive: true,
  });
  return chosen;
}

export async function createHousehold({ idToken, name, headers = {}, ip = '' }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const household = householdRef(db, db.collection(HOUSEHOLDS).doc().id);
  const userRef = db.collection(USERS).doc(user.uid);
  const householdName = normalizeName(name);

  await db.runTransaction(async (tx) => {
    const rateWrites = [];
    await assertRateLimit(tx, db, 'create:user', user.uid, 3, 60 * 60 * 1000, rateWrites);
    await assertRateLimit(tx, db, 'create:ip', clientIp(headers, ip), 10, 60 * 60 * 1000, rateWrites);
    const userSnap = await tx.get(userRef);
    const state = await inspectUserHouseholdState(tx, db, userSnap.data(), user.uid);
    if (state.activeId || state.pendingId) {
      throw new HouseholdError('ALREADY_IN_HOUSEHOLD', '진행 중인 가족 공유 설정을 먼저 완료해 주세요.', 409);
    }
    const now = FieldValue.serverTimestamp();
    writeRateLimits(tx, rateWrites);
    tx.create(household, {
      name: householdName,
      ownerId: user.uid,
      schemaVersion: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    tx.create(memberRef(db, household.id, user.uid), {
      uid: user.uid,
      role: ROLE_OWNER,
      joinedAt: now,
      joinedBy: user.uid,
    });
    tx.set(userRef, {
      ...(state.cleanupPayload || {}),
      pendingHouseholdId: household.id,
      updatedAt: now,
    }, { merge: true });
  });

  return { householdId: household.id, name: householdName, role: ROLE_OWNER };
}

/**
 * 가족 공유 경로를 실제 사용하기 시작하는 시점에만 activeHouseholdId를 설정한다.
 * 생성 직후 개인 데이터가 빈 가족 경로로 바뀌어 보이는 현상을 막는다.
 */
export async function activateHousehold({ idToken, householdId, migrationMode }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);
  const mode = normalizeMigrationMode(migrationMode);
  const userRef = db.collection(USERS).doc(user.uid);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const state = await inspectUserHouseholdState(tx, db, userSnap.data(), user.uid);
    const [householdSnap, memberSnap] = await Promise.all([
      tx.get(householdRef(db, id)),
      tx.get(memberRef(db, id, user.uid)),
    ]);
    if (state.activeId && state.activeId !== id) {
      throw new HouseholdError('ALREADY_IN_HOUSEHOLD', '이미 다른 가족 그룹에 참여하고 있습니다.', 409);
    }
    if (!householdSnap.exists || !isHouseholdActiveDoc(householdSnap.data()) || !memberSnap.exists || !isMemberActiveDoc(memberSnap.data())) {
      throw new HouseholdError('HOUSEHOLD_NOT_FOUND', '활성화할 가족 그룹을 찾을 수 없습니다.', 404);
    }
    if (mode === MIGRATION_COPY && !memberSnap.data()?.migrationCopyCompletedAt) {
      throw new HouseholdError(
        'MIGRATION_COPY_REQUIRED',
        '데이터 복사가 완료된 뒤에만 가족 공유를 시작할 수 있습니다.',
        409,
      );
    }
    const copiedCount = Number(memberSnap.data()?.lastMigrationCopiedCount) || 0;
    const skippedCount = Number(memberSnap.data()?.lastMigrationSkippedCount) || 0;
    if (mode === MIGRATION_COPY && copiedCount + skippedCount === 0 && memberSnap.data()?.role === ROLE_OWNER) {
      throw new HouseholdError(
        'NO_SHARED_DATA_TO_COPY',
        '가져올 공유 데이터가 없습니다. 빈 가족 냉장고로 시작하거나 개인 데이터를 먼저 저장해 주세요.',
        409,
      );
    }
    tx.set(userRef, {
      ...(state.cleanupPayload || {}),
      activeHouseholdId: id,
      pendingHouseholdId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.update(memberRef(db, id, user.uid), {
      migrationChoiceCompletedAt: FieldValue.serverTimestamp(),
      migrationMode: mode,
    });
  });
  return getCurrentHousehold({ idToken });
}

/** 활성화 전 setup을 중단해 개인 scope로 안전하게 되돌린다. */
export async function cancelPendingHousehold({ idToken, householdId }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);
  await db.runTransaction(async (tx) => {
    const userRef = db.collection(USERS).doc(user.uid);
    const userSnap = await tx.get(userRef);
    const state = await inspectUserHouseholdState(tx, db, userSnap.data(), user.uid);
    if (state.activeId) throw new HouseholdError('HOUSEHOLD_ALREADY_ACTIVE', '이미 시작한 가족 공유는 취소할 수 없습니다.', 409);
    if (state.pendingId !== id) throw new HouseholdError('PENDING_HOUSEHOLD_NOT_FOUND', '진행 중인 가족 공유 설정을 찾을 수 없습니다.', 404);
    const membership = await tx.get(memberRef(db, id, user.uid));
    if (membership.exists) {
      tx.delete(membership.ref);
      if (membership.data()?.role === ROLE_OWNER) {
        tx.update(householdRef(db, id), {
          status: 'deleted',
          deletedAt: FieldValue.serverTimestamp(),
          deletedBy: user.uid,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    tx.set(userRef, { ...clearHouseholdSetupPayload(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

/**
 * 정상 포인터+멤버십이면 진단/discovery 없이 즉시 반환.
 * miss면 recovery path로 넘어간다 (deleted/inactive/stale/membership 오류 포함).
 *
 * Fast path 읽기:
 * - users/{uid} (fieldMask: 포인터만)
 * - households/{id} + members/{uid} 병렬
 * - members 전체 목록은 includeMembers=true 일 때만 (홈 초기 로딩 생략)
 *
 * active+pending 이중 포인터: active가 유효하면 fast 유지하고 pending만 비동기 정리.
 */
async function tryGetCurrentHouseholdFast(db, uid, timing, { includeMembers = false } = {}) {
  const userRef = db.collection(USERS).doc(uid);
  const userSnap = await timing.step('users/{uid}', async () => {
    try {
      return await userRef.get({
        fieldMask: ['activeHouseholdId', 'pendingHouseholdId'],
      });
    } catch (err) {
      console.warn('[household] users fieldMask get failed, falling back to full get', {
        message: err?.message || String(err),
      });
      return userRef.get();
    }
  });
  if (!userSnap.exists) {
    return { hit: false, reason: 'USER_DOC_MISSING', userSnap };
  }
  const userData = userSnap.data() || {};
  const rawActive = userData.activeHouseholdId ?? null;
  const rawPending = userData.pendingHouseholdId ?? null;
  const activeId = storedHouseholdId(rawActive);
  const pendingId = storedHouseholdId(rawPending);

  // 포인터 형식 오류·없음 → recovery
  if ((rawActive && !activeId) || (rawPending && !pendingId)) {
    return { hit: false, reason: 'POINTER_INVALID_FORMAT', userSnap };
  }
  if (!activeId && !pendingId) {
    return { hit: false, reason: 'NO_POINTER', userSnap };
  }

  // 이중 포인터: active 우선 검증. active 실패 시에만 recovery.
  const householdId = activeId || pendingId;
  const stalePendingWithActive = Boolean(activeId && pendingId);
  const membershipStarted = Date.now();
  const reads = [
    timing.trackPromise('households/{householdId}', householdRef(db, householdId).get()),
    timing.trackPromise('members/{uid}', memberRef(db, householdId, uid).get()),
  ];
  if (includeMembers) {
    reads.push(timing.trackPromise(
      'members list',
      householdRef(db, householdId).collection('members').get(),
    ));
  }
  const [householdSnap, memberSnap, membersSnap = null] = await Promise.all(reads);
  console.info('[household:timing]', {
    step: 'fast_membership_reads_wall',
    durationMs: Date.now() - membershipStarted,
    includeMembers,
  });

  const validated = await timing.step('validation', async () => {
    if (!householdSnap.exists) return { ok: false, reason: 'HOUSEHOLD_DOC_MISSING' };
    if (!isHouseholdActiveDoc(householdSnap.data())) return { ok: false, reason: 'HOUSEHOLD_DOC_NOT_ACTIVE' };
    if (!memberSnap.exists) return { ok: false, reason: 'MEMBER_DOC_MISSING' };
    if (!isMemberActiveDoc(memberSnap.data())) return { ok: false, reason: 'MEMBER_INACTIVE' };
    return { ok: true, reason: null };
  });
  if (!validated.ok) {
    return { hit: false, reason: validated.reason, userSnap };
  }

  // active가 유효한데 pending이 남아 있으면 진단 없이 pending만 제거 (홈 경로 유지)
  if (stalePendingWithActive) {
    const cleanupStarted = Date.now();
    userRef.set({
      pendingHouseholdId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).then(() => {
      console.info('[household:timing]', {
        step: 'pending_pointer_cleanup',
        durationMs: Date.now() - cleanupStarted,
      });
    }).catch((err) => {
      console.warn('[household] pending pointer cleanup failed', {
        uid,
        message: err?.message || String(err),
      });
    });
  }

  const data = householdSnap.data();
  const memberData = memberSnap.data() || {};

  // pending 만 있고 가족이 이미 운영 중(다른 활성 구성원 있음)이거나
  // migrationChoiceCompletedAt 만 남은 불일치 상태면 owner active 포인터를 복구한다.
  // (공유 데이터 복사/삭제 없음. 새 household 없음.)
  let resolvedActiveId = activeId;
  if (!resolvedActiveId && pendingId) {
    const isOwner = data.ownerId === uid || memberData.role === ROLE_OWNER;
    if (isOwner) {
      let hasOtherActiveMember = false;
      if (includeMembers && membersSnap) {
        hasOtherActiveMember = membersSnap.docs.some(
          (snap) => snap.id !== uid && isMemberActiveDoc(snap.data()),
        );
      } else {
        const preview = await householdRef(db, householdId).collection('members').limit(8).get();
        hasOtherActiveMember = preview.docs.some(
          (snap) => snap.id !== uid && isMemberActiveDoc(snap.data()),
        );
      }
      const migrationDone = Boolean(memberData.migrationChoiceCompletedAt);
      if (hasOtherActiveMember || migrationDone) {
        await userRef.set({
          activeHouseholdId: householdId,
          pendingHouseholdId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        resolvedActiveId = householdId;
        console.info('[household] promoted stuck pending owner to active', {
          uid,
          householdId,
          hasOtherActiveMember,
          migrationDone,
        });
      }
    }
  }

  let members;
  if (includeMembers && membersSnap) {
    members = membersSnap.docs
      .filter((snap) => isMemberActiveDoc(snap.data()))
      .map((snap) => ({
        uid: snap.id,
        role: snap.data()?.role || ROLE_MEMBER,
        joinedAt: serializeTimestamp(snap.data()?.joinedAt),
      }));
  } else {
    // 홈 필수 경로: 본인만. 전체 목록은 가족 UI에서 includeMembers로 로드.
    members = [{
      uid,
      role: memberData.role || ROLE_MEMBER,
      joinedAt: serializeTimestamp(memberData.joinedAt),
    }];
  }

  return {
    hit: true,
    userSnap,
    household: {
      householdId,
      name: data.name,
      ownerId: data.ownerId,
      role: memberData.role || null,
      status: data.status ?? 'active',
      needsMigrationChoice: !memberData.migrationChoiceCompletedAt,
      members,
      membersPartial: !includeMembers,
      createdAt: serializeTimestamp(data.createdAt),
      pendingSetup: !resolvedActiveId,
      resolutionPath: 'fast',
    },
  };
}

/** pointer 불일치·deleted·membership 오류·discovery가 필요한 기존 경로 */
async function getCurrentHouseholdRecovery(db, user, userRef, timing, { userSnap = null, includeMembers = true } = {}) {
  const diagnostics = await loadCurrentHouseholdDiagnostics(db, user.uid, timing, { userSnap });
  const baseDebug = {
    uid: user.uid,
    userExists: diagnostics.userExists,
    userData: diagnostics.userData,
    activeHouseholdId: diagnostics.rawActiveHouseholdId,
    pendingHouseholdId: diagnostics.rawPendingHouseholdId,
    ownerHouseholds: diagnostics.ownerHouseholds,
    memberHouseholds: diagnostics.memberHouseholds,
  };
  if (diagnostics.memberQueryError) {
    console.warn('[CURRENT HOUSEHOLD DEBUG] collectionGroup(members) query failed', {
      uid: user.uid,
      message: diagnostics.memberQueryError,
    });
  }

  // 1) users/{uid}.activeHouseholdId / pendingHouseholdId + members/{uid} 검증
  //    주의: cleanupPayload 가 stale 로 판단하면 activeHouseholdId 를 delete 할 수 있다.
  let state = await timing.step('transaction', () => db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const inspected = await inspectUserHouseholdState(tx, db, userSnap.data(), user.uid);
    if (inspected.cleanupPayload) {
      console.warn('[CURRENT HOUSEHOLD DEBUG] applying setup cleanupPayload', {
        uid: user.uid,
        path: userRef.path,
        beforeActiveHouseholdId: userSnap.data()?.activeHouseholdId ?? null,
        inspectedActiveId: inspected.activeId,
        inspectedPendingId: inspected.pendingId,
        cleanupKeys: Object.keys(inspected.cleanupPayload),
      });
      tx.set(userRef, inspected.cleanupPayload, { merge: true });
    }
    return inspected;
  }));

  await timing.step('validation', () => buildActiveHouseholdValidationDebug(db, user.uid, {
    inspectedActiveId: state.activeId,
    inspectedPendingId: state.pendingId,
    enteredDiscovery: false,
    returnReason: state.activeId || state.pendingId
      ? 'AFTER_INSPECT_HAS_POINTER'
      : 'AFTER_INSPECT_NO_POINTER',
  }));

  // 2) 포인터가 없거나 stale cleanup으로 비었으면 membership / ownerId로 소속 검색
  //    (새 household 생성 금지, 공유 데이터 복사/삭제 금지)
  let enteredDiscovery = false;
  if (!state.activeId && !state.pendingId) {
    enteredDiscovery = true;
    console.info('[ACTIVE HOUSEHOLD VALIDATION DEBUG] entering discoverAndRepairHouseholdForUser', {
      uid: user.uid,
      reason: 'state.activeId and state.pendingId are both null after inspect',
      rawActiveHouseholdId: diagnostics.rawActiveHouseholdId,
    });
    const preferredHouseholdId = diagnostics.rawActiveHouseholdId || diagnostics.rawPendingHouseholdId || null;
    const discovered = await timing.step('discovery', () => discoverAndRepairHouseholdForUser(db, user.uid, {
      preferredHouseholdId,
    }));
    if (!discovered?.householdId) {
      let returnReason = 'NO_ACTIVE_PENDING_OWNER_OR_MEMBER_HOUSEHOLD';
      if (diagnostics.ownerHouseholds.length > 1) {
        returnReason = 'NO_ACTIVE_AND_MULTIPLE_OWNER_HOUSEHOLDS';
      } else if (diagnostics.ownerHouseholds.length === 1) {
        returnReason = 'DISCOVERY_OWNER_REPAIR_FAILED';
      } else if (diagnostics.memberHouseholds.length > 0) {
        returnReason = 'DISCOVERY_FOUND_NO_REPAIRABLE_MEMBERSHIP';
      } else if (diagnostics.memberQueryError) {
        returnReason = 'NO_ACTIVE_AND_MEMBER_QUERY_FAILED';
      }
      await buildActiveHouseholdValidationDebug(db, user.uid, {
        inspectedActiveId: state.activeId,
        inspectedPendingId: state.pendingId,
        enteredDiscovery: true,
        returnReason,
      });
      logCurrentHouseholdDebug({
        ...baseDebug,
        inspectedActiveId: state.activeId,
        inspectedPendingId: state.pendingId,
        returnReason,
      });
      return null;
    }

    state = await timing.step('transaction(post-discovery)', () => db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const inspected = await inspectUserHouseholdState(tx, db, userSnap.data(), user.uid);
      if (inspected.cleanupPayload) tx.set(userRef, inspected.cleanupPayload, { merge: true });
      return inspected;
    }));
    // inspect가 아직 members를 못 보면 discovery 결과를 직접 사용
    if (!state.activeId && !state.pendingId) {
      state = {
        activeId: discovered.householdId,
        pendingId: null,
        cleanupPayload: null,
      };
    }
  }

  const householdId = state.activeId || state.pendingId || null;
  if (!householdId) {
    await timing.step('validation', () => buildActiveHouseholdValidationDebug(db, user.uid, {
      inspectedActiveId: state.activeId,
      inspectedPendingId: state.pendingId,
      enteredDiscovery,
      returnReason: 'NO_HOUSEHOLD_ID_AFTER_INSPECT_AND_DISCOVERY',
    }));
    logCurrentHouseholdDebug({
      ...baseDebug,
      inspectedActiveId: state.activeId,
      inspectedPendingId: state.pendingId,
      returnReason: 'NO_HOUSEHOLD_ID_AFTER_INSPECT_AND_DISCOVERY',
    });
    return null;
  }

  const membershipReads = [
    timing.trackPromise('households/{householdId}', householdRef(db, householdId).get()),
    timing.trackPromise('members/{uid}', memberRef(db, householdId, user.uid).get()),
  ];
  if (includeMembers) {
    membershipReads.push(timing.trackPromise(
      'members list',
      householdRef(db, householdId).collection('members').get(),
    ));
  }
  const [householdSnap, memberSnap, membersSnap = null] = await Promise.all(membershipReads);
  if (!householdSnap.exists || !isHouseholdActiveDoc(householdSnap.data()) || !memberSnap.exists || !isMemberActiveDoc(memberSnap.data())) {
    const returnReason = !householdSnap.exists
      ? 'HOUSEHOLD_DOC_MISSING'
      : !isHouseholdActiveDoc(householdSnap.data())
        ? 'HOUSEHOLD_DOC_NOT_ACTIVE'
        : !memberSnap.exists
          ? 'MEMBER_DOC_MISSING_FOR_SELECTED_HOUSEHOLD'
          : 'MEMBER_INACTIVE_FOR_SELECTED_HOUSEHOLD';
    await timing.step('validation', () => buildActiveHouseholdValidationDebug(db, user.uid, {
      inspectedActiveId: state.activeId,
      inspectedPendingId: state.pendingId,
      enteredDiscovery,
      returnReason,
    }));
    logCurrentHouseholdDebug({
      ...baseDebug,
      inspectedActiveId: state.activeId,
      inspectedPendingId: state.pendingId,
      returnReason,
    });
    return null;
  }
  const data = householdSnap.data();
  const memberData = memberSnap.data() || {};
  const members = includeMembers && membersSnap
    ? membersSnap.docs
      .filter((snap) => isMemberActiveDoc(snap.data()))
      .map((snap) => ({
        uid: snap.id,
        role: snap.data()?.role || ROLE_MEMBER,
        joinedAt: serializeTimestamp(snap.data()?.joinedAt),
      }))
    : [{
      uid: user.uid,
      role: memberData.role || ROLE_MEMBER,
      joinedAt: serializeTimestamp(memberData.joinedAt),
    }];

  // recovery 경로에서도 stuck pending owner 를 active 로 승격
  let resolvedActiveId = state.activeId;
  if (!resolvedActiveId && state.pendingId) {
    const isOwner = data.ownerId === user.uid || memberData.role === ROLE_OWNER;
    if (isOwner) {
      let hasOtherActiveMember = includeMembers && membersSnap
        ? membersSnap.docs.some((snap) => snap.id !== user.uid && isMemberActiveDoc(snap.data()))
        : false;
      if (!includeMembers || !membersSnap) {
        const preview = await householdRef(db, householdId).collection('members').limit(8).get();
        hasOtherActiveMember = preview.docs.some(
          (snap) => snap.id !== user.uid && isMemberActiveDoc(snap.data()),
        );
      }
      const migrationDone = Boolean(memberData.migrationChoiceCompletedAt);
      if (hasOtherActiveMember || migrationDone) {
        await userRef.set({
          activeHouseholdId: householdId,
          pendingHouseholdId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        resolvedActiveId = householdId;
        console.info('[household] recovery promoted stuck pending owner to active', {
          uid: user.uid,
          householdId,
          hasOtherActiveMember,
          migrationDone,
        });
      }
    }
  }

  const okReason = resolvedActiveId ? 'OK_ACTIVE_HOUSEHOLD' : 'OK_PENDING_HOUSEHOLD';
  await timing.step('validation', () => buildActiveHouseholdValidationDebug(db, user.uid, {
    inspectedActiveId: resolvedActiveId || state.activeId,
    inspectedPendingId: state.pendingId,
    enteredDiscovery,
    returnReason: okReason,
  }));
  logCurrentHouseholdDebug({
    ...baseDebug,
    inspectedActiveId: resolvedActiveId || state.activeId,
    inspectedPendingId: state.pendingId,
    returnReason: okReason,
  });
  return {
    householdId,
    name: data.name,
    ownerId: data.ownerId,
    role: memberData.role || null,
    status: data.status ?? 'active',
    needsMigrationChoice: !memberData.migrationChoiceCompletedAt,
    members,
    membersPartial: !includeMembers,
    createdAt: serializeTimestamp(data.createdAt),
    pendingSetup: !resolvedActiveId,
    resolutionPath: 'recovery',
  };
}

/** 가족 UI(includeMembers) 조회 시 비활성 저장자 lazy cleanup — 실패해도 current 응답은 유지 */
async function maybePurgeInactiveSavedRecipes(db, household, { includeMembers = false } = {}) {
  const householdId = String(household?.householdId || '').trim();
  if (!includeMembers || !householdId || household?.pendingSetup) return household;
  try {
    const purged = await purgeInactiveSavedRecipeMembers(db, householdId);
    if (purged?.touched) {
      console.info('[household] lazy savedRecipes purge on /current', {
        householdId,
        touched: purged.touched,
        removedUids: purged.removedUids || [],
      });
    }
  } catch (err) {
    console.warn('[household] lazy savedRecipes purge failed', {
      householdId,
      message: err?.message || String(err),
    });
  }
  return household;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function emailLocalPart(email) {
  return displayEmailLocalPart(email);
}

/**
 * includeMembers 응답용 — publicProfiles/users에서 표시 필드만 보강.
 * 이메일은 클라이언트에 노출하지 않으며, 필요 시 label fallback에만 사용한다.
 * label 우선순위: nickname → displayName → profileId/username → email local
 */
export function buildMemberPublicFields(publicData = {}, userData = {}) {
  const profileId = firstNonEmptyString(
    publicData.profileId,
    userData.profileId,
    publicData.username,
    userData.username,
    publicData.userId,
    userData.userId,
  );
  // 사이트 기준: users.nickname → publicProfiles.nickname → 레거시 displayName
  const nickname = firstNonEmptyString(
    userData.nickname,
    publicData.nickname,
    userData.displayName,
    publicData.displayName,
  );
  const displayName = firstNonEmptyString(userData.displayName, publicData.displayName, nickname);
  const photoURL = firstNonEmptyString(
    publicData.profileImageUrl,
    publicData.profileImage,
    userData.profileImageUrl,
    userData.profileImage,
    userData.photoURL,
  );
  // 이메일 원문은 반환하지 않음. @ 앞부분만 label 최후 fallback에 사용.
  const label = firstNonEmptyString(
    nickname,
    displayName,
    profileId,
    emailLocalPart(userData.email),
  );
  return {
    profileId: profileId || '',
    username: firstNonEmptyString(publicData.username, userData.username),
    nickname,
    displayName,
    photoURL,
    label,
  };
}

async function enrichMembersWithPublicProfiles(db, members) {
  const list = Array.isArray(members) ? members.filter((m) => m?.uid) : [];
  if (!list.length) return Array.isArray(members) ? members : [];

  try {
    // users + publicProfiles 모두 조회해 최신 nickname 반영
    const publicRefs = list.map((member) => db.collection('publicProfiles').doc(member.uid));
    const userRefs = list.map((member) => db.collection(USERS).doc(member.uid));
    const [publicSnaps, userSnaps] = await Promise.all([
      db.getAll(...publicRefs),
      db.getAll(...userRefs),
    ]);

    return list.map((member, index) => {
      const publicSnap = publicSnaps[index];
      const userSnap = userSnaps[index];
      const fields = buildMemberPublicFields(
        publicSnap?.exists ? (publicSnap.data() || {}) : {},
        userSnap?.exists ? (userSnap.data() || {}) : {},
      );
      return {
        uid: member.uid,
        role: member.role,
        joinedAt: member.joinedAt,
        ...fields,
      };
    });
  } catch (err) {
    console.warn('[household] member profile enrichment failed', {
      message: err?.message || String(err),
      memberCount: list.length,
    });
    // 조회 실패 시 기존 members 형태 유지 (uid/role) — UI fallback
    return list;
  }
}

async function finalizeCurrentHousehold(db, household, { includeMembers = false } = {}) {
  let result = await maybePurgeInactiveSavedRecipes(db, household, { includeMembers });
  if (!result || !includeMembers || !Array.isArray(result.members) || result.membersPartial) {
    return result;
  }
  const members = await enrichMembersWithPublicProfiles(db, result.members);
  return { ...result, members };
}

export async function getCurrentHousehold({ idToken, includeMembers = false } = {}) {
  const timing = createHouseholdTiming('GET /api/households/current');
  const user = await timing.step('verifyToken', () => requireHouseholdUser(idToken));
  const db = getFirestoreAdmin();
  const userRef = db.collection(USERS).doc(user.uid);
  console.info('[household] GET /api/households/current', {
    uid: user.uid,
    includeMembers: Boolean(includeMembers),
  });

  const fast = await tryGetCurrentHouseholdFast(db, user.uid, timing, { includeMembers });
  if (fast.hit) {
    timing.summary({
      uid: user.uid,
      resolutionPath: 'fast',
      pendingSetup: Boolean(fast.household.pendingSetup),
      includeMembers: Boolean(includeMembers),
      membersPartial: Boolean(fast.household.membersPartial),
    });
    return finalizeCurrentHousehold(db, fast.household, { includeMembers });
  }

  console.info('[household] GET /current falling back to recovery', {
    uid: user.uid,
    reason: fast.reason,
  });
  const household = await getCurrentHouseholdRecovery(db, user, userRef, timing, {
    userSnap: fast.userSnap || null,
    includeMembers,
  });
  timing.summary({
    uid: user.uid,
    resolutionPath: 'recovery',
    hasHousehold: Boolean(household),
    fastMissReason: fast.reason,
    includeMembers: Boolean(includeMembers),
  });
  return finalizeCurrentHousehold(db, household, { includeMembers });
}

export async function issueInvite({ idToken, householdId, kind, expiresAt, maxUses, headers = {}, ip = '' }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);
  const inviteKind = normalizeInviteKind(kind);
  const expiry = normalizeExpiresAt(expiresAt);
  const uses = normalizeMaxUses(maxUses);
  const secret = makeInviteSecret(inviteKind);
  const hash = inviteHash(inviteKind, secret);
  const inviteRef = db.collection(INVITES).doc();

  await db.runTransaction(async (tx) => {
    const rateWrites = [];
    // 재발급 버튼의 중복 클릭은 클라이언트에서 막는다. 서버 제한은 자동화 남용만
    // 방지하도록 넉넉히 두어, 일반 관리자가 필요할 때마다 재발급할 수 있게 한다.
    await assertRateLimit(tx, db, 'invite:reissue:v2:user', user.uid, 20, 60 * 60 * 1000, rateWrites);
    await assertRateLimit(tx, db, 'invite:reissue:v2:ip', clientIp(headers, ip), 100, 60 * 60 * 1000, rateWrites);
    await assertOwner(tx, db, id, user.uid);
    const householdSnap = await tx.get(householdRef(db, id));
    if (!householdSnap.exists || !isHouseholdActiveDoc(householdSnap.data())) {
      throw new HouseholdError('HOUSEHOLD_NOT_FOUND', '활성 가족 그룹을 찾을 수 없습니다.', 404);
    }
    const activeInvites = await tx.get(db.collection(INVITES).where('householdId', '==', id));
    writeRateLimits(tx, rateWrites);
    activeInvites.docs
      .filter((docSnap) => docSnap.data()?.active)
      .forEach((docSnap) => tx.update(docSnap.ref, {
        active: false,
        revokedAt: FieldValue.serverTimestamp(),
        revokedBy: user.uid,
      }));
    tx.create(inviteRef, {
      householdId: id,
      kind: inviteKind,
      tokenHash: hash,
      active: true,
      maxUses: uses,
      useCount: 0,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: expiry,
      revokedAt: null,
    });
  });

  return {
    inviteId: inviteRef.id,
    kind: inviteKind,
    secret,
    expiresAt: expiry.toDate().toISOString(),
    maxUses: uses,
  };
}

/**
 * 링크와 코드를 한 번에 재발급한다.
 * 기존 활성 초대는 모두 폐기하고, rate limit도 버튼 클릭당 한 번만 계산한다.
 */
export async function reissueInvites({ idToken, householdId, expiresAt, maxUses, headers = {}, ip = '' }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);
  const expiry = normalizeExpiresAt(expiresAt);
  const uses = normalizeMaxUses(maxUses);
  const linkSecret = makeInviteSecret(INVITE_LINK);
  const codeSecret = makeInviteSecret(INVITE_CODE);
  const linkRef = db.collection(INVITES).doc();
  const codeRef = db.collection(INVITES).doc();

  await db.runTransaction(async (tx) => {
    const rateWrites = [];
    await assertRateLimit(tx, db, 'invite:reissue:v2:user', user.uid, 20, 60 * 60 * 1000, rateWrites);
    await assertRateLimit(tx, db, 'invite:reissue:v2:ip', clientIp(headers, ip), 100, 60 * 60 * 1000, rateWrites);
    await assertOwner(tx, db, id, user.uid);
    const householdSnap = await tx.get(householdRef(db, id));
    const invitesSnap = await tx.get(db.collection(INVITES).where('householdId', '==', id));
    if (!householdSnap.exists || !isHouseholdActiveDoc(householdSnap.data())) {
      throw new HouseholdError('HOUSEHOLD_NOT_FOUND', '활성 가족 그룹을 찾을 수 없습니다.', 404);
    }

    writeRateLimits(tx, rateWrites);
    invitesSnap.docs
      .filter((docSnap) => docSnap.data()?.active)
      .forEach((docSnap) => tx.update(docSnap.ref, {
        active: false,
        revokedAt: FieldValue.serverTimestamp(),
        revokedBy: user.uid,
      }));

    const createInvite = (ref, kind, secret) => tx.create(ref, {
      householdId: id,
      kind,
      tokenHash: inviteHash(kind, secret),
      active: true,
      maxUses: uses,
      useCount: 0,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: expiry,
      revokedAt: null,
    });
    createInvite(linkRef, INVITE_LINK, linkSecret);
    createInvite(codeRef, INVITE_CODE, codeSecret);
  });

  const serialize = (inviteId, kind, secret) => ({
    inviteId,
    kind,
    secret,
    expiresAt: expiry.toDate().toISOString(),
    maxUses: uses,
  });
  return {
    link: serialize(linkRef.id, INVITE_LINK, linkSecret),
    code: serialize(codeRef.id, INVITE_CODE, codeSecret),
  };
}

export async function joinHousehold({ idToken, kind, secret, headers = {}, ip = '' }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const inviteKind = normalizeInviteKind(kind);
  const hash = inviteHash(inviteKind, secret);
  const userRef = db.collection(USERS).doc(user.uid);
  let result = null;

  await db.runTransaction(async (tx) => {
    const rateWrites = [];
    await assertRateLimit(tx, db, 'join:user', user.uid, 8, 60 * 60 * 1000, rateWrites);
    await assertRateLimit(tx, db, 'join:ip', clientIp(headers, ip), 20, 60 * 60 * 1000, rateWrites);
    await assertRateLimit(tx, db, 'join:invite', hash, 12, 60 * 60 * 1000, rateWrites);

    const userSnap = await tx.get(userRef);
    const state = await inspectUserHouseholdState(tx, db, userSnap.data(), user.uid);
    if (state.activeId || state.pendingId) {
      throw new HouseholdError('ALREADY_IN_HOUSEHOLD', '진행 중인 가족 공유 설정을 먼저 완료해 주세요.', 409);
    }
    const inviteQuery = db.collection(INVITES).where('tokenHash', '==', hash).where('kind', '==', inviteKind).limit(1);
    const inviteSnap = await tx.get(inviteQuery);
    const inviteDoc = inviteSnap.docs[0];
    if (!inviteDoc?.exists) throw new HouseholdError('INVALID_INVITE', '유효하지 않은 초대입니다.', 404);
    const invite = inviteDoc.data();
    const expired = invite.expiresAt?.toMillis?.() <= Timestamp.now().toMillis();
    if (!invite.active || invite.revokedAt || expired) {
      throw new HouseholdError('INVITE_EXPIRED', '만료되었거나 폐기된 초대입니다.', 410);
    }
    if (Number(invite.useCount || 0) >= Number(invite.maxUses || 0)) {
      throw new HouseholdError('INVITE_MAX_USES_REACHED', '초대 사용 횟수가 모두 소진되었습니다.', 409);
    }
    const household = householdRef(db, invite.householdId);
    const householdSnap = await tx.get(household);
    if (!householdSnap.exists || !isHouseholdActiveDoc(householdSnap.data())) {
      throw new HouseholdError('HOUSEHOLD_NOT_FOUND', '활성 가족 그룹을 찾을 수 없습니다.', 404);
    }
    const membership = memberRef(db, invite.householdId, user.uid);
    const membershipSnap = await tx.get(membership);
    if (membershipSnap.exists && isMemberActiveDoc(membershipSnap.data())) {
      throw new HouseholdError('ALREADY_MEMBER', '이미 가족 구성원입니다.', 409);
    }

    writeRateLimits(tx, rateWrites);
    if (membershipSnap.exists) {
      tx.set(membership, {
        uid: user.uid,
        role: ROLE_MEMBER,
        active: true,
        joinedAt: membershipSnap.data()?.joinedAt || FieldValue.serverTimestamp(),
        joinedBy: invite.createdBy,
        rejoinedAt: FieldValue.serverTimestamp(),
        removedAt: FieldValue.delete(),
        removedBy: FieldValue.delete(),
        removedReason: FieldValue.delete(),
      }, { merge: true });
    } else {
      tx.create(membership, {
        uid: user.uid,
        role: ROLE_MEMBER,
        active: true,
        joinedAt: FieldValue.serverTimestamp(),
        joinedBy: invite.createdBy,
      });
    }
    tx.update(inviteDoc.ref, {
      useCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(userRef, {
      ...(state.cleanupPayload || {}),
      pendingHouseholdId: invite.householdId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    result = { householdId: invite.householdId, name: householdSnap.data().name, role: ROLE_MEMBER };
  });

  return result;
}

export async function transferOwnership({ idToken, householdId, toUid }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);
  const targetUid = String(toUid || '').trim();
  if (!targetUid || targetUid === user.uid) throw new HouseholdError('INVALID_OWNER_TARGET', '다른 가족 구성원을 선택해 주세요.');

  await db.runTransaction(async (tx) => {
    await assertOwner(tx, db, id, user.uid);
    const target = await tx.get(memberRef(db, id, targetUid));
    if (!target.exists || target.data()?.role !== ROLE_MEMBER) {
      throw new HouseholdError('TARGET_MEMBER_NOT_FOUND', '소유권을 받을 일반 멤버가 필요합니다.', 404);
    }
    tx.update(householdRef(db, id), { ownerId: targetUid, updatedAt: FieldValue.serverTimestamp() });
    tx.update(memberRef(db, id, user.uid), { role: ROLE_MEMBER, roleUpdatedAt: FieldValue.serverTimestamp() });
    tx.update(memberRef(db, id, targetUid), { role: ROLE_OWNER, roleUpdatedAt: FieldValue.serverTimestamp() });
  });
}

export async function renameHousehold({ idToken, householdId, name }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);
  const householdName = normalizeName(name);

  await db.runTransaction(async (tx) => {
    await assertOwner(tx, db, id, user.uid);
    const household = await tx.get(householdRef(db, id));
    if (!household.exists || !isHouseholdActiveDoc(household.data())) {
      throw new HouseholdError('HOUSEHOLD_NOT_FOUND', '활성 가족 그룹을 찾을 수 없습니다.', 404);
    }
    tx.update(household.ref, { name: householdName, updatedAt: FieldValue.serverTimestamp() });
  });
  return { householdId: id, name: householdName };
}

function clearPointersForHouseholdPayload(userData, householdId) {
  const payload = { updatedAt: FieldValue.serverTimestamp() };
  if (storedHouseholdId(userData?.activeHouseholdId) === householdId) {
    payload.activeHouseholdId = FieldValue.delete();
  }
  if (storedHouseholdId(userData?.pendingHouseholdId) === householdId) {
    payload.pendingHouseholdId = FieldValue.delete();
  }
  for (const field of USER_HOUSEHOLD_SETUP_FIELDS) {
    if (field === 'activeHouseholdId' || field === 'pendingHouseholdId') continue;
    if (userData?.[field] !== undefined) payload[field] = FieldValue.delete();
  }
  return payload;
}

/**
 * 탈퇴/제거 전: household 공유 데이터를 개인 경로로 복사한다.
 * household 원본은 삭제하지 않으며, 개인에 이미 있는 문서는 건너뛴다.
 */
async function copyHouseholdSharedDataToPersonal(db, { householdId, uid }) {
  const id = validateHouseholdId(householdId);
  const targetUid = String(uid || '').trim();
  if (!targetUid) throw new HouseholdError('INVALID_MEMBER_REMOVAL', '복구할 구성원이 필요합니다.');

  const householdRoot = householdRef(db, id);
  const userRoot = db.collection(USERS).doc(targetUid);
  const copied = [];
  const skipped = [];

  await copyCollectionDocs({
    source: householdRoot.collection('ingredients'),
    target: userRoot.collection('ingredients'),
    copied,
    skipped,
  });
  // household 원본은 삭제하지 않는다. 개인에 동일 ID가 있으면 건너뛰어 개인 데이터를 유지한다.

  await copyCollectionDocs({
    source: householdRoot.collection('shopping'),
    target: userRoot.collection('shopping'),
    copied,
    skipped,
  });
  await copyCollectionDocs({
    source: householdRoot.collection('mealCalendar'),
    target: userRoot.collection('mealCalendar'),
    copied,
    skipped,
  });

  const sourceMeal = householdRoot.collection('mealPlans').doc('default');
  const targetMeal = userRoot.collection('mealPlans').doc('default');
  const [sourceMealSnap, targetMealSnap] = await Promise.all([sourceMeal.get(), targetMeal.get()]);
  if (sourceMealSnap.exists && !targetMealSnap.exists) {
    await targetMeal.create({ ...sourceMealSnap.data() });
    copied.push(sourceMeal.path);
  } else if (sourceMealSnap.exists) {
    const sourceData = sourceMealSnap.data() || {};
    const targetData = targetMealSnap.data() || {};
    await targetMeal.set({
      ...targetData,
      ...Object.fromEntries(Object.entries(sourceData).filter(([key]) => !(key in targetData))),
      plans: { ...(sourceData.plans || {}), ...(targetData.plans || {}) },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    copied.push(`${sourceMeal.path}:merged`);
  }

  const grocerySnap = await householdRoot.collection('grocery').doc('preferences').get();
  if (grocerySnap.exists) {
    const prefsRef = userRoot.collection('settings').doc('preferences');
    const prefsSnap = await prefsRef.get();
    const existing = prefsSnap.exists ? (prefsSnap.data() || {}) : {};
    const grocery = grocerySnap.data() || {};
    const existingByWeek = existing.grocery?.byWeek || {};
    const sharedByWeek = grocery.byWeek || {};
    const missingWeeks = Object.fromEntries(
      Object.entries(sharedByWeek).filter(([week]) => !(week in existingByWeek)),
    );
    const existingBudgetByMonth = (existing.budgetByMonth && typeof existing.budgetByMonth === 'object')
      ? existing.budgetByMonth
      : {};
    const groceryBudgetByMonth = (grocery.budgetByMonth && typeof grocery.budgetByMonth === 'object')
      ? grocery.budgetByMonth
      : {};
    await prefsRef.set({
      grocery: {
        ...(existing.grocery || {}),
        activeWeekKey: existing.grocery?.activeWeekKey || grocery.activeWeekKey || '',
        byWeek: { ...existingByWeek, ...missingWeeks },
      },
      currency: existing.currency || grocery.currency || 'KRW',
      monthlyFoodBudget: existing.monthlyFoodBudget ?? grocery.monthlyFoodBudget ?? 0,
      budgetByMonth: { ...groceryBudgetByMonth, ...existingBudgetByMonth },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    copied.push(`${grocerySnap.ref.path}:merged`);
  }

  // 내가 저장한 레시피만 개인 savedRecipeIds로 이관 (다른 구성원 저장분은 제외)
  const savedMigration = await migrateUidSavedRecipesToPersonal(db, id, targetUid);
  if (savedMigration.migratedCount > 0) {
    copied.push(`households/${id}/savedRecipes:uid=${targetUid}:count=${savedMigration.migratedCount}`);
  }

  console.info('[household] copy shared data to personal completed', {
    uid: targetUid,
    householdId: id,
    copiedCount: copied.length,
    skippedCount: skipped.length,
    savedRecipesMigrated: savedMigration.migratedCount,
  });

  return {
    householdId: id,
    uid: targetUid,
    copied,
    skipped,
    copiedCount: copied.length,
    skippedCount: skipped.length,
    savedRecipesMigrated: savedMigration.migratedCount,
    ok: true,
  };
}

async function deactivateHouseholdMember(db, {
  householdId,
  memberUid,
  removedBy,
  removedReason,
}) {
  const id = validateHouseholdId(householdId);
  const targetUid = String(memberUid || '').trim();
  const actorUid = String(removedBy || '').trim();
  if (!targetUid || !actorUid) {
    throw new HouseholdError('INVALID_MEMBER_REMOVAL', '구성원 제거 정보가 올바르지 않습니다.');
  }

  const recovery = await copyHouseholdSharedDataToPersonal(db, {
    householdId: id,
    uid: targetUid,
  });
  if (!recovery?.ok) {
    throw new HouseholdError('MEMBER_DATA_RECOVERY_FAILED', '구성원 개인 데이터 복구에 실패했습니다.', 500);
  }

  await db.runTransaction(async (tx) => {
    const [householdSnap, memberSnap, userSnap] = await Promise.all([
      tx.get(householdRef(db, id)),
      tx.get(memberRef(db, id, targetUid)),
      tx.get(db.collection(USERS).doc(targetUid)),
    ]);
    if (!householdSnap.exists || !isHouseholdActiveDoc(householdSnap.data())) {
      throw new HouseholdError('HOUSEHOLD_NOT_FOUND', '활성 가족 그룹을 찾을 수 없습니다.', 404);
    }
    if (!memberSnap.exists || !isMemberActiveDoc(memberSnap.data())) {
      throw new HouseholdError('MEMBER_NOT_FOUND', '활성 가족 구성원을 찾을 수 없습니다.', 404);
    }
    if (memberSnap.data()?.role === ROLE_OWNER) {
      throw new HouseholdError('OWNER_TRANSFER_REQUIRED', 'owner는 소유권을 이전한 후 탈퇴할 수 있습니다.', 409);
    }

    const userData = userSnap.exists ? (userSnap.data() || {}) : {};
    tx.set(
      db.collection(USERS).doc(targetUid),
      clearPointersForHouseholdPayload(userData, id),
      { merge: true },
    );
    tx.set(memberRef(db, id, targetUid), {
      active: false,
      removedAt: FieldValue.serverTimestamp(),
      removedBy: actorUid,
      removedReason: removedReason || 'removed',
      lastRecoveryCopiedCount: recovery.copiedCount,
      lastRecoverySkippedCount: recovery.skippedCount,
      recoveryCompletedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  // 나간/제거된 구성원의 저장 관계만 해제 (공개 레시피·타인 저장 유지). idempotent.
  // soft-deactivate 이후이므로 실패해도 leave/remove 자체는 유지하고 lazy purge로 보정한다.
  try {
    const removed = await removeUidFromHouseholdSavedRecipes(db, id, targetUid);
    const purged = await purgeInactiveSavedRecipeMembers(db, id);
    console.info('[household] savedRecipes cleanup after member deactivate', {
      householdId: id,
      memberUid: targetUid,
      removedReason: removedReason || 'removed',
      removedTouches: removed?.touched || 0,
      purgedTouches: purged?.touched || 0,
      purgedUids: purged?.removedUids || [],
    });
  } catch (err) {
    console.error('[household] savedRecipes cleanup failed (will retry via lazy purge)', {
      householdId: id,
      memberUid: targetUid,
      error: err?.message || String(err),
    });
  }

  return recovery;
}

export async function removeMember({ idToken, householdId, memberUid }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);
  const targetUid = String(memberUid || '').trim();
  if (!targetUid || targetUid === user.uid) {
    throw new HouseholdError('INVALID_MEMBER_REMOVAL', 'owner는 자신을 제거할 수 없습니다.');
  }

  await db.runTransaction(async (tx) => {
    await assertOwner(tx, db, id, user.uid);
    const target = await tx.get(memberRef(db, id, targetUid));
    if (!target.exists || !isMemberActiveDoc(target.data())) {
      throw new HouseholdError('MEMBER_NOT_FOUND', '가족 구성원을 찾을 수 없습니다.', 404);
    }
    if (target.data()?.role === ROLE_OWNER) {
      throw new HouseholdError('OWNER_TRANSFER_REQUIRED', 'owner는 먼저 소유권을 이전해야 합니다.', 409);
    }
  });

  await deactivateHouseholdMember(db, {
    householdId: id,
    memberUid: targetUid,
    removedBy: user.uid,
    removedReason: 'removed_by_owner',
  });
}

export async function leaveHousehold({ idToken, householdId }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);

  let soleOwnerDelete = false;
  await db.runTransaction(async (tx) => {
    const member = await tx.get(memberRef(db, id, user.uid));
    if (!member.exists || !isMemberActiveDoc(member.data())) {
      throw new HouseholdError('MEMBER_NOT_FOUND', '가족 구성원을 찾을 수 없습니다.', 404);
    }
    if (member.data()?.role === ROLE_OWNER) {
      // 마지막 활성 관리자만 남은 경우 leave → 가족 삭제 플로우
      const members = await tx.get(householdRef(db, id).collection('members'));
      const activeMembers = members.docs.filter((doc) => isMemberActiveDoc(doc.data()));
      if (activeMembers.length === 1 && activeMembers[0].id === user.uid) {
        soleOwnerDelete = true;
        return;
      }
      throw new HouseholdError('OWNER_TRANSFER_REQUIRED', 'owner는 소유권을 이전한 후 탈퇴할 수 있습니다.', 409);
    }
  });

  if (soleOwnerDelete) {
    console.info('[household] leaveHousehold → deleteLastOwnerHousehold (sole active owner)', {
      householdId: id,
      uid: user.uid,
    });
    return deleteLastOwnerHousehold({ idToken, householdId: id });
  }

  await deactivateHouseholdMember(db, {
    householdId: id,
    memberUid: user.uid,
    removedBy: user.uid,
    removedReason: 'left',
  });
}

export async function deleteLastOwnerHousehold({ idToken, householdId }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);

  console.info('[household] deleteLastOwnerHousehold start', {
    householdId: id,
    uid: user.uid,
  });

  // soft-delete 전에 owner 본인 저장분만 개인 preferences로 이관
  // (다른 구성원 저장 참조가 개인 savedRecipeIds에 섞이지 않도록 uid 필터)
  try {
    await migrateUidSavedRecipesToPersonal(db, id, user.uid);
    console.info('[household] deleteLastOwnerHousehold stage=migrateSavedRecipes ok', {
      householdId: id,
    });
  } catch (error) {
    console.error('[household] deleteLastOwnerHousehold stage=migrateSavedRecipes failed', {
      householdId: id,
      message: error?.message || String(error),
      code: error?.code || '',
    });
    throw error;
  }

  try {
    await db.runTransaction(async (tx) => {
      await assertOwner(tx, db, id, user.uid);

      const members = await tx.get(householdRef(db, id).collection('members'));
      // leave/remove는 members 문서를 soft-deactivate만 하므로 size가 1보다 클 수 있다.
      // 삭제 조건은 "활성 구성원 정확히 1명(본인 owner)"이어야 한다.
      const activeMembers = members.docs.filter((doc) => isMemberActiveDoc(doc.data()));
      console.info('[household] deleteLastOwnerHousehold stage=memberCheck', {
        householdId: id,
        totalMemberDocs: members.size,
        activeMemberCount: activeMembers.length,
        soleOwner: activeMembers.length === 1 && activeMembers[0]?.id === user.uid,
      });
      if (activeMembers.length !== 1 || activeMembers[0].id !== user.uid) {
        throw new HouseholdError(
          'MEMBERS_REMAIN',
          '다른 활성 구성원이 남아 있습니다. 구성원을 제거하거나 소유권을 이전해 주세요.',
          409,
        );
      }

      const activeInvites = await tx.get(
        db.collection(INVITES).where('householdId', '==', id).where('active', '==', true),
      );
      activeInvites.docs.forEach((doc) => tx.update(doc.ref, {
        active: false,
        revokedAt: FieldValue.serverTimestamp(),
        revokedBy: user.uid,
      }));
      console.info('[household] deleteLastOwnerHousehold stage=revokeInvites', {
        householdId: id,
        revokedCount: activeInvites.size,
      });

      tx.update(householdRef(db, id), {
        status: 'deleted',
        deletedAt: FieldValue.serverTimestamp(),
        deletedBy: user.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.delete(memberRef(db, id, user.uid));
      tx.set(db.collection(USERS).doc(user.uid), {
        ...clearHouseholdSetupPayload(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  } catch (error) {
    console.error('[household] deleteLastOwnerHousehold stage=transaction failed', {
      householdId: id,
      message: error?.message || String(error),
      code: error?.code || '',
    });
    throw error;
  }

  console.info('[household] deleteLastOwnerHousehold completed', {
    householdId: id,
    clearedUserPointers: true,
    householdStatus: 'deleted',
  });
}

function isExtractedRecipe(data = {}) {
  return Boolean(
    data.sourcePlatform
    || data.videoUrl
    || data.normalizedVideoId
    || String(data.createdFrom || '').includes('영상'),
  );
}

const EXTRACTED_RECIPE_FIELDS = new Set([
  'name', 'ingredients', 'optionalIngredients', 'ingredientSubstitutes', 'steps',
  'cookTime', 'difficulty', 'category', 'dishType', 'cuisine', 'tags', 'dietTags',
  'image', 'thumbnailUrl', 'calories', 'memo', 'sourceUrl', 'videoUrl', 'sourcePostUrl',
  'normalizedVideoId', 'normalizedSourceUrl', 'sourcePlatform', 'parentRecipeId',
  'createdFrom', 'sourceRecipeId', 'sourceType', 'isCustomVersion', 'ownerId',
  'authorId', 'authorName', 'visibility', 'publicRecipeId', 'createdAt', 'updatedAt',
]);

function extractedRecipePayload(data = {}) {
  return Object.fromEntries(Object.entries(data).filter(([key]) => EXTRACTED_RECIPE_FIELDS.has(key)));
}

function savedMember(user) {
  const name = getDisplayName({
    userProfile: user,
    authUser: user,
    storedName: user.name || '',
    email: user.email || '',
    fallback: '냉장GO 사용자',
  }).slice(0, 40);
  return {
    uid: user.uid,
    name,
    savedAt: Timestamp.now(),
  };
}

function normalizeSavedByMembers(data = {}) {
  const members = Array.isArray(data.savedByMembers) ? data.savedByMembers : [];
  const legacy = data.savedBy ? [{
    uid: String(data.savedBy),
    name: String(data.savedByName || '냉장GO 사용자'),
    savedAt: data.savedAt || Timestamp.now(),
  }] : [];
  return [...members, ...legacy].reduce((unique, member) => {
    const uid = String(member?.uid || '').trim();
    if (uid && !unique.some((item) => item.uid === uid)) {
      unique.push({ uid, name: String(member.name || '냉장GO 사용자').slice(0, 40), savedAt: member.savedAt || Timestamp.now() });
    }
    return unique;
  }, []);
}

function normalizedIngredientKey(data = {}) {
  return normalizeIngredientName(
    data.normalizedName || data.name || data.ingredientName,
  )
    || String(data.name || data.ingredientName || '').trim().toLocaleLowerCase();
}

/**
 * 수량 파싱. 빈 문자열/null/undefined/NaN 은 미입력(null).
 * 기본값 1을 넣지 않는다.
 */
function parseIngredientQuantity(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === 'nan') return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeQuantityForStorage(value) {
  const parsed = parseIngredientQuantity(value);
  if (parsed != null) {
    return Number.isInteger(parsed) ? String(parsed) : String(parsed);
  }
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === 'nan') return '';
  return raw;
}

function mergeIngredientQuantities(existing = {}, incoming = {}) {
  const numeric = [
    parseIngredientQuantity(existing.quantity),
    parseIngredientQuantity(incoming.quantity),
  ].filter((n) => n != null);
  if (numeric.length) {
    const total = numeric.reduce((sum, n) => sum + n, 0);
    return Number.isInteger(total) ? String(total) : String(total);
  }
  return normalizeQuantityForStorage(existing.quantity)
    || normalizeQuantityForStorage(incoming.quantity)
    || '';
}

function earliestExpiryDate(...items) {
  const dates = items
    .map((data) => String(data?.expiryDate || data?.expirationDate || '').trim())
    .filter(Boolean)
    .sort();
  return dates[0] || '';
}

function mergeIngredientData(existing = {}, incoming = {}) {
  // 기존 household 필드를 우선해 메모·보관 위치 같은 정보가 사라지지 않게 한다.
  const merged = { ...incoming, ...existing };
  merged.quantity = mergeIngredientQuantities(existing, incoming);
  const expiryDate = earliestExpiryDate(existing, incoming);
  if (expiryDate) merged.expiryDate = expiryDate;
  else delete merged.expiryDate;
  // 표기명은 기존 household 명칭을 유지하되, 새 문서일 때는 source를 사용한다.
  merged.name = String(existing.name || incoming.name || incoming.ingredientName || '').trim();
  merged.normalizedName = normalizedIngredientKey(merged);
  return merged;
}

function mergeManyIngredientDocs(items = []) {
  return items.reduce((merged, item) => (merged ? mergeIngredientData(merged, item) : { ...item }), null);
}

async function mergeIngredientCollectionDocs({ source, target, copied, skipped }) {
  await target.firestore.runTransaction(async (tx) => {
    const [sourceSnapshots, targetSnapshots] = await Promise.all([
      source ? tx.get(source) : Promise.resolve({ docs: [] }),
      tx.get(target),
    ]);
    const sourceByName = new Map();
    const targetByName = new Map();
    const targetIds = new Set(targetSnapshots.docs.map((snap) => snap.id));
    sourceSnapshots.docs.forEach((snap) => {
      const key = normalizedIngredientKey(snap.data());
      if (key) sourceByName.set(key, [...(sourceByName.get(key) || []), snap]);
    });
    targetSnapshots.docs.forEach((snap) => {
      const key = normalizedIngredientKey(snap.data());
      if (key) targetByName.set(key, [...(targetByName.get(key) || []), snap]);
    });

    // source에 없는 기존 가족 중복도 같이 정리한다.
    const keys = new Set([...sourceByName.keys(), ...targetByName.keys()]);
    const writeCount = [...keys].reduce((count, key) => {
      const householdItems = targetByName.get(key) || [];
      return count + 1 + Math.max(0, householdItems.length - 1);
    }, 0);
    if (writeCount > 450) {
      throw new HouseholdError('TOO_MANY_INGREDIENTS_TO_MERGE', '재료가 너무 많아 한 번에 안전하게 병합할 수 없습니다.', 409);
    }

    for (const key of keys) {
      const sourceItems = sourceByName.get(key) || [];
      const householdItems = targetByName.get(key) || [];
      const canonical = householdItems[0] || null;
      const sourceData = mergeManyIngredientDocs(sourceItems.map((snap) => snap.data()));
      const householdData = mergeManyIngredientDocs(householdItems.map((snap) => snap.data()));
      const mergedData = householdData
        ? (sourceData ? mergeIngredientData(householdData, sourceData) : householdData)
        : sourceData;
      mergedData.normalizedName = normalizedIngredientKey(mergedData);
      const targetRef = canonical?.ref
        || (targetIds.has(sourceItems[0].id) ? target.doc() : target.doc(sourceItems[0].id));
      tx.set(targetRef, mergedData, { merge: true });
      if (sourceItems[0]) copied.push(`${sourceItems[0].ref.path}:merged`);
      householdItems.slice(1).forEach((duplicate) => {
        tx.delete(duplicate.ref);
        skipped.push(`${duplicate.ref.path}:deduplicated`);
      });
    }
  });
}

export async function deduplicateHouseholdIngredients({ idToken, householdId }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);
  await db.runTransaction(async (tx) => {
    await assertMember(tx, db, id, user.uid);
  });
  const copied = [];
  const skipped = [];
  await mergeIngredientCollectionDocs({
    source: null,
    target: householdRef(db, id).collection('ingredients'),
    copied,
    skipped,
  });
  return { mergedCount: copied.length, removedDuplicates: skipped.length };
}

async function copyCollectionDocs({ source, target, copied, skipped }) {
  const snapshots = await source.get();
  const existing = await Promise.all(snapshots.docs.map((snap) => target.doc(snap.id).get()));
  let batch = source.firestore.batch();
  let writes = 0;
  for (const [index, snap] of snapshots.docs.entries()) {
    if (existing[index].exists) {
      skipped.push(snap.ref.path);
      continue;
    }
    batch.create(target.doc(snap.id), {
      ...snap.data(),
    });
    writes += 1;
    copied.push(snap.ref.path);
    if (writes === 450) {
      await batch.commit();
      batch = source.firestore.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
}

/**
 * 개인 생활 데이터를 household로 복사한다. 원본 users/{uid} 데이터는 절대 삭제하지 않는다.
 * 재실행 시 같은 문서 ID가 있으면 건너뛰므로 idempotent하다.
 */
export async function copyPersonalDataToHousehold({ idToken, householdId, scopes = [] }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);
  const selected = new Set(Array.isArray(scopes) && scopes.length
    ? scopes
    : ['ingredients', 'shopping', 'mealPlans', 'mealCalendar', 'grocery', 'savedRecipes', 'statistics']);
  const copied = [];
  const skipped = [];

  await db.runTransaction(async (tx) => {
    await assertMember(tx, db, id, user.uid);
  });

  const userRoot = db.collection(USERS).doc(user.uid);
  const householdRoot = householdRef(db, id);
  const userProfileSnap = await userRoot.get();
  const userProfile = userProfileSnap.exists ? (userProfileSnap.data() || {}) : {};
  const migrationUser = {
    ...user,
    ...userProfile,
    name: getDisplayName({
      userProfile,
      authUser: user,
      storedName: user.name || '',
      email: user.email || userProfile.email || '',
      fallback: '냉장GO 사용자',
    }),
  };
  if (selected.has('ingredients')) {
    await mergeIngredientCollectionDocs({
      source: userRoot.collection('ingredients'),
      target: householdRoot.collection('ingredients'),
      copied,
      skipped,
    });
  }
  if (selected.has('shopping')) {
    await copyCollectionDocs({
      source: userRoot.collection('shopping'),
      target: householdRoot.collection('shopping'),
      copied,
      skipped,
    });
  }
  if (selected.has('mealCalendar')) {
    await copyCollectionDocs({
      source: userRoot.collection('mealCalendar'),
      target: householdRoot.collection('mealCalendar'),
      copied,
      skipped,
    });
  }
  if (selected.has('mealPlans')) {
    const source = userRoot.collection('mealPlans').doc('default');
    const target = householdRoot.collection('mealPlans').doc('default');
    const [sourceSnap, targetSnap] = await Promise.all([source.get(), target.get()]);
    if (sourceSnap.exists && !targetSnap.exists) {
      await target.create({
        ...sourceSnap.data(),
      });
      copied.push(source.path);
    } else if (sourceSnap.exists) {
      const sourceData = sourceSnap.data() || {};
      const targetData = targetSnap.data() || {};
      await target.set({
        ...targetData,
        ...Object.fromEntries(Object.entries(sourceData).filter(([key]) => !(key in targetData))),
        plans: { ...(sourceData.plans || {}), ...(targetData.plans || {}) },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      copied.push(`${source.path}:merged`);
    }
  }

  const preferencesSnap = await userRoot.collection('settings').doc('preferences').get();
  const preferences = preferencesSnap.exists ? preferencesSnap.data() || {} : {};
  if (selected.has('grocery')) {
    const target = householdRoot.collection('grocery').doc('preferences');
    const existing = await target.get();
    const hasGroceryOrBudget = Boolean(
      preferences.grocery
      || preferences.currency
      || Object.prototype.hasOwnProperty.call(preferences, 'monthlyFoodBudget')
      || (preferences.budgetByMonth && typeof preferences.budgetByMonth === 'object'
        && Object.keys(preferences.budgetByMonth).length),
    );
    if (!existing.exists && hasGroceryOrBudget) {
      await target.create({
        activeWeekKey: preferences.grocery?.activeWeekKey || '',
        byWeek: preferences.grocery?.byWeek || {},
        currency: preferences.currency || 'KRW',
        monthlyFoodBudget: Number(preferences.monthlyFoodBudget) || 0,
        budgetByMonth: (preferences.budgetByMonth && typeof preferences.budgetByMonth === 'object')
          ? preferences.budgetByMonth
          : {},
        updatedAt: FieldValue.serverTimestamp(),
      });
      copied.push(preferencesSnap.ref.path);
    } else if (hasGroceryOrBudget) {
      const existingData = existing.data() || {};
      const existingByWeek = existingData.byWeek || {};
      const personalByWeek = preferences.grocery?.byWeek || {};
      const missingWeeks = Object.fromEntries(Object.entries(personalByWeek)
        .filter(([week]) => !(week in existingByWeek)));
      await target.set({
        byWeek: { ...existingByWeek, ...missingWeeks },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      copied.push(`${preferencesSnap.ref.path}:merged`);
    }
  }
  if (selected.has('savedRecipes')) {
    const ids = Array.isArray(preferences.savedRecipeIds) ? preferences.savedRecipeIds : [];
    const target = householdRoot.collection('savedRecipes');
    const batch = db.batch();
    let writes = 0;
    for (const recipeId of ids) {
      const ref = target.doc(String(recipeId));
      const existing = await ref.get();
      if (existing.exists) {
        const data = existing.data() || {};
        const members = normalizeSavedByMembers(data);
        if (!members.some((member) => member.uid === user.uid)) {
          batch.set(ref, {
            savedByMembers: [...members, savedMember(migrationUser)],
            savedBy: FieldValue.delete(),
            savedByName: FieldValue.delete(),
            savedAt: FieldValue.delete(),
          }, { merge: true });
          copied.push(`${preferencesSnap.ref.path}:saved:${recipeId}:merged`);
        } else if (data.savedBy && !data.savedByMembers) {
          batch.set(ref, {
            savedByMembers: members,
            savedBy: FieldValue.delete(),
            savedByName: FieldValue.delete(),
            savedAt: FieldValue.delete(),
          }, { merge: true });
          copied.push(`${preferencesSnap.ref.path}:saved:${recipeId}:upgraded`);
        } else skipped.push(`${preferencesSnap.ref.path}:saved:${recipeId}`);
      } else {
        batch.create(ref, {
          recipeId: String(recipeId),
          savedByMembers: [savedMember(migrationUser)],
        });
        writes += 1;
        copied.push(`${preferencesSnap.ref.path}:saved:${recipeId}`);
      }
    }
    if (writes) await batch.commit();
  }
  if (selected.has('statistics')) {
    await copyCollectionDocs({
      source: userRoot.collection('statistics'),
      target: householdRoot.collection('statistics'),
      copied,
      skipped,
    });
  }

  await householdRoot.collection('statistics').doc('migration').set({
    lastCopiedBy: user.uid,
    lastCopiedAt: FieldValue.serverTimestamp(),
    copiedCount: copied.length,
  }, { merge: true });
  await memberRef(db, id, user.uid).set({
    migrationCopyCompletedAt: FieldValue.serverTimestamp(),
    lastMigrationCopiedCount: copied.length,
    lastMigrationSkippedCount: skipped.length,
  }, { merge: true });
  return { copiedCount: copied.length, skippedCount: skipped.length, copied, skipped };
}

export function toHouseholdErrorResponse(err) {
  if (err instanceof HouseholdError) {
    return {
      status: err.status,
      body: { success: false, error: err.code, message: err.message, ...err.details },
    };
  }
  if (err?.code === 'INVALID_ID_TOKEN' || err?.code === 'FIREBASE_AUTH_UNAVAILABLE') {
    return {
      status: err.httpStatus || (err.code === 'FIREBASE_AUTH_UNAVAILABLE' ? 503 : 401),
      body: {
        success: false,
        error: err.code,
        message: err.message,
        ...(process.env.NODE_ENV !== 'production' ? {
          firebaseCode: err.firebaseCode || null,
          debugMessage: err.causeMessage || err.message,
        } : {}),
      },
    };
  }
  console.error('[households]', err);
  const isDevelopment = process.env.NODE_ENV !== 'production';
  return {
    status: 500,
    body: {
      success: false,
      error: 'HOUSEHOLD_SERVER_ERROR',
      message: isDevelopment ? (err?.message || String(err)) : '가족 처리 중 오류가 발생했습니다.',
      ...(isDevelopment ? { debugMessage: err?.stack || String(err) } : {}),
    },
  };
}
