# server/realtime/ — 섬 실시간 서비스

**gromo**의 섬 실시간 서비스. 채팅은 이 프로세스의 기존 도메인이다. A **separate** Spring Boot project from `server/data-api/`:
its own Gradle build, its own database, its own package root (`com.oneorthree.realtime`).
The two share **no code** — their external contracts are listed below, including an optional current-membership HTTP provider. Loads in addition to
the root `CLAUDE.md`. Run all commands from inside `server/realtime/`.

## 서비스의 두 규칙

1. 채팅은 한 섬 안에서만 이루어진다. 섬은 Data API의 `groups`이며 활성 주민만 채팅을 조회·구독·발신한다.
2. 집중 중 채팅을 차단한다. CONNECT는 JWT 인증만 담당하고 집중 여부는 채팅 SUBSCRIBE·SEND·REST와
   기존 구독의 메시지 전달 직전에 검사한다. `/ws/realtime`으로 바뀌어도 채팅 제한은 유지한다.

집중 중에도 연결 자체는 허용한다. 집중/휴식 이벤트를 받을 연결과 채팅에 들어갈 권한은 다르다.
섬 채널 셋(`focus`·`rest`·`emotes`)은 GROMO-1765에서 열렸다 — 관전 둘은 인증만, 응원은 Data 정본으로
「그 섬의 본인 진행 세션(active·paused)」을 판정한다. 나머지 섬 채널(`events`·`playback`·`messages`)과 `/user/queue/events`는 각 도메인의
인가·복구 계약이 구현될 때까지 계속 닫혀 있다.

채팅은 푸시를 발송하지 않는다. 기존 `chat_read_cursors`는 본인의 읽은 위치를 나타내며 이번 개명에서
삭제하거나 의미를 바꾸지 않는다. 서버는 집중 시작에 소켓 전체를 끊지 않고 채팅 본문 전달을 차단한다.

## Stack

- Spring Boot 4.0.6 / Java 17 / Gradle — same versions as `server/data-api/`.
- WebSocket + STOMP (`SimpleBroker`) for realtime; **Redis Pub/Sub** for cross-instance fanout.
- Spring Data JPA + PostgreSQL (database `gromo_chat`), Flyway.
- Redis (Lettuce) — **a hard dependency**: fanout, membership cache and focus presence all sit on it.
- JJWT — validates the access token locally. It never issues one.

**Boot 4 gotchas that cost time here** (they differ from anything written for Boot 3):

- Jackson is **3.x** (`tools.jackson.databind.ObjectMapper`, not `com.fasterxml…`). The
  Spring-managed `ObjectMapper` bean is the Jackson 3 one; asking for the Jackson 2 type
  compiles (it is on the classpath transitively) but fails to inject at runtime.
  Jackson 3 has `java.time` support built in and its exceptions are unchecked.
- Spring 7 dropped `MappingJackson2MessageConverter` → use `JacksonJsonMessageConverter`.
- `@AutoConfigureMockMvc` moved to `org.springframework.boot.webmvc.test.autoconfigure`
  and needs `spring-boot-starter-webmvc-test`.
- There is no `@DataJpaTest` slice module wired here — repository tests use
  `@SpringBootTest` + `@Transactional`.

## Layout

Domain-based, mirroring `server/data-api/`'s conventions (see
`docs/conventions/backend-layering.md` at the repo root):

| Package | What lives there |
| --- | --- |
| `auth/` | `JwtValidator`, `@LoginUser` + resolver, `ChatPrincipal` (the STOMP session subject) |
| `config/` | Spring wiring only — `WebSocketConfig`, `StompAuthChannelInterceptor`, `ChatStompErrorHandler`, `JwtFilter`, `RedisConfig`, `ClockConfig` |
| `common/exception/` | The `{code, message}` envelope, `ErrorCode`, `DomainException`, the single `GlobalExceptionHandler` |
| `common/id/` | `UuidV7` (the **only** id source) + the Hibernate generator |
| `common/redis/` | `RedisKeys` — every Redis key this service touches, in one file |
| `membership/` | 기존 Redis 소속 캐시 + `client/GroupClient`; 옵션 ON의 전용 Data 현재 인가 client는 아래 별도 계약 |
| `presence/` | `FocusPresenceReader` — **read-only** view of `presence:focus:*` |
| `focus/` | 응원 도메인 — `IslandFocusSessions`(Data 정본 인가), `FocusEmoteService`, `FocusEmoteStompController` |
| `fanout/` | Redis Pub/Sub publish + subscribe, and local delivery |
| `message/` | The chat domain: controllers at the package root, `service/`, `repository/`(+`repository/domain/`), `dto/`, `exception/` |

