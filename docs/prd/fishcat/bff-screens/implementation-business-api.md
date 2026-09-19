# Business 구현 — 화면 조회 14종

[정책](policy.md) B15~B27 · [Data 구현](implementation-data-api.md) · 흐름 그림 [diagrams/](diagrams/)

> **B24 (2026-09-15 확정):** 화면 조회는 Business가 도메인 내부 GET을 병렬로 조합하는 것이 기본이다. 같은 순간의 값이 필요한 화면만 개별 예외로 Data 단일 스냅샷 read-model을 쓴다. 화면 경로 이름은 B25, 응답 키·availability 이름은 B26으로 확정했다.

## 1. 흐름 네 가지

| 패턴 | 화면 | 그림 |
| --- | --- | --- |
| A. 섬 문맥 확인 뒤 조각 병렬 | `explore` · `visit` · `home` · `focus` · `library` · `board` · `shop` · `playback` | `diagrams/parallel-home.sequence.json` |
| B. 역할 확인 뒤 방장 조각 | `town-hall` | `diagrams/sequential-town-hall.sequence.json` |
| C. 다른 서비스 조각 포함 | `mailbox`(Realtime) · `account`(Notification) | `diagrams/cross-service-mailbox.sequence.json` |
| 병렬만 | `launch` · `raft` · `friends` | 패턴 A에서 섬 문맥 단계만 뺀 형태 |
| 명령 (화면 조회 아님) | 집중·건설·구매·가입·공지 등 기존 도메인 명령 | `diagrams/command-realtime-focus.sequence.json` |

