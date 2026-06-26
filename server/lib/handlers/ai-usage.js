import { getAiUsage } from '../ai-usage-limit.js';

export function handleAiUsage({ userId }) {
  const trimmedUserId = String(userId || '').trim();

  if (!trimmedUserId) {
    return {
      status: 400,
      body: { success: false, error: 'MISSING_USER_ID', message: 'userId가 필요합니다.' },
    };
  }

  return {
    status: 200,
    body: { success: true, aiUsage: getAiUsage(trimmedUserId) },
  };
}
