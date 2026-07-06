/** Firestore Timestamp → ISO 문자열 */
export function timestampToIso(ts) {
  return ts?.toDate ? ts.toDate().toISOString() : '';
}

export function nowIso() {
  return new Date().toISOString();
}
