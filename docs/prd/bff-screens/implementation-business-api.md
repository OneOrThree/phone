# Business 구현 — 화면 조회 14종

[정책](policy.md) B15~B23 · [Data 구현](implementation-data-api.md) · 흐름 그림 [diagrams/](diagrams/)

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
node ~/.claude/skills/archify/bin/archify.mjs deliver sequence docs/prd/bff-screens/diagrams/parallel-home.sequence.json /tmp/parallel-home.html --quality showcase --json
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
| `explore` | 03–07 · 59 | `GET /me/islands` | 소속 0개: `GET /islands/discover` / 그 외: `GET /islands?q=` | 검색의 전망대 미해금 403은 화면 403. 대기 신청 목록은 BG10 |
| `visit/{islandId}` | 60 · 61 | `GET /islands/{islandId}` (공개 요약·`joinRequestId`) | `joinRequestId`가 있으면 `GET /me/join-requests/{requestId}` | 없으면 `joinRequestAvailability:none` |
| `home` | 14–18 · 26 · 31 | 섬 문맥 | `GET /me/focus-summary` · `GET /focus-sessions/current` · `GET /islands/{islandId}/rest-members` · `GET /islands/{islandId}/shop/wallets` · 방송기 있으면 `GET /islands/{islandId}/playback` | 방송기 없음: `playbackAvailability:facility_locked`. rest 흡수는 BG11 |
| `focus` | 19–25 · 28 | `GET /focus-sessions/current` → 세션의 `islandId`, 없으면 섬 문맥 | `GET /islands/{islandId}/focus-members` · 방송기 있으면 `GET /islands/{islandId}/playback` | 세션 없음 정상. 방송기 없음은 `facility_locked` |
| `town-hall` | 39–44 · 41A | 섬 문맥 (`role`) | `GET /islands/{islandId}/members` · `…/shop/wallets` · `…/construction-options` · 방장이면 `…/join-requests` | 일반 주민: `joinRequestsAvailability:host_only`. 조회 뒤 위임돼 403이면 화면 403. 가계부는 BG10 |
| `library` | 32–38 | 섬 문맥 (도서관 완공) | `GET /islands/{islandId}/statistics/focus` · `…/statistics/screen-time` | 미완공: 기록 조각 null + `facility_locked`. 물고기 장은 BG10, 타 섬 경로는 BG11 |
| `board` | 45–55 | 섬 문맥 (게시판 완공·건설 목표) | `GET /islands/{islandId}/quests/current` · `…/notices` · `…/shop/wallets` | 미완공은 화면 403 `FACILITY_LOCKED` |
| `mailbox` | 63–66 | 섬 문맥 (우체통 완공) | Realtime `…/messages` 첫 페이지 · Data 편지함·친구(BG10) → 작성자 표시 정보 batch | Realtime 권한 거부는 화면 403. 표시 정보 장애를 탈퇴자로 바꾸지 않는다 |
| `shop` | 68–73 | 섬 문맥 (상점 완공) | `GET /islands/{islandId}/shop/wallets` · `…/shop/products?category=` · `…/inventory` | 미완공은 화면 403 |
| `playback` | 84 · 85 | 섬 문맥 (방송기 완공) | `GET /islands/{islandId}/inventory` · `…/playback` · `…/shop/products?category=sound` · `…/shop/wallets` | 미완공은 화면 403 `FACILITY_LOCKED` |
| `raft` | 76 · 77 | — | `GET /me` · `GET /me/inventory` · 받은 친구 요청 수(BG10) | 현재 섬 불필요 |
| `friends` | 78 · 79 | — | 친구 목록 · 받은·보낸 요청 (BG10) | 설계 전 비활성 |
| `account` | 80–83 | — | `GET /me` · `AccountSettingsUseCase` 조회(같은 프로세스, HTTP 재호출 없음) | 설정 정본은 Notification |

화면 조회가 없는 프레임: 01 약관(`GET` 1개), 08·30·62 항해(B17), 27·29 결과(B18), 56·57 공지 상세, 58 랭킹, 67 편지 상세, 74·75 구매 내역. 모두 앱이 도메인 경로를 한 번 부르거나 앞 응답으로 그린다.

## 5. 공통 규칙

- 조각 이름이 응답 키다(B26 확정): `me`·`memberships`·`islands`·`island`·`joinRequest`·`focusSummary`·`session`·`focusMembers`·`restMembers`·`wallets`·`playback`·`members`·`constructionOptions`·`joinRequests`·`focusStatistics`·`screenTimeStatistics`·`quests`·`notices`·`messages`·`letters`·`friends`·`friendRequests`·`products`·`sharedInventory`·`inventory`·`settings`.
- availability 필드(B26 확정): `joinRequestAvailability`(visit)·`playbackAvailability`(home·focus)·`joinRequestsAvailability`(town-hall)·`statisticsAvailability`(library, 값 `available`·`facility_locked`).
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
