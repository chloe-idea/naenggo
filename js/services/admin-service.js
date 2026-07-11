/**
 * admins/{uid} — 운영자 권한 (Firestore 데이터 기준, 하드코딩 없음)
 */
import { doc, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { db } from '../firebase.js';

const COLLECTION = 'admins';

let unsubscribe = null;
let adminState = {
  isAdmin: false,
  role: null,
  checked: false,
};

function applyAdminSnapshot(snap) {
  const active = snap.exists() && snap.data()?.active === true;
  adminState = {
    isAdmin: active,
    role: active ? (snap.data()?.role || 'admin') : null,
    checked: true,
  };
  window.dispatchEvent(new CustomEvent('admin-status-changed', { detail: { ...adminState } }));
  return adminState;
}

export const AdminService = {
  getState() {
    return { ...adminState };
  },

  isAdmin() {
    return adminState.isAdmin === true;
  },

  async checkOnce(uid) {
    if (!db || !uid) {
      adminState = { isAdmin: false, role: null, checked: true };
      window.dispatchEvent(new CustomEvent('admin-status-changed', { detail: { ...adminState } }));
      return adminState;
    }
    try {
      const snap = await getDoc(doc(db, COLLECTION, uid));
      return applyAdminSnapshot(snap);
    } catch (err) {
      console.error('[AdminService] checkOnce failed:', err?.message || err);
      adminState = { isAdmin: false, role: null, checked: true };
      return adminState;
    }
  },

  startSync(uid) {
    this.stopSync();
    if (!db || !uid) {
      adminState = { isAdmin: false, role: null, checked: true };
      return;
    }
    const ref = doc(db, COLLECTION, uid);
    unsubscribe = onSnapshot(
      ref,
      (snap) => {
        applyAdminSnapshot(snap);
      },
      (err) => {
        console.error('[AdminService] snapshot error:', err?.code, err?.message);
        adminState = { isAdmin: false, role: null, checked: true };
        window.dispatchEvent(new CustomEvent('admin-status-changed', { detail: { ...adminState } }));
      },
    );
  },

  stopSync() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    adminState = { isAdmin: false, role: null, checked: false };
    window.dispatchEvent(new CustomEvent('admin-status-changed', { detail: { ...adminState } }));
  },
};