Entity PKs are UUID v7 via `@GeneratedUuidV7`. Error responses use one envelope
`{code, message}` where `code` is the enum constant name — the app branches on it, so
**constant names are a contract**, and the STOMP error frame uses the same shape.

## Things that will bite you

- **Ids must come from `common/id/UuidV7`.** Calling `Generators.…().generate()` directly
  works and produces valid UUID v7s, but loses monotonicity *within a millisecond*
  (measured: ~50% inversions). Cursor paging, `hasMore`, and unread counts all rest on
  `id` ordering, so the damage shows up as "messages occasionally out of order" — never
  reproducible. The measurements are in that class's javadoc.
- **Three places encode the topic path** (`ChatFanout.topicOf` and the regexes in
  `StompAuthChannelInterceptor` and `ChatOutboundChannelInterceptor`). Change one without the other and subscriptions still
  work — only the authorization check silently stops matching.
- **`presence:*` is read-only here.** Data API owns it. A write or delete from this
  service would let chat cancel the focus rule.
- **The simple broker only knows subscribers in this JVM.** Cross-instance delivery is
  `fanout/` and nothing else. A missing `RedisMessageListenerContainer` bean is invisible
  on a single instance — `ChatWebSocketIntegrationTest` covers that regression.
- **현재 인가 옵션 OFF의 멤버십은 TTL 캐시** (`chat.membership.cache-ttl-seconds`)다. ON이면 지정된
  `requireCanChat` 경계가 PR753 Data 현재 인가를 매번 조회한다. 방 목록·duplicates·개인큐는 새 조회 범위가 아니다.
- **Messages are stored only through `ChatMessageAppender`, never `ChatMessageRepository.save`.**
  It takes a per-room advisory lock, reads the room's last id and inserts a strictly larger one,
  so within a room id order equals commit order (GROMO-1741). A plain `save` reopens the window
  where a smaller id commits later — a client scrolling up with a kept cursor skips it and the
  unread badge under-counts it — and lets a clock-skewed instance sort a new message before older ones.
- **`setPreserveReceiveOrder(true)` needs `WebSocketConfig.RejectAsErrorFrame`.** With receive order
  preserved, Spring's ordered decorator swallows `preSend` exceptions, so the gate's rejections
  (no token, other island, focusing) would never reach the client. The wrapper turns them into the
  ERROR frame itself. Remove the flag and one session's burst of SENDs is stored out of order.
- **만료된 access token은 `UNAUTHORIZED`로 거절한다.** CONNECT·SEND·SUBSCRIBE에서 검증하고,
  아웃바운드 채팅에서도 CONNECT 주체의 토큰을 다시 검증한다. 다른 기기가 멤버십 캐시를 갱신해도
  만료된 소켓은 채팅을 송수신할 수 없다. 전달 시 만료를 감지하면 실제 소켓을
  WebSocket 1008/UNAUTHORIZED로 종료하여 수신 전용 앱도 토큰을 갱신하고 다시 연결할 수 있다.
- **A resend is never re-broadcast.** `clientMessageId` makes `send` idempotent, and a resend
  returns the originally stored message — but it does *not* go to the room again, or every other
  member would see the same `messageId` twice. Since a successful STOMP send returns nothing (the
  broadcast *is* the ack), a resend would otherwise get no answer at all and the client would retry
  forever — so it is echoed to that one sender on `/user/queue/duplicates`. The destination lives in
  `ChatFanout.DUPLICATE_QUEUE` and the SUBSCRIBE allow-list reads that same constant.
- **A user destination without a session id reaches every session that user has.** The echo above
  carries the sending session's id for exactly this reason: a person with a phone and a tablet open
  would otherwise get one device's resend answer on the other, which already had the message from the
  first broadcast. `@SendToUser(broadcast = false)` is the annotation form of the same guard, and the
  error queue uses it.
