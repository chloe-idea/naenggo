# Family Sharing Baseline

이 문서는 **현재 정상 동작 중인 가족 공유**를 기준(Baseline)으로 고정한다.  
기능 변경 PR은 이 문서의 흐름·Firestore 상태·Invariant와 `docs/Family Sharing Regression Checklist.md`를 통과해야 완료로 본다.

관련 코드 (참고만, 이 문서만으로 회귀 판단):

| 영역 | 경로 |
|------|------|
| API 서비스 | `server/lib/household-service.js` |
| **공통 API dispatcher** | `server/lib/household-api-handler.js` |
| Express | `server/routes/households.js` |
| Vercel (non-Next) | `api/households/current.js`, `api/households/index.js`, `api/household-api.js` + `vercel.json` rewrites — **`[...route]` catch-all 사용 금지**, `api/` 아래 `_helper` 파일 금지 |
| 클라이언트 | `js/services/family-sharing-service.js`, `js/firebase-bootstrap.js` |
| 계약 테스트 | `node scripts/test-household-api-contract.mjs` |

> household API 변경 시 Express와 Vercel 진입점을 **모두** 검증한다. localhost 성공만으로 완료 처리하지 않는다.  
> production 확인: 응답 헤더 `X-Household-Handler`, `X-Deploy-Commit` (예: `current-v3`).

---

## 1. 전체 흐름

### 1.1 Owner: household 생성 → 데이터 가져오기 → activate

UI는 「가족 구성원 초대하기」에서 **즉시 생성하지 않는다.**  
「현재 데이터를 가져오기」/「빈 가족 냉장고로 시작」 클릭 시점에 생성한다.

```
[start] 가족 공유 모달
   → create-choice (마이그레이션 선택 화면)
   → POST /api/households                    (create)
   → POST /api/households/migrate-copy       (copy 선택 시)
   → POST /api/households/activate           (copy | empty)
   → GET  /api/households/current            (activate 후 refresh)
```

| 단계 | API | 담당 |
|------|-----|------|
| 생성 | `POST /api/households` | `createHousehold` |
| 현재 데이터 가져오기 | `POST /api/households/migrate-copy` | `copyPersonalDataToHousehold` |
| 활성화 | `POST /api/households/activate` | `activateHousehold` |
| 현재 가족 조회 | `GET /api/households/current` | `getCurrentHousehold` |

**Rate limit (유지):** `create:user` 3회/60분, `create:ip` 10회/60분.  
GET `/current`는 create bucket과 **공유하지 않는다.**

### 1.2 Invite

활성화된 owner만 초대 재발급:

```
POST /api/households/invites  { action: "reissue", householdId, ... }
```

- 기존 활성 초대는 revoke
- link + code 시크릿을 새로 발급
- UI: 「가족 구성원 초대하기」(관리 화면)

### 1.3 Join

```
POST /api/households/join  { kind: "code"|"link", secret }
→ (구성원) migrate-copy 선택 가능
→ POST /api/households/activate
```

- 신규: `members/{uid}` create, `role: member`, `active: true`
- 재참여(이전 `active: false`): 같은 member 문서 재활성화
- join 직후: `users/{uid}.pendingHouseholdId` = 해당 householdId (`activeHouseholdId`는 activate 때 설정)

### 1.4 Remove member (owner)

```
DELETE /api/households/members/:uid?householdId=...
```

순서 (`deactivateHouseholdMember`):

1. 대상이 active member인지 검증 (owner 본인/owner role 제거 불가)
2. 공유 데이터 → 개인 경로로 **복사** (household 원본 유지, 개인 기존 문서는 skip)
3. 대상 `activeHouseholdId`/`pendingHouseholdId`가 해당 household면 필드 삭제
4. `members/{uid}`: `active: false`, `removedAt`, `removedBy`, `removedReason`
5. **household 문서는 수정하지 않음** (status 유지 `active`)

### 1.5 Leave household (일반 member)

