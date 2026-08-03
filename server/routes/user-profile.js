import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken, getFirestoreAdmin, isFirebaseAdminConfigured } from '../lib/firebase-admin.js';
import { resolveIdTokenFromRequest } from '../lib/analysis-quota.js';
import { normalizeSocialLinks } from '../lib/social-url.js';
import {
  getDisplayName,
  nicknameDualWriteFields,
  normalizeSiteNickname,
} from '../lib/display-name.js';

const router = Router();
const DEFAULT_DISPLAY_NAME = '냉장GO 사용자';

const AVATAR_TYPES = new Set(['letter', 'upload', 'google', 'initial', 'fridge']);

function normalizeAvatarType(value) {
  const type = String(value || '').trim();
  if (type === 'initial' || type === 'fridge') return 'letter';
  if (type === 'letter' || type === 'upload' || type === 'google') return type;
  return '';
}

function pickProfileFields(body = {}) {
  const avatarRaw = typeof body.avatarType === 'string'
    ? body.avatarType
    : (typeof body.profileImageType === 'string' ? body.profileImageType : undefined);
  return {
    nickname: typeof body.nickname === 'string' ? body.nickname.trim().slice(0, 20) : undefined,
    displayName: typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 20) : undefined,
    bio: typeof body.bio === 'string' ? body.bio.trim().slice(0, 80) : undefined,
    profileImageUrl: typeof body.profileImageUrl === 'string'
      ? body.profileImageUrl.trim()
      : (typeof body.profileImage === 'string' ? body.profileImage.trim() : undefined),
    photoURL: typeof body.photoURL === 'string' ? body.photoURL.trim() : undefined,
    uploadedPhotoURL: typeof body.uploadedPhotoURL === 'string' ? body.uploadedPhotoURL.trim() : undefined,
    googlePhotoURL: typeof body.googlePhotoURL === 'string' ? body.googlePhotoURL.trim() : undefined,
    avatarType: typeof avatarRaw === 'string' && AVATAR_TYPES.has(avatarRaw.trim())
      ? normalizeAvatarType(avatarRaw)
      : undefined,
    socialLinks: body.socialLinks && typeof body.socialLinks === 'object' ? body.socialLinks : undefined,
  };
}

router.post('/user-profile', async (req, res) => {
  try {
    if (!isFirebaseAdminConfigured()) {
      return res.status(503).json({ ok: false, error: '서버 프로필 저장을 사용할 수 없습니다.' });
    }

    const idToken = resolveIdTokenFromRequest(req);
    const decoded = await verifyFirebaseIdToken(idToken);
    const uid = decoded?.uid;
    if (!uid) {
      return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    }

    const fields = pickProfileFields(req.body || {});
    const linksResult = normalizeSocialLinks(fields.socialLinks || {});
    if (!linksResult.ok) {
      return res.status(400).json({ ok: false, error: linksResult.error });
    }

    const db = getFirestoreAdmin();
    const userRef = db.collection('users').doc(uid);
    const publicRef = db.collection('publicProfiles').doc(uid);
    const userSnap = await userRef.get();
    const existing = userSnap.exists ? userSnap.data() : {};

    const siteName = normalizeSiteNickname(
      fields.nickname ?? fields.displayName
        ?? existing.nickname ?? existing.displayName,
      { fallback: DEFAULT_DISPLAY_NAME },
    );
    const nameFields = nicknameDualWriteFields(siteName);
    const bio = fields.bio !== undefined
      ? fields.bio
      : String(existing.bio || '').trim();
    const profileImageUrl = fields.profileImageUrl !== undefined
      ? fields.profileImageUrl
      : String(existing.profileImageUrl || existing.profileImage || '').trim();
    const avatarType = fields.avatarType !== undefined
      ? fields.avatarType
      : normalizeAvatarType(existing.avatarType || existing.profileImageType) || undefined;
    const uploadedPhotoURL = fields.uploadedPhotoURL !== undefined
      ? fields.uploadedPhotoURL
      : String(existing.uploadedPhotoURL || '').trim();
    const googlePhotoURL = fields.googlePhotoURL !== undefined
      ? fields.googlePhotoURL
      : String(existing.googlePhotoURL || decoded.picture || '').trim();

    let resolvedImage = profileImageUrl || existing.profileImageUrl || existing.profileImage || '';
    if (avatarType === 'letter') {
      resolvedImage = '';
    } else if (avatarType === 'upload') {
      resolvedImage = uploadedPhotoURL || resolvedImage;
    } else if (avatarType === 'google') {
      resolvedImage = googlePhotoURL || decoded.picture || resolvedImage;
    }

    const userPayload = {
      ...nameFields,
      bio,
      profileImage: resolvedImage || '',
      profileImageUrl: resolvedImage || '',
      photoURL: resolvedImage || '',
      uploadedPhotoURL: uploadedPhotoURL || '',
      googlePhotoURL: googlePhotoURL || '',
      socialLinks: linksResult.socialLinks,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (avatarType) {
      userPayload.avatarType = avatarType;
      userPayload.profileImageType = avatarType;
    }
    if (!userSnap.exists) {
      userPayload.createdAt = FieldValue.serverTimestamp();
      userPayload.email = decoded.email || '';
    }

    const publicSnap = await publicRef.get();
    const publicPayload = {
      ...nameFields,
      profileImageUrl: resolvedImage || '',
      bio,
      socialLinks: linksResult.socialLinks,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!publicSnap.exists) {
      publicPayload.createdAt = FieldValue.serverTimestamp();
      publicPayload.publicRecipeCount = 0;
    }

    const batch = db.batch();
    batch.set(userRef, userPayload, { merge: true });
    batch.set(publicRef, publicPayload, { merge: true });
    await batch.commit();

    const resolvedName = getDisplayName({
      userProfile: userPayload,
      publicProfile: publicPayload,
      fallback: DEFAULT_DISPLAY_NAME,
    });

    return res.json({
      ok: true,
      profile: {
        nickname: userPayload.nickname || resolvedName,
        displayName: userPayload.displayName || resolvedName,
        bio: userPayload.bio,
        profileImageUrl: resolvedImage || '',
        profileImage: resolvedImage || '',
        photoURL: resolvedImage || '',
        uploadedPhotoURL: uploadedPhotoURL || '',
        googlePhotoURL: googlePhotoURL || '',
        avatarType: userPayload.avatarType || null,
        profileImageType: userPayload.profileImageType || userPayload.avatarType || null,
        socialLinks: linksResult.socialLinks,
      },
    });
  } catch (err) {
    const status = err?.code === 'INVALID_ID_TOKEN' ? 401 : 500;
    console.error('[user-profile]', err?.message || err);
    return res.status(status).json({
      ok: false,
      error: err?.message || '프로필 저장에 실패했습니다.',
    });
  }
});

export default router;
