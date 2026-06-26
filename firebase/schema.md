# 냉장GO Firestore 스키마 설계

> 목표: 사용자별 데이터를 **쉽게 격리·조회·확장**하고, 커뮤니티(공개 레시피)까지 같은 구조로 커버한다.

---

## 설계 원칙

| 원칙 | 설명 |
|------|------|
| **소유권 명시** | 모든 사용자 데이터에 `ownerId`(= Firebase Auth `uid`) 필드 |
| **비공개 vs 공개 분리** | 비공개 → `users/{uid}` 하위 서브컬렉션 / 공개 → 최상위 `recipes` |
| **문서 ID = 앱 ID** | LocalStorage의 `pantry-xxx`, `recipe-xxx` ID를 Firestore 문서 ID로 재사용 (마이그레이션 용이) |
| **쿼리 패턴 우선** | 자주 쓰는 조회(월별 식사 기록, 내 냉장 재료)에 맞춰 필드·인덱스 설계 |
| **서버 전용 필드** | `freeAnalysisRemaining` 등은 **클라이언트 쓰기 금지**, Admin SDK만 차감 |

---

## 전체 구조 (권장)

```
users/{uid}                          ← 프로필 · 설정 · AI quota
  ├── fridges/{fridgeId}             ← 냉장(팬try) 메타
  │     └── items/{itemId}           ← 재료 항목
  ├── mealLogs/{logId}               ← 식사 기록
  ├── shoppingLists/{listId}         ← 장보기 목록(또는 단일 기록)
  │     └── items/{itemId}           ← (선택) 목록 내 항목
  └── favorites/{recipeId}           ← 저장한 레시피 (문서 ID = recipeId)

recipes/{recipeId}                   ← 내 레시피 + 공개 레시피 (커뮤니티)
```

### 왜 서브컬렉션 + 최상위 `recipes` 혼합?

- **비공개 데이터**(냉장, 식사, 장보기, 즐겨찾기): `users/{uid}/...` → 보안 규칙이 단순 (`request.auth.uid == uid`)
- **공개 레시피**: 최상위 `recipes` + `visibility: 'public'` → 커뮤니티 탭에서 `where('visibility','==','public')` 조회
- 요청하신 컬렉션 이름(`fridges`, `mealLogs` …)은 **논리적 이름**으로 유지하고, 물리 경로는 위 트리를 사용

---

## 1. `users/{uid}`

사용자 프로필 · 계정 메타. **문서 ID = Auth uid**.

```typescript
{
  // ── 프로필 (Auth 동기화) ──
  email: string
  displayName: string
  photoURL?: string

  // ── AI 분석 (현재 구현) ──
  freeAnalysisRemaining: number      // 초기값 5, 서버(Admin)만 차감

  // ── 설정 (향후) ──
  defaultCurrency: 'KRW' | 'USD' | ...
  defaultFridgeId?: string           // fridges 서브컬렉션 기본 냉장

  // ── 메타 ──
  createdAt: Timestamp
  updatedAt?: Timestamp
  lastLoginAt?: Timestamp
}
```

**마이그레이션 매핑**: 없음 (신규 Auth 계정 전용)

---

## 2. `users/{uid}/fridges/{fridgeId}` + `items`

LocalStorage `PantryRepository` → **냉장 1개 + 재료 items** 구조.

### `fridges/{fridgeId}` (냉장 메타)

