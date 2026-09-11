# server/realtime/ — 섬 실시간 서비스

**gromo**의 섬 실시간 서비스. 채팅은 이 프로세스의 기존 도메인이다. A **separate** Spring Boot project from `server/data-api/`:
its own Gradle build, its own database, its own package root (`com.oneorthree.realtime`).
The two share **no code** — only two contracts, both listed below. Loads in addition to
the root `CLAUDE.md`. Run all commands from inside `server/realtime/`.

## 서비스의 두 규칙

1. 채팅은 한 섬 안에서만 이루어진다. 섬은 Data API의 `groups`이며 활성 주민만 채팅을 조회·구독·발신한다.
2. 집중 중 채팅을 차단한다. CONNECT는 JWT 인증만 담당하고 집중 여부는 채팅 SUBSCRIBE·SEND·REST와
   기존 구독의 메시지 전달 직전에 검사한다. `/ws/realtime`으로 바뀌어도 채팅 제한은 유지한다.

집중 중에도 연결 자체는 허용한다. 향후 집중/휴식 이벤트를 받을 연결과 채팅에 들어갈 권한은 다르다.
현재 새 섬 채널은 도메인 인가·스냅샷·권한 회수 구현 전이라 모두 닫혀 있다.

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
| `membership/` | "Is this person on this island" + its Redis cache; `client/GroupClient` is the only outbound call |
| `presence/` | `FocusPresenceReader` — **read-only** view of `presence:focus:*` |
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
- **Membership invalidation is TTL-only** (`chat.membership.cache-ttl-seconds`). Leaving a
  group takes effect up to that long later.
- **`id` is assigned at INSERT, not at COMMIT.** A smaller id can commit later, so a client
  scrolling upward with a kept cursor can miss that one message, and the unread badge can
  under-count it. The message itself is not lost — it is committed and shows up on the newest
  page. The window is INSERT→COMMIT of a single-row insert (microseconds). Closing it properly
  needs a commit-ordered sequence; tracked as a follow-up.
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
  멤버십을 다시 검사한다. Redis/상류 판정 실패는 본문 전달을 거절한다. 기존 멤버십 캐시는 TTL 방식이라
  탈퇴·강퇴는 캐시 만료까지 지연될 수 있다. 새 보호 채널은 이 한계를 그대로 승계하지 않으며,
  현재 도메인의 권한 회수·시설 접근·스냅샷을 검증하기 전까지 활성화하지 않는다.

## Redis keys (A19 namespace table)

Only these. Adding a pattern means updating `common/redis/RedisKeys` **and** the
architecture decision A19 table.

| Key | Writer | This service | Purpose |
| --- | --- | --- | --- |
| `cache:chat:member:{userId}` | chat | read/write | the user's island ids; service-private, never shared |
| `chat:fanout` | chat | pub/sub | cross-instance delivery |
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

Only two, and both are one-directional:

1. `GET /api/v1/groups` with the requester's own access token → their island ids.
   Called only from `membership/client/GroupClient`. Target architecture A9 moves this to
   `/internal/*` + a service token; that surface does not exist yet (epic 1643), and when
   it lands only that one class changes.
2. `presence:focus:{userId}` in shared Redis — Data API writes, chat reads.
   Data API's side is `common/port/FocusPresencePort` and is **best-effort**: if the lease
   write fails, focus still starts and chat stays open for that person.

Chat never touches the `gromo` database and Data API never touches `gromo_chat`.

## 신규 이벤트 골격과 활성화 경계

`event/EventRouter.route(RealtimeEventEnvelope, RealtimeAudience)`가 14종 이벤트의 단일 내부 진입점이다.
이름별 고정 목적지만 계산하고 payload의 destination을 거절한다. 개인 자산은 소유자 한 명의 개인큐로만,
공동 자산은 같은 섬으로만 보낸다. 필수 `schemaVersion: 1`과 안전 정수 자원 버전을 구분하고, payload version 일치·owner/currency 범위를 검사한다.
알 수 없거나 누락된 schemaVersion은 거절한다. emote도 schemaVersion은 1이고 aggregateVersion만 null이다.

`DisabledRealtimeDelivery`는 항상 거절한다. 새 SUBSCRIBE/SEND 및 새 채널의 아웃바운드도 닫혀 있다.
새 생산자 HTTP endpoint·Redis fanout 채널·샘플 메시지는 만들지 않았다. 14종 전체 payload 스키마,
신청 수신자의 현재 방장 권한, 시설 해금, focus/rest 투영 버전, 재연결 스냅샷/구독 완료 확인,
다중 인스턴스 권한 철회가 준비되어야 각 도메인 작업에서 전달 adapter를 활성화할 수 있다.

계약: `docs/prd/realtime-events/` (참고 티켓 1754). 기존 `chat:fanout` payload와 Redis 키·DB 이름·테이블은
호환 유지한다. `com.oneorthree.realtime`, `RealtimeApplication`, Gradle `realtime`과 CI/image/compose 이름만
서비스 개명에 맞춘다. 운영 환경의 `CHAT_DB_*`, `CHAT_WS_ALLOWED_ORIGINS`, `chat.*` 설정 키도 유지한다.

개발 overlay: `server/scripts/docker-compose.realtime.yml`, 서비스 이름 `realtime`, 이미지 override
`REALTIME_IMAGE`. 이전 overlay로 실행 중인 `chat` 서비스는 이번 변경이 자동 중지하지 않는다.
배포 시 기존 채팅 인스턴스에서 realtime 인스턴스로 전환하는 것은 별도 운영 절차다.