- **기존 구독도 전달 직전에 재검사한다.** `ChatOutboundChannelInterceptor`가 JWT·집중 상태와
  멤버십을 다시 검사한다. Redis/상류 판정 실패는 본문 전달을 거절한다. 옵션 OFF의 멤버십 캐시는 TTL 방식이라
  탈퇴·강퇴가 캐시 만료까지 지연될 수 있다. ON의 기존 그룹 채팅은 Data 현재 인가를 조회하되
  최종 beforeHandle 이후 DB 변경과 TCP 전송을 원자화하지 않는다. 새 보호 채널은 이 연결만으로 열리지 않으며,
  현재 도메인의 권한 회수·시설 접근·스냅샷을 검증하기 전까지 활성화하지 않는다.

## Redis keys (A19 namespace table)

Only these. Adding a pattern means updating `common/redis/RedisKeys` **and** the
architecture decision A19 table.

| Key | Writer | This service | Purpose |
| --- | --- | --- | --- |
| `cache:chat:member:{userId}` | chat | read/write | the user's island ids; service-private, never shared |
| `chat:fanout` | chat | pub/sub | cross-instance delivery (채팅 전용 wire) |
| `chat:events:v1` | realtime | pub/sub | cross-instance delivery of **island events**; `{originInstanceId,destination,event}` |
| `lock:chat:emote:{islandId}:{userId}` | realtime | read/write | 응원 **성공** 창(3초). 존재가 곧 「이미 보냈다」 |
| `lock:chat:emote:try:{userId}` | realtime | read/write | 응원 **발신** 시도 창(600ms, **사용자 축**). 거절된 요청도 소모해 상류 조회를 누른다 |
| `lock:chat:emote:sub:{userId}` | realtime | read/write | 응원 **구독** 시도 창(600ms). SUBSCRIBE 도 상류 조회를 부르므로 같은 상한 |
| `presence:focus:{userId}` | **Data API** | **read only** | focus lease; existence is the signal, the value is not read |

**This ownership is a code convention, not an enforced boundary — yet.** A19 says the chat
Redis user should get `presence:*` through a **separate read-only ACL selector**
(`%R~presence:*`; A19 explains why it cannot share a selector with the writable patterns),
but no deployment applies it: the dev overlay runs stock Redis with no ACL file and no
credentials, so both services share the default all-access user. Until GROMO-1744 lands,
nothing stops this service from writing `presence:*` except the rule below — which means a
mistake here silently disables "no chat while focusing" instead of failing loudly.

Data API also keeps `presence:focus:{userId}:closed` in that namespace — a short-lived
"this session already ended" marker it uses to order its own writes. Chat never reads it,
and it is a *different key* from the lease, so the `hasKey` check is unaffected.

## API surface

The ticket (GROMO-292/293) predates the current conventions, so the endpoints were
designed fresh.

| | |
| --- | --- |
| `WS /ws/chat`, `WS /ws/realtime` | STOMP handshake — anonymous; auth happens in the CONNECT frame |
| `SEND /app/groups/{groupId}/send` | post a message; returns nothing (the broadcast is the ack) |
| `SUB /topic/groups/{groupId}` | that island's broadcast; members only |
| `SUB /user/queue/errors` | send failures, same `{code, message}` envelope |
| `SUB /user/queue/duplicates` | a resend's ack — the message already stored, sent to that sender only |
| `SUB /topic/islands/{islandId}/focus`, `/rest` | 섬의 집중·휴식 주민 갱신. **인증만** — 비소속 관전 개방(2026-09-19) |
| `SUB /topic/islands/{islandId}/emotes` | 응원 수신. 그 섬의 **본인 진행 세션(active·paused)** 이 있어야 한다 |
| `SEND /app/islands/{islandId}/focus/emotes` | 응원 발신, body `{sessionId,type}`. 성공은 브로드캐스트가 ack |
| `GET /api/v1/chat/rooms` | my islands + unread counts |
| `GET /api/v1/chat/rooms/{groupId}/messages?cursor&size` | history, newest → oldest |
| `POST /api/v1/chat/rooms/{groupId}/read` | advance the read cursor (forward only) |

No SpringDoc here — the real contract is the STOMP surface, which Swagger cannot express,
and three REST endpoints do not justify a second annotation vocabulary. This table is it.

## Profiles & commands

`dev`, `prod`, `ci`. **`ci` deliberately differs from data-api's**: it runs Flyway and
`ddl-auto: validate` so entity↔DDL drift fails in CI rather than at deploy boot
(the failure mode of GROMO-1506).

