import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreAdmin, isFirebaseAdminConfigured } from './firebase-admin.js';

const ADMINS_COLLECTION = 'admins';

export const ADMIN_UNLIMITED_USAGE = {
  remaining: null,
  limit: null,
  used: 0,
  source: 'admin',
  unlimited: true,
};

function adminDocRef(uid) {
  return getFirestoreAdmin().collection(ADMINS_COLLECTION).doc(uid);
}

export async function isActiveAdminUid(uid) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid || !isFirebaseAdminConfigured()) return false;

  try {
    const snap = await adminDocRef(normalizedUid).get();
    return snap.exists && snap.data()?.active === true;
  } catch (err) {
    console.warn('[firestore-admin] isActiveAdminUid failed:', err?.message || err);
    return false;
  }
}

export async function recordAdminAnalysisUsage(uid) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid || !isFirebaseAdminConfigured()) {
    return { ...ADMIN_UNLIMITED_USAGE };
  }

  await adminDocRef(normalizedUid).set({
    adminUsageCount: FieldValue.increment(1),
    lastAnalysisAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ...ADMIN_UNLIMITED_USAGE };
}
