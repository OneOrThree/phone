# 출석 보상 LLD

상태: 구현 명세, 미구현. 작성일: 2026-11-12. GROMO-2858. 규칙의 정본은 [정책](policy.md), 구조는 [HLD](high-level-design.md)다. 이 문서는 기준 코드 main `d6c41f4dd` 를 읽고 썼다. 「신설」 표시가 없는 경로는 그 커밋에 있다.

## 1. 파일 배치

| 서비스 | 경로 | 내용 |
| --- | --- | --- |
| Data | `server/data-api/src/main/resources/db/v0/V16__attendance.sql` (신설) | §3 테이블 5개와 기본 표 시드 |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/attendance/` (신설) | 도메인 L8: `repository/domain/` 엔티티, `repository/` 리포지토리, `support/` 순수 규칙, `exception/AttendanceErrorCode` |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/internal/` (신설 파일) | `InternalAttendanceController`(사용자), `InternalAttendanceAdminController`(운영자), `service/AttendanceClaimService`·`AttendanceReadService`·`AttendanceScheduleAdminService`·`AttendanceStatsService` |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/construction/repository/domain/IslandWalletTransactionType.java` | `ATTENDANCE(true)` 추가 |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/construction/service/IslandWalletService.java` | `creditAttendance` 추가(§6) |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/config/InternalAuthFilter.java` | 운영자 경로 접두사 `/internal/admin/attendance/` |
| Data | `server/data-api/src/main/resources/application-satellites.yml` | business·console-member-1~3 allowlist(§5) |
| Data | `server/data-api/src/main/java/com/oneorthree/phone/internal/InternalContentAdminController.java` | capability `attendance.schedule.v1`·`attendance.stats.v1` |
| Business | `server/business-api/src/main/java/com/oneorthree/business/api/AttendanceController.java` (신설) | `/me/attendance` 3개 |
| Business | `server/business-api/src/main/java/com/oneorthree/business/usecase/AttendanceUseCase.java` (신설) | Data 호출, 이미지 URL 조립 |
| Business | `server/business-api/src/main/java/com/oneorthree/business/upstream/data/DataAttendanceClient.java` (신설) | `/internal/users/{userId}/attendance/**` |
| Business | `server/business-api/src/main/java/com/oneorthree/business/common/api/ApiErrorCode.java` | 출석 오류 3개 등록(§4). 등록하지 않으면 공개 응답이 502 가 된다 |
| 백오피스 | `backoffice/server/attendance.mjs`·`local-attendance.mjs` (신설) | 초안·발행 상태 store(§10.1), 로컬 모드 흉내 |
| 백오피스 | `backoffice/server/upstream.mjs`·`app.mjs`·`contract.json` | 호출·라우트·필수 capability |
| 백오피스 | `backoffice/src/AttendanceRewards.tsx`·`AttendanceStats.tsx` (신설), `backoffice/src/App.tsx` | 화면 두 개, 사이드바 |
| 앱 | `app/app-dev/src/services/api/attendance.ts`·`services/attendance.ts` (신설) | API 호출, 기기 기억, 출석판 상태 저장소와 `useAttendanceBoard()`(§11) |
| 앱 | `app/app-dev/src/screens/attendance/` (신설) | `AttendanceBoard.tsx`·`useAttendance.ts`·`AttendanceIcon.tsx` |
| 앱 | `app/app-dev/src/App.tsx`, `app/app-dev/src/i18n/locales/ko.json`·`en.json` | 팝업 장착, 문구 |
| 앱 | `app/app-dev/src/screens/letter/useDeveloperLetter.ts`·`useForceUpdateLetter.ts` | 조회 완료 `settled` 를 함께 돌려준다(§11.2) |
| 문서 | `docs/conventions/backend-layering.md` §4, `server/data-api/docs/db/schema.dbml`, `CONTEXT.md` | 층 표에 `attendance`, 스키마, 용어 「출석」·「출석판」 |

`server/business-api/src/main/java/com/oneorthree/business/common/api/PublicApiRoutes.java` 는 이미 `/me/**` 를 성공 봉투로 감싸므로 바꾸지 않는다. `server/data-api/src/main/java/com/oneorthree/phone/withdrawal/service/AccountWithdrawalService.java` 도 바꾸지 않는다. 출석 기록은 탈퇴 뒤에도 남는다(정책 AT16, §12).

## 2. 도메인 배치와 층

- `attendance` 를 **L8** 에 둔다(`docs/conventions/backend-layering.md` §4 표와 `server/data-api/src/test/java/com/oneorthree/phone/architecture/DomainLayerRulesTest.java` 의 `LAYERS` 에 함께 추가). 잡지(`magazine`, L8)처럼 엔티티·리포지토리·순수 규칙만 둔다.
- `attendance` 가 아래로 참조하는 것: `ranking`(L4)의 `RankingWeek`, `user`(L0). 섬 통장(`construction`, L6)·보유품(`appearance`, L7)·멤버십(`group`, L5)을 함께 쓰는 조합은 L10 `internal` 의 서비스가 한다.
- 탈퇴(`withdrawal`, L9)는 `attendance` 를 부르지 않는다. 출석 기록은 탈퇴 뒤에도 남는다(정책 AT16).

`support/` 의 순수 규칙:

| 클래스 | 하는 일 |
| --- | --- |
| `AttendanceDay` | `today(Instant)` = UTC 날짜, `nextDayAt(Instant)` = 다음 UTC 자정. 주 계산은 `RankingWeek.weekStart`·`RankingWeek.endInstant` 에 맡긴다 |
| `AttendanceSlots` | 이번 주 출석 수 → 다음 칸 번호(1~7, 7 을 넘으면 없음) |
| `AttendanceScheduleResolver` | (주 시작일, 주간 표 최신 발행본, 기본 표 최신 발행본) → 적용할 개정 |
| `AttendanceScheduleDigest` | 표 정규 문자열과 SHA-256(§8.3). 백오피스 BFF 와 같은 결과를 낸다 |

## 3. 저장 모델: V16

최신이 `V15__developer_notice_target_platform.sql` 이라 다음은 V16 이다. push 직전에 `origin/main` 의 최신 번호를 다시 보고, 겹치면 번호와 관련 시험·`schema.dbml` 을 함께 바꾼다.

```sql
-- 출석 보상 (GROMO-2855). 정책 docs/prd/fishcat/attendance/policy.md.

-- 발행된 표 개정. 고치지 않고 새 행만 더한다. 발행 ID 가 곧 개정 ID 다.
-- 운영자 한 명이 발행한다(정책 AT13). 승인 테이블은 없다.
CREATE TABLE attendance_schedule_revisions (
    revision_id uuid PRIMARY KEY,         -- = 백오피스 publicationId
    scope varchar(10) NOT NULL CHECK (scope IN ('DEFAULT', 'WEEK')),
    week_start date,                      -- WEEK 만. UTC 일요일
    revision integer NOT NULL CHECK (revision >= 1),
    digest char(64),                      -- §8.3. 같은 발행 ID 재요청의 본문 대조에도 쓴다
    published_by varchar(30) NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendance_revision_scope_ck CHECK ((scope = 'DEFAULT') = (week_start IS NULL)),
    CONSTRAINT attendance_revision_sunday_ck CHECK (week_start IS NULL OR EXTRACT(ISODOW FROM week_start) = 7),
    -- 마이그레이션 시드 행만 다이제스트 없이 있다
    CONSTRAINT attendance_revision_seed_ck CHECK ((published_by = 'migration') = (digest IS NULL))
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
- 운영자 이름 열 `published_by` 에는 `member-1`~`member-3` 같은 콘솔 actor 만 들어간다. 사용자 개인정보는 없다.
- 섬 통장 원장(`island_wallet_transactions.type`)은 varchar(40) 이고 CHECK 가 없어 새 사유에 마이그레이션이 필요 없다.

V16 과 함께 바꿀 고정값 자리(2026-11-09 꾸미기 지급 배치에서 확인한 목록):

| 파일 | 바꿀 것 |
| --- | --- |
| `server/data-api/docs/db/test-deploy-v0.py` | 마이그레이션 체인에 V16 |
| `server/data-api/src/test/java/com/oneorthree/phone/common/db/DeploymentMigrationMainTest.java` | 체인, 실행 건수 |
| `server/data-api/src/test/java/com/oneorthree/phone/db/V0BaselineMigrationTest.java` | 체인, public 테이블 수(+5) |
| `server/data-api/src/test/java/com/oneorthree/phone/db/V0DefaultSeedTest.java` | 체인, 기본 표 시드 행 |
| `server/data-api/docs/db/schema.dbml` | 테이블 5개. 고친 뒤 `server/data-api/docs/db/verify-schema-dbml.sh` 로 V0 체인과 대조한다(`server/data-api/CLAUDE.md` 「Database changes」) |
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
      { "slot": 3, "status": "NEXT", "alreadyOwned": true,
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

`wallet` 은 이 청구로 섬 통장에 적립했을 때만 있고, 적립 직후의 정본 잔액과 지갑 사건 버전이다. 잔액은 `creditAttendance` 가 돌려준 값이다. 버전은 `IslandWalletEvents.changed(...)` 가 돌려준 `EventEnvelope.version()`, 곧 `aggregate_versions` 의 `ISLAND_WALLET` 축 값이다. 상점 응답(`ShopService.walletVersion`)과 `wallet.updated` 가 쓰는 축과 같다. `island_wallets.version` 은 낙관적 잠금 값이라 이 축과 다르므로 쓰지 않는다. 앱은 지급량을 로컬 잔액에 더하지 않고 이 값으로 `SERVER_VILLAGE_POINTS` 를 보낸다(`app/app-dev/src/services/model/reducer.ts`). 그래서 영수증 재생과 겹쳐도, 앞으로 앱이 Realtime `wallet.updated` 를 받게 되더라도 두 번 더해지지 않는다. 재생 응답의 `wallet` 은 처음 청구 때의 값이고, 버전이 더 낮으면 리듀서가 무시한다.

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
| 409 | `ATTENDANCE_WEEK_COMPLETE` | 출석판을 다시 읽고 PRD 「결과 종류와 문구」의 「이번 주 완료」를 보여 준다(`nextWeekAt`) |
| 409 | `IDEMPOTENCY_KEY_REUSED` | 키를 버리고 출석판을 다시 읽는다. 자동으로 다시 청구하지 않는다(정책 AT04 의 「409 면 키를 버린다」) |
| 503 | `ATTENDANCE_SCHEDULE_UNAVAILABLE` | 「잠시 후 다시 시도해 주세요」, 같은 키로 다시 |
| 404 | (라우트 없음) | 출석 입구를 숨긴다(AT-F06) |
| 그 밖의 5xx·`UPSTREAM_CONTRACT_ERROR` | 「잠시 후 다시 시도해 주세요」. 키를 버리고 출석판을 다시 읽는다. 첫 요청이 반영됐다면 다시 읽은 출석판이 보여 준다 |

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
- 'PUT /internal/admin/attendance/schedules/publications/*'
- 'GET /internal/admin/attendance/stats'
```

`InternalAuthFilter` 의 운영자 경로 조건(지금 `/internal/admin/content/`·`/internal/admin/policies/focus`·`/internal/admin/customization/`)에 `path.startsWith("/internal/admin/attendance/")` 를 더한다. 이 조건 밖의 경로는 콘솔 토큰을 거절하므로, 빠뜨리면 백오피스 호출이 모두 403 이다. 관리 컨트롤러는 다른 관리 컨트롤러처럼 `requireEnvironment(request)` 로 `X-Backoffice-Environment` 를 확인하고 `content.actor` 속성에서 운영자를 읽는다.

## 6. 청구 원자 명령

`AttendanceClaimService.claim(userId, idempotencyKey)` 는 `@Transactional` 하나 안에서 `PublicCommandService.run` 을 부른다. `run` 이 같은 키의 영수증을 먼저 재생하므로, 날짜·횟수 검사는 새 명령일 때만 돈다(정책 AT04). 영수증(`command_idempotency`)에는 만료가 없고 탈퇴 때 기존 공통 경로 `forgetReceiptsOf` 가 지운다(출석이 탈퇴 경로에 더하는 변경은 아니다, §12). 그래서 자정을 넘긴 재시도도 처음 결과를 받는다.

- 명령 이름: `POST:/me/attendance/claims:<userId>`. 지문: 빈 객체(본문이 없다).
- 활성 주체 검사: 탈퇴하지 않은 계정. 재생 권한 검사: 같은 사용자.

새 명령의 순서. 잠금 방향은 집중 시작(`FocusSessionLifecycleService` 의 context → 섬 → 멤버십)과 1회 보상(`FocusTutorialRewardService`)을 따른다.

1. `UserQueryService.getCallerForUpdate(userId)`: 사용자 행 배타 잠금. 같은 사용자의 청구·탈퇴·섬 이동이 여기서 차례로 선다.
2. 현재 섬 컨텍스트를 읽는다(`UserIslandContextRepository.findById`). 컨텍스트를 바꾸는 쓰기(섬 이동·가입·강퇴 정리)는 모두 사용자 행을 먼저 잡으므로 사용자 잠금 아래의 읽기로 충분하다. `UserIslandContextLockService.lock` 은 행이 없으면 만들기 때문에 쓰지 않는다. 출석이 컨텍스트 행을 새로 만들 이유가 없다.
3. `now = clock.instant()` 를 **이 한 번만** 읽는다. `today = AttendanceDay.today(now)`, `weekStart = RankingWeek.weekStart(now)`, `nextDayAt`·`nextWeekAt`, 꾸미기 지급 시각, 출석 행의 `created_at` 이 모두 이 값을 쓴다. 자정 직전에 시작한 청구의 날짜와 주가 서로 다른 날을 가리키지 않는다. 판정 순서는 영수증 재생(1 앞의 `run`) → 같은 날 출석(4, 409) → 칸·표(5, 503) → 현재 섬(6) → 꾸미기(7) 이고, 어느 오류가 먼저 나오는지가 이 순서로 정해진다(PRD 구현 결정 7).
4. 오늘 출석 행이 있으면 `ATTENDANCE_ALREADY_CLAIMED`(409). 이번 주 출석 수가 7 이면 `ATTENDANCE_WEEK_COMPLETE`(409). 유일 제약 `uq_attendance_claim_day`·`uq_attendance_claim_slot` 이 마지막 방어선이다.
5. `slot = 이번 주 출석 수 + 1`. 적용 개정은 `AttendanceScheduleResolver`: 그 주의 `WEEK` 최대 `revision`, 없으면 `DEFAULT` 최대 `revision`. 둘 다 없으면 `ATTENDANCE_SCHEDULE_UNAVAILABLE`(503).
6. 현재 섬 판정: 컨텍스트의 `currentIslandId` 가 있으면 `GroupMembershipMutationLocks.lockGroup(islandId)` 뒤 `findActiveByUserIdAndGroupIdForShare` 와 `IslandMovementGuards.isAlive` 로 다시 확인한다. 실패하면 「현재 섬 없음」으로 본다(`GET /me/islands` 의 `currentIslandId` 와 같은 판정). `lockGroup` 은 섬 행이 없으면 `GROUP_NOT_FOUND` 를 던지는데, 청구는 이것도 잡아 「현재 섬 없음」으로 본다. 섬 정리(`IslandPurgeService`)는 `markDeleted` 로 행을 남기므로 지금은 생기지 않지만, 청구가 이 예외로 실패하지 않게 한다. 강퇴·나가기·탈퇴는 사용자 행을 먼저 잡아 이 청구와 섞이지 않는다. 이 재확인이 막는 것은 사용자 행을 잡지 않는 섬 종료다. 2026-11-12 기준 그런 경로는 운영자 섬 닫기 `GroupMemberService.closeIslandByOperator`(섬 `FOR UPDATE` 와 멤버십만 잠근다)와 섬 정리 `IslandPurgeService`(`markDeleted`)다. 둘 다 섬 잠금을 잡으므로 청구의 `lockGroup` 뒤 재확인과 차례로 선다. 청구는 섬 하나만 잠근다. 계정 탈퇴는 여러 섬을 정렬해 잠그지만(`lockGroupsForAccountWithdrawal`) 그 전에 사용자 행을 배타로 잡으므로 같은 사용자의 청구와 만나지 않는다.
7. 칸 보상 풀기:
   - `FISH`: `todayFish = fish_amount`.
   - `ITEM`: 상품이 `CustomizationCatalogService.catalog()` 결과에 있고 그 항목의 `retiredAt` 이 비어 있으면 `OwnedProductRepository.insertUserProductIfAbsent(newId, userId, productId, "attendance:<userId>:<today>", now)`. 1 이면 `GRANTED`·`todayFish=0`, 0 이면 `ALREADY_OWNED`·`todayFish = fallback`. 카탈로그 조건에 맞지 않으면 `UNAVAILABLE`·`todayFish = fallback`.
8. 물고기 배달 값 정하기(아직 쓰지 않는다):
   - 현재 섬 있음: 열린 보관 행을 `FOR UPDATE` 로 읽어 합 `released` 를 낸다. `fishDelivery = todayFish > 0 ? CREDITED : NONE`, `releasedHoldFish = released`.
   - 현재 섬 없음: `fishDelivery = todayFish > 0 ? HELD : NONE`, `releasedHoldFish = 0`. 지난 보관 행은 건드리지 않는다.
9. 쓰기. 보관 행이 출석 행을 외래 키로 가리키므로 출석 행을 먼저 넣는다.
   1. 출석 행(보상 사본·결과·`island_id`).
   2. `HELD` 면 보관 행 하나(`claim_id` = 방금 출석). 현재 섬이 있고 `released > 0` 이면 열린 보관 행에 `released_claim_id` = 방금 출석, `released_at` = now.
   3. 현재 섬이 있고 `total = todayFish + released` 가 0 보다 크면 `IslandWalletService.creditAttendance(islandId, total, "attendance:<userId>:<today>")`. 지갑은 마지막에 잠근다. `total = 0`(섬 없이 보관만 했거나, 꾸미기만 받고 보관분도 없는 날)이면 원장 행을 쓰지 않는다. 원장의 `ATTENDANCE` 행 합계가 곧 섬에 들어간 출석 물고기이고, 통계 `fishCredited`(§9)와 같은 사건을 센다. 0원 행은 섞이지 않는다.
   4. 그날 노출 행이 없으면 넣는다(`INSERT … ON CONFLICT DO NOTHING`, 정책 AT15).
10. 이벤트: 적립했으면 `IslandWalletEvents.changed(islandId, userId, "ATTENDANCE_REWARD")`, 꾸미기를 넣었으면 `AppearanceEvents.inventoryChanged("user", userId, userId, productId)`. 둘 다 같은 트랜잭션의 outbox 행이다.
11. 결과(§4 응답 모양)를 `PublicCommandResult(201, data, events)` 로 돌려준다. 적립했으면 `creditAttendance` 가 돌려준 잔액과 10 의 `IslandWalletEvents.changed` 봉투 `version` 을 `wallet` 에 담는다.

`IslandWalletService.creditAttendance(islandId, amount, idempotencyKey)` 는 `creditQuestSettlement` 와 같은 모양이다. `@Transactional(propagation = MANDATORY)`, 지갑을 마지막에 잠그고, `(island_id, ATTENDANCE, idempotency_key)` 가 이미 있으면 잔액만 돌려준다. 멱등 키 `attendance:<userId>:<YYYY-MM-DD>` 는 하루 한 번이라는 자연 키라 출석 행의 유일 제약과 같은 것을 가리킨다.

보관분을 꺼낸 물고기는 출석 행의 `island_id` 로 집계한다. 그 물고기가 어느 섬에서 번 것인지는 없다(PR #1649 리뷰 1라운드).

잠금과 경합에 관한 결정:

- 잠금 순서는 사용자(배타) → 섬(`lockGroup`) → 멤버십(공유) → 보유품 삽입 → 지갑(마지막)이다. 섬 통장 쓰기가 지갑을 마지막에 잡는 것은 `IslandWalletService` 의 모든 메서드와 같다.
- 이벤트는 지갑 적립 뒤 `wallet.updated` → `inventory.updated` 순서로 적는다. 두 사건 축(`ISLAND_WALLET` 섬 하나, 보유품 사용자 하나)의 `aggregate_versions` 행은 서로 다르다. 사용자 축은 이미 사용자 잠금 아래이고, 섬 지갑 축은 이 명령이 마지막에 잡는 섬 단위 자원이라 순환이 생기지 않는다.
- 보관 행은 그 사용자의 청구만 건드리고 사용자 잠금 아래에서 `FOR UPDATE` 로 읽으므로 다른 요청과 다투지 않는다.
- 한국 오전 9시에 같은 섬 주민의 청구가 몰리면 섬 잠금(6)부터 커밋까지 줄을 선다. 그 구간에는 외부 호출이 없고 쓰기는 몇 행이다. 섬 잠금 대기 시간은 로컬 격리 환경에서만 잰다(AWS 대상 부하 시험 금지).

## 7. 출석판 조회

`AttendanceReadService.board(userId)` 는 읽기 전용 트랜잭션이다.

- 이번 주 출석 행(최대 7)으로 `CLAIMED` 칸을 채운다. 사본에서 `reward`·`received` 를 만든다.
- 적용 개정(§6 의 5)에서 나머지 칸의 `reward` 를 만든다. `ITEM` 칸의 이름과 이미지 경로는 `CustomizationCatalogService.catalog()` 결과에서 상품 ID 로 찾는다. 이 결과는 `customization_asset_meta` 행과, 메타 행 없이 `customization_reward_items` 에만 있는 보상 꾸미기(이미지 경로가 `render_data` 쪽)를 함께 담는다. 메타 테이블만 읽으면 보상 꾸미기의 그림이 빠진다. 카탈로그에 없는 상품이면 `product` 의 `imageUrl` 을 `null` 로 내고 앱은 이름만 보인다.
- `heldFish` = 열린 보관 행의 합, `viewedToday` = 오늘 노출 행 존재, `attendedToday` = 오늘 출석 행 존재. 출석하면 그날 노출도 기록되므로 `attendedToday=true` 이면 `viewedToday=true` 다.
- 받지 않은 `ITEM` 칸에는 `alreadyOwned`(이미 가진 상품이면 `true`)를 싣는다. 앱은 이 값이 참이면 칸 아래에 「이미 가짐 · 물고기 {n}」을 보여 준다. 청구 순간 판정(§6 의 7)이 정본이고 이 값은 미리 보기다.

`recordView(userId)` 의 날짜는 청구와 같은 `Clock` 에서 낸 UTC 날짜다. DB 의 `CURRENT_DATE` 는 세션 시간대에 따라 날이 갈리므로 쓰지 않는다. `recordView(userId)` 는 쓰기 트랜잭션에서 `UserQueryService.getCallerForShare(userId)` 로 활성 사용자를 공유 잠금한 뒤 `INSERT INTO attendance_views … ON CONFLICT DO NOTHING` 을 한다. 영향 행 수로 `first` 를 정한다. 이 잠금은 탈퇴한 계정이 노출·출석을 새로 기록하지 못하게 한다. 공유 잠금이 탈퇴의 배타 잠금과 차례로 서므로, 탈퇴가 먼저 끝났으면 활성 사용자를 찾지 못해 거절하고, 탈퇴가 뒤면 방금 넣은 노출 행도 남는다(정책 AT16). 청구는 같은 목적으로 `getCallerForUpdate` 를 쓴다(§6 의 1). 활성 사용자 확인은 잡지 열람 기록(`MagazineIssueService.receive`)과 같은 방식이다.

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
  "default":     { "editable": true, "published": { "revision": 1, "publishedBy": "migration", "slots": [ … ] } },
  "items": "GET /internal/admin/customization/items 를 따로 부른다"
}
```

- `effective` 는 그 주에 청구하면 쓰이는 표(`WEEK` 또는 `DEFAULT`)다. `expectedRevision` 은 `published.revision`(없으면 0)이다.
- 꾸미기 고르기 목록은 기존 `GET /internal/admin/customization/items` 를 그대로 쓴다. 그 응답의 `displayable` 이 `CustomizationCatalogService.catalog()` 포함 여부다.

### 8.2 발행

승인 단계 없이 운영자 한 명의 발행 한 번으로 끝난다(정책 AT13). 승인·취소 경로는 없다. 오류는 `CustomizationRewardPoolAdminService` 처럼 `ResponseStatusException` 으로 상태와 문장을 낸다.

| 단계 | 요청 본문 | 검사(이 순서) | 실패 |
| --- | --- | --- | --- |
| 발행 `PUT …/publications/{publicationId}` | `scope`, `weekStart`, `expectedRevision`, `slots`(7), `digest` | ① 같은 `publicationId` 의 개정 행이 이미 있으면 본문 대조만 한다. `scope`·`weekStart`·`expectedRevision`(저장된 `revision - 1`)·재계산 다이제스트(저장된 `digest`)가 같으면 처음 응답, 다르면 409. 이 경우 ②~⑤ 는 보지 않는다 ② 칸 모양(§3 CHECK 와 같은 규칙)·수량 1~100·꾸미기 상품 카탈로그 조건 ③ 대상 주가 이번 주·다음 주(`WEEK` 만) ④ `expectedRevision` = 현재 개정 ⑤ 다이제스트 재계산 일치 | 400 형식·수량·상품, 409 주·개정·다이제스트·같은 ID 다른 본문 |

- ① 을 맨 앞에 두는 이유: 첫 발행이 성공하고 응답만 잃었다면 현재 개정이 이미 하나 올라가 있다. ④ 를 먼저 보면 재요청이 409 가 된다. 대상 주가 지난 뒤의 재요청도 같은 이유로 처음 응답을 받는다.
- 재요청 대조에 따로 영수증 테이블을 두지 않는다. 발행 ID 가 개정 ID 이고, 다이제스트가 7칸 전체를 덮으므로 개정 행만으로 대조할 수 있다.
- 다시 보내는 운영자가 처음 운영자와 달라도 결과는 같다. `published_by` 는 처음 발행한 운영자로 남는다.
- 409 `expectedRevision` 불일치는 다른 운영자가 같은 대상을 먼저 발행했다는 뜻이다. 백오피스는 새 개정을 다시 읽어 보여 준다.

응답 모양.

```jsonc
// 발행 200: 같은 publicationId·같은 본문 재요청도 같은 응답
{ "publicationId": "…", "revisionId": "…", "scope": "WEEK", "weekStart": "2026-11-15", "revision": 1,
  "digest": "…", "publishedBy": "member-1", "publishedAt": "…" }
// 이력 GET …/history?scope=WEEK&week=2026-11-15&limit=20: 최신 개정부터
{ "items": [ { "revision": 1, "revisionId": "…", "publishedBy": "member-1",
               "publishedAt": "…", "slots": [ … ] } ] }
```

발행은 `pg_advisory_xact_lock('backoffice:attendance-schedule')` 안에서 ① 을 확인하고 `revision = 현재 + 1` 행과 칸 7행을 넣는다. 같은 대상을 두 운영자가 동시에 발행하면 이 잠금에서 차례로 서고, 뒤의 요청은 ④ 에서 409 다. 발행 ID 가 개정 ID 다.

### 8.3 정규형과 다이제스트

BFF 와 Data 가 같은 문자열을 만든다. 키 순서는 아래 그대로, 공백 없음, `null` 은 생략하지 않는다.

```text
{"scope":"WEEK","weekStart":"2026-11-15","slots":[{"slot":1,"rewardType":"FISH","fishAmount":10,"productId":null,"fallbackFishAmount":null}, … 7개, slot 오름차순]}
```

`DEFAULT` 는 `"weekStart":null`. 다이제스트 = UTF-8 바이트의 SHA-256 소문자 16진수 64자.

어긋나기 쉬운 곳:

- Data 는 BFF 가 보낸 문자열을 쓰지 않는다. 받은 7칸을 검증한 뒤 위 순서로 직접 다시 조립해 다이제스트를 계산하고 요청의 `digest` 와 비교한다. 입력 JSON 의 키 순서에 기대지 않는다.
- 칸은 `slot` 오름차순 7개다. 중복·누락이면 다이제스트 계산 전에 400 이다.
- 숫자는 정수 리터럴(`10`, `10.0` 아님)이다. `null` 은 생략하지 않고 `null` 로 쓴다.
- `productId` 는 카탈로그 ID 형식(ASCII)이라 이스케이프가 생기지 않는다. `/` 도 이스케이프하지 않는다. BFF 는 `JSON.stringify`, Data 는 Jackson 기본 설정이다.

고정 예시(V16 시드 기본 표). 아래 문자열의 다이제스트는 `fbfa42dfc536d73d205aab71b676d612bb1a1c2e414ed01e5835f2df3ec33df0` 다. Node `JSON.stringify` + `crypto` 와 Python `json.dumps(separators=(",", ":"))` + `hashlib` 이 같은 값을 낸다. BFF·Data 시험이 이 값을 함께 고정한다.

```text
{"scope":"DEFAULT","weekStart":null,"slots":[{"slot":1,"rewardType":"FISH","fishAmount":10,"productId":null,"fallbackFishAmount":null},{"slot":2,"rewardType":"FISH","fishAmount":10,"productId":null,"fallbackFishAmount":null},{"slot":3,"rewardType":"FISH","fishAmount":15,"productId":null,"fallbackFishAmount":null},{"slot":4,"rewardType":"FISH","fishAmount":15,"productId":null,"fallbackFishAmount":null},{"slot":5,"rewardType":"FISH","fishAmount":20,"productId":null,"fallbackFishAmount":null},{"slot":6,"rewardType":"FISH","fishAmount":20,"productId":null,"fallbackFishAmount":null},{"slot":7,"rewardType":"FISH","fishAmount":30,"productId":null,"fallbackFishAmount":null}]}
```

## 9. 참여 현황 통계

`GET /internal/admin/attendance/stats?from=YYYY-MM-DD&to=YYYY-MM-DD`(포함 범위, 최대 92일, UTC 날짜). `@Transactional(readOnly = true, isolation = REPEATABLE_READ)` 하나에서 아래를 읽는다.

| 묶음 | 항목 | 정의 |
| --- | --- | --- |
| 일별 | `viewers` | `attendance_views` 의 그날 행 수 |
| 일별 | `attendees` | `attendance_claims` 의 그날 행 수. 출석하면 노출도 기록되므로 `attendees ≤ viewers` |
| 일별 | `conversion` | `attendees / viewers`, `viewers = 0` 이면 `null` |
| 일별 | `firstDayAttendees` | 그날 출석자 중 `users.created_at` 의 UTC 날짜가 그날인 계정 |
| 주별 | `distribution[0..6]` | `distribution[k-1]` = 그 주 출석 수가 k 인 계정 수 |
| 주별 | `completers` | `distribution[6]` |
| 주별 | `slotClaims[0..6]` | `slotClaims[k-1]` = 그 주 k 칸 출석 행 수 |
| 주별 | `returnRate` | 지난 주 출석자 중 이번 주에도 출석한 비율 |
| 지급 | `fishCredited` | `today_fish`(`CREDITED`) 합 + `released_hold_fish` 합 |
| 지급 | `fishHeldOpen` | 조회 시점의 열린 보관 행 합(기간과 무관). 탈퇴 계정(`users.is_deleted = true`)의 행은 뺀다(정책 AT16). 개인 잔액 지표가 아니다(정책 AT08) |
| 지급 | `fallbacks` | `item_outcome` 이 `ALREADY_OWNED`·`UNAVAILABLE` 인 행 수와 물고기 합 |
| 지급 | `itemsGranted[]` | `GRANTED` 상품별 건수, 상품 이름 |

기간 규칙:

- `from`·`to` 는 UTC 날짜, 포함 범위, 최대 92일. `from > to` 나 92일 초과는 400.
- 일별 값은 기간 안의 날마다 하나다.
- 주별 값은 시작일이 `RankingWeek.weekStart(from)` 이상 `weekStart(to)` 이하인 주마다 하나다. 기간이 주 중간에서 잘려도 그 주 전체(조회 시점까지)를 센다. 진행 중인 주는 `inProgress: true` 다.
- `returnRate` 는 그 주와 바로 앞 주를 본다. 앞 주가 기간 밖이어도 센다. 앞 주 출석자가 0 이면 `null`.
- `conversion`·`returnRate` 는 0~1 소수(소수점 넷째 자리 반올림)다. 화면이 % 로 바꾼다.
- `firstDayAttendees` 는 `(u.created_at AT TIME ZONE 'UTC')::date = claimed_on` 으로 센다. `claimed_on`·`viewed_on` 은 이미 date 다.
- 주는 UTC 일요일 시작이다.
- 탈퇴한 계정의 출석·노출 행도 남아 있어 집계에 들어간다(정책 AT16). 참여 현황 숫자는 탈퇴로 줄지 않는다. 탈퇴 계정을 빼는 값은 `fishHeldOpen` 하나다.
- `fishCredited` 와 섬 통장 원장의 `ATTENDANCE` 합계는 같은 사건을 센다. 출석 한 번의 원장 금액이 그 출석 행의 `today_fish`(`CREDITED`)와 `released_hold_fish` 의 합이다(§6 의 9). 보관분은 보관한 날이 아니라 섬 통장에 적립된 날의 출석 행과 원장에 들어간다.
- `fallbacks` 의 물고기는 `fishCredited`(또는 보관)의 일부다. 더하면 두 번 센다.
- 응답에는 사용자 식별자를 싣지 않는다.

```json
{
  "from": "2026-11-01", "to": "2026-11-14",
  "daily": [ { "date": "2026-11-11", "viewers": 180, "attendees": 150, "conversion": 0.8333, "firstDayAttendees": 40 } ],
  "weeks": [ { "weekStart": "2026-11-08", "inProgress": true,
               "distribution": [120, 60, 30, 12, 5, 2, 1], "completers": 1,
               "slotClaims": [230, 110, 50, 20, 8, 3, 1], "returnRate": 0.4120 } ],
  "totals": { "fishCredited": 5120, "fishHeldOpen": 340,
              "fallbacks": { "alreadyOwned": { "count": 12, "fish": 360 }, "unavailable": { "count": 0, "fish": 0 } },
              "itemsGranted": [ { "productId": "cust.neck.red-scarf", "title": "빨간 목도리", "count": 88 } ] }
}
```

`distribution[k-1]` 은 그 주 출석 수가 k 인 계정 수, `slotClaims[k-1]` 은 k 칸 출석 행 수다. 그래서 `slotClaims[k-1] = distribution[k-1] + … + distribution[6]` 이다.

## 10. 백오피스

### 10.1 BFF

- `backoffice/server/attendance.mjs`: `AttendanceScheduleStore`. 초안·발행 상태만 가진 store 다. 꾸미기 추첨 풀의 `ApprovalWorkflowStore`(2인 흐름)를 쓰지 않는다(정책 AT13). 나중에 2인 승인으로 되돌리려면 `ApprovalWorkflowStore` 로 옮긴다.
- 상태는 `draft` → `publishing` → `published` | `failed` | `uncertain` 이고, 대상 주가 지난 초안은 `expired` 다.

| 상태 | 뜻 | 다음 |
| --- | --- | --- |
| `draft` | 편집 중. 7칸과 `expectedRevision` 을 갖는다 | 「발행」 확인 → `publishing` |
| `publishing` | 「발행」 확인 때 `publicationId` 를 만들어 이 상태와 함께 SQLite 에 먼저 저장했다. 그 뒤 Data 를 부른다 | 200 → `published`, 400·409 → `failed`, 응답 유실·5xx·BFF 재시작 → `uncertain` |
| `published` | Data 응답의 `revision`·`revisionId` 를 저장했다 | 끝 |
| `failed` | Data 가 거절했다. 사유를 저장한다 | 고치면 `draft`. 다음 「발행」은 새 `publicationId` 를 만든다 |
| `uncertain` | 발행 여부를 모른다 | 「다시 보내기」: 같은 `publicationId`·같은 본문으로 다시 부른다. 누가 눌러도 된다. 결과에 따라 `published` 나 `failed` |
| `expired` | 조회 때 `weekStart` 가 이번 주보다 이르다(정책 AT11) | 끝. 같은 대상의 새 초안을 만들 수 있다 |

- 요청 본문은 `{ scope, weekStart, expectedRevision, slots, digest }` 다. `slots`·`digest` 는 §8.3 정규형과 같은 함수(`normalizeSchedule`·`scheduleDigest`)로 만든다. 다시 보낼 때는 저장한 본문을 그대로 쓴다.
- 「발행」을 누르면 BFF 가 `GET …/schedules` 를 다시 읽어 그 대상에 지금 적용 중인 표(`effective`)와 초안을 칸마다 견준 확인 창 자료를 돌려준다. 주간 표가 없는 주는 기본 표와 견준다. 확인해야 `publishing` 으로 간다.
- 초안은 (`scope`, `weekStart`)마다 한 번에 하나만 열려 있다. 열린 초안(`draft`·`publishing`·`failed`·`uncertain`)이 있으면 같은 대상의 새 초안을 만들지 않는다. `published` 나 `expired` 가 된 뒤에 새 초안을 만든다.
- `uncertain` 은 대상 주가 지나도 `expired` 로 바꾸지 않는다. 다시 보내면 첫 발행이 됐을 때 처음 응답(§8.2 ①)을 받아 `published` 가 되고, 안 됐을 때 409(대상 주)로 `failed` 가 된 뒤 `expired` 로 보인다.
- `expectedRevision` 은 0 을 허용한다(아직 주간 표가 없는 주). 추첨 풀의 `expected()` 는 0 을 거절하므로 그대로 복사하지 않는다.
- `upstream.mjs`: `attendanceSchedules`·`attendanceHistory`·`publishAttendance`·`attendanceStats`. 로컬 모드는 `local-attendance.mjs` 가 §8 규칙을 흉내 낸다(`local-customization.mjs` 와 같은 방식).
- `contract.json` 의 `data` 목록에 `attendance.schedule.v1`·`attendance.stats.v1`.
- `app.mjs` 라우트: `GET /api/attendance/schedules`, 초안 만들기·저장, 확인 창 자료, 발행, 다시 보내기(추첨 풀 라우트와 같은 이름 규칙), `GET /api/attendance/stats`.

### 10.2 화면

- `AttendanceRewards.tsx`: 탭 「이번 주」·「다음 주」·「기본 표」와 읽기 전용 「지난 주」(`GET …/schedules/history?scope=WEEK&week=<지난 주 시작일>`). 각 탭에 지금 적용되는 표(`effective`)와 개정 번호를 보이고, 7칸 편집기에서 칸마다 종류·수량·꾸미기(썸네일은 `CustomizationShared.tsx` 의 `Thumb`)·대체 물고기를 고른다. 아래에 「발행」 버튼과 발행 이력(누가 언제 발행했는지와 7칸)을 둔다. 「발행」을 누르면 확인 창이 지금 적용 중인 표와 바뀌는 칸의 전후를 보여 주고, 확인하면 발행한다. 「승인 대기」 영역은 없다. `uncertain` 이면 「결과 확인 필요」와 「다시 보내기」 버튼을, `failed` 면 Data 가 준 사유를 보인다.
- `AttendanceStats.tsx`: 기간 선택(기본 최근 14일), 일별 표, 주별 분포·칸별 수령 표(진행 중인 주 표시), 지급 합계(대체 물고기는 지급 합계의 일부이고, 「보관 중」은 탈퇴 계정을 뺀 값임을 함께 적는다). 머리에 「UTC 기준: 하루는 한국 오전 9시, 주는 한국 일요일 오전 9시에 시작」.
- `App.tsx`: 사이드바 버튼 두 개, `panel` 값 `'attendance' | 'attendanceStats'`, props `{ session, onDirtyChange, onUnauthorized }`.

## 11. 앱

### 11.1 파일과 상태

- `services/api/attendance.ts`: `getAttendance()`, `claimAttendance(idempotencyKey)`, `recordAttendanceView()`.
- `services/attendance.ts`: 계정별 기기 기억 `attendance:autoOpened:<userId>` = 마지막으로 자동으로 연 날의 서버 `today` 문자열, `attendance:viewPending:<userId>` = 보내지 못한 노출의 서버 `today`.
- `screens/attendance/useAttendance.ts`: 조회 → 자동 열림 판정 → 노출 기록 → 청구. 청구 키는 「출석하기」를 처음 누를 때 만들고, 응답을 받기 전 재시도에는 같은 키를 쓴다.

### 11.2 자동 열림

조건을 모두 만족하면 연다.

1. 팝업 게이트 통과: `services/developerLetter.ts` 의 `isLetterReady(…)` 가 참이고(튜토리얼·방문·모달·화면 경로 같은 나머지 조건은 이 함수가 맡는다), 운영진의 편지(`useDeveloperLetter`)와 강제 업데이트 편지(`useForceUpdateLetter`)가 **이번 판정 회차의 조회를 마쳤고**(성공·실패 모두) 둘 다 떠 있지 않다. 우선순위는 강제 업데이트 → 운영진의 편지 → 출석판이다. 지금 두 훅은 조회 완료를 알려 주지 않는다(`useDeveloperLetter` 는 `{ notice, dismiss }`, `useForceUpdateLetter` 는 요구 사항만 돌려준다). 그래서 출석 조회가 먼저 끝나면 출석판이 먼저 열리고 뒤늦은 편지가 겹칠 수 있다. 두 훅이 `settled` 를 함께 돌려주게 고친다. 앱 시작과 foreground 복귀 때마다 `settled` 는 거짓으로 돌아갔다가 그 회차의 조회가 끝나면 참이 된다.
2. 조회 응답이 `attendedToday=false`·`viewedToday=false`.
3. 기기 기억 `autoOpened` 가 응답의 `today` 와 다르다.

열면 `autoOpened = today` 를 먼저 저장하고 노출을 보낸다. 노출이 실패하면 `viewPending = today` 를 둔다. 다음 foreground 에 먼저 조회하고, 응답의 `today` 가 `viewPending` 과 같을 때만 노출을 한 번 더 보낸다. 다르면 `viewPending` 을 지운다. 서버는 노출을 도착 시각의 UTC 날짜로 기록하므로 자정을 넘겨 보내면 보지 않은 날의 노출이 된다. 앱은 날짜를 계산하지 않고 서버가 준 `today` 문자열만 비교한다.

### 11.3 입구·결과·오류

- 아이콘 `AttendanceIcon.tsx`: 섬 홈과 먼바다 화면의 HUD 에 둔다(`screens/island/HomeQuestIndicator.tsx` 와 같은 자리 규칙). `attendedToday=false` 면 점.
- 상태 공유: `services/attendance.ts` 가 마지막 조회 응답을 작은 저장소로 들고 `useAttendanceBoard()` 로 구독하게 한다(`services/unseenOutfits.ts` 의 `update`·구독 훅과 같은 모양). 출석판·두 화면의 아이콘이 같은 값을 본다. 청구 성공 뒤와 foreground 복귀 때 다시 조회한다.
- 청구 키는 메모리에만 둔다. 앱이 죽어 키를 잃으면 다음 청구는 409 가 되고 출석판 재조회로 정리된다.
- 아이콘으로 열 때도 노출을 보낸다(같은 날 두 번째부터 서버가 무시한다).
- 출석판 `AttendanceBoard.tsx`: `design-system/patterns.tsx` 의 `Overlay` 를 쓴다. 7칸, 보관 물고기, `nextDayAt`·`nextWeekAt` 을 기기 시간대로 표시한다. 디자인은 `app/app-dev/DESIGN.md` 를 따른다.
- 결과 문구는 PRD 「결과 종류와 문구」 표의 6종이다.
- 섬 통장 잔액은 응답의 `wallet` 으로 `SERVER_VILLAGE_POINTS` 를 보내 고친다. 퀘스트 보상이 게시판에서 하는 방식과 같다(`screens/interiors/board/Board.tsx` 의 `SERVER_VILLAGE_POINTS`). 지금 앱의 `services/islandRealtime.ts` 는 `wallet.updated`·`inventory.updated` 를 받지 않는다. 응답이 앱의 유일한 즉시 갱신 경로다. 두 사건은 앞으로의 소비자용이다.
- 꾸미기를 받으면(`itemOutcome=GRANTED`) `addUnseenOutfits("attendance:<claimedOn>", [productId])` 로 NEW 표시를 달고 `getMyInventory()`(`services/api/shop.ts`)를 한 번 다시 부른다. 리듀서는 대상 섬이 아직 `islands` 에 없으면 값을 버리므로, 섬 목록을 불러오기 전에 받은 응답은 다음 조회가 채운다.
- 404 는 그 세션 동안 입구를 숨긴다. 409·503·그 밖의 실패는 §4 표대로.
- 문구 키는 `attendance.*` 로 `ko.json`·`en.json` 에 넣는다.
- PostHog: `attendance_board_viewed` `{ source: "auto" | "icon" }`, `attendance_claimed` `{ slot, item_outcome, fish_delivery }`. `services/socialAnalytics.ts` 가 쓰는 `captureProductEvent` 로 보낸다. 서버 노출자(§9)는 자동 열림과 아이콘 열림을 가르지 않고 계정·날짜로 한 번만 센다. 퍼널을 PostHog 와 비교하면 두 수가 다를 수 있다.

## 12. 탈퇴·개인정보·관측

- 탈퇴 경로(`AccountWithdrawalService`)에 출석 관련 변경은 없다. 출석 기록·노출 기록·보관 행을 지우지 않는다(정책 AT16). 출석 기록은 사용자 ID·날짜·칸·보상만 갖고 개인정보가 없다. 탈퇴 계정의 `users` 행도 PII 만 지우고 남는다(`AccountWithdrawalService.withdraw` Javadoc 「행을 지우지 않고 PII 를 파기한 뒤 비활성 표시」). 그래서 출석 3표의 외래 키 `users(id)` 는 탈퇴 뒤에도 유효하다.
- 열린 보관 행도 지우지 않는다. 쓸 사람이 없으므로 통계 `fishHeldOpen` 에서 `users.is_deleted = true` 인 계정을 뺀다(§9).
- 탈퇴한 계정은 노출·출석을 새로 기록하지 못한다. 청구는 `getCallerForUpdate`(§6 의 1), 노출은 `getCallerForShare`(§7)가 활성 사용자만 통과시킨다. 청구와 탈퇴는 사용자 행에서 차례로 선다. 탈퇴가 먼저면 청구가 거절되고, 탈퇴가 뒤면 방금 만든 기록도 남는다.
- 섬 통장에 이미 들어간 물고기와 원장 행도 그대로 남는다.
- 로그: 청구 한 번에 `attendance_claim slot=<n> item_outcome=<GRANTED|ALREADY_OWNED|UNAVAILABLE|-> fish_delivery=<CREDITED|HELD|NONE> released=<m>` 한 줄, 거절이면 `attendance_claim_rejected code=<오류 코드>`. HLD 「관측」의 지급·보관·대체·거절은 각각 `CREDITED`·`GRANTED`, `HELD`, `ALREADY_OWNED`·`UNAVAILABLE`, `attendance_claim_rejected` 다. 사용자 ID 외 개인정보는 남기지 않는다.
- 게스트: `AccessTokenFilter` 에는 게스트를 가르는 분기가 없고 출석 서비스도 `users.is_guest` 를 보지 않는다(정책 AT14). 게스트가 소셜 계정으로 올라가면 같은 사용자 행을 승격하므로(`AuthService.java:298` `setGuest(false)`) 출석·보관 기록이 이어진다.

## 13. 검증

시험은 실제 마이그레이션이 만든 테이블로 돌린다. DDL 을 시험 안에서 따로 만들거나, 칸 계산·표 해석 같은 이음새를 덮어쓰는 시험은 쓰지 않는다.

| 범위 | 잡아야 할 회귀 |
| --- | --- |
| Data 청구 | 같은 날 다른 키 두 번 → 두 번째 409. 같은 키 재생 → 같은 응답, 원장 행 1개. 두 스레드 동시 청구 → 하나만 성공. UTC 토요일 23:59:59Z 와 일요일 00:00Z 의 주가 다름. 같은 키 재시도가 자정을 넘겨도 처음 결과 |
| Data 보상 | 섬 없음 → `HELD`, 섬 없음 + 새 꾸미기 → `NONE`, 섬 가입 뒤 다음 날 꾸미기 칸 → 보유품 + 보관분 적립. `render_data` 만 있는 보상 꾸미기 칸의 이미지 경로가 비지 않음. 이미 가짐 → 대체. 은퇴·카탈로그 밖 → `UNAVAILABLE` 대체. 청구 중 강퇴(섬 잠금 뒤 재확인 실패) → 보관 |
| Data 표 | 주간 표 없음 → 기본 표. 운영자 한 명이 발행 → 새 개정(승인 없이). 은퇴·표시 불가 상품, 수량 0·101 → 400. `expectedRevision` 이 현재 개정과 다름(다른 운영자가 먼저 발행) → 409. 다이제스트 불일치 → 409. 같은 `publicationId`·같은 본문 재요청 → 처음 응답, 개정 행 1개(첫 발행으로 현재 개정이 올라간 뒤여도, 다른 운영자가 보내도). 같은 `publicationId`·다른 본문 → 409. 두 운영자가 같은 대상을 동시에 발행 → 하나만 성공. 다음 주 표 초안을 만들고 주가 바뀐 뒤 발행 → 이번 주 표로 발행됨. 이번 주 표 초안을 만들고 주가 바뀐 뒤 발행 → 409. 시드가 아닌 `digest` NULL 행은 CHECK 가 거절 |
| Data 기타 | 탈퇴 뒤에도 출석·노출·보관 행이 남고 `fishHeldOpen` 에서만 빠진다(나머지 통계 값은 탈퇴 전과 같다). 탈퇴가 먼저 끝난 뒤의 청구·노출 기록은 거절되어 새 행이 없다. 기간의 `fishCredited` = 같은 기간 원장 `ATTENDANCE` 합계. 통계 픽스처의 일별·주별·지급 값과 불변식(`attendees ≤ viewers`, `slotClaims[k-1] = distribution[k-1..6]` 합), 기간이 주 중간에서 잘린 경우. `InternalCustomizationRewardPoolAllowlistTest` 처럼 allowlist 시험 |
| Business | 응답 JSON 모양, `imageUrl` 조립, Data 오류 3개가 502 가 아니라 같은 코드·상태·`retryable`(409 둘 `false`, 503 `true`)로 나감(`ApiErrorCode` 등록) |
| 백오피스 | 상태 전이(§10.1 표), 「발행」 때 `publicationId` 를 Data 호출 전에 저장, 응답 유실 뒤 같은 `publicationId`·같은 본문 재전송(다른 운영자도), 고친 뒤 발행은 새 `publicationId`, 한 대상에 열린 초안 하나, 확인 창의 바뀌는 칸 전후, `contract.json` 시험, 다이제스트가 Data 와 같은 값(§8.3 예시 고정) |
| 앱 | 자동 열림 세 조건, 편지 조회가 늦게 끝나도 출석판이 먼저 열리지 않음, 꾸미기 지급 뒤 `addUnseenOutfits` 호출과 `getMyInventory()` 재조회, 섬 목록을 불러오기 전 응답의 잔액이 버려진 뒤 다음 조회가 채움, 노출 실패 뒤 같은 기기에서 다시 안 열림, 청구 응답 `wallet` 으로 잔액 갱신(재생과 겹쳐도 한 번), 404 숨김, 409 다시 읽기, 503 같은 키 재시도 |

## 14. 배포 순서와 구현 티켓

배포 순서는 HLD 「배포 순서」 그대로다. Data·Business 운영 배포 → 운영 Data 의 capability 광고 확인 → 백오피스 머지(곧 운영 배포) → 앱 출시.

배포 중 새 Business 가 옛 Data 를 부르는 창(HLD 「배포 순서」 1단계에서 넘긴 확인):

- 옛 Data 에는 새 경로가 business allowlist 에 없다. `InternalAuthFilter` 가 라우팅 전에 본문 없는 403 을 내고, Business 의 `InternalHttpClient` 는 이를 `UpstreamCredentialRejectedException` 으로 받는다. 앱에는 404 가 아니라 서버 오류로 간다. 라우트까지 갔다면 옛 Data 는 `RESOURCE_NOT_FOUND`(404)를 낸다.
- 그래서 「Data 404 → 앱 404 → 입구 숨김」은 이 창에서 성립하지 않는다. 앱이 이 창을 만나는 일은 없다. 앱은 `app-server-gate.py` 로 서버 배포가 끝난 뒤에만 나가고, 구버전 앱은 출석 API 를 부르지 않는다. dev 에서는 잠깐 오류 문구가 보일 수 있고, 이를 받아들인다.
- 앱의 404 숨김(§11.3)이 막는 경우는 Business 자체가 옛 버전이라 `/me/attendance` 라우트가 없는 때다.

에픽 2855 에 넣을 구현 티켓 후보(이 문서 머지 뒤 만든다):

| 후보 | 범위 | 선행 |
| --- | --- | --- |
| Data | §1~§3·§5~§9·§12 의 Data 부분(탈퇴 경로는 바꾸지 않는다), 고정값 자리, `backend-layering.md`, `schema.dbml`, `CONTEXT.md` 용어 | 없음 |
| Business | §4(`ApiErrorCode` 등록 포함)와 계약 시험 | Data |
| 백오피스 | §10 과 시험, README 절 | Data 운영 배포 |
| 앱 | §11 과 시험 | Business 운영 배포 |
