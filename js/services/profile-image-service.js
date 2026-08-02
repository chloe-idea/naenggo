/**
 * 프로필 사진 리사이즈 · Firebase Storage 업로드
 * 경로: profile-images/{uid}/avatar.webp
 */
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js';
import { auth, storage, isFirebaseStorageConfigured } from '../firebase.js';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1.5 * 1024 * 1024;
const MAX_EDGE = 512;
const QUALITY = 0.82;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function avatarPath(uid) {
  return `profile-images/${uid}/avatar.webp`;
}

function avatarRef(uid) {
  if (!storage || !uid) return null;
  return ref(storage, avatarPath(uid));
}

function assertImageFile(file) {
  if (!file || !(file instanceof Blob)) {
    const err = new Error('이미지 파일을 선택해 주세요.');
    err.code = 'profile-image/invalid-file';
    throw err;
  }
  const type = String(file.type || '').toLowerCase();
  if (!ALLOWED_MIME.has(type)) {
    const err = new Error('jpg, jpeg, png, webp 이미지만 업로드할 수 있어요.');
    err.code = 'profile-image/unsupported-type';
    throw err;
  }
  if (file.size > MAX_INPUT_BYTES) {
    const err = new Error('이미지 용량이 너무 커요. 8MB 이하 파일을 선택해 주세요.');
    err.code = 'profile-image/too-large';
    throw err;
  }
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 불러오지 못했어요.'));
    };
    img.src = url;
  });
}

/** 긴 변 기준 512 이하로 축소 후 webp(또는 jpeg) Blob 반환 */
export async function resizeProfileImage(file) {
  assertImageFile(file);
  const image = await loadImageFromFile(file);
  const srcW = image.naturalWidth || image.width;
  const srcH = image.naturalHeight || image.height;
  if (!srcW || !srcH) {
    const err = new Error('올바른 이미지 파일이 아니에요.');
    err.code = 'profile-image/invalid-image';
    throw err;
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지 처리를 지원하지 않는 환경이에요.');
  ctx.drawImage(image, 0, 0, width, height);

  const toBlob = (mime, quality) => new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });

  let blob = await toBlob('image/webp', QUALITY);
  if (!blob) blob = await toBlob('image/jpeg', QUALITY);
  if (!blob) {
    const err = new Error('이미지 변환에 실패했어요.');
    err.code = 'profile-image/encode-failed';
    throw err;
  }
  if (blob.size > MAX_OUTPUT_BYTES) {
    const err = new Error('압축 후에도 이미지가 너무 커요. 다른 사진을 선택해 주세요.');
    err.code = 'profile-image/output-too-large';
    throw err;
  }
  return blob;
}

export const ProfileImageService = {
  isAvailable() {
    return isFirebaseStorageConfigured();
  },

  async uploadAvatar(file, { onProgress } = {}) {
    const user = auth?.currentUser;
    if (!user?.uid) {
      const err = new Error('로그인 후 사진을 업로드할 수 있어요.');
      err.code = 'auth/not-logged-in';
      throw err;
    }
    if (!this.isAvailable()) {
      const err = new Error('사진 업로드 저장소가 아직 준비되지 않았어요.');
      err.code = 'profile-image/storage-unavailable';
      throw err;
    }

    onProgress?.('compressing');
    const blob = await resizeProfileImage(file);
    const storageRef = avatarRef(user.uid);
    if (!storageRef) throw new Error('Storage 경로를 만들 수 없어요.');

    onProgress?.('uploading');
    await uploadBytes(storageRef, blob, {
      contentType: blob.type || 'image/webp',
      cacheControl: 'public,max-age=3600',
    });
    const downloadURL = await getDownloadURL(storageRef);
    onProgress?.('done');
    return {
      downloadURL,
      path: avatarPath(user.uid),
      contentType: blob.type || 'image/webp',
      size: blob.size,
    };
  },

  /** 교체 시 동일 경로 overwrite. 타입 변경 시에는 보관하고, 탈퇴 시에만 삭제 */
  async deleteAvatar(uid = auth?.currentUser?.uid) {
    if (!uid || !this.isAvailable()) return false;
    const storageRef = avatarRef(uid);
    if (!storageRef) return false;
    try {
      await deleteObject(storageRef);
      return true;
    } catch (err) {
      if (err?.code === 'storage/object-not-found') return false;
      console.warn('[ProfileImageService] deleteAvatar failed', err?.code || err?.message);
      return false;
    }
  },
};
