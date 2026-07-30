# Family Sharing Smoke Test

`npm test` 없이 사람이 Network 탭 + Firestore 콘솔(또는 Admin)로 확인하는 짧은 절차다.  
전체 합격 기준은 `docs/Family Sharing Regression Checklist.md`.  
계약·Invariant는 `docs/family-sharing-baseline.md`.

## 준비

1. 로컬 또는 스테이징 앱 로그인 (Owner / Member 두 계정)
2. DevTools → Network, filter: `households`
3. (선택) Firebase Console → Firestore

## Smoke (최소 15분)

### 1) Owner happy path

1. 프로필 → 가족 공유 → 가족 구성원 초대하기 → **현재 데이터를 가져오기**
2. 확인:
   - `POST /api/households` × 1
   - `POST /api/households/migrate-copy` × 1
   - `POST /api/households/activate` × 1
   - `GET /api/households/current` → `household.role === "owner"`
3. Firestore: `users/{owner}.activeHouseholdId` == current의 `householdId`

### 2) Invite + Join

1. Owner: 초대 재발급 → 코드 복사
2. Member: 참여 → 데이터 가져오기 또는 건너뛰기 → activate
3. 양쪽 current `householdId` 동일, member `role === "member"`

### 3) Remove

1. Owner: 구성원 제거
2. Member current → `household: null`
3. Firestore member doc: `active: false` (문서 삭제 아님)
4. Household `status: active`, ingredients count 유지

### 4) Soft-delete family (solo owner)

1. Owner만 남은 뒤 「가족 삭제」
2. `DELETE /api/households/current` 성공
3. Household `status: deleted`
4. Owner current → `household: null`
5. deleted household의 하위 컬렉션은 남아 있어도 OK (물리 삭제 의무 없음)

### 5) 재생성

1. Owner가 새 가족 생성·activate 가능하면 PASS  
2. `RATE_LIMITED`(3/60m)면 시간 경과 후 재시도 — limit을 올리지 말 것

## 빠른 실패 신호

| 증상 | 의심 |
|------|------|
| create가 연달아 여러 번 | in-flight/버튼 가드 또는 성공 후 포인터가 풀려 재시도 |
| activate 직후 current null | stale cleanup / deleted 포인터 / inactive member |
| remove 후 member가 계속 가족 화면 | `activeHouseholdId` 미제거 또는 current가 active 미검사 |
| deleted household가 current에 나옴 | `isHouseholdActiveDoc` / current 최종 검증 회귀 |

## 스크립트 메모

별도 `node` smoke runner는 의도적으로 두지 않았다.  
라이브에 쓰기 테스트 household를 자동 생성하면 Baseline을 오염시킨다.  
필요 시 **읽기 전용** 진단만 Admin으로 수행하고, 쓰기는 체크리스트 UI 경로만 사용한다.