```typescript
{
  name: string                       // 예: "우리집 냉장", "김치냉장고"
  isDefault: boolean                 // true = 메인 냉장
  ownerId: string                    // uid (규칙·쿼리용 중복)
  itemCount?: number                 // (선택) denormalized
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

> MVP: `fridgeId = 'default'` 단일 문서만 사용해도 됨.

### `fridges/{fridgeId}/items/{itemId}` (재료)

```typescript
{
  name: string
  quantity: string                   // "2", "500" (앱과 동일 — 문자열 유지)
  unit: string                       // "개", "g", "ml"
  expiryDate: string                 // "YYYY-MM-DD" | ""
  recipeId?: string | null           // 연결 레시피
  recipeName?: string
  ownerId: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

**인덱스 (items)**:
- `ownerId` + `expiryDate` — 임박 재료 조회

**LocalStorage 매핑**: `naengjanggo_v2_pantry[]` → `items` 문서들

---

## 3. `recipes/{recipeId}` (최상위)

내 레시피 · 영상 추출 레시피 · **공개 커뮤니티** 레시피.

```typescript
{
  // ── 기본 ──
  name: string
  ingredients: string[]
  optionalIngredients: string[]
  ingredientSubstitutes: string[]     // "재료 → 대체"
  steps: string[]
  cookTime: number                   // 분
  difficulty: '쉬움' | '보통' | '어려움'
  category: 'korean' | 'western' | ...

  // ── 분류 · 표시 ──
  cuisine: string
  tags: string[]
  dietTags: string[]
  dishType?: string
  image?: string                     // base64 또는 Storage URL (향후)
  thumbnailUrl?: string
  calories?: number | null
  memo?: string

  // ── 출처 ──
  source: 'user' | 'builtin' | 'video'
  sourceUrl?: string | null
  sourcePlatform?: 'youtube' | 'instagram' | 'tiktok' | null
  parentRecipeId?: string | null      // fork 원본
  createdFrom?: string | null

  // ── 소유 · 공개 ──
  authorId: string                   // uid (builtin은 'system')
  authorName: string
  visibility: 'private' | 'public'

  // ── 커뮤니티 (향후) ──
  saveCount?: number                 // denormalized (favorites 수)
  publishedAt?: Timestamp | null

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

**쿼리 패턴**:
| 용도 | 쿼리 |
|------|------|
| 내 레시피 | `where('authorId','==', uid)` |
| 공개 레시피 | `where('visibility','==','public')` + `orderBy('publishedAt','desc')` |
| 영상 레시피 | `where('authorId','==', uid).where('sourcePlatform','!=', null)` |

**인덱스**:
- `authorId` + `updatedAt desc`
- `visibility` + `publishedAt desc`
- `authorId` + `sourcePlatform` + `createdAt desc`

**LocalStorage 매핑**: `naengjanggo_v2_recipes[]`

**builtin 레시피**: Firestore에 넣지 않고 앱 번들(`BUILTIN_RECIPES`) 유지. 공개 조회 시 클라이언트 merge.

---

## 4. `users/{uid}/favorites/{recipeId}`

저장한 레시피. **문서 ID = recipeId** → `isSaved(id)` O(1) 조회.

```typescript
{
  recipeId: string                   // 문서 ID와 동일 (중복 허용 — 쿼리 편의)
  recipeName: string                 // denormalized (목록 표시용)
  authorId?: string                  // 원본 작성자
  savedAt: Timestamp
}
```

**대안 (최상위 `favorites` 컬렉션)** — 팀이 flat collection 선호 시:

```
favorites/{autoId}
  userId, recipeId, savedAt
  → 복합 unique: userId + recipeId 인덱스 필요
```

**권장**: 서브컬렉션 (`users/{uid}/favorites/{recipeId}`) — 규칙·조회 단순.

**LocalStorage 매핑**: `naengjanggo_v2_saved[]` (ID 배열)

**saveCount**: Cloud Function 또는 트랜잭션으로 `recipes/{recipeId}.saveCount` 증감 (향후).

---

## 5. `users/{uid}/mealLogs/{logId}`

식사 · 외식 · 배달 기록 (캘린더).

```typescript
{
  date: string                       // "YYYY-MM-DD"
  name: string
  mealType: 'home-cook' | 'eat-out' | 'delivery' | 'snack'
  recipeId?: string | null
  cost: number
  currency: 'KRW' | 'USD' | ...
  ingredients: string[]
  memo: string
  photo?: string                     // base64 → 향후 Storage URL
  usedExpiringIngredients: boolean
  ownerId: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

**인덱스**:
- `ownerId` + `date desc` — 월별 캘린더
- `ownerId` + `date` + `mealType` — 필터

**LocalStorage 매핑**: `naengjanggo_v2_meals[]`

---

## 6. `users/{uid}/shoppingLists/{listId}`

현재 앱은 **날짜별 장보기 기록(flat)** 구조. 확장을 위해 2단계 설계.

### Phase A (현재 앱 호환) — 기록 = list 문서 1개

`listId` = `shopping-{timestamp}` 또는 날짜 기반 ID.

```typescript
{
  date: string                       // "YYYY-MM-DD"
  amount: number
  store: string
  currency: string
  ingredients: string[]              // 구매 재료 목록
  recipeId?: string | null
  recipeName?: string
  pantryAdded: boolean               // 냉장에 반영 여부
  ownerId: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### Phase B (향후) — 진짜 "장보기 목록"

```typescript
// shoppingLists/{listId}
{
  title: string                      // "이번 주 장보기"
  status: 'active' | 'done'
  ownerId: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

// shoppingLists/{listId}/items/{itemId}
{
  name: string
  quantity: string
  unit: string
  checked: boolean
  recipeId?: string
}
```

**LocalStorage 매핑**: `naengjanggo_v2_shopping[]` → Phase A

---

## 컬렉션 이름 ↔ 물리 경로

| 논리 이름 (요청) | Firestore 경로 | 비고 |
|-----------------|----------------|------|
| `users` | `users/{uid}` | 프로필 |
| `recipes` | `recipes/{recipeId}` | 공개·비공개 모두 (visibility로 구분) |
| `fridges` | `users/{uid}/fridges/{fridgeId}` | + `items` 서브컬렉션 |
| `mealLogs` | `users/{uid}/mealLogs/{logId}` | |
| `shoppingLists` | `users/{uid}/shoppingLists/{listId}` | |
| `favorites` | `users/{uid}/favorites/{recipeId}` | |

---

## 보안 규칙 요약

```
users/{uid}           → 본인 read/write (freeAnalysisRemaining write 금지)
users/{uid}/*         → 본인만 CRUD
recipes/{id}          → public: 모두 read / private: author만 read
                        → create/update/delete: authorId == auth.uid
                        → freeAnalysisRemaining 등 서버 필드 클라이언트 수정 금지
```

상세: `firestore.rules.example`

---

## 클라이언트 Repository 마이그레이션 로드맵

```
Phase 0 (현재)  LocalStorage only + Auth + users.freeAnalysisRemaining
Phase 1         Repository interface + Firestore adapter (recipes, favorites)
Phase 2         fridges/items, mealLogs, shoppingLists
Phase 3         LocalStorage → Firestore 일회성 업로드 (로그인 시 merge)
Phase 4         Storage (사진), Cloud Functions (saveCount, 알림)
```

### Repository 인터페이스 (향후 `js/repositories/`)

```javascript
// 예: js/repositories/recipe-repository.js
export class RecipeRepository {
  constructor(adapter) { this.adapter = adapter; }  // LocalStorageAdapter | FirestoreAdapter
  async getUserRecipes(uid) { ... }
  async create(uid, data) { ... }
}
```

게스트: `LocalStorageAdapter`  
로그인: `FirestoreAdapter` (+ 선택적 LocalStorage 캐시)

---

## Firestore 인덱스 (firestore.indexes.json 요약)

```json
{
  "indexes": [
    { "collectionGroup": "mealLogs", "fields": [
      { "fieldPath": "ownerId", "order": "ASCENDING" },
      { "fieldPath": "date", "order": "DESCENDING" }
    ]},
    { "collectionGroup": "items", "fields": [
      { "fieldPath": "ownerId", "order": "ASCENDING" },
      { "fieldPath": "expiryDate", "order": "ASCENDING" }
    ]},
    { "collectionGroup": "recipes", "fields": [
      { "fieldPath": "visibility", "order": "ASCENDING" },
      { "fieldPath": "publishedAt", "order": "DESCENDING" }
    ]},
    { "collectionGroup": "recipes", "fields": [
      { "fieldPath": "authorId", "order": "ASCENDING" },
      { "fieldPath": "updatedAt", "order": "DESCENDING" }
    ]}
  ]
}
```

---

## 데이터 흐름 예시

### 로그인 후 첫 진입

```
1. Auth Google sign-in
2. users/{uid} ensure (freeAnalysisRemaining: 5)
3. fridges/default 없으면 생성
4. (Phase 3) LocalStorage 데이터 diff → Firestore upload
```

### AI 레시피 추출 (현재)

```
Client → POST /api/extract-* + Bearer token
Server → verify token → users/{uid}.freeAnalysisRemaining 차감 (Admin)
Client → Firestore users/{uid} read → UI 표시
```

### 레시피 저장 (향후)

```
Client → recipes/{newId} create (authorId: uid, visibility: private)
Client → users/{uid}/favorites/{recipeId} set (optional, "저장" 시)
```

---

## FAQ

**Q. 왜 mealLogs를 최상위가 아닌 서브컬렉션?**  
A. 사용자별 격리·보안 규칙·비용(쿼리 스코프)에 유리. 관리자 대시보드가 필요하면 BigQuery export.

**Q. recipes를 users 아래에 두면?**  
A. `where('visibility','==','public')` 커뮤니티 쿼리가 collection group index로 가능하지만, 최상위가 더 단순.

**Q. 게스트 데이터는?**  
A. LocalStorage 유지. 로그인 시 merge 정책: `updatedAt` 최신 wins.

**Q. freeAnalysisRemaining을 users에 두는 이유?**  
A. 이미 구현됨. 향후 `users/{uid}/usage/ai` 서브컬렉션으로 이력 분리 가능.
