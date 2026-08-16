/**
 * 버그 신고 → Resend 이메일 발송
 * secrets: RESEND_API_KEY, BUG_REPORT_TO_EMAIL, (optional) BUG_REPORT_FROM_EMAIL
 */

const BUG_TYPES = new Set([
  'feature',
  'ui',
  'auth',
  'recipe',
  'other',
]);

const BUG_TYPE_LABELS = {
  feature: '기능 오류',
  ui: '화면/디자인 오류',
  auth: '로그인/계정',
  recipe: '레시피 오류',
  other: '기타',
};

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 3;
/** @type {Map<string, number[]>} */
const rateBuckets = new Map();

function now() {
  return Date.now();
}

function clientKey(req, uidHint) {
  const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xf || String(req.socket?.remoteAddress || req.ip || 'unknown');
  return `${ip}|${uidHint || 'anon'}`;
}

function checkRateLimit(key) {
  const t = now();
  const prev = (rateBuckets.get(key) || []).filter((ts) => t - ts < RATE_WINDOW_MS);
  if (prev.length >= RATE_MAX) {
    rateBuckets.set(key, prev);
    const err = new Error('잠시 후 다시 시도해 주세요. (신고 한도 초과)');
    err.code = 'RATE_LIMITED';
    err.status = 429;
    throw err;
  }
  prev.push(t);
  rateBuckets.set(key, prev);
}

function sanitizeText(value, maxLen) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function sanitizeEmail(value) {
  const email = sanitizeText(value, 120);
  if (!email) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error('회신 이메일 형식이 올바르지 않습니다.');
    err.code = 'INVALID_EMAIL';
    err.status = 400;
    throw err;
  }
  return email;
}

function sanitizeUidHint(value) {
  const raw = sanitizeText(value, 64);
  if (!raw) return '';
  // UID 전체가 아니라 끝 6자 또는 이미 마스킹된 값만 허용
  if (raw.includes('…') || raw.includes('...')) return raw.slice(0, 16);
  if (raw.length <= 8) return raw;
  return `…${raw.slice(-6)}`;
}

function sanitizeScreenshot(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'object') {
    const err = new Error('스크린샷 형식이 올바르지 않습니다.');
    err.code = 'INVALID_SCREENSHOT';
    err.status = 400;
    throw err;
  }
  const contentType = sanitizeText(raw.contentType || raw.mimeType || '', 40).toLowerCase();
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowed.has(contentType)) {
    const err = new Error('스크린샷은 JPEG/PNG/WebP만 가능합니다.');
    err.code = 'INVALID_SCREENSHOT';
    err.status = 400;
    throw err;
  }
  let base64 = String(raw.base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!base64 || base64.length > 1_400_000) {
    const err = new Error('스크린샷이 너무 큽니다. 더 작은 이미지로 다시 첨부해 주세요.');
    err.code = 'SCREENSHOT_TOO_LARGE';
    err.status = 400;
    throw err;
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    const err = new Error('스크린샷 데이터가 손상되었습니다.');
    err.code = 'INVALID_SCREENSHOT';
    err.status = 400;
    throw err;
  }
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  return { contentType, base64, filename: `bug-screenshot.${ext}` };
}

function validatePayload(body = {}) {
  const type = sanitizeText(body.type, 32);
  if (!BUG_TYPES.has(type)) {
    const err = new Error('문제 유형을 선택해 주세요.');
    err.code = 'INVALID_TYPE';
    err.status = 400;
    throw err;
  }
  const screen = sanitizeText(body.screen, 80);
  if (screen.length < 1) {
    const err = new Error('버그가 발생한 화면을 입력해 주세요.');
    err.code = 'INVALID_SCREEN';
    err.status = 400;
    throw err;
  }
  const description = sanitizeText(body.description, 4000);
  if (description.length < 10) {
    const err = new Error('문제 설명을 10자 이상 입력해 주세요.');
    err.code = 'INVALID_DESCRIPTION';
    err.status = 400;
    throw err;
  }
  const replyEmail = sanitizeEmail(body.replyEmail);
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
  const screenshot = sanitizeScreenshot(body.screenshot);

  return {
    type,
    typeLabel: BUG_TYPE_LABELS[type] || type,
    screen,
    description,
    replyEmail,
    screenshot,
    meta: {
      currentView: sanitizeText(meta.currentView, 80),
      appVersion: sanitizeText(meta.appVersion, 40),
      userAgent: sanitizeText(meta.userAgent, 300),
      occurredAt: sanitizeText(meta.occurredAt, 40) || new Date().toISOString(),
      loggedIn: Boolean(meta.loggedIn),
      uidHint: sanitizeUidHint(meta.uidHint),
      recentErrorCodes: Array.isArray(meta.recentErrorCodes)
        ? meta.recentErrorCodes.map((c) => sanitizeText(c, 80)).filter(Boolean).slice(0, 5)
        : [],
      path: sanitizeText(meta.path, 200),
      sourceFeature: sanitizeText(meta.sourceFeature, 80),
      errorCode: sanitizeText(meta.errorCode, 80),
    },
  };
}

