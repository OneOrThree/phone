# 레거시 `/api/v1` 폐기 계획

GROMO-1889. [A24](../../architecture/decisions.md)(1.x 데이터 이관 없음 · 계정 전환 보상 · 도메인별 레거시 삭제 · prod 는 `release` 라인이 서빙 · 1.x 종료는 한 달 뒤)의 후속 실행 문서다. A24 를 먼저 읽는다.

## §1 범위와 근거

범위는 `server/data-api/src/main/java/` 아래 클래스 레벨 `@RequestMapping("/api/v1")` 컨트롤러 **28개**다(§부록 집계 방법 참조). `server/realtime/`(예: `ChatController`)·`server/business-api/`는 별도 Gradle 프로젝트라 이 표에 없다.

**"main 삭제가 운영 1.x 에 영향 없다"의 근거**는 두 워크플로의 트리거 분기다.

- `.github/workflows/prod-ci.yml:14-15` — `push: branches: [release]`. `main` push 는 이 워크플로를 트리거하지 않는다.
- `.github/workflows/prod-cd.yml:11-14` — `workflow_run` 이 `prod-ci` 의 `release` 브랜치 성공만 구독한다(`branches: [release]`).
- 대조: `.github/workflows/dev-ci.yml:28-29` — `push: branches: [main]` 이 dev 배포(`dev-cd.yml`)만 만든다.

즉 `main` 에서 레거시 컨트롤러를 지워도 그 이미지는 `prod-ci`/`prod-cd` 를 타지 않는다. prod 는 `release` 브랜치가 마지막으로 머지한 이미지를 계속 서빙하며, 종료 전 hotfix 는 `release` 에서 별도로 자른다(A24②).

## §2 컨트롤러 전수 표

판정 기준: 새 14종 화면 계약([policy.md B15](../../prd/fishcat/bff-screens/policy.md))과 도메인 LLD 로 같은 기능이 제공되면 **대체 있음**, 2.0 설계 어디에도 없으면 **2.0 에 없음**, 제품 결정이 필요하면 **판단 불가**. 근거는 실제 코드 경로(`@RequestMapping`)와 도메인 LLD 의 `파일:줄` 인용이며 주석은 근거로 쓰지 않았다.

