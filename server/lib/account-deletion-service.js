/**
 * 회원 탈퇴 — Admin SDK 전용.
 * - token uid만 신뢰
 * - 공유 household / 타인 데이터는 삭제하지 않음
 * - 공개 레시피는 유지 + 작성자 익명화
 * - Auth deleteUser는 Firestore 정리 성공 후 마지막에만 실행
 */
import { FieldValue } from 'firebase-admin/firestore';
import {
  getFirestoreAdmin,
  getFirebaseAdmin,
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
} from './firebase-admin.js';
import { deleteLastOwnerHousehold } from './household-service.js';
import { removeUidFromHouseholdSavedRecipes } from './household-saved-recipes.js';

const USERS = 'users';
const HOUSEHOLDS = 'households';
const PUBLIC_PROFILES = 'publicProfiles';
const PUBLIC_RECIPES = 'publicRecipes';
const ADMINS = 'admins';
const ACCOUNT_DELETIONS = 'accountDeletions';
const DELETED_AUTHOR_NAME = '탈퇴한 사용자';
const ROLE_OWNER = 'owner';
const IN_PROGRESS_STALE_MS = 15 * 60 * 1000;

const USER_SUBCOLLECTIONS = [
  'ingredients',
  'myRecipes',
  'mealPlans',
  'mealCalendar',
  'shopping',
  'settings',
];

/** 공개 레시피에서 제거할 식별 가능 필드 (레시피 본문·이미지는 유지) */
const PUBLIC_RECIPE_IDENTITY_DELETE_FIELDS = [
  'authorId',
  'userId',
  'email',
  'authorEmail',
  'nickname',
  'profileImage',
  'profileImageUrl',
  'authorProfileImage',
  'authorProfileImageUrl',
  'authorGooglePhotoURL',
  'authorPhotoURL',
  'authorProfileUrl',
  'profileUrl',
  'socialLinks',
  'myRecipeId',
];

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

export class AccountDeletionError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'AccountDeletionError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isHouseholdActiveDoc(data) {
  if (!data) return false;
  const status = data.status;
  if (status === 'deleted') return false;
  return status === 'active' || status == null || status === '';
}

function isMemberActiveDoc(data) {
  if (!data) return false;
  return data.active !== false;
}

function clearHouseholdSetupPayload() {
  return Object.fromEntries(USER_HOUSEHOLD_SETUP_FIELDS.map((field) => [field, FieldValue.delete()]));
}

function deletionRef(db, uid) {
  return db.collection(ACCOUNT_DELETIONS).doc(uid);
}