- `./gradlew test` — JUnit 5 + Testcontainers (**PostgreSQL and Redis**, neither mocked).
- `./gradlew checkstyleMain spotbugsMain` — style + static analysis.
- `./gradlew build` — everything.

## Database changes

Flyway, `src/main/resources/db/migration/V<N>__<desc>.sql`. Keep `docs/db/schema.dbml`
in sync and commit it **in the same commit** as the migration. Never edit an applied
migration — fix with `V<N+1>` (Flyway checksums them).

## Contracts with Data API

기존 두 계약과 선택적인 현재 인가 HTTP 계약이다. 모두 서비스 경계를 넘는 명시적인 읽기이며 DB를 공유하지 않는다:

1. `GET /api/v1/groups` with the requester's own access token → their island ids.
   `membership/client/GroupClient`가 기존 소속 캐시·방 목록에 사용한다. 새 옵션 ON의 특정 그룹
   채팅 검사는 아래3번을 쓰지만 방 목록까지 내부 현재 인가로 전환한 것은 아니다.
2. `presence:focus:{userId}` in shared Redis — Data API writes, chat reads.
   Data API's side is `common/port/FocusPresencePort` and is **best-effort**: if the lease
   write fails, focus still starts and chat stays open for that person.

3. 선택 `POST /internal/realtime/membership-authorization` — Data 제공자는 PR753으로 main에 있으나 기본 비활성이다. 켤 때는 Data를 먼저 활성화한다.
   전용 서비스 Bearer + 검증된 subject의 X-User-Id, body `{sessionId,authGeneration,islandId}`를 보내고
   평평한 `{allowed:boolean}`을 받는다. Data는 primary 한 SQL snapshot으로 사용자/세션/섬/소속을 확인한다.
4. Inbound `POST /internal/events` (GROMO-1943) — Data's canonical `user.withdrawn` envelope, authenticated by
   the Data-only token `SVC_TOKEN_DATA_TO_REALTIME` (no `X-User-Id`). `message/service/ChatUserFence` writes
   `user_tombstones` and deletes the user's `chat_read_cursors` under a per-user advisory lock; every cursor
   write goes through the same fence. Wired by GROMO-1954 (2026-09-19 R-1): Data's relay sends every `REALTIME`
   row here over HTTP by default, or over the `realtime-events` Kafka topic when both flags are on
   (`event/KafkaEventInbound`, `REALTIME_EVENTS_KAFKA_ENABLED`, default false). Both entrances call
   `event/InboundEventService`, which inserts `inbound_events(event_id)` first and applies only on first sight.
   Of the 14 app event types, `focus.member.updated` and `rest.member.updated` are now **delivered to STOMP**
   (GROMO-1765): `InboundEventService` converts the canonical 10-field outbox envelope to the 7-field
   `RealtimeEventEnvelope` (`subjectId`→`islandId`, `version`→`aggregateVersion`, `params`→`payload`) and calls
   `EventRouter`. The other 12 are still accepted-and-deduped only — their domain payload validators and
   authorization/recovery contracts do not exist yet. **A conversion failure never becomes a 400**: the event is
   still recorded and only delivery is skipped, because a 400 makes the relay mark the row permanent and that
   aggregate axis is blocked forever.
   Multi-instance fan-out **is** implemented, via Redis Pub/Sub on `chat:events:v1` (`RealtimeEventDelivery` +
   `RealtimeEventFanoutSubscriber`), not per-instance Kafka consumer groups — both entrances (HTTP behind a load
   balancer, Kafka group `realtime-v1`) land on a single instance, so redistribution covers both while a split
   consumer group would only fix Kafka.

5. `GET /internal/islands/{islandId}/focus-members` with the Realtime service token + the subject's `X-User-Id`
   (GROMO-1765) — the **authoritative** answer to "does this user have a progressing (active **or paused**)
   session in this island, in this session id". That list's filter is `[ACTIVE, PAUSED]`, so a resting user is
   carried with `status: "paused"` — which is why the 2026-09-20 decision needed no new surface.
   `focus/IslandFocusSessions` is the only caller; it never caches (LLD §4.2 forbids a stale TTL cache as final
   authorization evidence) and fails closed. Data's side needs the `realtime` caller allowlist entry in
   `application-realtime-authorization.yml` — without that profile and token, **emotes only** are rejected
   wholesale; chat and island watching are unaffected.

### 선택적 현재 멤버십 인가

