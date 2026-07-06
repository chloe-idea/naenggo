/**
 * naengjanggo_v2_pantry localStorage → Firestore users/{uid}/ingredients 일회성 마이그레이션
 * 마이그레이션 후 localStorage 키는 제거합니다.
 */
import { getDocs } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

export const PANTRY_LOCAL_STORAGE_KEYS = [
  'naengjanggo_v2_pantry',
  'naengjanggo_pantry_ingredients',
];

export function readLegacyPantryFromLocalStorage() {
  const items = [];
  for (const key of PANTRY_LOCAL_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        if (typeof entry === 'string') {
          items.push({ name: entry, quantity: '', unit: '', expiryDate: '' });
        } else if (entry && typeof entry === 'object') {
          items.push({
            name: entry.name || '',
            quantity: entry.quantity || '',
            unit: entry.unit || '',
            expiryDate: entry.expiryDate || '',
          });
        }
      }
    } catch (err) {
      console.warn('[PantryMigration] legacy read failed:', key, err);
    }
  }
  return items.filter((item) => String(item.name || '').trim());
}

export async function migrateLegacyPantryToFirestore(FirestoreIngredientService, uid) {
  if (!uid || !FirestoreIngredientService) return { migrated: 0, purged: false };

  const legacyItems = readLegacyPantryFromLocalStorage();
  if (!legacyItems.length) {
    return { migrated: 0, purged: false };
  }

  const col = FirestoreIngredientService.ingredientsCollectionRef?.(uid);
  if (!col) {
    console.warn('[PantryMigration] Firestore collection unavailable');
    return { migrated: 0, purged: false };
  }

  let existingCount = 0;
  try {
    const snap = await getDocs(col);
    existingCount = snap.size;
  } catch (err) {
    console.error('[PantryMigration] getDocs failed:', err);
    return { migrated: 0, purged: false };
  }

  if (existingCount > 0) {
    console.log('[PantryMigration] Firestore already has ingredients — skip migration');
    return { migrated: 0, purged: false };
  }

  let migrated = 0;
  console.log('[PantryMigration] migrating', legacyItems.length, 'items to users/' + uid + '/ingredients');
  for (const item of legacyItems) {
    try {
      await FirestoreIngredientService.addIngredient(item);
      migrated += 1;
    } catch (err) {
      console.error('[PantryMigration] addIngredient failed:', item.name, err);
    }
  }

  console.log('[PantryMigration] complete, migrated:', migrated);
  for (const key of PANTRY_LOCAL_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  return { migrated, purged: migrated > 0 };
}
