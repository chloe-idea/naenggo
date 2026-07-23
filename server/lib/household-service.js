import { createHash, randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  getFirestoreAdmin,
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
} from './firebase-admin.js';

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

function requireAdmin() {
  if (!isFirebaseAdminConfigured()) {
    throw new HouseholdError('FIREBASE_ADMIN_NOT_CONFIGURED', '서버 Firebase 설정이 완료되지 않았습니다.', 503);
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
  if (!member.exists || member.data()?.role !== ROLE_OWNER) {
    throw new HouseholdError('HOUSEHOLD_OWNER_REQUIRED', '가족 owner 권한이 필요합니다.', 403);
  }
  return member;
}

async function assertMember(tx, db, householdId, uid) {
  const member = await tx.get(memberRef(db, householdId, uid));
  if (!member.exists) {
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
    return {
      id,
      valid: household.exists && household.data()?.status === 'active' && member.exists,
      member,
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
  const cleanupPayload = hasStaleReference || hasLegacySetupResidue ? {
    ...clearHouseholdSetupPayload(),
    ...(validActiveId ? { activeHouseholdId: validActiveId } : {}),
    ...(validPendingId ? { pendingHouseholdId: validPendingId } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  } : null;

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
    if (!householdSnap.exists || householdSnap.data()?.status !== 'active' || !memberSnap.exists) {
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

export async function getCurrentHousehold({ idToken }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const userRef = db.collection(USERS).doc(user.uid);
  const state = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const inspected = await inspectUserHouseholdState(tx, db, userSnap.data(), user.uid);
    if (inspected.cleanupPayload) tx.set(userRef, inspected.cleanupPayload, { merge: true });
    return inspected;
  });
  const householdId = state.activeId || state.pendingId || null;
  if (!householdId) return null;

  const [householdSnap, memberSnap, membersSnap] = await Promise.all([
    householdRef(db, householdId).get(),
    memberRef(db, householdId, user.uid).get(),
    householdRef(db, householdId).collection('members').get(),
  ]);
  if (!householdSnap.exists || householdSnap.data()?.status !== 'active' || !memberSnap.exists) {
    return null;
  }
  const data = householdSnap.data();
  return {
    householdId,
    name: data.name,
    ownerId: data.ownerId,
    role: memberSnap.data()?.role || null,
    needsMigrationChoice: !memberSnap.data()?.migrationChoiceCompletedAt,
    members: membersSnap.docs.map((snap) => ({
      uid: snap.id,
      role: snap.data()?.role || ROLE_MEMBER,
      joinedAt: serializeTimestamp(snap.data()?.joinedAt),
    })),
    createdAt: serializeTimestamp(data.createdAt),
    pendingSetup: !state.activeId,
  };
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
    if (!householdSnap.exists || householdSnap.data()?.status !== 'active') {
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
    if (!householdSnap.exists || householdSnap.data()?.status !== 'active') {
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
    if (!householdSnap.exists || householdSnap.data()?.status !== 'active') {
      throw new HouseholdError('HOUSEHOLD_NOT_FOUND', '활성 가족 그룹을 찾을 수 없습니다.', 404);
    }
    const membership = memberRef(db, invite.householdId, user.uid);
    const membershipSnap = await tx.get(membership);
    if (membershipSnap.exists) throw new HouseholdError('ALREADY_MEMBER', '이미 가족 구성원입니다.', 409);

    writeRateLimits(tx, rateWrites);
    tx.create(membership, {
      uid: user.uid,
      role: ROLE_MEMBER,
      joinedAt: FieldValue.serverTimestamp(),
      joinedBy: invite.createdBy,
    });
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
    if (!household.exists || household.data()?.status !== 'active') {
      throw new HouseholdError('HOUSEHOLD_NOT_FOUND', '활성 가족 그룹을 찾을 수 없습니다.', 404);
    }
    tx.update(household.ref, { name: householdName, updatedAt: FieldValue.serverTimestamp() });
  });
  return { householdId: id, name: householdName };
}

export async function removeMember({ idToken, householdId, memberUid }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);
  const targetUid = String(memberUid || '').trim();
  if (!targetUid || targetUid === user.uid) throw new HouseholdError('INVALID_MEMBER_REMOVAL', 'owner는 자신을 제거할 수 없습니다.');

  await db.runTransaction(async (tx) => {
    await assertOwner(tx, db, id, user.uid);
    const target = await tx.get(memberRef(db, id, targetUid));
    if (!target.exists) throw new HouseholdError('MEMBER_NOT_FOUND', '가족 구성원을 찾을 수 없습니다.', 404);
    if (target.data()?.role === ROLE_OWNER) throw new HouseholdError('OWNER_TRANSFER_REQUIRED', 'owner는 먼저 소유권을 이전해야 합니다.', 409);
    tx.delete(target.ref);
    tx.set(db.collection(USERS).doc(targetUid), {
      ...clearHouseholdSetupPayload(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

export async function leaveHousehold({ idToken, householdId }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);

  await db.runTransaction(async (tx) => {
    const member = await tx.get(memberRef(db, id, user.uid));
    if (!member.exists) throw new HouseholdError('MEMBER_NOT_FOUND', '가족 구성원을 찾을 수 없습니다.', 404);
    if (member.data()?.role === ROLE_OWNER) {
      throw new HouseholdError('OWNER_TRANSFER_REQUIRED', 'owner는 소유권을 이전한 후 탈퇴할 수 있습니다.', 409);
    }
    tx.delete(member.ref);
    tx.set(db.collection(USERS).doc(user.uid), {
      ...clearHouseholdSetupPayload(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

export async function deleteLastOwnerHousehold({ idToken, householdId }) {
  const user = await requireHouseholdUser(idToken);
  const db = getFirestoreAdmin();
  const id = validateHouseholdId(householdId);

  await db.runTransaction(async (tx) => {
    await assertOwner(tx, db, id, user.uid);
    const members = await tx.get(householdRef(db, id).collection('members'));
    if (members.size !== 1) {
      throw new HouseholdError('MEMBERS_REMAIN', '다른 멤버를 제거하거나 소유권을 이전해 주세요.', 409);
    }
    const activeInvites = await tx.get(db.collection(INVITES).where('householdId', '==', id).where('active', '==', true));
    activeInvites.docs.forEach((doc) => tx.update(doc.ref, {
      active: false,
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: user.uid,
    }));
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
  return {
    uid: user.uid,
    name: String(user.name || user.displayName || user.email || '냉장GO 사용자').slice(0, 40),
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
  return [
    String(data.name || data.ingredientName || '').trim().toLowerCase(),
    String(data.storage || data.storageLocation || data.location || '').trim().toLowerCase(),
    String(data.unit || '').trim().toLowerCase(),
  ].join('|');
}

function mergeIngredientData(existing = {}, incoming = {}) {
  const quantityKey = ['quantity', 'amount', 'count'].find((key) => Number.isFinite(Number(existing[key])) || Number.isFinite(Number(incoming[key])));
  const merged = { ...existing };
  if (quantityKey) merged[quantityKey] = (Number(existing[quantityKey]) || 0) + (Number(incoming[quantityKey]) || 0);
  const dates = [existing.expiryDate, existing.expirationDate, incoming.expiryDate, incoming.expirationDate]
    .filter(Boolean)
    .map((value) => String(value))
    .sort();
  if (dates[0]) {
    if ('expirationDate' in existing || 'expirationDate' in incoming) merged.expirationDate = dates[0];
    else merged.expiryDate = dates[0];
  }
  return merged;
}

async function copyCollectionDocs({ source, target, copied, skipped, mergeIngredients = false }) {
  const snapshots = await source.get();
  const targetSnapshots = mergeIngredients ? await target.get() : null;
  const existingByIngredient = new Map((targetSnapshots?.docs || []).map((snap) => [normalizedIngredientKey(snap.data()), snap]));
  const existing = await Promise.all(snapshots.docs.map((snap) => target.doc(snap.id).get()));
  let batch = source.firestore.batch();
  let writes = 0;
  for (const [index, snap] of snapshots.docs.entries()) {
    const matchingIngredient = mergeIngredients ? existingByIngredient.get(normalizedIngredientKey(snap.data())) : null;
    if (matchingIngredient) {
      batch.set(matchingIngredient.ref, mergeIngredientData(matchingIngredient.data(), snap.data()), { merge: true });
      copied.push(`${snap.ref.path}:merged`);
      writes += 1;
      continue;
    }
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
  const migrationUser = {
    ...user,
    name: userProfileSnap.data()?.displayName || user.name || user.email,
  };
  if (selected.has('ingredients')) {
    await copyCollectionDocs({
      source: userRoot.collection('ingredients'),
      target: householdRoot.collection('ingredients'),
      copied,
      skipped,
      mergeIngredients: true,
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
      || Object.prototype.hasOwnProperty.call(preferences, 'monthlyFoodBudget'),
    );
    if (!existing.exists && hasGroceryOrBudget) {
      await target.create({
        activeWeekKey: preferences.grocery?.activeWeekKey || '',
        byWeek: preferences.grocery?.byWeek || {},
        currency: preferences.currency || 'KRW',
        monthlyFoodBudget: Number(preferences.monthlyFoodBudget) || 0,
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
          batch.set(ref, { savedByMembers: [...members, savedMember(migrationUser)] }, { merge: true });
          copied.push(`${preferencesSnap.ref.path}:saved:${recipeId}:merged`);
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