`realtime.authorization-client.enabled`는 기본 false다. `ChatAccessGuard.requireCanChat`은
집중 여부를 먼저 확인하고, OFF이면 기존 캐시를 사용한다. ON이면 원 AT의 서명·subject/sid/gen/exp를
엄격히 검증한 뒤 Data 현재 인가를 호출하고 HTTP 대기 뒤 exp를 재확인한다. 양의 승인 캐시나
ON 실패 시 기존 캐시 fallback은 없다. `allowed:false`는 `NOT_A_MEMBER`이며 어떤 내부 조건이
실패했는지 추측하지 않는다. 로컬 invalid AT는401, 서비스401/403/404·5xx·malformed·timeout은503이다.

현재 연결 범위는 그룹 SUBSCRIBE, SEND 서비스, 히스토리 GET, 읽음 POST, 기존 그룹 outbound
`beforeHandle`이다. CONNECT·방 목록·duplicates·개인큐는 이 추가 조회 범위가 아니다.
새14개 이벤트·시설·snapshot·재연결·transport는 계속 닫혀 있고 host-transfer도 OFF다.
rooms 목록·개인 duplicates의 오래된 재전송 응답까지 현재 세션을 검사하는 것은 아니므로
“로그아웃 후 채팅 전체 즉시 차단”·“Realtime 전체 세션 철회 완료”로 설명하지 않는다.

같은 prefix의 `base-url`, `service-token`, `connect-timeout`, `request-timeout`, `max-in-flight`가
내부 HTTP의 대상·자격·연결/총deadline·동시수 상한을 정한다. 응답1KiB 제한, redirect 금지,
application-level 재시도0, 원 토큰/개인 body 로그 금지를 지킨다. 응답은 exactly allowed:boolean 한 필드다.
unknown/duplicate/trailing/빈본문/타입 오류는503이다. 초기값은 connect500ms/request1500ms/inflight16,
상한은 timeout10초/inflight64이며 실제 운영 부하 검증 결과를 뜻하지 않는다.

스위치 env는 `REALTIME_AUTHORIZATION_CLIENT_ENABLED`다. Data 제공자의 `REALTIME_MEMBERSHIP_AUTHORIZATION_ENABLED`와
**일부러 다른 이름**이다 — 합치면 공유 env 한 줄이 두 서비스를 동시에 켜서 아래 순서가 깨진다.
**자리표시자 이름만 다르게 두는 것으로는 막히지 않는다.** Spring 완화 바인딩은 env를 속성 키로 직접 읽고
(`REALTIME_MEMBERSHIP_AUTHORIZATION_ENABLED` → `realtime.membership-authorization.enabled`) yml 자리표시자보다 우선한다.
그래서 옛 prefix `realtime.membership-authorization`은 Data의 env로 켜졌고, prefix를 `realtime.authorization-client`로 옮겼다.
키를 추가·개명하면 그 키의 env 형태(대문자·`.`/`-`→`_`)가 Data나 다른 서비스의 env와 겹치지 않는지 확인하라 —
`RealtimeAuthorizationConfigTest`가 두 env를 함께 둔 실제 `application.yml` 우선순위로 이 회귀를 잡는다.
켜는 순서: Data(프로필·전용 토큰·feature) → Realtime client 주입 → sid/gen 없는 AT 소진 확인·부하 검증 → Realtime ON.
Data가 꺼진 채 Realtime만 켜면 404→503으로 그룹 채팅 경계가 전부 막힌다(ON에는 fallback이 없다).
main의 AT 발급 경로(로그인·게스트·갱신)는 이미 전부 sid/gen을 싣는다. 그래도 그 이전에 받은 AT는 ON에서
그룹 채팅 경계401이고, dev AT 수명은30일이다. 발급 지점 조사는 아래 문서의 「켜기 전 조건」에 있다.
DB 판정 뒤 beforeHandle/TCP까지의 분산 원자성이나 이미 보낸 프레임의 회수는 보장하지 않는다.
신규64개(HTTP35·verifier10·JWT11·config6·전달 가드2)를 포함한 전체 Realtime build는 `norm.sh` exit 0,
테스트205개(기존141+신규64)·실패0·오류0·skip0이다(2026-09-15).
실제 PostgreSQL/Redis 기존 회귀를 포함한다. CheckstyleMain·SpotBugsMain은 앞선 PASS 뒤 full에서
UP-TO-DATE였으며 테스트 소스 정적 검사 task는 기존 설정대로 skip이다. Realtime Docker 이미지 빌드도 통과했다(로컬 검증, 게시·배포 없음).
beforeHandle 검증은 실제 interceptor와
실제 TCP 가짜 Data 응답의 회귀이며, 운영 Data/Realtime 두 노드 production 연동 검증이 아니다.
ELI5의 Mermaid2개는 조정자가 CLI11.17.0으로 SVG 실렌더 exit0을 확인했다.

