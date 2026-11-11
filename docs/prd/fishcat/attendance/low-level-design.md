# 출석 보상 LLD

상태: 구현 명세, 미구현. 작성일: 2026-11-12. GROMO-2858. 규칙의 정본은 [정책](policy.md), 구조는 [HLD](high-level-design.md)다. 이 문서는 기준 코드 main `d6c41f4dd` 를 읽고 썼다. 「신설」 표시가 없는 경로는 그 커밋에 있다.

## 1. 파일 배치

| 서비스 | 경로 | 내용 |
| --- | --- | --- |
| Data | `server/data-api/src/main/resources/db/v0/V16__attendance.sql` (신설) | §3 테이블 6개와 기본 표 시드 |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/attendance/` (신설) | 도메인 L8: `repository/domain/` 엔티티, `repository/` 리포지토리, `support/` 순수 규칙, `exception/AttendanceErrorCode` |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/internal/` (신설 파일) | `InternalAttendanceController`(사용자), `InternalAttendanceAdminController`(운영자), `service/AttendanceClaimService`·`AttendanceReadService`·`AttendanceScheduleAdminService`·`AttendanceStatsService` |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/construction/repository/domain/IslandWalletTransactionType.java` | `ATTENDANCE(true)` 추가 |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/construction/service/IslandWalletService.java` | `creditAttendance` 추가(§6) |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/withdrawal/service/AccountWithdrawalService.java` | 출석 3표 삭제 한 줄(§12) |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/config/InternalAuthFilter.java` | 운영자 경로 접두사 `/internal/admin/attendance/` |
| Data | `server/data-api/src/main/resources/application-satellites.yml` | business·console-member-1~3 allowlist(§5) |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/internal/InternalContentAdminController.java` | capability `attendance.schedule.v1`·`attendance.stats.v1` |
| Business | `server/business-api/src/main/java/com/oneorthree/business/api/AttendanceController.java` (신설) | `/me/attendance` 3개 |
| Business | `server/business-api/src/main/java/com/oneorthree/business/usecase/AttendanceUseCase.java` (신설) | Data 호출, 이미지 URL 조립 |
| Business | `server/business-api/src/main/java/com/oneorthree/business/upstream/data/DataAttendanceClient.java` (신설) | `/internal/users/{userId}/attendance/**` |
| Business | `server/business-api/src/main/java/com/oneorthree/business/common/api/ApiErrorCode.java` | 출석 오류 3개 등록(§4). 등록하지 않으면 공개 응답이 502 가 된다 |
| 백오피스 | `backoffice/server/attendance.mjs`·`local-attendance.mjs` (신설) | 2인 흐름 store, 로컬 모드 흉내 |
| 백오피스 | `backoffice/server/upstream.mjs`·`app.mjs`·`contract.json` | 호출·라우트·필수 capability |
| 백오피스 | `backoffice/src/AttendanceRewards.tsx`·`AttendanceStats.tsx` (신설), `backoffice/src/App.tsx` | 화면 두 개, 사이드바 |
| 앱 | `app/app-dev/src/services/api/attendance.ts`·`services/attendance.ts` (신설) | API 호출, 기기 기억 |
| 앱 | `app/app-dev/src/screens/attendance/` (신설) | `AttendanceBoard.tsx`·`useAttendance.ts`·`AttendanceIcon.tsx` |
| 앱 | `app/app-dev/src/App.tsx`, `app/app-dev/src/i18n/locales/ko.json`·`en.json` | 팝업 장착, 문구 |
| 앱 | `app/app-dev/src/screens/letter/useDeveloperLetter.ts`·`useForceUpdateLetter.ts` | 조회 완료 `settled` 를 함께 돌려준다(§11.2) |
| 문서 | `docs/conventions/backend-layering.md` §4, `server/data-api/docs/db/schema.dbml`, `CONTEXT.md` | 층 표에 `attendance`, 스키마, 용어 「출석」·「출석판」 |

`server/business-api/src/main/java/com/oneorthree/business/common/api/PublicApiRoutes.java` 는 이미 `/me/**` 를 성공 봉투로 감싸므로 바꾸지 않는다.

## 2. 도메인 배치와 층

- `attendance` 를 **L8** 에 둔다(`docs/conventions/backend-layering.md` §4 표와 `server/data-api/src/test/java/com/oneorthree/phone/architecture/DomainLayerRulesTest.java` 의 `LAYERS` 에 함께 추가). 잡지(`magazine`, L8)처럼 엔티티·리포지토리·순수 규칙만 둔다.
- `attendance` 가 아래로 참조하는 것: `ranking`(L4)의 `RankingWeek`, `user`(L0). 섬 통장(`construction`, L6)·보유품(`appearance`, L7)·멤버십(`group`, L5)을 함께 쓰는 조합은 L10 `internal` 의 서비스가 한다.
- 탈퇴(`withdrawal`, L9)가 `attendance`(L8) 리포지토리를 부른다. 아래 방향이라 허용된다.

`support/` 의 순수 규칙:

| 클래스 | 하는 일 |
| --- | --- |
| `AttendanceDay` | `today(Instant)` = UTC 날짜, `nextDayAt(Instant)` = 다음 UTC 자정. 주 계산은 `RankingWeek.weekStart`·`RankingWeek.endInstant` 에 맡긴다 |
| `AttendanceSlots` | 이번 주 출석 수 → 다음 칸 번호(1~7, 7 을 넘으면 없음) |
| `AttendanceScheduleResolver` | (주 시작일, 주간 표 최신 발행본, 기본 표 최신 발행본) → 적용할 개정 |
| `AttendanceScheduleDigest` | 표 정규 문자열과 SHA-256(§8.3). 백오피스 BFF 와 같은 결과를 낸다 |

## 3. 저장 모델 — V16

최신이 `V15__developer_notice_target_platform.sql` 이라 다음은 V16 이다. push 직전에 `origin/main` 의 최신 번호를 다시 보고, 겹치면 번호와 관련 시험·`schema.dbml` 을 함께 바꾼다.

```sql
-- 출석 보상 (GROMO-2855). 정책 docs/prd/fishcat/attendance/policy.md.

-- 백오피스 승인 영수증. 꾸미기 추첨 풀(V12)과 같은 모양이다.
CREATE TABLE attendance_schedule_approvals (
    approval_id uuid PRIMARY KEY,
    scope varchar(10) NOT NULL CHECK (scope IN ('DEFAULT', 'WEEK')),
    week_start date,
    expected_revision integer NOT NULL CHECK (expected_revision >= 0),
    slots jsonb NOT NULL,                 -- 승인 때 정한 7칸 정규형(§8.3)
    approved_digest char(64) NOT NULL,
    request_digest char(64) NOT NULL,
    approved_by varchar(30) NOT NULL,
    approved_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    revoked_by varchar(30),
    CONSTRAINT attendance_approval_scope_ck CHECK ((scope = 'DEFAULT') = (week_start IS NULL)),
    CONSTRAINT attendance_approval_revocation_ck CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

-- 발행된 표 개정. 고치지 않고 새 행만 더한다. 발행 ID 가 곧 개정 ID 다.
CREATE TABLE attendance_schedule_revisions (
    revision_id uuid PRIMARY KEY,
    scope varchar(10) NOT NULL CHECK (scope IN ('DEFAULT', 'WEEK')),
    week_start date,                      -- WEEK 만. UTC 일요일
    revision integer NOT NULL CHECK (revision >= 1),
    approval_id uuid UNIQUE REFERENCES attendance_schedule_approvals(approval_id),
    digest char(64),
    approved_by varchar(30),
    published_by varchar(30) NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendance_revision_scope_ck CHECK ((scope = 'DEFAULT') = (week_start IS NULL)),
    CONSTRAINT attendance_revision_sunday_ck CHECK (week_start IS NULL OR EXTRACT(ISODOW FROM week_start) = 7),
    -- 시드 행만 승인 없이 있다
    CONSTRAINT attendance_revision_seed_ck CHECK (
        (approval_id IS NULL AND digest IS NULL AND approved_by IS NULL AND published_by = 'migration')
        OR (approval_id IS NOT NULL AND digest IS NOT NULL AND approved_by IS NOT NULL
            AND approved_by <> published_by))
);
CREATE UNIQUE INDEX uq_attendance_revision_default ON attendance_schedule_revisions (revision)
    WHERE scope = 'DEFAULT';
CREATE UNIQUE INDEX uq_attendance_revision_week ON attendance_schedule_revisions (week_start, revision)
    WHERE scope = 'WEEK';

CREATE TABLE attendance_schedule_slots (
    revision_id uuid NOT NULL REFERENCES attendance_schedule_revisions(revision_id),
    slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 7),
    reward_type varchar(10) NOT NULL CHECK (reward_type IN ('FISH', 'ITEM')),
    fish_amount integer CHECK (fish_amount BETWEEN 1 AND 100),
    product_id varchar(80) REFERENCES catalog_assets(product_id),
    fallback_fish_amount integer CHECK (fallback_fish_amount BETWEEN 1 AND 100),
    PRIMARY KEY (revision_id, slot),
    CONSTRAINT attendance_slot_shape_ck CHECK (
        (reward_type = 'FISH' AND fish_amount IS NOT NULL AND product_id IS NULL AND fallback_fish_amount IS NULL)
        OR (reward_type = 'ITEM' AND fish_amount IS NULL AND product_id IS NOT NULL
            AND fallback_fish_amount IS NOT NULL))
);

-- 출석 한 번 = 한 행. 받은 보상의 사본을 같이 둔다(정책 AT12).
CREATE TABLE attendance_claims (
    claim_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    claimed_on date NOT NULL,             -- UTC 날짜
    week_start date NOT NULL,
    slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 7),
    revision_id uuid NOT NULL REFERENCES attendance_schedule_revisions(revision_id),
    reward_type varchar(10) NOT NULL CHECK (reward_type IN ('FISH', 'ITEM')),
    product_id varchar(80),
    fallback_fish_amount integer,
    item_outcome varchar(20) CHECK (item_outcome IN ('GRANTED', 'ALREADY_OWNED', 'UNAVAILABLE')),
    today_fish integer NOT NULL CHECK (today_fish BETWEEN 0 AND 100),
    fish_delivery varchar(10) NOT NULL CHECK (fish_delivery IN ('NONE', 'CREDITED', 'HELD')),
    released_hold_fish integer NOT NULL DEFAULT 0 CHECK (released_hold_fish >= 0),
    island_id uuid,                       -- 적립한 섬. CREDITED 이거나 보관분을 꺼냈을 때만
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_attendance_claim_day UNIQUE (user_id, claimed_on),
    CONSTRAINT uq_attendance_claim_slot UNIQUE (user_id, week_start, slot),
    CONSTRAINT attendance_claim_week_ck CHECK (claimed_on >= week_start AND claimed_on < week_start + 7),
    CONSTRAINT attendance_claim_item_ck CHECK ((reward_type = 'ITEM') = (item_outcome IS NOT NULL)),
    CONSTRAINT attendance_claim_delivery_ck CHECK ((fish_delivery = 'NONE') = (today_fish = 0)),
    CONSTRAINT attendance_claim_island_ck CHECK (
        (island_id IS NOT NULL) = (fish_delivery = 'CREDITED' OR released_hold_fish > 0))
);
CREATE INDEX ix_attendance_claims_week ON attendance_claims (week_start, slot);

-- 현재 섬이 없을 때 받은 물고기(정책 AT08). 출석 한 번에 최대 한 행.
CREATE TABLE attendance_fish_holds (
    claim_id uuid PRIMARY KEY REFERENCES attendance_claims(claim_id),
    user_id uuid NOT NULL REFERENCES users(id),
    amount integer NOT NULL CHECK (amount BETWEEN 1 AND 100),
    released_claim_id uuid REFERENCES attendance_claims(claim_id),
    released_at timestamptz,
    CONSTRAINT attendance_hold_release_ck CHECK ((released_at IS NULL) = (released_claim_id IS NULL))
);
CREATE INDEX ix_attendance_holds_open ON attendance_fish_holds (user_id) WHERE released_at IS NULL;

-- 출석판 노출(정책 AT15). 계정·UTC 날짜마다 한 행.
CREATE TABLE attendance_views (
    user_id uuid NOT NULL REFERENCES users(id),
    viewed_on date NOT NULL,
    first_viewed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, viewed_on)
);

-- 기본 표 시드(정책 ATQ01 제안값). 운영자가 백오피스에서 새 개정으로 바꾼다.
INSERT INTO attendance_schedule_revisions (revision_id, scope, week_start, revision, published_by)
VALUES ('01936f00-0000-7000-8000-000000000016', 'DEFAULT', NULL, 1, 'migration');
INSERT INTO attendance_schedule_slots (revision_id, slot, reward_type, fish_amount)
SELECT '01936f00-0000-7000-8000-000000000016', s, 'FISH', a
FROM (VALUES (1, 10), (2, 10), (3, 15), (4, 15), (5, 20), (6, 20), (7, 30)) AS v(s, a);
```

- 시드 행의 UUID 는 고정 값이다. 같은 마이그레이션을 dev·운영에 돌려도 같은 행이 생긴다.
- 운영자 이름 열(`approved_by`·`published_by`)에는 `member-1`~`member-3` 같은 콘솔 actor 만 들어간다. 사용자 개인정보는 없다.
- 섬 통장 원장(`island_wallet_transactions.type`)은 varchar(40) 이고 CHECK 가 없어 새 사유에 마이그레이션이 필요 없다.

V16 과 함께 바꿀 고정값 자리(2026-11-09 꾸미기 지급 배치에서 확인한 목록):

| 파일 | 바꿀 것 |
| --- | --- |
| `server/data-api/docs/db/test-deploy-v0.py` | 마이그레이션 체인에 V16 |
| `server/data-api/src/test/java/com/oneorthree/phone/common/db/DeploymentMigrationMainTest.java` | 체인, 실행 건수 |
| `server/data-api/src/test/java/com/oneorthree/phone/db/V0BaselineMigrationTest.java` | 체인, public 테이블 수(+6) |
| `server/data-api/src/test/java/com/oneorthree/phone/db/V0DefaultSeedTest.java` | 체인, 기본 표 시드 행 |
| `server/data-api/docs/db/schema.dbml` | 테이블 6개 |
| `.github/scripts/apidog-merge.py` `DOMAINS` | 새 컨트롤러 태그(Data 2개, Business 1개) |
| `server/data-api/src/test/java/com/oneorthree/phone/internal/ContentEnvironmentTest.java` | capability 목록 |

## 4. 공개 API (Business)

세 경로 모두 앱 액세스 토큰이 필요하다. 성공은 `{"data": …}` 로 감싼다. 실패는 공개 봉투 `{"error": {code, message, field, retryable}, "requestId"}` 이고 `code` 는 Data 의 도메인 코드를 그대로 싣는다([오류 계약](../../../conventions/error-contract.md)).

### GET `/me/attendance`

```json
{
  "data": {
    "today": "2026-11-12",
    "weekStart": "2026-11-08",
    "nextDayAt": "2026-11-13T00:00:00Z",
    "nextWeekAt": "2026-11-15T00:00:00Z",
    "attendedToday": false,
    "viewedToday": false,
    "claimedCount": 2,
    "heldFish": 20,
    "slots": [
      { "slot": 1, "status": "CLAIMED",
        "reward": { "type": "FISH", "fishAmount": 10 },
        "received": { "itemOutcome": null, "fish": 10, "fishDelivery": "CREDITED" } },
      { "slot": 3, "status": "NEXT",
        "reward": { "type": "ITEM", "fallbackFishAmount": 30,
                    "product": { "productId": "cust.neck.red-scarf", "title": "빨간 목도리",
                                 "imageUrl": "https://catus-api-v2.oneorthree.world/static/customization/neck/red-scarf.ab12cd34.png" } } },
      { "slot": 4, "status": "LOCKED", "reward": { "type": "FISH", "fishAmount": 15 } }
    ]
  }
}
```

- `slots` 는 늘 7개다. `status` 는 `CLAIMED`(받음) · `NEXT`(다음에 받을 칸) · `LOCKED`(그 뒤). 7칸을 다 받았으면 `NEXT` 가 없다.
- `CLAIMED` 칸의 `reward` 는 받을 때의 사본이고 `received` 가 실제 결과다. 나머지 칸의 `reward` 는 지금 적용되는 개정에서 읽는다.
- `attendedToday=true` 면 `NEXT` 칸이 있어도 오늘은 청구할 수 없다. 앱은 `nextDayAt` 을 기기 시간대로 바꿔 보여 준다.
- `imageUrl` 은 Business 가 Data 의 상대 경로 `imagePath` 앞에 `app.static-base-url` 을 붙여 만든다. `CustomizationCatalogUseCase` 와 같은 방식이다.

### POST `/me/attendance/claims`

헤더 `Idempotency-Key`(UUID) 필수, 본문 없음. 새 출석은 201, 같은 키의 재생도 201 이다.

`wallet` 은 이 청구로 섬 통장에 적립했을 때만 있고, 적립 직후의 정본 잔액과 지갑 버전이다(`island_wallets.balance`·`version`). 앱은 지급량을 로컬 잔액에 더하지 않고 이 값으로 `SERVER_VILLAGE_POINTS` 를 보낸다(`app/app-dev/src/services/model/reducer.ts`). 그래서 영수증 재생이나 먼저 도착한 Realtime `wallet.updated` 와 겹쳐도 두 번 더해지지 않는다. 재생 응답의 `wallet` 은 처음 청구 때의 값이고, 버전이 더 낮으면 리듀서가 무시한다.

Business 의 `GlobalExceptionHandler.registeredUpstream` 은 Data 오류 코드와 같은 이름·같은 상태가 `ApiErrorCode` 에 있을 때만 그 코드를 공개 응답에 싣고, 없으면 502 `UPSTREAM_CONTRACT_ERROR` 로 바꾼다. 그래서 아래 세 코드를 Data `AttendanceErrorCode` 와 Business `ApiErrorCode` 양쪽에 같은 상태로 넣는다. `retryable` 은 409 둘이 `false`, 503 이 `true` 다.

```json
{
  "data": {
    "claimedOn": "2026-11-12",
    "weekStart": "2026-11-08",
    "slot": 3,
    "reward": { "type": "ITEM", "productId": "cust.neck.red-scarf", "fallbackFishAmount": 30 },
    "itemOutcome": "ALREADY_OWNED",
    "fish": 30,
    "fishDelivery": "CREDITED",
    "releasedHeldFish": 20,
    "islandId": "0193…",
    "wallet": { "islandId": "0193…", "balance": 1250, "version": 42 },
    "heldFish": 0
  }
}
```

| 상태 | `code` | 앱 동작(PRD AT-F04) |
| --- | --- | --- |
| 409 | `ATTENDANCE_ALREADY_CLAIMED` | 출석판을 다시 읽고 「오늘은 이미 출석했어요」 |
| 409 | `ATTENDANCE_WEEK_COMPLETE` | 출석판을 다시 읽는다 |
| 409 | `IDEMPOTENCY_KEY_REUSED` | 새 키로 바꾸지 않는다. 출석판을 다시 읽는다 |
| 503 | `ATTENDANCE_SCHEDULE_UNAVAILABLE` | 「잠시 후 다시 시도해 주세요」, 같은 키로 다시 |
| 404 | (라우트 없음) | 출석 입구를 숨긴다(AT-F06) |

### POST `/me/attendance/views`

본문 없음. 200 `{"data": {"viewedOn": "2026-11-12", "first": true}}`. 같은 날 두 번째부터 `first=false` 이고 아무것도 바꾸지 않는다. 요청 키를 받지 않는다(자연 키 `(user_id, viewed_on)` 이 멱등을 맡는다).

## 5. 내부 API (Data)

| 메서드·경로 | 호출자 | 서비스 |
| --- | --- | --- |
| `GET /internal/users/{userId}/attendance` | business | `AttendanceReadService.board` |
| `POST /internal/users/{userId}/attendance/claims` | business | `AttendanceClaimService.claim` |
| `POST /internal/users/{userId}/attendance/views` | business | `AttendanceReadService.recordView` |
| `GET /internal/admin/attendance/schedules` | console | `AttendanceScheduleAdminService.overview` |
| `GET /internal/admin/attendance/schedules/history?scope=&week=&limit=` | console | `…history` |
| `POST /internal/admin/attendance/schedules/approvals/{approvalId}` | console | `…approve` |
| `DELETE /internal/admin/attendance/schedules/approvals/{approvalId}` | console | `…revoke` |
| `PUT /internal/admin/attendance/schedules/publications/{publicationId}` | console | `…publish` |
| `GET /internal/admin/attendance/stats?from=&to=` | console | `AttendanceStatsService.stats` |

`application-satellites.yml` 에 넣을 줄:

```yaml
# internal.api.callers.business.allow
- 'GET /internal/users/*/attendance'
- 'POST /internal/users/*/attendance/claims'
- 'POST /internal/users/*/attendance/views'
# console-member-1 · console-member-2 · console-member-3 의 allow 세 곳 모두
- 'GET /internal/admin/attendance/schedules'
- 'GET /internal/admin/attendance/schedules/history'
- 'POST /internal/admin/attendance/schedules/approvals/*'
- 'DELETE /internal/admin/attendance/schedules/approvals/*'
- 'PUT /internal/admin/attendance/schedules/publications/*'
- 'GET /internal/admin/attendance/stats'
```

`InternalAuthFilter` 의 운영자 경로 조건(지금 `/internal/admin/content/`·`/internal/admin/policies/focus`·`/internal/admin/customization/`)에 `path.startsWith("/internal/admin/attendance/")` 를 더한다. 이 조건 밖의 경로는 콘솔 토큰을 거절하므로, 빠뜨리면 백오피스 호출이 모두 403 이다. 관리 컨트롤러는 다른 관리 컨트롤러처럼 `requireEnvironment(request)` 로 `X-Backoffice-Environment` 를 확인하고 `content.actor` 속성에서 운영자를 읽는다.

## 6. 청구 원자 명령

`AttendanceClaimService.claim(userId, idempotencyKey)` 는 `@Transactional` 하나 안에서 `PublicCommandService.run` 을 부른다. `run` 이 같은 키의 영수증을 먼저 재생하므로, 날짜·횟수 검사는 새 명령일 때만 돈다(정책 AT04). 영수증(`command_idempotency`)에는 만료가 없고 탈퇴 때 `forgetReceiptsOf` 가 지운다. 그래서 자정을 넘긴 재시도도 처음 결과를 받는다.

- 명령 이름: `POST:/me/attendance/claims:<userId>`. 지문: 빈 객체(본문이 없다).
- 활성 주체 검사: 탈퇴하지 않은 계정. 재생 권한 검사: 같은 사용자.

새 명령의 순서. 잠금 방향은 집중 시작(`FocusSessionLifecycleService` 의 context → 섬 → 멤버십)과 1회 보상(`FocusTutorialRewardService`)을 따른다.

1. `UserQueryService.getCallerForUpdate(userId)` — 사용자 행 배타 잠금. 같은 사용자의 청구·탈퇴·섬 이동이 여기서 차례로 선다.
2. `UserIslandContextLockService.lock(user)` — 현재 섬 컨텍스트 잠금.
3. `now = clock.instant()`, `today = AttendanceDay.today(now)`, `weekStart = RankingWeek.weekStart(now)`.
4. 오늘 출석 행이 있으면 `ATTENDANCE_ALREADY_CLAIMED`(409). 이번 주 출석 수가 7 이면 `ATTENDANCE_WEEK_COMPLETE`(409). 유일 제약 `uq_attendance_claim_day`·`uq_attendance_claim_slot` 이 마지막 방어선이다.
5. `slot = 이번 주 출석 수 + 1`. 적용 개정은 `AttendanceScheduleResolver`: 그 주의 `WEEK` 최대 `revision`, 없으면 `DEFAULT` 최대 `revision`. 둘 다 없으면 `ATTENDANCE_SCHEDULE_UNAVAILABLE`(503).
6. 현재 섬 판정: 컨텍스트의 `currentIslandId` 가 있으면 `GroupMembershipMutationLocks.lockGroup(islandId)` 뒤 `findActiveByUserIdAndGroupIdForShare` 와 `IslandMovementGuards.isAlive` 로 다시 확인한다. 실패하면 「현재 섬 없음」으로 본다(`GET /me/islands` 의 `currentIslandId` 와 같은 판정). 예외를 던지지 않는다.
7. 칸 보상 풀기:
   - `FISH`: `todayFish = fish_amount`.
   - `ITEM`: 상품이 `CustomizationCatalogService.catalog()` 결과에 있고 그 항목의 `retiredAt` 이 비어 있으면 `OwnedProductRepository.insertUserProductIfAbsent(newId, userId, productId, "attendance:<userId>:<today>", now)`. 1 이면 `GRANTED`·`todayFish=0`, 0 이면 `ALREADY_OWNED`·`todayFish = fallback`. 카탈로그 조건에 맞지 않으면 `UNAVAILABLE`·`todayFish = fallback`.
8. 물고기 배달 값 정하기(아직 쓰지 않는다):
   - 현재 섬 있음: 열린 보관 행을 `FOR UPDATE` 로 읽어 합 `released` 를 낸다. `fishDelivery = todayFish > 0 ? CREDITED : NONE`, `releasedHoldFish = released`.
   - 현재 섬 없음: `fishDelivery = todayFish > 0 ? HELD : NONE`, `releasedHoldFish = 0`. 지난 보관 행은 건드리지 않는다.
9. 쓰기. 보관 행이 출석 행을 외래 키로 가리키므로 출석 행을 먼저 넣는다.
   1. 출석 행(보상 사본·결과·`island_id`).
   2. `HELD` 면 보관 행 하나(`claim_id` = 방금 출석). 현재 섬이 있고 `released > 0` 이면 열린 보관 행에 `released_claim_id` = 방금 출석, `released_at` = now.
   3. 현재 섬이 있고 `total = todayFish + released` 가 0 보다 크면 `IslandWalletService.creditAttendance(islandId, total, "attendance:<userId>:<today>")`. 지갑은 마지막에 잠근다.
   4. 그날 노출 행이 없으면 넣는다(`INSERT … ON CONFLICT DO NOTHING`, 정책 AT15).
10. 이벤트: 적립했으면 `IslandWalletEvents.changed(islandId, userId, "ATTENDANCE_REWARD")`, 꾸미기를 넣었으면 `AppearanceEvents.inventoryChanged("user", userId, userId, productId)`. 둘 다 같은 트랜잭션의 outbox 행이다.
11. 결과(§4 응답 모양)를 `PublicCommandResult(201, data, events)` 로 돌려준다. 적립했으면 `creditAttendance` 가 돌려준 잔액과 그때의 지갑 버전을 `wallet` 에 담는다.

`IslandWalletService.creditAttendance(islandId, amount, idempotencyKey)` 는 `creditQuestSettlement` 와 같은 모양이다. `@Transactional(propagation = MANDATORY)`, 지갑을 마지막에 잠그고, `(island_id, ATTENDANCE, idempotency_key)` 가 이미 있으면 잔액만 돌려준다. 멱등 키 `attendance:<userId>:<YYYY-MM-DD>` 는 하루 한 번이라는 자연 키라 출석 행의 유일 제약과 같은 것을 가리킨다.

보관분을 꺼낸 물고기는 출석 행의 `island_id` 로 집계한다. 그 물고기가 어느 섬에서 번 것인지는 없다(PR #1649 리뷰 1라운드).

## 7. 출석판 조회

`AttendanceReadService.board(userId)` 는 읽기 전용 트랜잭션이다.

- 이번 주 출석 행(최대 7)으로 `CLAIMED` 칸을 채운다. 사본에서 `reward`·`received` 를 만든다.
- 적용 개정(§6 의 5)에서 나머지 칸의 `reward` 를 만든다. `ITEM` 칸의 이름과 이미지 경로는 `CustomizationCatalogService.catalog()` 결과에서 상품 ID 로 찾는다. 이 결과는 `customization_asset_meta` 행과, 메타 행 없이 `customization_reward_items` 에만 있는 보상 꾸미기(이미지 경로가 `render_data` 쪽)를 함께 담는다. 메타 테이블만 읽으면 보상 꾸미기의 그림이 빠진다. 카탈로그에 없는 상품이면 `product` 의 `imageUrl` 을 `null` 로 내고 앱은 이름만 보인다.
- `heldFish` = 열린 보관 행의 합, `viewedToday` = 오늘 노출 행 존재, `attendedToday` = 오늘 출석 행 존재.

`recordView(userId)` 는 쓰기 트랜잭션에서 `UserQueryService.getCallerForShare(userId)` 로 활성 사용자를 공유 잠금한 뒤 `INSERT INTO attendance_views … ON CONFLICT DO NOTHING` 을 한다. 영향 행 수로 `first` 를 정한다. 공유 잠금이 탈퇴의 배타 잠금과 부딪혀, 탈퇴가 지운 노출 행을 늦게 도착한 요청이 다시 만들지 못한다. 잡지 열람 기록(`MagazineIssueService.receive`)과 같은 방식이다.

## 8. 표 관리

### 8.1 조회

`GET /internal/admin/attendance/schedules` 는 세 구역을 한 번에 돌려준다.

```json
{
  "now": "2026-11-12T03:00:00Z",
  "currentWeek": { "weekStart": "2026-11-08", "editable": true,
                   "published": { "revisionId": "…", "revision": 2, "publishedBy": "member-1", "publishedAt": "…", "slots": [ … ] },
                   "effective": "WEEK" },
  "nextWeek":    { "weekStart": "2026-11-15", "editable": true, "published": null, "effective": "DEFAULT" },
  "default":     { "published": { "revision": 1, "publishedBy": "migration", "slots": [ … ] } },
  "items": "GET /internal/admin/customization/items 를 따로 부른다"
}
```

- `effective` 는 그 주에 청구하면 쓰이는 표(`WEEK` 또는 `DEFAULT`)다. `expectedRevision` 은 `published.revision`(없으면 0)이다.
- 꾸미기 고르기 목록은 기존 `GET /internal/admin/customization/items` 를 그대로 쓴다. 그 응답의 `displayable` 이 `CustomizationCatalogService.catalog()` 포함 여부다.

### 8.2 승인·취소·발행

`CustomizationRewardPoolAdminService` 의 `approve`·`revoke`·`publish` 와 같은 모양이다. 오류는 같은 서비스처럼 `ResponseStatusException` 으로 상태와 문장을 낸다.

| 단계 | 요청 본문 | 검사 | 실패 |
| --- | --- | --- | --- |
| 승인 `POST …/approvals/{approvalId}` | `scope`, `weekStart`, `expectedRevision`, `slots`(7), `approvedDigest` | 칸 모양(§3 CHECK 와 같은 규칙), 꾸미기 상품 카탈로그 조건, 대상 주가 이번 주·다음 주, 다이제스트 재계산 일치, `expectedRevision` = 현재 개정 | 400 형식·상품, 409 주·개정·다이제스트, 같은 ID 다른 내용 409 |
| 취소 `DELETE …/approvals/{approvalId}` | 없음 | 발행에 쓰이지 않은 승인 | 404 없음, 409 이미 발행 |
| 발행 `PUT …/publications/{publicationId}` | `approvalId`, `scope`, `weekStart`, `expectedRevision`, `slots`, `approvedDigest` | 승인 존재·미취소·미사용, 본문 = 승인 스냅샷, `actor ≠ approved_by`, 꾸미기 상품 다시 검사, 대상 주가 아직 이번 주·다음 주, `expectedRevision` = 현재 개정 | 400 상품, 409 나머지. 같은 발행 ID 재요청은 처음 결과 |

발행은 `pg_advisory_xact_lock('backoffice:attendance-schedule')` 안에서 `revision = 현재 + 1` 행과 칸 7행을 넣는다. 발행 ID 가 개정 ID 다.

### 8.3 정규형과 다이제스트

BFF 와 Data 가 같은 문자열을 만든다. 키 순서는 아래 그대로, 공백 없음, `null` 은 생략하지 않는다.

```text
{"scope":"WEEK","weekStart":"2026-11-15","slots":[{"slot":1,"rewardType":"FISH","fishAmount":10,"productId":null,"fallbackFishAmount":null}, … 7개, slot 오름차순]}
```

`DEFAULT` 는 `"weekStart":null`. 다이제스트 = UTF-8 바이트의 SHA-256 소문자 16진수 64자.

## 9. 참여 현황 통계

`GET /internal/admin/attendance/stats?from=YYYY-MM-DD&to=YYYY-MM-DD`(포함 범위, 최대 92일, UTC 날짜). `@Transactional(readOnly = true, isolation = REPEATABLE_READ)` 하나에서 아래를 읽는다.

| 묶음 | 항목 | 정의 |
| --- | --- | --- |
| 일별 | `viewers` | `attendance_views` 의 그날 행 수 |
| 일별 | `attendees` | `attendance_claims` 의 그날 행 수. 출석하면 노출도 기록되므로 `attendees ≤ viewers` |
| 일별 | `conversion` | `attendees / viewers`, `viewers = 0` 이면 `null` |
| 일별 | `firstDayAttendees` | 그날 출석자 중 `users.created_at` 의 UTC 날짜가 그날인 계정 |
| 주별 | `distribution[1..7]` | 그 주 출석 수가 k 인 계정 수 |
| 주별 | `completers` | `distribution[7]` |
| 주별 | `slotClaims[1..7]` | 그 주 k 칸 출석 행 수 |
| 주별 | `returnRate` | 지난 주 출석자 중 이번 주에도 출석한 비율 |
| 지급 | `fishCredited` | `today_fish`(`CREDITED`) 합 + `released_hold_fish` 합 |
| 지급 | `fishHeldOpen` | 조회 시점의 열린 보관 행 합(기간과 무관). 개인 잔액 지표가 아니다(정책 AT08) |
| 지급 | `fallbacks` | `item_outcome` 이 `ALREADY_OWNED`·`UNAVAILABLE` 인 행 수와 물고기 합 |
| 지급 | `itemsGranted[]` | `GRANTED` 상품별 건수, 상품 이름 |

주는 기간에 걸친 UTC 일요일 시작 주다. 탈퇴한 계정의 행은 지워져 있어 집계에서 빠진다(정책 AT16). 응답에는 사용자 식별자를 싣지 않는다.

## 10. 백오피스

### 10.1 BFF

- `backoffice/server/attendance.mjs`: `AttendanceScheduleStore extends ApprovalWorkflowStore`. cfg 는 `reward-pool.mjs` 를 따른다.

```js
{ prefix: "attendance_schedule", noun: "출석 보상 표", verb: "발행", run: "publishing", done: "published",
  idName: "publicationId", resume: false,
  content: item => normalizeSchedule(item),          // { scope, weekStart, slots[7] } 정규형(§8.3)
  digest: content => scheduleDigest(content),
  request: (item, approvalId, content, digest) => ({ approvalId, scope: content.scope,
    weekStart: content.weekStart, expectedRevision: item.expectedRevision, slots: content.slots,
    approvedDigest: digest }),
  matches: (approval, request) => /* 승인 응답의 approvalId·expectedRevision·digest·slots 가 요청과 같다 */ }