function buildEmailText(report) {
  const lines = [
    '[냉장GO 버그 신고]',
    '',
    `문제 유형: ${report.typeLabel}`,
    `발생 화면: ${report.screen}`,
    '',
    '--- 문제 설명 ---',
    report.description,
    '',
    '--- 자동 첨부 정보 ---',
    `현재 화면: ${report.meta.currentView || '-'}`,
    `경로: ${report.meta.path || '-'}`,
    `앱 버전: ${report.meta.appVersion || '-'}`,
    `발생 시각: ${report.meta.occurredAt || '-'}`,
    `로그인: ${report.meta.loggedIn ? '예' : '아니오'}`,
    `UID 힌트: ${report.meta.uidHint || '-'}`,
    `기능(sourceFeature): ${report.meta.sourceFeature || '-'}`,
    `오류 코드: ${report.meta.errorCode || '-'}`,
    `User-Agent: ${report.meta.userAgent || '-'}`,
    `최근 오류 코드: ${report.meta.recentErrorCodes.length ? report.meta.recentErrorCodes.join(', ') : '-'}`,
    '',
    `회신 이메일: ${report.replyEmail || '(없음)'}`,
    `스크린샷: ${report.screenshot ? report.screenshot.filename : '(없음)'}`,
  ];
  return lines.join('\n');
}

function assertEmailConfigured() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const to = String(process.env.BUG_REPORT_TO_EMAIL || '').trim();
  if (!apiKey || !to) {
    // 클라이언트/로그에 환경변수명·키 값을 노출하지 않음
    const err = new Error('지금은 문의 접수를 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    err.code = 'EMAIL_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }
  return {
    apiKey,
    to,
    from: String(process.env.BUG_REPORT_FROM_EMAIL || '').trim()
      || '냉장GO 버그신고 <onboarding@resend.dev>',
  };
}

function safeLogMessage(err) {
  const raw = String(err?.message || err || '');
  // API key 형태가 실수로 메시지에 섞여도 로그에 남기지 않음
  return raw.replace(/re_[A-Za-z0-9]{8,}/g, '[redacted]').slice(0, 300);
}

async function sendViaResend(report) {
  const { apiKey, to, from } = assertEmailConfigured();

  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);
  const payload = {
    from,
    to: [to],
    subject: `[냉장GO 버그] ${report.typeLabel} · ${report.screen}`,
    text: buildEmailText(report),
    replyTo: report.replyEmail || undefined,
  };
  if (report.screenshot) {
    payload.attachments = [{
      filename: report.screenshot.filename,
      content: report.screenshot.base64,
    }];
  }

  const { data, error } = await resend.emails.send(payload);
  if (error) {
    // Resend 원문은 서버 로그만 — 사용자에게는 고정 문구
    console.error('[bug-report] resend send failed:', safeLogMessage(error));
    const err = new Error('이메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    err.code = 'EMAIL_SEND_FAILED';
    err.status = 502;
    throw err;
  }
  return { id: data?.id || null };
}

export async function submitBugReport(req) {
  const report = validatePayload(req.body || {});
  assertEmailConfigured();
  checkRateLimit(clientKey(req, report.meta.uidHint));
  const sent = await sendViaResend(report);
  return {
    success: true,
    message: '문의가 접수되었습니다',
    id: sent.id,
  };
}

export function toBugReportErrorResponse(err) {
  const status = Number(err?.status) || 500;
  const code = err?.code || 'BUG_REPORT_FAILED';
  const allowedUserCodes = new Set([
    'INVALID_TYPE',
    'INVALID_SCREEN',
    'INVALID_DESCRIPTION',
    'INVALID_EMAIL',
    'INVALID_SCREENSHOT',
    'SCREENSHOT_TOO_LARGE',
    'RATE_LIMITED',
    'EMAIL_NOT_CONFIGURED',
    'EMAIL_SEND_FAILED',
    'METHOD_NOT_ALLOWED',
  ]);
  const message = allowedUserCodes.has(code) && err?.message
    ? String(err.message)
    : '신고 접수에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  return {
    status,
    body: {
      success: false,
      error: code,
      message,
    },
  };
}

export { BUG_TYPES, BUG_TYPE_LABELS, safeLogMessage };
