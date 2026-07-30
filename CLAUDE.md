# CLAUDE.md

## Family Sharing Baseline (필수)

현재 가족 공유는 **정상 Baseline**이다. 관련 작업 시 기능을 “개선”하기 전에 계약을 깨지 않는지 확인한다.

### 문서

| 문서 | 용도 |
|------|------|
| `docs/family-sharing-baseline.md` | 전체 흐름, 단계별 Firestore 상태, Invariants |
| `docs/Family Sharing Regression Checklist.md` | 수동 회귀 체크리스트 (완료 판정 기준) |
| `scripts/family-sharing-smoke-test.md` | 짧은 smoke 절차 (`npm test` 불필요) |

### 규칙

1. `family-sharing` / `household` / `FamilySharingService` / `household-service` / `api/households` 를 수정하면 **반드시** `docs/Family Sharing Regression Checklist.md`를 실행한다.
2. 체크리스트를 통과하기 전에는 해당 작업을 **완료로 판단하지 않는다.**
3. 코드만 바꾸고 체크리스트를 생략하지 않는다. `npm test`가 없어도 체크리스트·smoke 문서로 대체한다.
4. Invariant를 깨는 변경(예: deleted household를 current에 반환, 하드코딩 UID로 `activeHouseholdId` 강제, remove 시 household soft-delete, create rate limit 제거/상향으로 증상 회피)은 Baseline 위반이다.
5. 새 household 자동 생성, 공유/개인 데이터 물리 삭제, 진단 중 생성 버튼 자동 재실행은 하지 않는다.
6. **household API를 수정할 때 Express(`server/routes/households.js`)와 Vercel 명시적 엔트리(`api/households/current.js`, `index.js`, `migrate-copy.js` 등)를 모두 검증해야 하며, localhost 성공만으로 완료 처리하지 않는다.** non-Next Vercel에서는 `[...route]` catch-all을 쓰지 않는다. 라우팅·응답은 `server/lib/household-api-handler.js` 공통 dispatcher를 유지하고 `node scripts/test-household-api-contract.mjs`를 통과시킨다. 배포 후 production에서 `X-Household-Handler` / `X-Deploy-Commit` 헤더로 새 함수 실행을 확인한다.

### 관련 파일 (수정 시 체크리스트 필수)

- `server/lib/household-service.js`
- `server/lib/household-api-handler.js`
- `server/routes/households.js`
- `api/households/current.js` 및 `api/households/*.js` 명시적 엔트리
- `api/households/_vercel-entry.js`
- `js/services/family-sharing-service.js`
- `js/firebase-bootstrap.js` (가족 공유 UI 바인딩)
- Firestore rules 중 household/members 관련 부분