async function writeDeletionStatus(db, uid, patch) {
  await deletionRef(db, uid).set({
    uid,
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function deleteCollectionDocs(db, colRef, { pageSize = 200 } = {}) {
  let deleted = 0;
  for (;;) {
    const snap = await colRef.limit(pageSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < pageSize) break;
  }
  return deleted;
}

async function deleteUserSubcollections(db, uid) {
  const userRef = db.collection(USERS).doc(uid);
  let total = 0;
  for (const name of USER_SUBCOLLECTIONS) {
    total += await deleteCollectionDocs(db, userRef.collection(name));
  }
  return total;
}

function buildPublicRecipeAnonymizePayload() {
  const payload = {
    authorName: DELETED_AUTHOR_NAME,
    displayName: DELETED_AUTHOR_NAME,
    authorDeleted: true,
    updatedAt: FieldValue.serverTimestamp(),
  };
  for (const field of PUBLIC_RECIPE_IDENTITY_DELETE_FIELDS) {
    payload[field] = FieldValue.delete();
  }
  return payload;
}

async function anonymizeAuthoredPublicRecipes(db, uid) {
  const seen = new Set();
  const queries = [
    db.collection(PUBLIC_RECIPES).where('authorId', '==', uid),
    db.collection(PUBLIC_RECIPES).where('userId', '==', uid),
  ];
  let anonymized = 0;
  for (const q of queries) {
    let snap;
    try {
      snap = await q.get();
    } catch (err) {
      console.warn('[account-deletion] publicRecipes query failed:', err?.message || err);
      continue;
    }
    for (const docSnap of snap.docs) {
      if (seen.has(docSnap.id)) continue;
      seen.add(docSnap.id);
      await docSnap.ref.set(buildPublicRecipeAnonymizePayload(), { merge: true });
      anonymized += 1;
    }
  }
  return anonymized;
}

async function listMemberHouseholdIds(db, uid) {
  const ids = new Set();
  try {
    const snap = await db.collectionGroup('members').where('uid', '==', uid).get();
    for (const docSnap of snap.docs) {
      const householdId = docSnap.ref.parent.parent?.id;
      if (householdId) ids.add(householdId);
    }
  } catch (err) {
    console.warn('[account-deletion] collectionGroup members query failed:', err?.message || err);
  }

  const userSnap = await db.collection(USERS).doc(uid).get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};
  for (const key of ['activeHouseholdId', 'pendingHouseholdId', 'householdId']) {
    const hid = String(userData[key] || '').trim();
    if (hid) ids.add(hid);
  }
  return [...ids];
}

async function softDeactivateMemberForAccountDeletion(db, householdId, uid) {
  await db.runTransaction(async (tx) => {
    const householdSnap = await tx.get(db.collection(HOUSEHOLDS).doc(householdId));
    const memberSnap = await tx.get(
      db.collection(HOUSEHOLDS).doc(householdId).collection('members').doc(uid),
    );
    const userSnap = await tx.get(db.collection(USERS).doc(uid));

    if (!householdSnap.exists || !isHouseholdActiveDoc(householdSnap.data())) {
      return;
    }
    if (!memberSnap.exists || !isMemberActiveDoc(memberSnap.data())) {
      if (userSnap.exists) {
        tx.set(db.collection(USERS).doc(uid), {
          ...clearHouseholdSetupPayload(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return;
    }
    if (memberSnap.data()?.role === ROLE_OWNER) {
      throw new AccountDeletionError(
        'OWNER_TRANSFER_REQUIRED',
        '가족 공유 소유권을 다른 구성원에게 이전한 뒤 탈퇴할 수 있습니다.',
        409,
      );
    }

    tx.set(db.collection(USERS).doc(uid), {
      ...clearHouseholdSetupPayload(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(memberSnap.ref, {
      active: false,
      removedAt: FieldValue.serverTimestamp(),
      removedBy: uid,
      removedReason: 'account_deleted',
    }, { merge: true });
  });
}

async function resolveHouseholdMembership(db, uid, idToken) {
  const householdIds = await listMemberHouseholdIds(db, uid);

  for (const householdId of householdIds) {
    const householdSnap = await db.collection(HOUSEHOLDS).doc(householdId).get();
    if (!householdSnap.exists || !isHouseholdActiveDoc(householdSnap.data())) {
      continue;
    }

    const memberSnap = await db.collection(HOUSEHOLDS).doc(householdId)
      .collection('members').doc(uid).get();
    if (!memberSnap.exists || !isMemberActiveDoc(memberSnap.data())) {
      continue;
    }

    const role = memberSnap.data()?.role;
    if (role === ROLE_OWNER) {
      const membersSnap = await db.collection(HOUSEHOLDS).doc(householdId)
        .collection('members').get();
      const activeOthers = membersSnap.docs.filter(
        (docSnap) => docSnap.id !== uid && isMemberActiveDoc(docSnap.data()),
      );
      if (activeOthers.length > 0) {
        throw new AccountDeletionError(
          'OWNER_TRANSFER_REQUIRED',
          '가족 공유 소유권을 다른 구성원에게 이전한 뒤 탈퇴할 수 있습니다.',
          409,
          { householdId, activeMemberCount: activeOthers.length + 1 },
        );
      }

      // 기존 마지막 owner 삭제 정책 그대로 사용 (로직 변경 없음)
      try {
        await deleteLastOwnerHousehold({ idToken, householdId });
      } catch (err) {
        const code = err?.code || 'HOUSEHOLD_DELETE_FAILED';
        const status = err?.status || 500;
        throw new AccountDeletionError(
          code,
          err?.message || '가족 그룹 정리에 실패했습니다.',
          status,
          err?.details,
        );
      }
      continue;
    }

    await softDeactivateMemberForAccountDeletion(db, householdId, uid);
  }

  // 포인터 잔여분 정리 (이미 비활성/삭제된 그룹)
  const userRef = db.collection(USERS).doc(uid);
  const userSnap = await userRef.get();
  if (userSnap.exists) {
    await userRef.set({
      ...clearHouseholdSetupPayload(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return householdIds;
}

async function deletePersonalDocuments(db, uid) {
  await deleteUserSubcollections(db, uid);

  const publicRef = db.collection(PUBLIC_PROFILES).doc(uid);
  if ((await publicRef.get()).exists) {
    await publicRef.delete();
  }

  const adminRef = db.collection(ADMINS).doc(uid);
  if ((await adminRef.get()).exists) {
    await adminRef.delete();
  }

  const userRef = db.collection(USERS).doc(uid);
  if ((await userRef.get()).exists) {
    await userRef.delete();
  }
}

async function deleteProfileStorageFiles(uid) {
  const targetUid = String(uid || '').trim();
  if (!targetUid) return { deleted: false };
  try {
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET
      || 'naenggo.firebasestorage.app';
    const bucket = getFirebaseAdmin().storage().bucket(bucketName);
    await bucket.deleteFiles({ prefix: `profile-images/${targetUid}/` });
    return { deleted: true };
  } catch (err) {
    // Storage 미사용/파일 없음은 탈퇴를 막지 않는다.
    console.warn('[account-deletion] profile storage cleanup skipped', {
      uid: targetUid,
      message: err?.message || String(err),
    });
    return { deleted: false, error: err?.message || String(err) };
  }
}

async function deleteAuthUser(uid) {
  try {
    await getFirebaseAdmin().auth().deleteUser(uid);
  } catch (err) {
    if (err?.code === 'auth/user-not-found') {
      return { alreadyDeleted: true };
    }
    throw new AccountDeletionError(
      'AUTH_DELETE_FAILED',
      err?.message || '인증 계정 삭제에 실패했습니다.',
      500,
    );
  }
  return { alreadyDeleted: false };
}

/**
 * @param {{ idToken: string }} params
 */
export async function deleteAccount({ idToken }) {
  if (!isFirebaseAdminConfigured()) {
    throw new AccountDeletionError(
      'SERVICE_UNAVAILABLE',
      '회원 탈퇴 서비스를 사용할 수 없습니다.',
      503,
    );
  }

  const decoded = await verifyFirebaseIdToken(idToken);
  const uid = decoded?.uid;
  if (!uid) {
    throw new AccountDeletionError('AUTH_REQUIRED', '로그인이 필요합니다.', 401);
  }

  const db = getFirestoreAdmin();
  const statusSnap = await deletionRef(db, uid).get();
  const prev = statusSnap.exists ? (statusSnap.data() || {}) : {};

  if (prev.status === 'completed') {
    // Auth만 남은 재시도
    await deleteAuthUser(uid);
    return {
      success: true,
      uid,
      idempotent: true,
      message: '회원 탈퇴가 완료되었습니다.',
    };
  }

  if (prev.status === 'in_progress' && prev.startedAt) {
    const startedMs = prev.startedAt.toMillis?.() || Date.parse(prev.startedAt) || 0;
    if (startedMs && Date.now() - startedMs < IN_PROGRESS_STALE_MS) {
      throw new AccountDeletionError(
        'DELETION_IN_PROGRESS',
        '회원 탈퇴가 이미 진행 중입니다. 잠시 후 다시 시도해 주세요.',
        409,
      );
    }
  }

  await writeDeletionStatus(db, uid, {
    status: 'in_progress',
    phase: 'started',
    startedAt: prev.startedAt || FieldValue.serverTimestamp(),
  });

  try {
    await writeDeletionStatus(db, uid, { phase: 'household' });
    const householdIds = await resolveHouseholdMembership(db, uid, idToken);

    await writeDeletionStatus(db, uid, { phase: 'public_recipes' });
    const anonymizedCount = await anonymizeAuthoredPublicRecipes(db, uid);

    await writeDeletionStatus(db, uid, { phase: 'saved_recipes' });
    let savedCleanup = 0;
    for (const householdId of householdIds) {
      const result = await removeUidFromHouseholdSavedRecipes(db, householdId, uid);
      savedCleanup += Number(result?.touched) || 0;
    }

    await writeDeletionStatus(db, uid, { phase: 'personal_data' });
    await deletePersonalDocuments(db, uid);

    await writeDeletionStatus(db, uid, { phase: 'profile_storage' });
    await deleteProfileStorageFiles(uid);

    await writeDeletionStatus(db, uid, { phase: 'auth' });
    await deleteAuthUser(uid);

    await writeDeletionStatus(db, uid, {
      status: 'completed',
      phase: 'done',
      completedAt: FieldValue.serverTimestamp(),
      anonymizedPublicRecipes: anonymizedCount,
      savedRecipeMembershipsRemoved: savedCleanup,
      householdIds,
    });

    return {
      success: true,
      uid,
      anonymizedPublicRecipes: anonymizedCount,
      savedRecipeMembershipsRemoved: savedCleanup,
      message: '회원 탈퇴가 완료되었습니다.',
    };
  } catch (err) {
    if (err instanceof AccountDeletionError) {
      await writeDeletionStatus(db, uid, {
        status: 'failed',
        phase: 'error',
        lastErrorCode: err.code,
        lastErrorMessage: err.message,
      }).catch(() => {});
      throw err;
    }
    await writeDeletionStatus(db, uid, {
      status: 'failed',
      phase: 'error',
      lastErrorCode: 'ACCOUNT_DELETE_FAILED',
      lastErrorMessage: err?.message || String(err),
    }).catch(() => {});
    throw new AccountDeletionError(
      'ACCOUNT_DELETE_FAILED',
      err?.message || '회원 탈퇴 처리에 실패했습니다.',
      500,
    );
  }
}

export function toAccountDeletionErrorResponse(err) {
  if (err instanceof AccountDeletionError) {
    return {
      status: err.status,
      body: {
        success: false,
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
  }
  if (err?.code === 'INVALID_ID_TOKEN' || err?.code === 'AUTH_REQUIRED') {
    return {
      status: err.httpStatus || 401,
      body: {
        success: false,
        error: err.code || 'AUTH_REQUIRED',
        message: err.message || '로그인이 필요합니다.',
      },
    };
  }
  return {
    status: 500,
    body: {
      success: false,
      error: 'ACCOUNT_DELETE_FAILED',
      message: err?.message || '회원 탈퇴 처리에 실패했습니다.',
    },
  };
}
