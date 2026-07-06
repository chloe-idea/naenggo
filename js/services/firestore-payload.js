/**
 * Firestore write 전 payload 정리 — undefined 제거 및 로깅
 */

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function collectUndefinedPaths(value, path = '') {
  const paths = [];
  if (value === undefined) {
    if (path) paths.push(path);
    return paths;
  }
  if (value === null || typeof value !== 'object') return paths;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      paths.push(...collectUndefinedPaths(item, `${path}[${index}]`));
    });
    return paths;
  }
  if (!isPlainObject(value)) return paths;
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (nested === undefined) paths.push(nextPath);
    else paths.push(...collectUndefinedPaths(nested, nextPath));
  }
  return paths;
}

function stripUndefinedDeep(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .map(stripUndefinedDeep)
      .filter((item) => item !== undefined);
  }
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested === undefined) continue;
    const cleaned = stripUndefinedDeep(nested);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

/** setDoc / addDoc / updateDoc 전에 undefined 필드를 제거하고 로그를 남깁니다. */
export function sanitizeFirestorePayload(payload, label = 'Firestore') {
  const undefinedPaths = collectUndefinedPaths(payload);
  if (undefinedPaths.length) {
    console.warn(`[${label}] Firestore payload에 undefined 필드가 있습니다. 저장 전 제거합니다:`, undefinedPaths);
  }
  return stripUndefinedDeep(payload);
}