상세 ELI5와 검증 범위: [현재 멤버십 client](../../docs/architecture/realtime-current-membership-client.md).

Chat never touches the `gromo` database and Data API never touches `gromo_chat`.

## 신규 이벤트 골격과 활성화 경계

`event/EventRouter.route(RealtimeEventEnvelope, RealtimeAudience)`가 14종 이벤트의 단일 내부 진입점이다.
이름별 고정 목적지만 계산하고 payload의 destination을 거절한다. 개인 자산은 소유자 한 명의 개인큐로만,
공동 자산은 같은 섬으로만 보낸다. 필수 `schemaVersion: 1`과 안전 정수 자원 버전을 구분하고, payload version 일치·owner/currency 범위를 검사한다.
알 수 없거나 누락된 schemaVersion은 거절한다. emote도 schemaVersion은 1이고 aggregateVersion만 null이다.

`RealtimeEventDelivery`가 섬 목적지 전달을 담당한다(GROMO-1765) — 로컬 `SimpMessagingTemplate` 먼저,
그다음 `chat:events:v1` Redis 발행. 둘 중 어느 쪽이 실패해도 예외를 올리지 않는다: 이 메서드는
`InboundEventService`의 트랜잭션 안에서 불리므로 던지면 수신 기록까지 롤백돼 relay가 무한 재전달한다.
**개인 큐(`UserAudience`) 전달은 여전히 거절한다** — `/user/queue/events`가 허용목록에 없어 보내도 아무도
못 받고, event별 owner/방장 권한 재검사가 아직 없다.

응원 자격은 **진행 중(active·paused) 본인 세션**이다(2026-09-20 재영님 결정 — 휴식은 빠진 상태가 아니라
모닥불에 앉은 상태다). 거절되는 것은 완료·포기·남의 세션·다른 섬·비주민이다.

인가는 세 층이다: SUBSCRIBE(**구독 시도 창 → Data 정본 1회**) → SEND(**발신 시도 창[관문] → 형식 →
Data 정본 1회 → 성공 창**) → 전달 직전(`ChatOutboundChannelInterceptor` 가 **JWT 재검증 + 사건에
동반된 수신 집합 대조**).

**두 시도 창 모두 `StompAuthChannelInterceptor` 에서 잡는다 — 본문 변환보다 앞이다.** 컨트롤러 안에서
재면 `sessionId` 가 빠진 프레임은 `@Payload` 변환·`@Valid` 가 메서드 진입 전에 실패시켜 **창을 아예
안 거친다** — 가장 싼 거절만 공짜가 되는 구멍이다. 그 대신 `FocusEmoteService` 는 시도 창을 재지
않는다(이중 소모 방지). 발신 창과 구독 창의 키를 나눈 이유는 응원을 보낸 직후 재구독하는(재연결
직후가 그렇다) 클라이언트가 자기 발신 때문에 구독을 거절당하지 않게 하기 위해서다.

시도 창 초과 = ERROR 프레임 + 연결 종료(다른 관문 위반과 같다). 정상 클라이언트는 자기 성공 창(3초)
때문에 그 속도를 만들 수 없다. 사용자에게 보이는 429 는 성공 창이 개인 큐로 보낸다.

**구독은 «빈도»와 별개로 «누적»도 막는다.** `SimpleBroker` 는 구독을 연결이 끊길 때까지 들고 있어,
STOMP `id` 만 바꿔 반복하면 소켓 하나로 레지스트리 메모리를 계속 불릴 수 있다(관전 채널은 공개라
상류 조회조차 안 타서 가장 싸게 쌓인다). 빈도 창은 «조회 수»를 막지 «누적 수»를 막지 않는다 —
창마다 하나씩 꾸준히 쌓으면 걸리지 않는다. 그래서 `RealtimeSessionRegistry` 가 두 가지를 따로 센다:
**중복**(같은 목적지 재구독 → 사건 하나가 구독 수만큼 복제되는 증폭을 막는다)과
**총량**(세션당 `MAX_SUBSCRIPTIONS_PER_SESSION` = 64 → 임의 UUID 로 목적지를 바꿔도 막힌다).
하나만으로는 다른 하나가 샌다. 64 의 근거는 계정당 소속 상한(`GroupService.MAX_JOINED_GROUPS` = 10)
× 섬당 목적지 4(`focus`·`rest`·`emotes`·채팅) + 개인 큐 2 = **42** 에 약 50% 여유다.
**UNSUBSCRIBE 가 자리를 돌려주므로**(`id → destination` 으로 추적한다) 섬을 떠날 때 해지하는 정상
클라이언트는 이 상한에 닿지 않는다.

