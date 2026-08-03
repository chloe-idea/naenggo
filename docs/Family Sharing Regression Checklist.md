# Family Sharing Regression Checklist

**Baseline:** `docs/family-sharing-baseline.md`  
가족 공유 관련 코드를 수정한 뒤에는 이 체크리스트를 **직접 실행**하고, 모두 통과해야 작업을 완료로 본다.  
자동화 `npm test`가 없어도 된다. 보조 안내는 `scripts/family-sharing-smoke-test.md`.

테스트 계정: Owner 1명 + Member 1명 (서로 다른 Google/Firebase 계정).

---

## A. Owner 생성 · 활성화

- [ ] **새 household 생성**  
  가족 공유 → 「가족 구성원 초대하기」→ 「✓ 현재 데이터를 가져오기」  
  → Network에 `POST /api/households` **1회**만 발생 (더블클릭해도 1회)

- [ ] **현재 데이터 가져오기**  
  `POST /api/households/migrate-copy` 성공. 개인 냉장고 데이터가 비지 않음(원본 유지).

- [ ] **activate**  
  `POST /api/households/activate` 성공. 가족 관리 화면(이름·멤버 목록) 표시.

- [ ] **owner current 확인**  
  `GET /api/households/current` → `household != null`, `role: "owner"`, `status` 개념상 active.  
  Firestore: `users/{owner}.activeHouseholdId` == 응답 `householdId`, `pendingHouseholdId` 없음.

---

## B. Invite · Join

- [ ] **invite**  
  Owner 「가족 구성원 초대하기」→ 링크·코드 표시. 기존 코드는 무효화(재발급).

- [ ] **member join**  
  Member가 코드로 참여 → 마이그레이션 선택 → activate(또는 건너뛰기) 완료.

- [ ] **owner/member householdId 동일**  
  양쪽 `GET /current`의 `householdId` 동일.  
  Firestore 양쪽 `activeHouseholdId` 동일. Member `role: "member"`, Owner `role: "owner"`.

- [ ] Member UI에 owner 전용 버튼(초대 재발급·이름 저장·구성원 제거·가족 삭제) **미표시**.

---

## C. Remove · Rejoin

- [ ] **member remove**  
  Owner가 구성원 제거 확인.

- [ ] **member active=false**  
  Firestore `households/{id}/members/{memberUid}.active === false`, `removedAt`/`removedBy` 존재.  
  Household `status`는 여전히 **active**. 하위 ingredients 등 **물리 삭제 없음**.

- [ ] **member current=null**  
  Member `GET /current` → `{ household: null }`.  
  Member `users.activeHouseholdId` 없음(또는 해당 id 아님).

- [ ] **member rejoin**  
  새 초대로 재참여 → activate → 다시 동일 `householdId`, `members.active === true`.

---

## D. Leave · 가족 삭제

- [ ] **leave** (일반 member)  
  Member 「가족 나가기」→ current null, `members.active === false`, household는 active 유지.

- [ ] Owner만 남은 상태에서 Member leave 후 Owner current는 **정상** (같은 household).

- [ ] **마지막 member leave / 가족 삭제**  
  활성 구성원이 owner 1명만일 때 「가족 삭제」(`DELETE /api/households/current`) 성공.  
  (비활성 member 문서가 남아 있어도 삭제 가능해야 함.) 삭제 후 개인 모드·「가족 만들기」 UI.  
  단독 owner가 leave를 호출해도 동일 삭제로 처리.  
  조건: 활성 멤버가 사실상 본인뿐(UI에서 삭제 버튼 노출).

- [ ] **household deleted**  
  Firestore `households/{id}.status === "deleted"`.  
  Owner `activeHouseholdId` 클리어.  
  `GET /current` → `household: null` (deleted 문서 내용을 반환하지 않음).

- [ ] **새 household 생성 가능**  
  Owner가 다시 생성·activate 가능. (create rate limit 3/60분 내로 과도 재시도하지 말 것)

---

## E. 회귀 금지 항목 (실패 시 즉시 중단)

- [ ] `GET /current`가 `status: deleted` household를 반환하지 않음
- [ ] 하드코딩 UID/householdId로 `activeHouseholdId`를 덮어쓰는 로직이 없음
- [ ] create 실패를 rate limit 상향으로 “해결”하지 않음
- [ ] remove/leave 시 다른 멤버의 공유 데이터가 사라지지 않음
- [ ] 개인 `users/{uid}/ingredients` 등이 migrate/remove로 **삭제**되지 않음

---

## 결과 기록

| 항목 | 값 |
|------|-----|
| 일시 | |
| 테스터 | |
| Owner uid | |
| Member uid | |
| householdId | |
| 결과 | PASS / FAIL |
| 실패 항목 | |
| 메모 | |