```
POST /api/households/leave  { householdId }
```

- owner는 leave 불가 → 소유권 이전 또는 가족 삭제
- member는 remove와 동일하게 soft-deactivate (`removedReason: "left"`)
- household는 **유지**

### 1.6 마지막 구성원 삭제 / household soft delete

일반 member leave ≠ household 삭제.

**혼자 남은 owner**가 가족을 끝낼 때:

```
DELETE /api/households/current?householdId=...
→ deleteLastOwnerHousehold
```

조건: `members` 컬렉션 문서가 **정확히 1개**(본인).  
동작:

- 활성 invite revoke
- `households/{id}.status = "deleted"`, `deletedAt`, `deletedBy`
- owner `members/{uid}` **문서 삭제** (soft-deactivate가 아님)
- `users/{uid}` household setup 필드 clear (`activeHouseholdId` 등)

> Invariant 문구의 “마지막 member leave → deleted”는 이 앱에서는 **마지막 owner의 가족 삭제(delete)** 경로로 구현되어 있다. owner는 leave API를 쓸 수 없다.

### 1.7 Soft delete (운영/중복 정리)

중복 household 정리 시 하위 데이터는 **물리 삭제하지 않는다.**

권장 메타:

- `status: "deleted"`
- `deletedAt`, `deletedBy`
- `deletionReason` (예: `duplicate_household_created_during_repair_bug`)
- `duplicateOf` (남길 householdId)

`status === "deleted"` 인 household는 `GET /current`에 **절대 반환되지 않는다.**

---

## 2. 단계별 필수 Firestore 상태

범례: `—` = 해당 단계와 무관 / 변경 없음. `∅` = 필드 없음 또는 delete.

### 2.1 Create (`POST /households`)

| 경로 | 필드 | 값 |
|------|------|-----|
| `users/{ownerUid}` | `pendingHouseholdId` | 새 `householdId` |
| `users/{ownerUid}` | `activeHouseholdId` | ∅ (아직 설정 안 함) |
| `households/{id}` | `status` | `active` |
| `households/{id}` | `ownerId` | `ownerUid` |
| `members/{ownerUid}` | `role` | `owner` |
| `members/{ownerUid}` | `active` | 없거나 `true` (레거시 허용) |

### 2.2 Migrate-copy

| 경로 | 필드 | 값 |
|------|------|-----|
| `users/{uid}` | pointers | create/join 직후와 동일 (pending 유지) |
| `households/{id}/…` | ingredients 등 | 개인 → 가족 **복사** (개인 원본 유지) |
| `members/{uid}` | `migrationCopyCompletedAt` | 설정됨 |
| `members/{uid}` | `lastMigrationCopiedCount` / `SkippedCount` | 기록 |

### 2.3 Activate

| 경로 | 필드 | 값 |
|------|------|-----|
| `users/{uid}` | `activeHouseholdId` | 해당 `householdId` |
| `users/{uid}` | `pendingHouseholdId` | ∅ |
| `households/{id}` | `status` | `active` |
| `members/{uid}` | `migrationChoiceCompletedAt` | 설정됨 |
| `members/{uid}` | `migrationMode` | `copy` \| `empty` |

### 2.4 Invite (reissue)

| 경로 | 필드 | 값 |
|------|------|-----|
| `householdInvites/*` (기존) | `active` | `false`, `revokedAt` |
| `householdInvites/*` (신규) | `householdId`, `active: true`, `useCount: 0` | |
| users / household / members | — | 변경 없음 |

### 2.5 Join (구성원)

| 경로 | 필드 | 값 |
|------|------|-----|
| `users/{memberUid}` | `pendingHouseholdId` | owner의 `householdId` |
| `users/{memberUid}` | `activeHouseholdId` | ∅ until activate |
| `households/{id}` | `status` | `active` |
| `members/{memberUid}` | `role` | `member` |
| `members/{memberUid}` | `active` | `true` |
| invite | `useCount` | +1 |

