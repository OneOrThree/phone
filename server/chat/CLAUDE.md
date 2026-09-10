# server/chat/ — chat service

Group chat for **gromo**. A **separate** Spring Boot project from `server/data-api/`:
its own Gradle build, its own database, its own package root (`com.oneorthree.chat`).
The two share **no code** — only two contracts, both listed below. Loads in addition to
the root `CLAUDE.md`. Run all commands from inside `server/chat/`.

## The two rules this service exists to enforce

Everything here is in service of these. If a change makes either harder to see, it is
the wrong change.

1. **Chat happens inside one island only.** "Island" (섬) is the 같이숲 world's word for
   a **group** — the storage-level entity is `groups` in Data API. Only active members of
   a group may subscribe to, read, or post in that group's room.
2. **You cannot enter chat while a focus session is running.** The unit is the *chat
   connection*, not the individual message: CONNECT, SUBSCRIBE, SEND and the REST reads
   are all refused. Messages from others keep piling up and are read afterwards.

Two consequences that are easy to forget:

- **Chat sends no push notifications.** Not connected means not notified. Unread volume
  surfaces only in the room list (`chat_read_cursors`). This is why blocking chat during
  focus costs the user nothing.
- **The server does not force-disconnect a session when focus starts.** It only guards
  the gates. A client that starts focusing is expected to unsubscribe itself; if it
  doesn't, nothing bad happens (no push, and sends are refused anyway).

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
- **Two places encode the topic path** (`ChatFanout.topicOf` and the regex in
  `StompAuthChannelInterceptor`). Change one without the other and subscriptions still
  work — only the authorization check silently stops matching.
- **`presence:*` is read-only here.** Data API owns it. A write or delete from this
  service would let chat cancel the focus rule.
- **The simple broker only knows subscribers in this JVM.** Cross-instance delivery is
  `fanout/` and nothing else. A missing `RedisMessageListenerContainer` bean is invisible
  on a single instance — `ChatWebSocketIntegrationTest` covers that regression.
- **Membership invalidation is TTL-only** (`chat.membership.cache-ttl-seconds`). Leaving a
  group takes effect up to that long later.
- **A subscription is authorized once, at SUBSCRIBE time.** Someone removed from a group
  keeps *receiving* until their socket closes — TTL does not help, because an established
  subscription is never re-checked. Sending and new subscriptions are still blocked.
  Accepted for now; fixing it needs either per-broadcast re-authorization (a membership
  lookup per subscriber) or a membership-change event from Data API.

## Redis keys (A19 namespace table)

Only these. Adding a pattern means updating `common/redis/RedisKeys` **and** the
architecture decision A19 table.

| Key | Writer | This service | Purpose |
| --- | --- | --- | --- |
| `cache:chat:member:{userId}` | chat | read/write | the user's island ids; service-private, never shared |
| `chat:fanout` | chat | pub/sub | cross-instance delivery |
| `presence:focus:{userId}` | **Data API** | **read only** | focus lease; existence is the signal, the value is not read |

Deployment gives the chat Redis user `presence:*` through a **separate read-only ACL
selector** (`%R~presence:*`) — A19 spells out why it cannot share a selector with the
writable patterns.

## API surface

The ticket (GROMO-292/293) predates the current conventions, so the endpoints were
designed fresh.

| | |
| --- | --- |
| `WS /ws/chat` | STOMP handshake — anonymous; auth happens in the CONNECT frame |
| `SEND /app/groups/{groupId}/send` | post a message; returns nothing (the broadcast is the ack) |
| `SUB /topic/groups/{groupId}` | that island's broadcast; members only |
| `SUB /user/queue/errors` | send failures, same `{code, message}` envelope |
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