```

- `expectedRevision` 은 0 을 허용한다(아직 주간 표가 없는 주). 추첨 풀의 `expected()` 는 0 을 거절하므로 그대로 복사하지 않는다.
- `upstream.mjs`: `attendanceSchedules`·`attendanceHistory`·`approveAttendance`·`revokeAttendanceApproval`·`publishAttendance`·`attendanceStats`. 로컬 모드는 `local-attendance.mjs` 가 §8 규칙을 흉내 낸다(`local-customization.mjs` 와 같은 방식).
- `contract.json` 의 `data` 목록에 `attendance.schedule.v1`·`attendance.stats.v1`.
- `app.mjs` 라우트: `GET /api/attendance/schedules`, 초안 저장·검토 요청·승인·철회·발행(추첨 풀 라우트와 같은 이름 규칙), `GET /api/attendance/stats`.

### 10.2 화면

- `AttendanceRewards.tsx`: 탭 「이번 주」·「다음 주」·「기본 표」. 각 탭에 지금 적용되는 표(`effective`)와 개정 번호를 보이고, 7칸 편집기에서 칸마다 종류·수량·꾸미기(썸네일은 `CustomizationShared.tsx` 의 `Thumb`)·대체 물고기를 고른다. 아래에 승인 대기·발행 이력.
- `AttendanceStats.tsx`: 기간 선택, 일별 표, 주별 분포·칸별 수령 표, 지급 합계. 머리에 「UTC 기준 — 하루는 한국 오전 9시, 주는 한국 일요일 오전 9시에 시작」.
- `App.tsx`: 사이드바 버튼 두 개, `panel` 값 `'attendance' | 'attendanceStats'`, props `{ session, onDirtyChange, onUnauthorized }`.

## 11. 앱

### 11.1 파일과 상태

- `services/api/attendance.ts`: `getAttendance()`, `claimAttendance(idempotencyKey)`, `recordAttendanceView()`.
- `services/attendance.ts`: 계정별 기기 기억 `attendance:autoOpened:<userId>` = 마지막으로 자동으로 연 날의 서버 `today` 문자열, `attendance:viewPending:<userId>` = 보내지 못한 노출의 서버 `today`.
- `screens/attendance/useAttendance.ts`: 조회 → 자동 열림 판정 → 노출 기록 → 청구. 청구 키는 「출석하기」를 처음 누를 때 만들고, 응답을 받기 전 재시도에는 같은 키를 쓴다.

### 11.2 자동 열림

조건을 모두 만족하면 연다.

1. 팝업 게이트 통과: `services/developerLetter.ts` 의 `isLetterReady(…)` 가 참이고, 운영진의 편지(`useDeveloperLetter`)와 강제 업데이트 편지(`useForceUpdateLetter`)가 **이번 판정 회차의 조회를 마쳤고**(성공·실패 모두) 둘 다 떠 있지 않다. 우선순위는 강제 업데이트 → 운영진의 편지 → 출석판이다. 지금 두 훅은 조회 완료를 알려 주지 않아(`useDeveloperLetter` 는 `{ notice, dismiss }`, `useForceUpdateLetter` 는 요구 사항만 돌려준다), 출석 조회가 먼저 끝나면 출석판이 먼저 열리고 뒤늦은 편지가 겹칠 수 있다. 두 훅이 `settled` 를 함께 돌려주게 고친다. 앱 시작과 foreground 복귀 때마다 `settled` 는 거짓으로 돌아갔다가 그 회차의 조회가 끝나면 참이 된다.
2. 조회 응답이 `attendedToday=false`·`viewedToday=false`.
3. 기기 기억 `autoOpened` 가 응답의 `today` 와 다르다.

열면 `autoOpened = today` 를 먼저 저장하고 노출을 보낸다. 노출이 실패하면 `viewPending = today` 를 두고 다음 foreground 에 한 번 더 보낸다. 앱은 날짜를 계산하지 않고 서버가 준 `today` 문자열만 비교한다.

### 11.3 입구·결과·오류

- 아이콘 `AttendanceIcon.tsx`: 섬 홈과 먼바다 화면의 HUD 에 둔다(`screens/island/HomeQuestIndicator.tsx` 와 같은 자리 규칙). `attendedToday=false` 면 점.
- 출석판 `AttendanceBoard.tsx`: `design-system/patterns.tsx` 의 `Overlay` 를 쓴다. 7칸, 보관 물고기, `nextDayAt`·`nextWeekAt` 을 기기 시간대로 표시한다. 디자인은 `app/app-dev/DESIGN.md` 를 따른다.
- 결과 문구는 PRD 「결과 종류와 문구」 표의 6종이다. 꾸미기를 받으면 `services/unseenOutfits.ts` 의 NEW 표시를 단다. 섬 통장 잔액은 응답의 `wallet`(정본 잔액·버전)으로 먼저 고치고, Realtime `wallet.updated` 는 다른 화면과 다른 기기의 보정용이다.
- 404 는 그 세션 동안 입구를 숨긴다. 409·503 은 §4 표대로.
- 문구 키는 `attendance.*` 로 `ko.json`·`en.json` 에 넣는다.
- PostHog: `attendance_board_viewed` `{ source: "auto" | "icon" }`, `attendance_claimed` `{ slot, item_outcome, fish_delivery }`. `services/socialAnalytics.ts` 가 쓰는 `captureProductEvent` 로 보낸다.

## 12. 탈퇴·개인정보·관측

- `AccountWithdrawalService.withdraw` 는 사용자 행을 먼저 배타 잠금한다. 그 뒤 개인 기록을 지우는 줄들 사이에 `attendanceErasure.eraseWithdrawnUser(userId)` 를 넣는다. 지우는 순서는 `attendance_fish_holds` → `attendance_claims` → `attendance_views` 다(외래 키 방향).
- 섬 통장에 이미 들어간 물고기와 원장 행은 그대로 남는다. 다중 계정 감시는 원장의 `ATTENDANCE` 행으로 한다(정책 ATQ05).
- 로그: 청구 한 번에 `attendance_claim outcome=<GRANTED|ALREADY_OWNED|UNAVAILABLE|FISH> delivery=<CREDITED|HELD|NONE> slot=<n>` 한 줄. 사용자 ID 외 개인정보는 남기지 않는다.

## 13. 검증

시험은 실제 마이그레이션이 만든 테이블로 돌린다. DDL 을 시험 안에서 따로 만들거나, 칸 계산·표 해석 같은 이음새를 덮어쓰는 시험은 쓰지 않는다.

| 범위 | 잡아야 할 회귀 |
| --- | --- |
| Data 청구 | 같은 날 다른 키 두 번 → 두 번째 409. 같은 키 재생 → 같은 응답, 원장 행 1개. 두 스레드 동시 청구 → 하나만 성공. UTC 토요일 23:59:59Z 와 일요일 00:00Z 의 주가 다름. 같은 키 재시도가 자정을 넘겨도 처음 결과 |
| Data 보상 | 섬 없음 → `HELD`, 섬 없음 + 새 꾸미기 → `NONE`, 섬 가입 뒤 다음 날 꾸미기 칸 → 보유품 + 보관분 적립. `render_data` 만 있는 보상 꾸미기 칸의 이미지 경로가 비지 않음. 이미 가짐 → 대체. 은퇴·카탈로그 밖 → `UNAVAILABLE` 대체. 청구 중 강퇴(섬 잠금 뒤 재확인 실패) → 보관 |
| Data 표 | 주간 표 없음 → 기본 표. 승인자 = 발행자 → 409. 승인 뒤 상품 은퇴 → 발행 400. 다음 주 표를 승인하고 주가 바뀐 뒤 발행 → 이번 주 표로 발행됨. 이번 주 표를 승인하고 주가 바뀐 뒤 발행 → 409 |
| Data 기타 | 탈퇴 → 출석 3표 행 0. 탈퇴와 노출 기록이 겹쳐도 탈퇴 뒤 노출 행이 남지 않음. 통계 픽스처의 일별·주별·지급 값. `InternalCustomizationRewardPoolAllowlistTest` 처럼 allowlist 시험 |
| Business | 응답 JSON 모양, `imageUrl` 조립, Data 오류 3개가 502 가 아니라 같은 코드·상태로 나감(`ApiErrorCode` 등록) |
| 백오피스 | 2인 흐름(`approval-workflow.mjs` 공통 시험), `contract.json` 시험, 다이제스트가 Data 와 같은 값(§8.3 예시 고정) |
| 앱 | 자동 열림 세 조건, 편지 조회가 늦게 끝나도 출석판이 먼저 열리지 않음, 노출 실패 뒤 같은 기기에서 다시 안 열림, 청구 응답 `wallet` 으로 잔액 갱신(재생·Realtime 과 겹쳐도 한 번), 404 숨김, 409 다시 읽기, 503 같은 키 재시도 |

## 14. 배포 순서와 구현 티켓

배포 순서는 HLD 「배포 순서」 그대로다. Data·Business 운영 배포 → 운영 Data 의 capability 광고 확인 → 백오피스 머지(곧 운영 배포) → 앱 출시.

에픽 2855 에 넣을 구현 티켓 후보(이 문서 머지 뒤 만든다):

| 후보 | 범위 | 선행 |
| --- | --- | --- |
| Data | §1~§3·§5~§9·§12 의 Data 부분, 고정값 자리, `backend-layering.md`, `schema.dbml`, `CONTEXT.md` 용어 | 없음 |
| Business | §4(`ApiErrorCode` 등록 포함)와 계약 시험 | Data |
| 백오피스 | §10 과 시험, README 절 | Data 운영 배포 |
| 앱 | §11 과 시험 | Business 운영 배포 |