| 파일 | 기본 경로 | 엔드포인트 수 | 판정 | 대체 계약 | 비고 |
| --- | --- | --- | --- | --- | --- |
| `analytics/AnalyticsController.java` | `/analytics/events` | 1 | 판단 불가 | — | island-\*/bff-screens 어디에도 `analytics`·`클라이언트 이벤트` 인용 없음(전수 grep). 이벤트 스키마를 2.0에서 계속 받을지 자체가 미결 |
| `auth/AuthController.java` | `/auth/*` | 9 | 대체 있음(부분) | [account LLD §2.1](../../prd/fishcat/account/low-level-design.md) `POST /auth/sessions`(google·line·instagram·facebook·kakao·apple 6종 통합, :26-45) · [§2.4](../../prd/fishcat/account/low-level-design.md) `DELETE /auth/sessions/current`(logout, :104) | **guest(`POST /auth/guest`)·refresh(`POST /auth/refresh`)는 삭제 금지.** account LLD:118 "신규 guest 생성은 이 7개에 추가하지 않으며 기존 `/api/v1/auth/guest`의 userId 보존과 세션 전환을 함께 검증", :355 "기존 refresh 계약은 7개 신규 endpoint에 추가 계수하지 않는다" — 둘 다 legacy 경로 그대로 활성 의존으로 명시됨 |
| `character/CharacterController.java` | `/character/quota`,`/character/generation` | 2 | 판단 불가 | — | island-\*/bff-screens 전수에 `캐릭터 생성`·`누끼` 인용 없음. 2.0에 캐릭터 생성 기능 자체가 있는지 미결 |
| `character/CharacterModerationController.java` | `/character/moderation` | 1 | 판단 불가 | — | 위와 동일 사유(모더레이션은 생성 기능에 종속) |
| `currency/InGameCurrencyController.java` | `/currency*` | 4 | 대체 있음 | [island-shop LLD §2](../../prd/fishcat/island-shop/low-level-design.md) `GET /islands/{islandId}/shop/wallets`(:25, wallet↔`GET /currency`) · `GET .../shop/orders`(:139, transactions↔`GET /currency/transactions`) · `POST .../shop/orders`(:95, spend↔`POST /currency/spend`) | `POST /currency/earn`(범용 획득) 1:1 대응 없음 — island-shop은 소비(buy)만 설계, 획득은 퀘스트·집중 보상 등 개별 도메인 TX로 흩어짐. `InGameCurrencyService.spendCurrency`는 island-shop이 내부적으로 재사용(§3) |
| `focus/FocusController.java` | `/tag*`,`/focus-session*` | 10 | 대체 있음(부분) | [focus-rest-session LLD §2·§8](../../prd/fishcat/focus-rest-session/low-level-design.md) — `POST /focus-sessions`(start,:30)·`GET /focus-sessions/current`(:40)·`POST .../pause`(:47)·`.../resume`(:55)·`.../finish`(:61)가 세션 5종(`POST /focus-session`·`/start`·`PATCH /focus-session`·`/cancel`·`GET /focus-session`)을 그대로 대체(§8 "원본 요청·응답 예시 보존"에 `/v1/focus-sessions/*` → 무접두 명시 대조) | **태그 5종(`/tag`,`/tag/defaults` GET/POST/PATCH/DELETE)은 대응 없음.** focus-rest-session LLD:26 "공개 DTO에 없다. 완료 기록의 통계 태그와 subject는 다른 개념이며 subject 문자열로 기존 태그를 자동 생성하지 않는다" — 태그 CRUD 자체가 설계 밖 |
| `friend/FriendController.java` | `/friends*` | 7 | 2.0 에 없음 | — | [policy.md BG10](../../prd/fishcat/bff-screens/policy.md) "친구·편지 도메인 설계(레포에 LLD 없음)... `friends` 전체... 설계 전 해당 조각을 활성화하지 않는다". `island-mailbox` LLD는 별도 도메인(섬 우체통=실시간 메시지, `server/realtime`의 `ChatController` 대체)이라 friend 관계와 무관 |
| `friend/PinController.java` | `/pins*` | 3 | 2.0 에 없음 | — | 위 BG10과 동일(친구 하위 기능) |
| `group/ChallengeResultAckController.java` | `/me/challenge-results*` | 2 | 2.0 에 없음 | — | [A24⑤](../../architecture/decisions.md) "2.0 에 대체 계약이 없는 도메인(챌린지·내기·리그 등)은 1.x 종료 뒤 한 번에 지운다" |
| `group/GroupBetBatchController.java` | `/groups/bets/settle` | 1 | 2.0 에 없음 | — | A24⑤ |
| `group/GroupBetController.java` | `/groups/*/bets*`,`/challenges/*/join-*` | 9 | 2.0 에 없음 | — | A24⑤ |
| `group/GroupBetQueryController.java` | `/me/bet-sessions`,`/me/challenge-results`,`/groups/*/challenge-history` | 4 | 2.0 에 없음 | — | A24⑤ |
| `group/GroupChallengeController.java` | `/groups/*/challenges*` | 5 | 2.0 에 없음 | — | A24⑤ |
| `group/GroupController.java` | `/groups*` | 17 | 대체 있음 | [island-membership LLD §1](../../prd/fishcat/island-membership/low-level-design.md) — `GroupService.createGroup`(:12)↔`POST /islands`, `joinGroup`(:14)↔`POST /islands/{islandId}/memberships`, `getGroupOverview`(:21)↔`GET /islands/{islandId}`(PublicIslandSummary); [island-management LLD §1](../../prd/fishcat/island-management/low-level-design.md) — `GroupMemberService.transferOwner`(:12)↔`POST .../host-transfer`, `kickMember`(:13)↔`DELETE .../members/{userId}`; [island-board LLD](../../prd/fishcat/island-board/low-level-design.md) — notices 5종↔공지 CRUD | `POST /groups/{groupId}/code`(초대코드 발급)는 이미 legacy에서 `@Deprecated generateUniqueCode()`(island-membership LLD:15)라 대체가 아니라 폐기 확인. `GET /groups/search`↔`GET /islands?q=`([policy B19](../../prd/fishcat/bff-screens/policy.md)). 설정(`/groups/{groupId}/settings`)의 필드별 1:1은 미검증 — 도메인 PR에서 재확인 필요 |
| `invitelink/InviteLinkController.java` | `/groups/*/invite-link`,`/invite-links/claim` | 2 | 대체 있음 | [link-attribution LLD](../../prd/fishcat/link-attribution/low-level-design.md)(A23) · [island-membership LLD §3.10-3.11](../../prd/fishcat/island-membership/low-level-design.md) `POST /invitations/resolve`·`POST /islands/{islandId}/invitations` — `InviteLinkService.issue`(island-membership:22) 재사용 근거 명시 | — |
| `item/EquipmentController.java` | `/equipment*` | 3 | 대체 있음 | [island-appearance LLD §1.2](../../prd/fishcat/island-appearance/low-level-design.md) `PATCH /me/appearance`(:28) — clothes/decor/hull/position 필드로 equip·unequip 통합 | `GET /equipment`(장착 조회)는 `GET /me/inventory` 응답의 `equipped` 필드(§1.1, :16)로 흡수 |
| `item/InventoryController.java` | `/inventory*` | 2 | 대체 있음 | [island-appearance LLD §1.1](../../prd/fishcat/island-appearance/low-level-design.md) `GET /me/inventory`(:13) | `POST /inventory/grant`(관리자 지급)는 새 4계약에 없음 — 퀘스트 클레임·상점 구매 등 개별 도메인 TX가 보유품을 직접 만드는 구조로 흡수된 것으로 보이나 명시 확인은 안 됨 |
| `league/LeagueBatchController.java` | `/league/batch*` | 2 | 2.0 에 없음 | — | A24⑤(리그) |
| `league/LeagueController.java` | `/league/*` | 7 | 2.0 에 없음 | — | A24⑤ |
| `notification/GroupNotificationBatchController.java` | `/groups/bets/notify-results` 등 | 3 | 판단 불가 | — | "알림 배치 3종" 중 하나. 대상 도메인(챌린지·내기)은 A24⑤로 없음이 확정됐지만, 이 트리거 자체를 알림 서버 분리(신규 서버, 이 레포 밖)로 옮길지 그냥 지울지는 별도 결정 |
| `notification/NotificationBatchController.java` | `/notifications/league/*`,`/inactive-return/run`,`/rank-overtake/run` | 7 | 판단 불가 | — | "알림 배치 3종" 중 하나. **예외: `rank-overtake`는 이미 결론남** — [decisions.md:214](../../architecture/decisions.md) "봇·추월 폐기(A5·D6)"로 폐기 확정. 나머지 6종(리그 5·inactive-return 1)은 알림 서버 소유권 이전 여부가 미결 |
| `notification/NotificationTestController.java` | `/notifications/test` | 1 | 판단 불가 | — | "알림 배치 3종" 중 하나. 컨트롤러 테스트도 서비스 테스트도 전무(§6) — 용도(운영 점검용 수동 발송?)조차 문서화가 없어 판단 근거 자체가 부족 |
| `profile/ProfileController.java` | `/users/{userId}/profile`,`/stats` | 2 | 판단 불가 | — | island-\*/bff-screens 전수에 `프로필 조회`(타인 프로필 열람) 인용 없음. 2.0에 타인 프로필 화면이 있는지 미결 |
| `screentime/ScreenTimeController.java` | `/screen-time` | 1 | 대체 있음 | [island-records LLD §1](../../prd/fishcat/island-records/low-level-design.md) `PUT /me/screen-time/{date}`(:80) — `ScreenTimeService.saveScreenTimeTx` 재사용 명시(:235) | — |
| `stats/StatsController.java` | `/stats/*` | 7 | 대체 있음 | [island-records LLD §1](../../prd/fishcat/island-records/low-level-design.md) `GET /islands/{islandId}/statistics/focus`(:9)·`.../statistics/screen-time`(:51) — [policy B23](../../prd/fishcat/bff-screens/policy.md) "기록 조회 도서관 이동(island-records)" | heatmap/streak/today/by-category 각각의 1:1 필드 매핑은 미검증 — `series`/`records` 통합 응답으로 흡수된 것으로 보임 |
| `user/OccupationController.java` | `/occupations` | 1 | 판단 불가 | — | island-\*/bff-screens 전수에 `직업` 인용 없음. `UserController`의 `PATCH /users/me/occupation`도 동일하게 미결 |
| `user/UserController.java` | `/users/me*` | 15 | 대체 있음(부분) | [account LLD §2.2-2.3](../../prd/fishcat/account/low-level-design.md) `GET /me`(:56)·`PATCH /me`(:74) · [§2.6-2.7](../../prd/fishcat/account/low-level-design.md) `GET/PATCH /me/settings`(:247,:253, 알림설정 — "Business에서 동기 활성 검사 후 알림 서버 정본을 읽는다") | **`PUT`/`DELETE /users/me/device-token`(2개)은 data-api 에서 삭제 대상이다 — 단 공개 경로는 보존된다.** 같은 URL 을 business-api `UserNotificationController`(`server/business-api/.../api/UserNotificationController.java:59,74`)가 이미 구현하고, nginx 가 그 URL 을 business upstream 으로 보낸다(`server/scripts/nginx-satellites.include.conf.example:58-60`). 즉 `DeviceTokenUseCase` 는 data-api 의 legacy 를 부르는 것이 아니라 business 컨트롤러가 요청을 받는다 — **보존 대상은 business 경로이고 data-api 의 두 메서드는 같이 지운다.** 지우지 않으면 공개 경로가 이미 옮겨간 뒤에도 data-api 의 죽은 구현과 테스트가 남는다. account LLD:118 "기기 등록 정리는 별도 `DELETE /api/v1/users/me/device-token`의 소유다... 새로운 8번째 계정 API가 아니라 기존 DELETE 사용 규약" — Business의 `DeviceTokenUseCase.delete`가 지금도 이 legacy 경로를 직접 호출한다. `GET /users/nickname/check`(중복 사전확인)는 2.0 매핑 미확인(gap). `PATCH .../occupation`은 OccupationController 판단불가와 연동 |
| `withdrawal/AccountWithdrawalController.java` | `DELETE /users/me` | 1 | 대체 있음 | [account LLD §2.5](../../prd/fishcat/account/low-level-design.md) `DELETE /me`(:239) — `AccountWithdrawalService.withdraw` 단일 TX 재사용 명시(:243) | 응답 코드 변경 주의: legacy는 204, 신규는 200 `{data:{deleted:true}}`(LLD:243 "원본 예상 계약의 200과 legacy DELETE `/api/v1/users/me`의 204를 구분") |

