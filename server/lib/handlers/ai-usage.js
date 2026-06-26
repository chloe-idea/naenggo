import { getAnalysisUsage } from '../analysis-quota.js';

export async function handleAiUsage({ userId, idToken }) {
  const trimmedUserId = String(userId || '').trim();
  const token = String(idToken || '').trim();

  if (!token && !trimmedUserId) {
    return {
      status: 400,
      body: { success: false, error: 'MISSING_USER_ID', message: 'userId가 필요합니다.' },
    };
  }

  try {
    const aiUsage = await getAnalysisUsage({ userId: trimmedUserId, idToken: token });
    return {
      status: 200,
      body: { success: true, aiUsage },
    };
  } catch (err) {
    if (err.code === 'INVALID_ID_TOKEN') {
      return {
        status: 401,
        body: { success: false, error: err.code, message: err.message },
      };
    }
    if (err.code === 'FIREBASE_ADMIN_NOT_CONFIGURED') {
      return {
        status: 503,
        body: {
          success: false,
          error: err.code,
          message: '서버 Firebase 설정이 완료되지 않았습니다.',
        },
      };
    }
    throw err;
  }
}