구성원 activate 후: owner와 **동일한** `activeHouseholdId`.

### 2.6 Remove member / Leave (member)

| 경로 | 필드 | 값 |
|------|------|-----|
| `users/{memberUid}` | `activeHouseholdId` | 해당 id였으면 ∅ |
| `users/{memberUid}` | `pendingHouseholdId` | 해당 id였으면 ∅ |
| `households/{id}` | `status` | **`active` 유지** |
| `households/{id}` | `ownerId` | 변경 없음 |
| `members/{memberUid}` | `active` | `false` |
| `members/{memberUid}` | `removedAt` / `removedBy` / `removedReason` | 기록 |
| owner `users` / `members` | — | 변경 없음 |
| 하위 공유 컬렉션 | — | **물리 삭제 없음** |

### 2.7 Delete last owner household

| 경로 | 필드 | 값 |
|------|------|-----|
| `users/{ownerUid}` | `activeHouseholdId` / `pendingHouseholdId` | ∅ |
| `households/{id}` | `status` | `deleted` |
| `households/{id}` | `deletedAt` / `deletedBy` | 설정 |
| `members/{ownerUid}` | 문서 | **삭제** |
| 하위 공유 컬렉션 | — | 물리 삭제 없음 (orphan 허용) |
| invites | `active` | false |

### 2.8 GET `/api/households/current` 판정 요약

유효 current = 모두 만족:

1. `users.activeHouseholdId` 또는 유효 `pendingHouseholdId`가 가리키는 문서 존재
2. `household.status !== "deleted"` (없거나 `active`면 OK)
3. `members/{uid}` 존재
4. `members.active !== false` (필드 없음 = 레거시 active)

아니면 HTTP 200 + `{ household: null }` (또는 pending/active 없음).  
**deleted household / inactive member는 household 객체를 반환하지 않는다.**

---

## 3. Invariants (절대 깨지면 안 됨)

1. **동일 가족 활성 구성원**은 같은 `users/{uid}.activeHouseholdId`를 가진다 (activate 완료 후).
2. `activeHouseholdId`가 가리키는 household에 대해 **active membership** (`members/{uid}` 존재, `active !== false`)이 있어야 한다. 없으면 stale → cleanup 후 current는 null.
3. `status === "deleted"` household는 `GET /current`에서 **절대 반환되지 않는다.**
4. `members.active === false`인 사용자는 해당 household를 current로 받으면 안 된다 → **`household: null`** (포인터도 정리되어야 함).
5. Owner는 `leave`로 빠져나갈 수 없다. 단독 owner 종료는 **`DELETE /current`** → `household.status = deleted`.
6. Member remove/leave 시 household `status`는 **active로 유지**하고, 다른 멤버·공유 하위 데이터는 유지한다.
7. 개인 `users/{uid}/…` 원본은 migrate-copy / remove 복구 과정에서 **삭제하지 않는다** (복사·merge만).
8. `GET /current`는 새 household를 **자동 생성하지 않는다.** 하드코딩 UID/householdId로 `activeHouseholdId`를 덮어쓰지 않는다.
9. Create rate limit (`create:user` 3/60m)은 유지한다. limit을 “고치기” 위해 올리거나 제거하지 않는다 (클라이언트 중복·버그 수정이 우선).
10. Pending 중(`pendingHouseholdId`만 있음)에는 Firestore 생활 데이터 scope는 **개인**을 유지한다 (`activeHouseholdId` 설정 전).

---

## 4. Baseline 스냅샷 (참고)

문서 작성 시점의 정상 연결 예 (운영 값은 변할 수 있음):

- 활성 연결 예: owner/member가 동일 `activeHouseholdId`로 `GET /current` 성공
- Soft-deleted 중복본은 `deletionReason` / `duplicateOf` 메타만 두고 하위 컬렉션 보존

회귀 시 이 문서 + 체크리스트로 “이전과 같은 계약인지”를 판단한다.