집계: 대체 있음 11 · 2.0 에 없음 9 · 판단 불가 8 = 28.

### 부록 — 엔드포인트 집계 방법

1. `grep -rl '@RequestMapping("/api/v1")' server/data-api/src/main/java` → 28개 파일(클래스 레벨 애노테이션이 정확히 `/api/v1` 하나뿐인지 `grep -c '@RequestMapping'`으로 개별 확인, 전부 1).
2. 그 28개 파일에 대해 `grep -E '@(Get|Post|Put|Patch|Delete)Mapping'` 개수를 합산 → **129**.
3. rtk 의 `find`/`ls` 요약 집계 사고를 피하려고 `rtk proxy grep`(비필터 경로) 또는 `grep -c`/`wc -l`로 숫자만 뽑아 이중 검증했다.

## §3 같이 지우면 안 되는 것

레거시 컨트롤러가 부르는 서비스·유틸 중, **2.0 도메인 LLD 가 같은 클래스를 내부적으로 재사용**하는 것들이다. 컨트롤러(HTTP 표면)는 지워도 이 클래스들은 남는다 — 도메인 PR에서 컨트롤러만 지우고 서비스는 유지해야 한다.

| 클래스 | 레거시 사용처 | 2.0 이 쓰는 곳(근거) |
| --- | --- | --- |
| `focus/service/FocusService.java` | `FocusController` | [focus-rest-session HLD](../../prd/fishcat/focus-rest-session/high-level-design.md):11 (`start`의 users FOR UPDATE),:21 |
| `friend/service/FriendService.java` | `FriendController`,`PinController` | [account LLD](../../prd/fishcat/account/low-level-design.md):740,:1091 — 탈퇴 시 `FriendService.detachWithdrawnUser`로 친구 관계 soft delete |
| `group/service/GroupMemberService.java` | `GroupController`,`GroupBetController` 등 | [island-management LLD](../../prd/fishcat/island-management/low-level-design.md):12-13(`transferOwner`·`kickMember`) · [account LLD](../../prd/fishcat/account/low-level-design.md):582,:1080(탈퇴 `detachWithdrawnUser`) · [link-attribution LLD](../../prd/fishcat/link-attribution/low-level-design.md):689(호출부 보존) |
| `stats/service/StatsService.java` | `StatsController` | [account LLD](../../prd/fishcat/account/low-level-design.md):1107(`anonymizeWithdrawnUser`) · [island-records LLD](../../prd/fishcat/island-records/low-level-design.md):264 |
| `screentime/service/ScreenTimeService.java` | `ScreenTimeController` | [account LLD](../../prd/fishcat/account/low-level-design.md):1108(`anonymizeWithdrawnUser`) · [island-records LLD](../../prd/fishcat/island-records/low-level-design.md):235,:265(`saveScreenTimeTx` 재사용) |
| `user/service/UserService.java` | `UserController` | [account LLD](../../prd/fishcat/account/low-level-design.md):86(`changeNickname`),:92(`setupProfile`/`updateProfile`),:1077,:529(`erasePersonalData`) · [link-attribution LLD](../../prd/fishcat/link-attribution/low-level-design.md):369 |
| `ClientIpResolver` | `AnalyticsController` 등 IP 로깅 사용처 | [link-attribution HLD](../../prd/fishcat/link-attribution/high-level-design.md):161,[LLD](../../prd/fishcat/link-attribution/low-level-design.md):544 — 같은 규칙을 business-api 로 그대로 옮김 |
| `invitelink/service/InviteLinkService.java` | `InviteLinkController`,`GroupController`(POST code) | [island-membership LLD](../../prd/fishcat/island-membership/low-level-design.md):22(`issue` 재사용) |
| `invitelink/service/InviteLinkMatchService.java` | `InviteLinkController` | [account LLD](../../prd/fishcat/account/low-level-design.md):1105(claim 무잠금 findBySlug 로직) |
| `notification/` 의 서비스 전부(`FriendNotificationService` 등) | `NotificationBatchController`,`GroupNotificationBatchController`,`NotificationTestController` | [account LLD](../../prd/fishcat/account/low-level-design.md):540(`NotificationOutboxProducer`),:846(`FriendNotificationService`) — 탈퇴 TX가 모든 알림 writer 와 직렬화해야 해서 전부 살아있어야 함 |
| `league/service/LeagueBatchService.java` | `LeagueBatchController` | **재사용 근거 확인 안 됨** — island-\*/account/focus-rest-session 어디에도 인용 없음(전수 grep). 다만 리그 도메인 전체가 A24⑤로 1.x 종료 후 일괄 삭제 대상이라 컨트롤러보다 먼저 지워질 위험 자체가 없다. 표에는 지시대로 남기되, "재사용돼서" 가 아니라 "삭제 시점이 챌린지/리그 일괄 삭제와 묶여 있어서" 로 이유가 다르다는 점을 표시해둔다 |
| `group/service/ChallengeResultAckService.java` | `ChallengeResultAckController` | [island-quests LLD](../../prd/fishcat/island-quests/low-level-design.md):209 · [policy.md Q09](../../prd/fishcat/island-quests/policy.md):17(`claimDisplay`는 결과 모달 선점이며 지급 수단이 아님이라는 의미로 재사용) · [account LLD](../../prd/fishcat/account/low-level-design.md):870 |

