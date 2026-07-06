/**
 * Firebase Auth 오류 → 사용자 메시지
 */
export function formatAuthError(err) {
  const code = String(err?.code || err?.error?.code || '');
  const hostname = typeof location !== 'undefined' ? location.hostname : '';

  if (code === 'auth/unauthorized-domain') {
    return {
      code,
      title: '승인되지 않은 도메인',
      message: `현재 도메인(${hostname})이 Firebase 승인 목록에 없습니다.`,
      hint: [
        'Firebase Console → Authentication → Settings → Authorized domains',
        '에 다음 도메인을 추가해 주세요:',
        `• ${hostname}`,
        hostname !== 'localhost' ? '• localhost (로컬 개발용)' : '',
      ].filter(Boolean).join('\n'),
    };
  }

  if (code === 'auth/popup-blocked') {
    return {
      code,
      title: '팝업 차단',
      message: '브라우저가 로그인 팝업을 차단했습니다. 팝업을 허용한 뒤 다시 시도해 주세요.',
      hint: '주소창 옆 팝업 차단 아이콘에서 이 사이트의 팝업을 허용할 수 있습니다.',
    };
  }

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return {
      code,
      title: '로그인 취소',
      message: 'Google 로그인 창이 닫혔습니다.',
      hint: '다시 시도해 주세요.',
    };
  }

  if (code === 'auth/operation-not-allowed') {
    return {
      code,
      title: 'Google 로그인 미설정',
      message: 'Firebase에서 Google 로그인이 활성화되지 않았습니다.',
      hint: 'Firebase Console → Authentication → Sign-in method → Google 을 Enable 해 주세요.',
    };
  }

  return {
    code: code || 'auth/unknown',
    title: '로그인 오류',
    message: err?.message || 'Google 로그인에 실패했습니다.',
    hint: code ? `오류 코드: ${code}` : '',
  };
}

export function logAuthError(context, err) {
  const formatted = formatAuthError(err);
  console.error(`[AuthService] ${context}`, {
    code: formatted.code,
    message: formatted.message,
    raw: err,
  });
  return formatted;
}