전체 구성은 `diagrams/overview.architecture.json`이다. 그림은 [archify](https://github.com/tt-a1i/archify)로 렌더한다.

```bash
node ~/.claude/skills/archify/bin/archify.mjs deliver sequence docs/prd/fishcat/bff-screens/diagrams/parallel-home.sequence.json /tmp/parallel-home.html --quality showcase --json
```

렌더된 HTML(파일당 약 800KB)은 커밋하지 않는다. 원본 JSON만 둔다.

## 2. 이미 있는 것 — 새로 만들지 않는다

| 필요 | main에 있는 곳 |
| --- | --- |
| AT 검증·외부 `X-User-Id` 폐기 | `config/AccessTokenFilter` · `auth/LoginUser` |
| requestId·`{data}` 봉투·오류 형식 | `config/RequestEnvelopeFilter` · `common/api/ApiResponseAdvice` |
| 공유 deadline·병렬 조각·취소·큐 포화 | `common/http/ScreenComposer` · `Deadline` · `ReadFragment` |
| 내부 호출·재시도·오류 분류 | `common/http/InternalHttpClient` · `upstream/data/DataApiClient` · `upstream/notification/NotificationApiClient` |
| 공개 경로 등록 | `common/api/PublicApiRoutes`에 `/screens/**` 등록됨 · `server/scripts/nginx-satellites.include.conf.example` |
| 알림 설정 조회 | `usecase/AccountSettingsUseCase` (`GET /me/settings`) |
| 계약 테스트 기반 | `src/test/.../support/MockUpstream` · `UpstreamTestBase` |

## 3. 추가할 것

| 파일 | 내용 |
| --- | --- |
| `api/ScreenController` | `GET /screens/*` 14개를 한 클래스에 둔다. query 검증만 하고 유스케이스에 넘긴다 |
| `usecase/ScreenReadUseCase` | 화면별 메서드. `ScreenComposer.start`로 context를 만들고, 단계마다 같은 context로 `compose`를 부른다 |
| `upstream/data/DataApiClient` | 조각별 경로 상수와 GET 메서드. 임의 URL을 받지 않는 기존 규칙을 따른다 |
| `upstream/data/dto/*` | 도메인 LLD 공개 DTO record. 도메인 패스스루와 같은 record를 공유한다. `Map`·`JsonNode`를 그대로 응답에 싣지 않는다 |
| `upstream/realtime/RealtimeApiClient` | `mailbox`의 섬 편지방 조각 전용. 새 서비스 토큰 audience는 realtime |
| `api/<화면>ScreenContractTest` | 화면당 1개. §6의 세 경우 |

화면 응답 전용 DTO 클래스는 만들지 않는다. `compose`가 돌려준 조각 맵(값은 typed record)에 `…Availability`를 더해 `{data}`로 한 번 감싼다. 응답 모양은 계약 테스트가 고정한다.

```java
// ponytail: 화면 DTO 클래스 없음 — 조각 이름이 계약이다. OpenAPI 문서가 필요해지면 화면별 record로 올린다.
// ponytail: 유스케이스 한 클래스 — 500줄을 넘으면 장소별(섬·건물·내 뗏목)로 나눈다.
```

## 4. 화면별 조각

경로는 앱이 보는 도메인 공개 경로다. Data 내부 경로 대응은 [Data 구현](implementation-data-api.md) §2에 있다.

**섬 문맥**은 `GET /me/islands`의 `currentIslandId` → `GET /islands/{islandId}`(시설·역할)를 순서대로 부르는 두 단계다. 현재 섬이 null이면 BG01을 따르고 임의로 섬을 고르지 않는다.

| 화면 | 기획 프레임 | 먼저 (순차) | 그다음 (병렬 조각) | N 상태·실패 |
| --- | --- | --- | --- | --- |
| `launch` | 02 · 09–13 | — | `GET /me` · `GET /me/islands` · `GET /focus-sessions/current` | 세션 없음은 `session:null` 정상 |
| `explore` | 03–07 · 59 | `GET /me/islands` | 소속 0개: `GET /islands/discover` / 그 외: `GET /islands?q=` | 검색의 전망대 미해금 403은 화면 403. 대기 신청 목록은 `GET /me/join-requests`(GROMO-1895 — BG10 해소, 조합 배선은 화면 티켓 몫) |
| `visit/{islandId}` | 60 · 61 | `GET /islands/{islandId}` (공개 요약·`joinRequestId`) | `GET /islands/{islandId}/members`(2026-09-19 결정 V-읽기) + `joinRequestId`가 있으면 `GET /me/join-requests/{requestId}` | 요청이 없으면 `joinRequestAvailability:none` |
| `home` | 14–18 · 26 · 31 | 섬 문맥 | `GET /me/focus-summary` · `GET /focus-sessions/current` · `GET /islands/{islandId}/rest-members` · `GET /islands/{islandId}/shop/wallets` · 방송기 있으면 `GET /islands/{islandId}/playback` | 방송기 없음: `playbackAvailability:facility_locked`. rest 흡수 확정(BG11 home 해소, 2026-09-19) — `restMembers` 는 필수 조각 |
| `focus` | 19–25 · 28 | `GET /focus-sessions/current` → 세션 있으면 그 `islandId`로 `GET /islands/{islandId}`(시설·역할), 없으면 섬 문맥 | `GET /islands/{islandId}/focus-members` · 방송기 완공이면 `GET /islands/{islandId}/playback` | 세션 없음 정상. 방송기 미완공은 `playback` 조각만 N(`playbackAvailability:facility_locked`) — 화면 전체는 그대로 200(B03·아래 각주) |
| `town-hall` | 39–44 · 41A | 섬 문맥 (`role`) | `GET /islands/{islandId}/members` · `…/shop/wallets` · `…/construction-options` · 방장이면 `…/join-requests` | 일반 주민: `joinRequestsAvailability:host_only`. 조회 뒤 위임돼 403이면 화면 403. 가계부는 `GET /islands/{islandId}/resources/ledger`(GROMO-1895, 조합 배선은 화면 티켓 몫) |
| `library` | 32–38 | 섬 문맥 (도서관 완공) | `GET /islands/{islandId}/statistics/focus` · `…/statistics/screen-time` | 미완공: 기록 조각 null + `facility_locked`. 물고기 장은 `GET /islands/{islandId}/statistics/fish-earnings`(GROMO-1895, 도서관 게이트 `LIBRARY_LOCKED`), 타 섬 경로는 BG11. 구현(GROMO-1898): 섬 상세에 시설 필드가 없어 완공은 `…/construction-options` 의 `items`(미완공 건물만)로 판정한다. 기록 GET(1769) 전까지 완공이면 두 기록 조각은 `missingFragments`·`statisticsAvailability:null` |
| `board` | 45–55 | 섬 문맥 (게시판 완공·건설 목표) | `GET /islands/{islandId}/quests/current` · `…/notices` · `…/shop/wallets` | 미완공은 화면 403 `FACILITY_LOCKED` |
| `mailbox` | 63–66 | 섬 문맥 (우체통 완공) | Realtime `…/messages` 첫 페이지 · Data 편지함·친구([friend-letter](../friend-letter/) 설계 완료 — BG10 해소) → 작성자 표시 정보 batch | Realtime 권한 거부는 화면 403. 표시 정보 장애를 탈퇴자로 바꾸지 않는다. 구현(GROMO-1899): 인가는 편지방 조각의 Data `mailbox-access` 가 하고, 작성자 표시 batch 는 POST 라 병렬 조각 밖에서 같은 deadline 으로 잇는다. `letters` 는 받은 편지함 첫 페이지 |
| `shop` | 68–73 | 섬 문맥 (상점 완공) | `GET /islands/{islandId}/shop/wallets` · `…/shop/products?category=` · `…/inventory` | 미완공은 화면 403. 구현(GROMO-1898): 상점을 가리는 도메인 GET 이 없어 `…/construction-options` 로 완공을 먼저 판정한다. 지갑·상품 GET(1781) 전까지 `wallets`·`products` 는 `missingFragments`, `category` query 는 상품 GET 과 함께 연다 |
| `playback` | 84 · 85 | 섬 문맥 (방송기 완공) | `GET /islands/{islandId}/inventory` · `…/playback` · `…/shop/products?category=sound` · `…/shop/wallets` | 미완공은 화면 403 `FACILITY_LOCKED` |
| `raft` | 76 · 77 | — | `GET /me` · `GET /me/inventory` · 받은 친구 요청 수([friend-letter](../friend-letter/) HLD §3 — 요청 배열의 길이, BG10 해소) | 현재 섬 불필요 |
| `friends` | 78 · 79 | — | 친구 목록 · 받은·보낸 요청 ([friend-letter](../friend-letter/) §1.15 내부 GET) | 설계 완료(BG10 해소). 구현(GROMO-1899): 받은 요청은 raft 와 같은 `friendRequests`, 보낸 요청은 `sentFriendRequests`. query `date` 만 받아 도메인에 넘긴다 |
| `account` | 80–83 | — | `GET /me` · `NotificationApiClient.getSettings()`(순수 GET, Notification) | 설정 정본은 Notification. `AccountSettingsUseCase.read()`는 재사용하지 않음. 응답은 공개 계약 모양으로 투영(아래 각주) |

### 4.1 `missingFragments` 현황 (정책 B27)

origin/main `ScreenReadUseCase`(`ddc4a9218`, 2026-09-19) 기준. 목록에 있는 조각은 명시 `null` 이고 해당 상류를 부르지 않는다. 표에 없는 화면(`launch`·`explore`·`visit`·`focus`·`mailbox`·`raft`·`friends`·`account`)은 키가 없다.

| 화면 | `missingFragments` (배열 순서 그대로) | 조건 | 빠진 도메인 GET | 사라지는 시점 |
| --- | --- | --- | --- | --- |
| `home` | `["wallets"]` | 항상 | `GET /islands/{islandId}/shop/wallets` | 상점 지갑 GET 연결 PR 머지 때 (진행 중) |
| `town-hall` | `["wallets"]` | 항상 (방장·일반 주민 모두) | 같음 | 같음 |
| `board` | `["wallets"]` | 게시판 완공(미완공은 화면 403) | 같음 | 같음 |
| `shop` | `["wallets","products"]` | 상점 완공(미완공은 화면 403, 키 없음) | `…/shop/wallets` · `…/shop/products?category=` | 상점 지갑·상품 연결 PR 머지 때 (진행 중) |
| `playback` | `["products","wallets"]` | 방송기 완공(미완공은 화면 403) | `…/shop/products?category=sound` · `…/shop/wallets` | 같음 |
| `library` | `["focusStatistics","screenTimeStatistics"]` · `statisticsAvailability:null` | 도서관 완공만. 미완공은 키 없이 `statisticsAvailability:facility_locked` | `…/statistics/focus` · `…/statistics/screen-time` (1769) | 도서관 기록 연결 PR 머지 때 (진행 중) |

지갑·상품(상점)과 도서관 기록 조각은 지금 다른 작업이 연결하고 있다. 그 PR 이 머지되면 위 행은 사라지고 표에 남는 화면이 없으면 이 절은 「현재 없음」으로 줄인다. 행을 지우는 것은 그 연결 PR 의 몫이다(B27 ④).

화면 조회가 없는 프레임: 01 약관(`GET` 1개), 08·30·62 항해(B17), 27·29 결과(B18), 56·57 공지 상세, 58 랭킹, 67 편지 상세, 74·75 구매 내역. 모두 앱이 도메인 경로를 한 번 부르거나 앞 응답으로 그린다.

`focus`의 순차 단계는 세션이 있어도 `GET /islands/{islandId}`(섬 시설·역할)를 반드시 부른다. 세션의 `islandId`로 바로 병렬 조각(특히 `playback`)만 부르고 섬 문맥을 건너뛰면, 방송기 완공 여부를 판단할 재료가 없어 필수 조각 취급인 `GET /islands/{islandId}/playback`을 무조건 호출하게 되고 미완공 섬에서는 그 호출이 도메인 403을 반환한다. §5의 "N은 앞 단계 응답으로 판단해 호출 자체를 생략한다"와 policy.md B03("N은 검증된 비적용으로 조회하지 않음. 실제403은 전체 실패")에 따라 이 403은 `playback` 조각만이 아니라 화면 전체 실패로 번진다. 섬 문맥 호출로 시설 완공 여부를 먼저 확인해야 `playback` 호출 자체를 생략하고 그 조각만 N(`facility_locked`)으로 내릴 수 있다. 지금 섬 상세 응답에는 시설 필드(`buildings`)가 아직 없어, `home`·`focus`는 섬 문맥 뒤 병렬 단계에서 `GET /islands/{islandId}/construction-options`를 함께 읽어 판정한다(GROMO-1897) — `items`는 완공하지 않은 건물만 담으므로 `gram`이 없으면 완공이다. 이 판정 재료는 응답에 싣지 않는다. 섬 상세에 시설 필드가 생기면 그쪽으로 옮긴다.

`account` 조각은 `AccountSettingsUseCase`(§2)를 그대로 부르지 않는다. `AccountSettingsUseCase.read()`(`server/business-api/.../usecase/AccountSettingsUseCase.java:28-34`)는 내부에서 `NotificationApiClient.initializedSettings()`를 호출하고, 그 메서드는 POST `.../notification-settings/initialized`를 보낸다(`NotificationApiClient.java:136-144`). 화면 병렬 조합의 각 조각은 `UpstreamRequestContext.forReads()`가 만든 읽기 전용 context를 공유하고, `UpstreamRequestContext.validate()`가 GET 외 호출을 예외로 막는다(`UpstreamRequestContext.java:104-106`, "화면 병렬 조합은 독립 GET만 허용합니다") — 그대로 조각에 넣으면 `account` 화면이 실행 시점에 매번 실패한다. 같은 클라이언트의 `getSettings()`(`NotificationApiClient.java:105-111`)는 순수 GET `/internal/users/{userId}/notification-settings`이라 조합기 제약을 지킨다. 설정 미초기화 시 baseline을 만드는 쓰기는 화면 조회가 아니라 기존 `GET /me/settings`(`AccountSettingsController`, §2)가 별도 명령으로 계속 처리한다.

**`settings` 조각은 상류 응답을 그대로 싣지 않는다.** `getSettings()` 의 반환 타입 `NotificationSettingsView`(`server/business-api/.../upstream/notification/dto/NotificationSettingsView.java:14-19`)는 `notificationEnabled`·`soundEnabled`·`nightModeEnabled`·`nightStartTime`·`nightEndTime` 5필드인데, 도메인 공개 계약 `GET /me/settings` 는 `{"data":{"notifications": true}}` 로 boolean 하나다([account LLD](../account/low-level-design.md):249). §5 의 「조각의 typed record 를 그대로 응답 키에 싣는다」를 여기에 그대로 적용하면 `/screens/account` 의 `settings` 가 같은 이름의 도메인 계약과 다른 모양이 된다. **`notificationEnabled` 를 공개 `notifications` 로 투영하는 한 단계를 조각 안에 둔다** — 나머지 4필드를 화면에 내보낼지는 공개 계약을 먼저 넓혀야 하는 별도 결정이다.

## 5. 공통 규칙

- 조각 이름이 응답 키다(B26 확정): `me`·`memberships`·`islands`·`island`·`joinRequest`·`focusSummary`·`session`·`focusMembers`·`restMembers`·`wallets`·`playback`·`members`·`constructionOptions`·`joinRequests`·`focusStatistics`·`screenTimeStatistics`·`quests`·`notices`·`messages`·`letters`·`friends`·`friendRequests`·`sentFriendRequests`·`products`·`sharedInventory`·`inventory`·`settings`.
- availability 필드(B26 확정): `joinRequestAvailability`(visit)·`playbackAvailability`(home·focus)·`joinRequestsAvailability`(town-hall)·`statisticsAvailability`(library, 값 `available`·`facility_locked`).
- 도메인 GET 이 아직 없는 조각은 `missingFragments`(B27) — 명시 `null` + 이름 배열, 없으면 키 생략. availability 로 위장하지 않고, 그 조각의 availability 는 `null` 이다. 현황은 §4.1.
- 화면 전체 `asOf`는 두지 않는다(B07 개정). 조각마다 온 `serverNow`·`asOf`·`version`을 그대로 둔다.
- 모든 조각은 `required=true`로 시작한다(B04). 선택 조각을 두려면 B05를 먼저 개정한다.
- N은 앞 단계 응답으로 판단해 **호출 자체를 생략**한다. 도메인 403을 N 상태로 바꾸지 않는다(B03).
- 화면 조회에는 cursor를 받지 않는다. 다음 페이지는 도메인 GET이 이어받는다(B10).
- 오류 변환·deadline·큐 포화는 [LLD §5](low-level-design.md)의 표를 그대로 쓴다. 전체 3초, pool16/queue64는 `ScreenComposer` 설정값이다.
- 로그는 기존 규칙대로 requestId·화면·조각 이름·결과만 남긴다. 사용자·섬 ID를 metric label로 쓰지 않는다.

## 6. 테스트 — 화면당 계약 테스트 1개

`MockUpstream`으로 상류를 세우고 세 경우를 확인한다.

1. 정상: 응답 키와 조각 DTO 필드가 도메인 계약과 같고 `Cache-Control: no-store`다.
2. N: 생략 조건이면 해당 상류가 **호출되지 않고** `…Availability`가 채워진다.
3. 실패: 필수 조각 403·502는 화면 전체 같은 상태, 전체 deadline 초과는 504다.

구현을 되돌려 해당 케이스만 실패하는지 확인한 뒤 테스트를 믿는다.

## 7. 착수 순서

재료 도메인이 머지된 화면부터 붙인다. data-api main(`df38072b4`)에서 새 섬 도메인 클래스(`FocusSessionDetail`·`Construction*`·`IslandQuest*`·`ShopProduct`·`Playback*`·`IslandNotice*`) 검색 결과는 0건이다.

각 순서의 화면을 켜는 PR은 **그 도메인의 레거시 `/api/v1` 컨트롤러도 같은 PR에서 지운다**(아키텍처 A24). 1.x 데이터는 이관하지 않고, 운영 중인 1.x는 `release` 라인이 계속 서빙하므로 `main`에서 지워도 영향이 없다.

| 순서 | 화면 | 필요한 도메인 LLD |
| --- | --- | --- |
| 1 | `launch` · `raft` · `account` | account · island-appearance · island-membership · focus-rest-session |
| 2 | `explore` · `visit` | island-membership |
| 3 | `home` · `focus` | island-membership · focus-rest-session · island-shop · island-playback |
| 4 | `town-hall` | island-management · island-construction · island-shop |
| 5 | `board` | island-quests · island-board · island-shop |
| 6 | `shop` · `playback` | island-shop · island-appearance · island-playback |
| 7 | `library` | island-records |
| 8 | `mailbox` · `friends` | island-mailbox · 친구·편지(BG10) |

순서 1의 `GET /internal/users/{userId}`(`GET /me` 대응)는 [Data 구현](implementation-data-api.md) §3의 `'GET /internal/users/*'` 경고를 먼저 해소해야 business caller 허용목록에 넣을 수 있다 — 그대로 추가하면 같은 세그먼트 패턴의 `notification-snapshot` 전수 조회도 함께 연다.
