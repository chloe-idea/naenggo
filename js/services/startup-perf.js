/**
 * 초기 Firebase 로딩 계측 (최적화 없음 — 측정 전용)
 * 개인정보·토큰·API 키는 로그에 넣지 않는다.
 */

const originMs = performance.now();
const marks = new Map();
const pathHits = new Map();
const listenerHits = new Map();
const queryTimings = [];
const startedLabels = new Set();
const completedLabels = new Set();

function safePath(path) {
  return String(path || '(unknown)').replace(/\/(?:users|households)\/[^/]+/g, (m) => {
    if (m.startsWith('/users/')) return '/users/{uid}';
    if (m.startsWith('/households/')) return '/households/{householdId}';
    return m;
  });
}

function recordPath(firestorePath, kind = 'read') {
  const key = `${kind}:${safePath(firestorePath)}`;
  pathHits.set(key, (pathHits.get(key) || 0) + 1);
  return key;
}

function recordListener(firestorePath) {
  const key = safePath(firestorePath);
  listenerHits.set(key, (listenerHits.get(key) || 0) + 1);
  return key;
}

export const StartupPerf = {
  originMs,

  /** 쿼리/리스너 시작 — 반환 startMs */
  begin(label, firestorePath = '') {
    const startMs = performance.now();
    const path = safePath(firestorePath);
    startedLabels.add(label);
    if (firestorePath) recordPath(path, 'begin');
    marks.set(label, { startMs, firestorePath: path });
    return startMs;
  },

  /**
   * [Startup] 로그 1회 출력
   * @param {string} label — e.g. "auth resolved"
   */
  end(label, {
    documentCount = null,
    firestorePath = '',
    startMs = null,
    once = true,
  } = {}) {
    if (once && completedLabels.has(label)) return null;
    completedLabels.add(label);

    const tracked = marks.get(label);
    const began = startMs ?? tracked?.startMs ?? originMs;
    const endMs = performance.now();
    const durationMs = Math.round(endMs - began);
    const path = safePath(firestorePath || tracked?.firestorePath || '');
    if (path && path !== '(unknown)') recordPath(path, 'end');

    const entry = {
      label,
      durationMs,
      documentCount: documentCount == null ? null : Number(documentCount) || 0,
      firestorePath: path || '(n/a)',
      elapsedFromOriginMs: Math.round(endMs - originMs),
    };
    queryTimings.push(entry);

    console.log(`[Startup] ${label}`, {
      durationMs: entry.durationMs,
      documentCount: entry.documentCount,
      firestorePath: entry.firestorePath,
      elapsedFromOriginMs: entry.elapsedFromOriginMs,
    });
    return entry;
  },

  markListener(firestorePath) {
    const key = recordListener(firestorePath);
    const count = listenerHits.get(key) || 0;
    if (count > 1) {
      console.warn('[Startup] duplicate onSnapshot registration', {
        firestorePath: key,
        registerCount: count,
      });
    }
    return key;
  },

  markRead(firestorePath) {
    const key = recordPath(firestorePath, 'get');
    const count = pathHits.get(key) || 0;
    if (count > 1) {
      console.warn('[Startup] duplicate path read', {
        firestorePath: key.replace(/^get:/, ''),
        hitCount: count,
      });
    }
    return key;
  },

  /** 홈 데이터 준비 완료 (ingredients/public/my 등 핵심 로드 후) */
  markHomeReady(extra = {}) {
    return this.end('home data ready', {
      documentCount: extra.documentCount ?? null,
      firestorePath: extra.firestorePath || 'composite:home',
      startMs: originMs,
      once: true,
    });
  },

  getTimings() {
    return [...queryTimings].sort((a, b) => b.durationMs - a.durationMs);
  },

  getDuplicatePaths() {
    return [...pathHits.entries()]
      .filter(([, count]) => count > 1)
      .map(([path, count]) => ({
        firestorePath: path.replace(/^(begin|end|get):/, ''),
        duplicateCount: count,
      }));
  },

  getDuplicateListeners() {
    return [...listenerHits.entries()]
      .filter(([, count]) => count > 1)
      .map(([path, count]) => ({
        firestorePath: path,
        registerCount: count,
      }));
  },

  summarize() {
    const timings = this.getTimings();
    const slowest3 = timings.slice(0, 3).map((entry) => ({
      firestorePath: entry.firestorePath,
      durationMs: entry.durationMs,
      documentCount: entry.documentCount,
    }));
    const duplicateListeners = this.getDuplicateListeners();
    const duplicatePaths = this.getDuplicatePaths();
    const completed = timings.map((entry) => ({
      task: entry.label,
      durationMs: entry.durationMs,
    }));

    console.log('[Startup] summary');
    console.log('[Startup] summary · slowest3');
    console.table(slowest3.length ? slowest3 : [{ firestorePath: '(none)', durationMs: 0, documentCount: 0 }]);
    console.log('[Startup] summary · duplicateListeners');
    console.table(duplicateListeners.length
      ? duplicateListeners
      : [{ firestorePath: '(none)', registerCount: 0 }]);
    console.log('[Startup] summary · duplicatePaths');
    console.table(duplicatePaths.length
      ? duplicatePaths
      : [{ firestorePath: '(none)', duplicateCount: 0 }]);
    console.log('[Startup] summary · completed');
    console.table(completed.length ? completed : [{ task: '(none)', durationMs: 0 }]);

    return { slowest3, duplicatePaths, duplicateListeners, completed };
  },
};

if (typeof window !== 'undefined') {
  window.StartupPerf = StartupPerf;
}