**SEND 의 빈도 제한이 둘인 것은 「거절도 비용을 치르게」 하기 위해서다.** 성공 창(사용자×섬 3초)만 두고
인가를 먼저 하면 임의의 다른 섬 UUID 로 보내는 거절 요청이 제한 키를 만들지도 않은 채 매번 Data 정본
조회를 불러, 인증된 사용자 하나가 동기 HTTP 로 STOMP 채널 스레드와 Data API 를 고갈시킬 수 있다.
그래서 **시도 창은 사용자 축**(섬을 키에 넣으면 UUID 만 바꿔 비켜 간다)이고 맨 앞에서 잰다 —
**상류 호출의 상한을 정의하는 것은 성공 창이 아니라 시도 창**이다.

**섬 프레임은 셋 모두 전달 직전에 JWT 를 다시 본다.** 섬 채널은 오래 열려 있는 구독이라 SUBSCRIBE 때
유효하던 AT 가 그 뒤 만료된다 — 관전이 「공개」라는 말은 *소속을 안 본다*이지 *아무나 받는다*가 아니다.
만료를 감지하면 프레임을 버리고 소켓도 1008/UNAUTHORIZED 로 닫는다(채팅 경로와 **같은 한 곳**을 쓴다).

**응원의 전달 직전 판정에 `presence:focus:*` 를 쓰지 않는다.** 그 사본은 Data 의 best-effort 쓰기라
양쪽으로 어긋난다 — 쓰기가 실패하면 정상 참가자의 응원이 전부 버려지고, 삭제가 유실되면 종료한
사용자가 TTL(13시간) 내내 계속 받는다. focus-rest-session LLD §6 이 「이 사본을 신규 emote 의 최종
인가 증거로 단독 사용하지 않는다」고 못 박아 뒀다. 대신 **사건마다 정본에서 나온 수신 집합**을
대조한다(`RealtimeEventDelivery.mayReceive`) — 그 집합은 발신이 이미 치른 조회 한 번에서 공짜로 나오므로
**추가 HTTP 가 0** 이고, 기록이 없거나 만료됐으면 fail-closed 다. 집합은 프로세스 안에 `eventId` 로
보관하고 프레임에서는 payload 의 `eventId` 로 되찾는다 — 커스텀 «메시지 헤더»로 싣는 방법을 먼저 썼다가
되돌렸다: `SimpleBrokerMessageHandler` 가 구독자별 메시지를 다시 만드는 과정에서 살아남지 않아
**전원이 fail-closed 로 막혔다**(실측). 팬아웃 봉투(`chat:events:v1`)는 다른 인스턴스에 같은 집합을 넘긴다.

14종 전체 payload 스키마, 신청 수신자의 현재 방장 권한, 시설 해금, 개인 큐 전달이 준비되어야
나머지 12종의 전달 adapter를 활성화할 수 있다.

계약: `docs/prd/fishcat/realtime-events/` (참고 티켓 1754). 기존 `chat:fanout` payload와 Redis 키·DB 이름·테이블은
호환 유지한다. `com.oneorthree.realtime`, `RealtimeApplication`, Gradle `realtime`과 CI/image/compose 이름만
서비스 개명에 맞춘다. 운영 환경의 `CHAT_DB_*`, `CHAT_WS_ALLOWED_ORIGINS`, `chat.*` 설정 키도 유지한다.

개발 overlay: `server/scripts/docker-compose.realtime.yml`, 서비스 이름 `realtime`, 이미지 override
`REALTIME_IMAGE`. 이전 overlay로 실행 중인 `chat` 서비스는 이번 변경이 자동 중지하지 않는다.
배포 시 기존 채팅 인스턴스에서 realtime 인스턴스로 전환하는 것은 별도 운영 절차다.