추가로 코드 확인 중 발견한, 지시된 최소 목록 밖의 재사용:

| 클래스 | 근거 |
| --- | --- |
| `group/service/GroupService.java` | [island-membership LLD](../../prd/fishcat/island-membership/low-level-design.md):12,14,21(`createGroup`·`joinGroup`·`getGroupOverview` 로직 선례로 재사용) |
| `currency/service/InGameCurrencyService.java` | [island-shop LLD §"기존 재화 계측 의무"](../../prd/fishcat/island-shop/low-level-design.md)(`spendCurrency` 재사용, 서버 MP 계측 의무 이행 주체) |
| `group/service/GroupAnnouncementService.java`,`group/service/GroupQueryService.java` | [api-platform policy.md](../../prd/fishcat/api-platform/policy.md):81(신규 섬 조회·관리·공지 어댑터가 이 두 서비스의 403 사유를 그대로 반환) |

### 컨트롤러 단위 예외(엔드포인트만 잔존)

§2 비고에 적었듯 서비스 클래스가 아니라 **엔드포인트 자체**가 legacy 경로 그대로 남는 경우가 둘 있다 — 도메인 PR이 컨트롤러 파일을 통째로 지우면 안 되고 메서드 단위로 남겨야 한다.

- `AuthController`: `POST /auth/guest`, `POST /auth/refresh` — account LLD 가 legacy 경로 그대로 활성 의존으로 명시.
- ~~`UserController`: device-token 2종~~ — **철회**. 이 URL 은 이미 business-api 소유이고 nginx 가 그쪽으로 보낸다(§2 `UserController` 행). data-api 의 두 메서드는 존치가 아니라 **삭제 대상**이다.

