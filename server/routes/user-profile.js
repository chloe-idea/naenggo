import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken, getFirestoreAdmin, isFirebaseAdminConfigured } from '../lib/firebase-admin.js';
import { resolveIdTokenFromRequest } from '../lib/analysis-quota.js';
import { normalizeSocialLinks } from '../lib/social-url.js';

const router = Router();
const DEFAULT_DISPLAY_NAME = '냉장GO 사용자';

function pickProfileFields(body = {}) {
  return {
    displayName: typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 20) : undefined,
    bio: typeof body.bio === 'string' ? body.bio.trim().slice(0, 80) : undefined,
    profileImageUrl: typeof body.profileImageUrl === 'string'
      ? body.profileImageUrl.trim()
      : (typeof body.profileImage === 'string' ? body.profileImage.trim() : undefined),
    avatarType: typeof body.avatarType === 'string' ? body.avatarType.trim() : undefined,
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

    const displayName = fields.displayName !== undefined
      ? fields.displayName
      : String(existing.displayName || '').trim();
    const bio = fields.bio !== undefined
      ? fields.bio
      : String(existing.bio || '').trim();
    const profileImageUrl = fields.profileImageUrl !== undefined
      ? fields.profileImageUrl
      : String(existing.profileImageUrl || existing.profileImage || '').trim();
    const avatarType = fields.avatarType !== undefined
      ? fields.avatarType
      : existing.avatarType;

    let resolvedImage = profileImageUrl;
    if (avatarType === 'google' && decoded.picture) {
      resolvedImage = decoded.picture;
    }

    const userPayload = {
      displayName: displayName || DEFAULT_DISPLAY_NAME,
      bio,
      profileImage: profileImageUrl || existing.profileImage || '',
      profileImageUrl: profileImageUrl || existing.profileImageUrl || existing.profileImage || '',
      socialLinks: linksResult.socialLinks,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (avatarType) userPayload.avatarType = avatarType;
    if (!userSnap.exists) {
      userPayload.createdAt = FieldValue.serverTimestamp();
      userPayload.email = decoded.email || '';
    }

    const publicSnap = await publicRef.get();
    const publicPayload = {
      displayName: displayName || DEFAULT_DISPLAY_NAME,
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

    return res.json({
      ok: true,
      profile: {
        displayName: userPayload.displayName,
        bio: userPayload.bio,
        profileImageUrl,
        profileImage: profileImageUrl,
        avatarType: userPayload.avatarType || null,
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