## §4 삭제 순서

도메인의 새 계약 PR 이 그 도메인의 레거시 컨트롤러·DTO·테스트를 같은 PR 에서 지운다(A24④). 선행 티켓은 설계/구현 페어로, 구현 티켓이 아직 없는 도메인은 그대로 표시했다.

| 도메인 | 함께 지울 컨트롤러 | 선행(새 계약 티켓) | 딸려 지울 테스트 파일 |
| --- | --- | --- | --- |
| 계정·인증(account) — **삭제 완료(GROMO-1947)** | `AuthController`(소셜 로그인 6종 + logout — guest·refresh 존치), `UserController`(대부분 — device-token 2종·§5 미결 2종 존치), `AccountWithdrawalController` | GROMO-1756(설계)/1757(구현) · 삭제 GROMO-1947 | **`AuthControllerTest` 는 부분 삭제** — 소셜 로그인·logout 케이스만 지우고 `refreshTokenSuccessReturns200`(`/api/v1/auth/refresh`)·`guestLoginWithinLimitReturns200`·`guestLoginOverLimitReturns429`(`/api/v1/auth/guest`)와 `auth.guest.rate-limit` 설정을 포함한 테스트 픽스처는 남긴다. 이 파일 말고는 두 경로를 검증하는 컨트롤러 테스트가 없어, 통째로 지우면 계속 서빙할 인증 전 엔드포인트의 회귀 방어가 사라진다. `UserControllerTest`, `auth/service/LegacyLogoutDeviceIntegrationTest`. `AccountWithdrawalController`는 컨트롤러 테스트 없음(§6) |
| 섬 소속·관리(group→island-membership/management/board) | `GroupController` — **선행 조건 있음, 아래 P1 참조** | GROMO-1758/1759(소속) · 1761/1762(관리) · 1770/1771(공지) | `GroupControllerTest` |
| 초대 링크(invitelink→link-attribution+island-membership) | `InviteLinkController` | GROMO-1799(link-attribution, PR #757 로 상당 부분 머지됨) · 1759(island-membership invitations) | 컨트롤러 테스트 없음(§6) — `invitelink/InviteLinkIssueTest`,`invitelink/service/InviteLinkServiceTest`,`invitelink/ClaimTest` 재검토 |
| 보유품·외양(item→island-appearance) | `EquipmentController`,`InventoryController` | GROMO-1782(설계) · GROMO-1909(정책 확정) · **구현 GROMO-1783** — A01·A03·A05 확정, A02(하위 선체 재착용)만 미결이라 hull 재착용 분기만 비활성으로 착수한다 | `EquipmentControllerTest`,`InventoryControllerTest` |
| 재화·상점(currency→island-shop) | `InGameCurrencyController` | GROMO-1780(설계)/1781(구현) | 컨트롤러 테스트 없음(§6) — `currency/service/InGameCurrencyServiceTest` 등 서비스 테스트 재검토 |
| 집중 세션(focus→focus-rest-session) | `FocusController`의 세션 5종만 — **태그 5종은 대응 없음, 별도 결정 없이 지우지 말 것**(§5 가 아니라 이 표에서 별도 관리) | GROMO-1763(설계)/1764(구현) | `FocusControllerTest`(부분 재작성 — 태그 케이스 분리 필요) |
| 기록·스크린타임(stats+screentime→island-records) | `StatsController`,`ScreenTimeController` | GROMO-1768(설계)/1769(구현) | `StatsControllerTest`,`ScreenTimeControllerTest` |

**계정·인증 삭제 결과(GROMO-1947).** 착수 조건은 `app/app-dev` 에서 `/api/v1` 호출 0건(2.0 앱은 아직 네트워크 계층이 없다)으로 확인했다.

- 지운 경로 19개: `POST /auth/{google,line,instagram,facebook,kakao,apple}`·`POST /auth/logout`(7) · `POST/PATCH/GET /users/me`·`PATCH /users/me/{screen-time-permission,screen-time-goal,focus-time-goal,stat-visibility}`·`GET/PUT /users/me/notification-settings`·`GET /users/me/social-links`·`DELETE /users/me/social-links/{provider}`(11) · `DELETE /users/me`(1, `AccountWithdrawalController` 파일째).
- 남긴 경로 6개: `POST /auth/guest`·`POST /auth/refresh`(위 §2 삭제 금지) · `PUT`/`DELETE /users/me/device-token`(티켓 1947 이 존치로 정했다 — nginx 가 공개 URL 을 business 로 보내므로 data-api 쪽은 모든 환경의 라우팅이 확인되면 따로 지운다) · `GET /users/nickname/check`·`PATCH /users/me/occupation`(§5 결정 대기).
- 서비스는 지우지 않았다(§3). `AuthService.socialLogin` 은 `LoginAttemptService`(내부 `/auth/sessions` 경로)가 계속 부르고, `UserService`·`AccountWithdrawalService` 는 내부 API 와 2.0 LLD 가 재사용한다. 호출자가 사라진 `AuthService.logout` 등 서비스 메서드 정리는 별도 작업이다.
- `JwtFilter` 화이트리스트에서 소셜 로그인 6개 경로를 뺐다.

**`GroupController` 삭제의 선행 조건 — Realtime 이 아직 `GET /api/v1/groups` 를 부른다.**
`server/realtime/src/main/java/com/oneorthree/realtime/membership/client/GroupClient.java:86` 의 `fetchMyGroupIds` 가 이 경로로 요청자의 활성 그룹 id 집합을 받아 `MembershipService` 의 방 목록·멤버십 판정에 쓴다. 이 컨트롤러를 먼저 지우면 그 호출이 404 가 되는데, 같은 파일의 주석이 **404 를 「빈 집합(비멤버)」이 아니라 「판정 불가」로 취급한다**고 명시한다(「400·404 는 상류가 이 유저에 대해 판정을 내린 게 아니라 우리 쪽 또는 배포가 어긋났다는 신호다」) — 즉 조용한 전원 차단은 아니지만 실시간 인가가 판정을 못 내리는 상태가 된다. 새 `POST /internal/realtime/membership-authorization` 은 기본 OFF 인 선택 기능이고 **방 목록 조회를 대체하지 않는다.** 따라서 이 도메인 PR 은 컨트롤러를 지우기 전에 Realtime 의 목록·멤버십 조회를 내부 대체 계약으로 옮기거나, 그 GET 하나를 별도로 존치해야 한다.

**설계 자체가 없어 이 표에 못 들어가는 것** — 별도 시점 삭제:

- 챌린지·내기·리그(`ChallengeResultAckController`,`GroupBetBatchController`,`GroupBetController`,`GroupBetQueryController`,`GroupChallengeController`,`LeagueBatchController`,`LeagueController`): A24⑤에 따라 **1.x 지원 종료(A24③, 대략 한 달 뒤) 이후 한 번에** 삭제. 선행 도메인 PR 없음.
- 친구·핀(`FriendController`,`PinController`): BG10 이 "설계 전 활성화 금지"라고만 했지 "영구히 없음"이라고 확정하지 않았다 — 친구 도메인 LLD 가 나오면 그 도메인 PR 이 지우고, 끝내 안 나오면 챌린지·리그처럼 1.x 종료 후 일괄 삭제로 편입할지는 별도 결정이 필요하다(이 문서가 임의로 정하지 않음).

## §5 재영님 확인이 필요한 항목

§2 의 "판단 불가" 8개다. 각각 정할 것 한 줄.

| 컨트롤러 | 무엇을 정해야 하는가 |
| --- | --- |
| `AnalyticsController` | 2.0에서 클라이언트 이벤트 수집을 계속할지, 계속한다면 어느 도메인(신규 analytics? business-api?)이 받을지 |
| `CharacterController` | 2.0(같이숲)에 AI 캐릭터 생성 기능이 남는지 — 캐릭터가 섬 주민 아바타로 흡수됐는지, 아니면 통째로 폐기인지 |
| `CharacterModerationController` | 위와 동일 결정에 종속(생성이 없으면 모더레이션도 없음) |
| `InGameCurrencyController`의 `POST /currency/earn` | island-shop이 소비만 다루므로, 범용 재화 "획득" 이벤트를 어느 도메인이 발행할지(quest·focus 각자 vs 공용 API) |
| `GroupNotificationBatchController`·`NotificationBatchController`·`NotificationTestController` | 이 배치/테스트 엔드포인트들을 신규 알림 서버(별도 레포)로 옮길지, data-api 에 남길지, 그냥 지울지 — 알림 서버 분리 설계의 소유권 결정에 달려 있음(`rank-overtake` 만 A5·D6로 이미 폐기 결정) |
| `ProfileController` | 2.0에 타인 프로필 열람 화면이 있는지 — 14종 화면 표(B15)에 없음 |
| `OccupationController` | 2.0에 "직업" 선택 개념이 남는지 — 남으면 `UserController`의 `PATCH .../occupation`도 같이 정해짐 |
| `UserController`의 `GET /users/nickname/check` | 닉네임 중복 사전확인을 별도 GET 으로 유지할지, `PATCH /me` 409 에러로만 처리할지(onboarding LLD:211 은 후자 뉘앙스지만 명시 결정 없음) |

## §6 영향 받는 테스트

### 컨트롤러 레벨 테스트

28개 중 **20개**만 전용 컨트롤러 테스트(`*ControllerTest.java`, MockMvc/WebTestClient 급)가 있다.

| 있음(20) | 없음(8) |
| --- | --- |
| `AnalyticsControllerTest`,`AuthControllerTest`,`FocusControllerTest`,`FriendControllerTest`,`PinControllerTest`,`GroupBetBatchControllerTest`,`GroupBetControllerTest`,`GroupBetQueryControllerTest`,`GroupChallengeControllerTest`,`GroupControllerTest`,`EquipmentControllerTest`,`InventoryControllerTest`,`LeagueBatchControllerTest`,`LeagueControllerTest`,`GroupNotificationBatchControllerTest`,`ProfileControllerTest`,`ScreenTimeControllerTest`,`StatsControllerTest`,`OccupationControllerTest`,`UserControllerTest` | `CharacterController`,`CharacterModerationController`,`InGameCurrencyController`,`ChallengeResultAckController`,`InviteLinkController`,`NotificationBatchController`,`NotificationTestController`,`AccountWithdrawalController` |

없음 8개 중 **서비스/통합 레벨 테스트라도 있는 것**: `CharacterGenerationServiceTest`·`CharacterModerationServiceTest`(character), `InGameCurrencyServiceTest`·`CurrencyLedgerServiceTest`·`InGameCurrencyConcurrencyTest`(currency), `ChallengeResultAckIntegrationTest`(challenge-result-ack), `InviteLinkIssueTest`·`InviteLinkServiceTest`·`InviteLinkQueryServiceTest`(invitelink), `NotificationBatchRetryTest`(notification-batch), `AccountWithdrawalServiceTest`·`AccountWithdrawalSettlementLockOrderIntegrationTest`(withdrawal). **컨트롤러도 서비스도 테스트가 전무한 것은 `NotificationTestController` 하나뿐** — 삭제해도 어떤 자동 테스트도 잡아주지 않는다.

### 간접 참조(리터럴 `/api/v1` 문자열을 담은 그 외 테스트)

컨트롤러 이름 패턴 밖에서 `/api/v1` 경로를 직접 조립/단언하는 파일 9개 — 컨트롤러 삭제 시 개별 확인 필요:

`config/InternalApiPropertiesTest.java`,`config/RequestSizeLimitFilterTest.java`,`config/JwtFilterTest.java`(공통 필터 테스트 — 레거시 경로를 예시로만 쓸 가능성, 필터 자체는 남음), `auth/service/LegacyLogoutDeviceIntegrationTest.java`, `group/GroupChallengeWindowTimeWireTest.java`, `internal/HostTransferIntegrationTest.java`, `internal/NotificationSettingsCommandIntegrationTest.java`, `invitelink/ClaimTest.java`, `invitelink/InviteLinkIssueTest.java`.
