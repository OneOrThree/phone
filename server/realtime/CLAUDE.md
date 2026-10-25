# server/realtime/ — 섬 실시간 서비스

**gromo**의 섬 실시간 서비스. 채팅은 이 프로세스의 기존 도메인이다. A **separate** Spring Boot project from `server/data-api/`:
its own Gradle build, its own database, its own package root (`com.oneorthree.realtime`).
The two share **no code** — their external contracts are listed below, including an optional current-membership HTTP provider. Loads in addition to
the root `CLAUDE.md`. Run all commands from inside `server/realtime/`.

## 서비스의 두 규칙

1. 채팅은 한 섬 안에서만 이루어진다. 섬은 Data API의 `islands`이며 활성 주민만 채팅을 조회·구독·발신한다.
2. 집중 중 채팅을 차단한다. CONNECT는 JWT 인증만 담당하고 집중 여부는 채팅 SUBSCRIBE·SEND·REST와
   기존 구독의 메시지 전달 직전에 검사한다. `/ws/realtime`으로 바뀌어도 채팅 제한은 유지한다.

집중 중에도 연결 자체는 허용한다. 집중/휴식 이벤트를 받을 연결과 채팅에 들어갈 권한은 다르다.
섬 채널 셋(`focus`·`rest`·`emotes`)은 GROMO-1765에서 열렸다 — 관전 둘은 인증만, 응원은 Data 정본으로
「그 섬의 본인 진행 세션(active·paused)」을 판정한다. `events` 는 GROMO-2302에서 **현재 소속 주민**에게 열렸다(구독 1회 +
전달 직전 프레임마다 캐시 멤버십 재검사, 지금 실리는 사건은 `island.member.arrived` 하나). 나머지 섬 채널(`playback`·`messages`)과
`/user/queue/events`는 각 도메인의 인가·복구 계약이 구현될 때까지 계속 닫혀 있다.

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
| `block/` | 받는 사람 기준 차단 — `BlockedUsers`(세대 캐시·fail-closed 판정), `client/BlockClient`(Data 정본 조회, GROMO-2182) |
| `sea/` | 먼바다 방(GROMO-2300) — `SeaRooms`(Redis 배정·퇴장 Lua), `SeaRoomPublisher`(로컬 + `chat:sea:v1`), `SeaStompController`·`SeaEmoteStompController`, `SeaAdriftSweeper`(떠 있는 채 10분 정리, 전용 데몬 60초) |
| `fanout/` | Redis Pub/Sub publish + subscribe, and local delivery |
| `message/` | The chat domain: controllers at the package root, `service/`, `repository/`(+`repository/domain/`), `dto/`, `exception/` |

Entity PKs are UUID v7 via `@GeneratedUuidV7`. Error responses use one envelope
`{code, message}` where `code` is the enum constant name — the app branches on it, so
**constant names are a contract**, and the STOMP error frame uses the same shape.

## Things that will bite you

- **A sea-room SET ghost is cleaned by the snapshot.** A member whose `sea:user:{id}` hash expired stays in
  `sea:room:{roomId}:members` (a later JOIN keeps extending the SET TTL) and holds capacity forever; `SeaRooms.membersOf`
  (snapshot) calls LEAVE's no-hash branch to SREM it. No event is emitted. Two small windows remain (both
  recovered by the app's periodic `sync` → `NOT_IN_SEA_ROOM` → re-`enter`, decision N39): if that user rejoins the same
  room between the pipeline read and the heal, LEAVE's `cur == roomId` branch evicts them without an event; and a healed
  room is **not** put back into `sea:rooms:open` by the heal — the freed seat becomes a candidate again only at the next
  normal JOIN/LEAVE on that room.
- **Ids must come from `common/id/UuidV7`.** Calling `Generators.…().generate()` directly
  works and produces valid UUID v7s, but loses monotonicity *within a millisecond*
  (measured: ~50% inversions). Cursor paging, `hasMore`, and unread counts all rest on
  `id` ordering, so the damage shows up as "messages occasionally out of order" — never
  reproducible. The measurements are in that class's javadoc.
- **Three places encode the topic path** (`ChatFanout.topicOf` and the regexes in
  `StompAuthChannelInterceptor` and `ChatOutboundChannelInterceptor`). Change one without the other and subscriptions still
  work — only the authorization check silently stops matching. The two movement topics (`/topic/islands/{id}/movement`,
  `/movement/snapshot`, GROMO-2247) live once in `StompTopics` (`MOVEMENT_TOPIC` regex + `movementTopic()` builder) and
  all three readers (gate, outbound check, `movement.stomp`) use it.
- **`presence:*` is read-only here.** Data API owns it. A write or delete from this
  service would let chat cancel the focus rule.
- **The simple broker only knows subscribers in this JVM.** Cross-instance delivery is
  `fanout/` and nothing else. A missing `RedisMessageListenerContainer` bean is invisible
  on a single instance — `ChatWebSocketIntegrationTest` covers that regression. 이동(movement)은 `fanout/` 이 아니라 자기 릴레이(`chat:movement:*`)를 쓰고, 그것도 플래그 `realtime.movement.multi-instance.enabled`(기본 ON)가 켜졌을 때만이다 — 아래 「섬 이동 다중 인스턴스」 절.
- **현재 인가 옵션 OFF의 멤버십은 TTL 캐시** (`chat.membership.cache-ttl-seconds`)다. ON이면 지정된
  `requireCanChat` 경계가 PR753 Data 현재 인가를 TTL 캐시(허용만, 기본 30s)를 거쳐 조회한다. 방 목록·duplicates·개인큐는 새 조회 범위가 아니다.
  전달 직전 허용 캐시(`OutboundAuthzCache`, 아래 송신 예산 절)는 ON 에서 멤버십 판정을 담지 않으므로 ON 의 반영 상한은 이 30s 그대로이고,
  OFF 에서는 원본 Redis 캐시의 만료를 넘지 않는다.
- **ON 모드 비용·예산(GROMO-2342)**: `CurrentMembershipDecisionCache`(인스턴스 로컬)가 «허용»만 (userId, sessionId, authGeneration, islandId) 키로
  `realtime.authorization-client.cache-ttl-seconds`(30, 0=끔) 동안 들고 있다 — 거절·오류는 캐시하지 않는다. `island.members.updated`(가입·탈퇴·강퇴)의 `memberUserId`와
  `user.withdrawn` 이 `InboundEventService` 에서 `evictUser` 로 지우고(Redis 삭제 성패와 무관, 펜스보다 먼저), 조회 중 겹친 evict 의 옛 허용은 `mark/remember` 가 막는다.
  ⚠️ 사건은 Kafka 소비 그룹·HTTP 로 «한 인스턴스»에만 닿으므로 다른 인스턴스의 항목은 TTL 로만 닫힌다(다중 인스턴스에서 즉시성이 필요하면 0). 개별 세션 폐기(로그아웃)는
  스위치 `AUTH_SESSION_REVOKED_REALTIME_EVENTS_ENABLED` ON 이면 `auth.session.revoked` 가 와서 그 sid 의 소켓을 즉시 닫는다(기본 OFF — 그때는 TTL 이 상한이다). 동시 상한(`max-in-flight` 16)이 차면 `wait-timeout`(200ms, 0=즉시 거절)까지만 기다린 뒤 503 — 대기는 총 예산(`request-timeout` 1.5s)에 포함된다.
  지표: `realtime.authorization.cache{result=hit|miss|evict}`·`.inflight`·`.limit`·`.capacity.rejected`(세마포어가 찬 거절 전부)·`.rejected{reason=timeout|interrupted}`·`.duration{outcome}`.
  OFF 모드 `GroupClient` 는 `SimpleClientHttpRequestFactory`(connect·read 2s 타임아웃이 소켓 읽기마다 적용 — 본문 정지도 끊긴다, keep-alive 는 JDK 기본)에 동시 상한 `chat.data-api.max-concurrency`(32)를 둔다.
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
  **통과한 결정은 짧게 캐시한다**(GROMO-2340, `OutboundAuthzCache`) — 아래 「송신 예산·heartbeat」 절.

- **바다 방은 전달 직전에 방 소속을 다시 읽는다.** 10분 정리(`SeaAdriftSweeper`)는 다른 인스턴스에서 Redis 의
  `sea:user:{id}` 를 지우는데, 이 JVM 의 소켓·구독은 그대로 남는다. 로컬 레지스트리로는 끊을 수 없으므로
  `ChatOutboundChannelInterceptor` 가 `/topic/sea/rooms/*` 프레임마다 `HGET sea:user:{me} roomId` 를 대조한다(fail-closed).
- **`BlockClient` 가 배선되지 않으면 바다는 전원 1인 방이다.** 배정의 차단 분리는 조회 실패를 «그 방 제외»로 접는다.
  `realtime.focus.data-base-url`/`data-service-token` 이 비어 있으면 조회가 항상 예외라 후보가 전부 빠지고 매번 새 방을
  만든다. 응원과 같은 realtime-authorization 배선이 전제다.
- **`sea:rooms:open` 에 TTL 을 걸지 마라.** 걸면 만료 순간 모든 방이 후보에서 사라져 전원이 새 방을 만든다. 입장·퇴장
  Lua 가 스스로 정리한다.
- **JOIN Lua 는 차단 검사 때 본 구성원 집합이 그대로일 때만 넣는다**(결정 N32, 반환 -2 면 다시 읽고 재검사, ≤3회). 차단
  검사와 입장 사이에 누가 들어오면 검사하지 않은 상대와 같은 방이 된다 — 동시 입장 두 명이 서로 차단 관계여도 분리되는 이유다.
- **JOIN 뒤 `sea-state` 를 한 번 더 조회한다**(결정 N33). 첫 조회와 JOIN 사이에 Data 사건(`sea.member.updated`)이 오면
  그때는 방이 없어 no-op 으로 버려져 입장 후 상태가 낡는다. 재조회가 다르면 `UPDATE` 전이로 맞추되 `rev` CAS 로, 그사이 먼저
  적용된 더 새로운 사건을 오래된 재조회가 덮지 못하게 한다. 해시를 직접 HSET 하지 말고 `SeaRooms.UPDATE` 를 쓴다.

- **롤백 메모: `sea:adrift`(ZSET)·`sea:rooms:open`(SET)에는 TTL 이 없다.** 1/2·2/2 를 함께 롤백한 채 오래 두는 경우에만 손으로
  지운다. **새 버전이 떠 있는 동안 `sea:rooms:open` 을 지우면 전원이 새 방을 만든다**(TTL 금지와 같은 이유). 2/2(스위퍼)만
  롤백하면 `sea:adrift` 가 쌓이고, 재배포 첫 틱이 전량을 읽어 스스로 치유한다(백로그 10^4 부터는 그 틱이 수 초 걸린다).

## 송신 예산·heartbeat (GROMO-2340·2341)

- **heartbeat 10s/10s 가 계약이다.** `WebSocketConfig` 가 `SimpleBroker` 에 `heart-beat:10000,10000` + 전용 1스레드 스케줄러
  (`realtime-heartbeat-`)를 건다. 앱(`islandRealtime.ts`)도 10s/10s 라 CONNECTED 는 `heart-beat:10000,10000`
  (`StompHeartbeatIntegrationTest`). 클라이언트가 30s(3회) 동안 아무것도 안 보내면 브로커가 세션을 닫는다 — `SimpleBrokerMessageHandler`
  의 HeartbeatTask 가 읽기 무활동을 DISCONNECT_ACK 로 내고 `StompSubProtocolHandler` 가 ERROR `Session closed.` 를 보내며 1002 로 닫는다
  (ERROR 프레임은 닫힘과 겹쳐 클라이언트에 안 닿기도 한다 — 계약은 1002 종료다)
  (`StompHeartbeatTimeoutIntegrationTest`, 1s 로 줄여 고정). 값은 `chat.websocket.heartbeat.server-ms`·`client-ms`(기본 10000).
  `heart-beat:0,0` 클라이언트(k6 등)는 양쪽 다 꺼진다. 프록시 유휴 상한(Cloudflare 약 100s, nginx
  `proxy_read/send_timeout 3600s` — `server/scripts/nginx-*.example`)보다 짧아야 연결이 산다 — 늘리거나 끄지 마라.
- **아웃바운드 실행기는 유한 큐다**(`OutboundSendBudget`). `chat.websocket.outbound.core-threads`(0 = CPU×2)·
  `max-threads`(0 = core)·`queue-capacity`(10000). 큐가 차면 거부된 프레임의 세션을 **종류 불문 1008
  `OUTBOUND_QUEUE_FULL`** 로 닫는다(채팅은 재연결 이력, 이동은 재구독 FullState 로 복구). 거부 핸들러는 **던지지 않는다** —
  Spring 7 `ExecutorSubscribableChannel` 은 거부된 작업을 보낸 스레드(브로커·이동 틱)에서 바로 실행한다. 종료는 전용
  `realtime-outbound-close`(2스레드)에서 한다. **종료 예약 즉시 그 세션으로의 전달을 막는다**(큐 넣기 전 `preSend` + 꺼낼 때
  `beforeHandle`, `dropped{reason=closing}`) — close 가 늦어도 빠진 프레임 뒤의 채팅을 정상처럼 받는 창이 없다. close 한 건의
  상한은 Tomcat 11 의 비정상 종료 송신 제한(`ABNORMAL_SESSION_CLOSE_SEND_TIMEOUT`, 50ms)이고, 예약은 소켓 종료 경로가 지운다.
  close 가 실패하면 예약을 유지한 채 1회 재시도하고, 그래도 실패하면 예약을 풀고 WARN — 좀비(전달만 영구 차단)를 막는 대가로 이 경로에서만
  한 프레임 손실 뒤 정상 수신이 가능하다(채팅은 앱 sync·이력, 이동은 in-flight 워치독 15s 로 복구).
- **세션 송신 상한은 기본값을 명시만 한다** — `chat.websocket.transport.send-time-limit-ms`(10000)·
  `send-buffer-size-limit-bytes`(524288)·`message-size-limit-bytes`(65536). `MovementOutbox.STUCK_NANOS`(15s)가 10s 를 전제한다.
  수신 크기 초과는 4500 이 아니다 — WebSocket 메시지 하나가 Tomcat 텍스트 버퍼(Spring 이 16KB+256 으로 올림)를 넘으면 Tomcat 1009,
  여러 프레임으로 모은 STOMP 메시지가 `message-size-limit-bytes` 를 넘으면 ERROR 프레임 뒤 1002 다.
- **전달 직전 인가는 «허용»만 캐시한다**(`OutboundAuthzCache`, `chat.websocket.outbound.authz-cache-ttl-seconds` 30, 멤버십
  TTL 이하로 잘림, 0 = 끔). 키는 (세션, `목적지#발신자`) — 담는 것은 멤버십·차단 판정뿐. 거절·판정 불가는 담지 않는다(fail-closed).
  JWT 재검증·**채팅의 집중 검사**(무효화 사건이 없고 규칙 2가 즉시 차단이다 — `ChatWebSocketIntegrationTest` 가 잡는다)·응원 수신
  대상 대조·바다 방 `HGET` 은 프레임마다 그대로. 무효화: `InboundEventService` 가 멤버십 변경·차단 세대·탈퇴를 **원 캐시를 고친 뒤**
  `evictUser`, 소켓 종료가 `evictSession`. 사건마다 순서는 ① ON 모드 결정 캐시(`CurrentMembershipDecisionCache`, 위 GROMO-2342 항목)
  → ② 원 캐시(Redis 멤버십·차단 세대)·탈퇴 펜스 → ③ 이 캐시다. `memberUserId` 가 없거나 형식이 깨진 옛 MEMBER_REMOVED 는 두 캐시 모두
  `evictIsland`(이 캐시는 그 섬 목적지 범위를 모든 세션에서 지운다). 남는 창(TTL 상한): 다른 인스턴스(이 캐시는 JVM 안).
  허용의 만료는 그 판정에 **쓴 원본 값의** 만료까지다 — 값과 PTTL 을 한 원자 단위(Lua GET+PTTL, `common/redis/Sourced`)로 읽는다.
  따로 읽으면 그 사이 다른 요청이 원본을 새 값·새 TTL 로 갈아 옛 판정이 새 수명을 얻는다. 멤버십(채팅·`events`)은 관문 판정 뒤
  `OutboundMembershipSource` 가 `cache:chat:member:{userId}` 를 원자 읽기해 그 값도 멤버일 때만 그 만료를 쓰고(비멤버·없음 → 담지 않음),
  차단(필터 ON 에서 실제 조회한 채팅·`events`·응원)은 `BlockedUsers.hasBlockedSourced` 가 판정 집합과 `cache:chat:block:{userId}` 의 PTTL 을
  함께 준다(MGET 대신 Lua 1회, 정본 재조회면 조회 시작 + TTL). 강퇴 상한은 멤버십 TTL, 차단 백스톱은 `realtime.blocks.cache-ttl-seconds`
  그대로다. **반영 상한 — OFF: 원본 Redis 만료(멤버십 TTL·차단 TTL)가 상한. ON(verifier): 관문 캐시(`CurrentMembershipDecisionCache`
  30s, GROMO-2342)가 상한이고, 이 캐시는 멤버십을 포함한 판정을 담지 않는다**(`OutboundMembershipSource` 가 `EXPIRED` — 겹쳐 쌓으면
  60s 가 된다; ON 의 응원(차단만)은 그대로 담는다). `OutboundAuthzCache` 는 Redis 를 읽지 않는다.
- **운영 신호**: 큐 깊이 `executor.queued{name=realtime-outbound}`(+`executor.active`·`executor.queue.remaining`),
  `realtime.outbound.dropped{reason=queue_full|session_limit|closing}`(`session_limit` = Spring 이 4500 `SESSION_NOT_RELIABLE` 로 닫은
  세션 — 송신 시간·버퍼 초과가 같은 코드라 구분 불가, CONNECT 없는 60s 세션 정리도 섞인다), 소켓 쓰기 시간
  `realtime.outbound.send{destination_kind=chat|movement|events|sea|other}`, 인가 캐시 `realtime.outbound.authz.cache{result=hit|miss|evict}`.
  `queue_full` 이 0 이 아니면 실행기·느린 수신자부터 본다. heartbeat 프레임도 같은 실행기를 지난다 — 송신 시간은
  `destination_kind=other` 로 재고, 포화로 거부되면 다른 프레임과 같이 `queue_full` 로 세며 그 세션을 닫는다.
  **포화 종료는 가해 세션을 먼저 닫는다** — 큐는 전역 하나라 넘친 프레임의 세션이 가해자가 아닐 수 있다. 그래서 세션별 대기 프레임 수
  (실행 중 포함, 실행기 `TaskDecorator` 가 센다 — 인터셉터 쌍은 앞선 인터셉터가 버린 프레임에서 새서 쓰지 않는다)를 두고 선별한다.
  선별은 **첫 거부**(`isConnected && closing.add`)에서만 한다. 후보는 연결된 세션(종료 예약 제외)이고 넘친 세션을 포함하며, 동률이면
  넘친 세션이 이긴다(이땐 `overflow` 만 센다). 가해자는 **한 번에 하나**(단일 슬롯 CAS)다 — 소켓 종료 콜백이 슬롯을 풀고, 콜백이
  안 오면 10 s 뒤 만료된다. 슬롯이 차 있는 동안의 거부는 넘친 세션만 닫는다. 가해자를 먼저, 넘친 세션을 그 다음에 같은
  `OUTBOUND_QUEUE_FULL` 로 닫는다. 지표 `realtime.outbound.closed{selected=offender|overflow}` — `overflow` 에는 «프레임을 잃은
  세션»뿐 아니라 «종료 ACK(DISCONNECT_ACK)를 잃은 세션»도 들어간다.
  **지표 판독**: `realtime.outbound.offender.pending`(가해자를 선점한 순간 그 세션의 대기 프레임 수 분포)이 `queue-capacity` 의 절반
  이상이면 단일 수신자(느린 소켓 한 명)가 큐를 채운 것이고, 작고 반복되면 전역 포화다 — 그땐 `executor.active == max-threads` 가 지속되는지,
  `realtime.outbound.send` p99 가 정상인지 함께 본다.
  **1008 vs 1002**: 원칙은 구분한다 — `OUTBOUND_QUEUE_FULL` 은 1008(`POLICY_VIOLATION`, 큐 포화), heartbeat 무활동은 1002. 다만 포화 중
  heartbeat 타임아웃의 DISCONNECT_ACK 가 거부되면 그 무활동 종료도 1008 로 닫힌다(가해자 선별 없이 그 세션만, `overflow` 로 집계).
  **재연결 지터 권고**: 포화로 한꺼번에 닫힌 세션이 같은 순간 다시 붙으면 포화가 되풀이된다 — 클라이언트 재연결은 5 s ± 50 % 같은
  지터를 둔다. 앱은 GROMO-2384 에서 2.5~7.5 s(5 s ± 50 %) 지터로 바꾼다.

## 섬 이동 다중 인스턴스 (GROMO-2339, ADR A26)

- **플래그 `realtime.movement.multi-instance.enabled`(env `REALTIME_MOVEMENT_MULTI_INSTANCE_ENABLED`, 기본 true — 2026-10-19
  재영님 결정: 늘릴 때마다 켜는 걸 챙기지 않게).** 1대여도 ON 경로(리스·채널·Lua)를 탄다. `false` 로 옵트아웃하면
  `MovementCluster` 가 `MovementRooms` 를 바로 부르고 Redis 를 전혀 쓰지 않는 단일 인스턴스 현행 경로다(릴레이 컨테이너·스레드도
  없다, `MovementMultiInstanceOffTest` 가 고정). **옵트아웃한 채 2대 이상이면** 같은 섬 방이 인스턴스마다 따로 생겨 서로 안 보인다.
- **ON 의 고정 비용(1대여도)**: 전용 스레드 3(`movement-cluster`·`movement-relay-in`·`movement-relay-out`), 1초마다 소유 섬별
  RENEW(EVAL) + PING PUBLISH(소유자별 — 입장해 있는 섬의 소유자마다 1건, 소유자 채널로) + 내 세션 섬 MGET 감시, 자기 세션 프레임도 Redis 메아리로 받는다(왕복 1회 지연). 명령은 EVAL·
  PUBLISH·SUBSCRIBE·GETDEL·MGET·SET 을 쓴다 — realtime Redis 에는 아직 ACL 이 없다(GROMO-1744, dev·prod 모두 ACL 파일 없음)라
  지금은 막히지 않는다. ACL 을 걸 때 아래 「ACL 이 걸리는 날」 목록을 같이 넣어야 이동이 fail-closed 로 멈추지 않는다.
- **ON — 섬마다 소유자 한 곳.** `MovementOwnership`(Lua ACQUIRE/RENEW/RELEASE) 리스를 든 인스턴스만 `RoomRuntime` 을 돌린다.
  세션 키는 `<instanceId>:<sessionId>`. 비소유 인스턴스 세션의 명령은 `chat:movement:cmd:v1` 로 소유자에게, 소유자의
  프레임은 `chat:movement:frames:v1` 로 전원에게 — **소유자도 자기 메아리로만 자기 세션에 넣는다**(전달 경로 하나).
  봉투(`MovementRelay.Frame`·`Command`)는 인스턴스 사이 전용이고 `payload` 는 앱 wire JSON 그대로다.
- **스레드**: `movement-cluster`(1, 라우팅·소유권·1초 감시 — 인바운드 스레드는 넣기만 한다), `movement-relay-in`(1, 전용
  `RedisMessageListenerContainer` — 채팅 컨테이너와 섞으면 순서가 깨진다), `movement-relay-out`(1, Snapshot·INTENT 줄 4096 +
  제어 줄 1024(reliable 프레임과 JOIN·LEAVE·FULL_STATE·RECHECK·PING(소유자별 채널)·EVICTED·RESYNC, 먼저 낸다) + 파이프라인 PUBLISH. 차면
  Snapshot·INTENT 는 `dropped{kind=frame}`, 제어 명령은 `dropped{kind=control}`, reliable 프레임은 아래 RESYNC).
- **fail-closed**: 리스 상실 → 방 `evict`·발행 중단. 리스는 마지막 성공 갱신을 «보낸 시각»부터 수명의 9/10(2.7초)까지만
  믿는다 — 넘으면 `MovementOwnership.lease()` 가 null 이라 감시 스레드가 밀려도 발행·명령 적용이 즉시 멈추고, 다음 감시가
  `lost{expired}` 로 방을 버린다(남의 값이면 `lost{stolen}`). 본 epoch 보다 작은 프레임은 버린다. 소유자가
  바뀌면 그 섬 내 세션 전부 게이트를 닫고(resync) 새 소유자에 다시 입장 → 세션 한정 FullState(wire 무변경).
- **인계(단계 B)**: 소유자 종료는 수명주기 단계 1(`SmartLifecycle` — 웹 서버 종료 뒤·Lettuce(단계 0) 종료 전)에서 위치를
  `movement:room:{id}:handoff` 에 남기고, 송신 줄을 비운 «뒤» 리스를 내놓는다(먼저 내놓으면 남은 프레임이
  `stale_queue` 로 버려진다). 수명주기는 되돌릴 수 있다 — `stop()` 뒤 `start()` 가 송신·감시를 다시 세운다(Spring 7 테스트 컨텍스트
  일시정지가 실제로 이것을 부른다. 예전엔 재개 뒤 실행기가 죽은 채라 이동 명령이 «길잡이 종료 중»으로 전부 버려졌다). relay-in 실행기는
  빈 수명(`@PreDestroy`)이라 컨테이너가 계속 쓴다. `@PreDestroy` 로 옮기지 마라 — 그때는 Redis 연결이 이미 닫혀 있어
  인계가 조용히 실패하고 남은 인스턴스가 리스 만료(3초)를 기다린다(실측).
- **강퇴·교체**: `MovementSubscriptionListener.recheckMembership` 은 로컬 재검사 + RECHECK 브로드캐스트(각자 자기 세션만,
  캐시 삭제 실패 표시 `cacheStale` 동반). 강퇴 사건은 한 노드만 받으므로 RECHECK 를 제어 줄에 못 넣거나 PUBLISH 가 실패하면
  버리지 않고 표시해 두었다가 1초 감시가 성공할 때까지 다시 보낸다(`movement.relay.recheck.retry{reason=dropped|publish}`).
  받는 쪽은 멱등이다(두 번 오면 재판정을 새로 시작할 뿐). PING 대조는 멤버십을 다시 보지 않는다. 다른 인스턴스에서 같은 사용자가 새로 들어오면 소유자가 SUPERSEDE 프레임으로 옛
  세션을 멈추고 그 세션 intent 를 버린다. 내게 오는 PING(1초)이 5초 끊긴 인스턴스의 세션 actor 는 소유자가 내보낸다(`lastPinged`).
- **PUBLISH 성공 ≠ 수신**: 수신 쪽 relay-in 이 끊긴 구간에 간 RECHECK 는 송신 쪽이 알 수 없다 — 상한은 멤버십 캐시 TTL 이다.
- **PING 대조(제어 명령 유실·생존 신호 복구)**: PING 은 그 인스턴스가 남의 방에 입장해 있다고 믿는 세션 목록(`섬|세션`)을
  싣는다. 소유자는 PING 마다 목록과 자기 방을 맞춘다 — 목록에 없는 그 인스턴스 actor 는 내보내고(LEAVE 유실), 목록에 있는데
  방에 없는 세션은 `EVICTED` 로 알려 그 세션만 resync + JOIN·FULL_STATE 로 다시 입장시킨다(JOIN·첫 FullState 요청 유실,
  생존 신호 단절로 제거된 뒤 복구). 1초마다 되풀이되므로 EVICTED 가 유실돼도 다음 PING 이 다시 보낸다 — 비소유 쪽의
  «내 PING 이 끊겼다 복구됨» 감지는 따로 두지 않았다.
  **PING 은 소유자별 채널이다**(GROMO-2352): 비소유 인스턴스는 입장해 있는 섬의 소유자마다 그 소유자의 세션만 담은 PING 1건을
  `chat:movement:cmd:v1:<소유자 instanceId>` 로 보낸다(소유자를 모르는 섬은 빼고 `pendingRejoin` 이 덮는다). 채널 하나에 전원이
  구독하면 PING 을 나눠도 N 구독자가 전부 받아 바이트가 N×S 그대로라 채널을 나눴다. 각 인스턴스는 자기 이름 채널도 구독한다.
  수신 쪽 생존은 `lastPinged`(origin → 내게 온 PING 시각, 원격 JOIN 때 한 번 심는다)로 센다 — 남에게 간 PING 이나 FULL_STATE 재시도 같은 다른 명령으로 갱신하면 내게 PING 을 안
  보내는(그 섬에 세션이 없는) 유령이 안 지워진다. 수신자 null PING(옛 버전·호환)은 전원 채널로 가고 전원이 대조한다.
  트레이드오프: 게이트가 닫힌(eligible 아님) 세션은 PING 목록에서 빠지므로 origin 이 살아 있어도 소유자가 5초 뒤 그 actor 를
  내보낼 수 있다 — 게이트가 열려 목록에 다시 들어오면 「목록엔 있고 방엔 없음」으로 EVICTED → 재입장해 복구된다.
  혼합 버전 한계: 옛 인스턴스는 소유자 채널을 구독하지 않아 새 인스턴스의 PING 을 못 받아 5초 뒤 그 세션 actor 를 내보낸다 —
  업그레이드 뒤 PING 대조가 복구한다. 비대칭: 옛→새 는 옛 인스턴스의 수신자 null PING 이 호환 경로(전원 채널)라 정상이고, 새→옛 만 끊기며 복구는 마지막 인스턴스가 올라온 뒤다.
- **세션 한정 FullState 유실**: JOIN 은 됐는데 FULL_STATE 명령이나 그 응답을 잃으면 게이트가 닫힌 채 남는다(PING 대조는 actor 가
  있으니 정상으로 본다). 감시가 «게이트가 닫힌 지 2초 넘은» 내 세션의 FULL_STATE 를 상한 없이 약 2초마다(재요청이 시각을 다시 찍어 실제 2~3초)
  다시 요청한다
  (`movement.fullstate.retry`, 멈춘 세션 제외 — 재개 때 처리기가 요청한다).
- **reliable 프레임 유실**: 버려도 되는 건 Snapshot(·INTENT)뿐이라 그것만 사건 줄(4096, `dropped{kind=frame}`)로 간다.
  FullState·PathAccepted·Arrived·MoveRejected·SUPERSEDE 는 제어 줄로 간다. 제어 줄이 차거나 PUBLISH 가 실패해 이것을 잃으면
  소유자가 그 섬에 «재동기화 필요»를 남기고(`movement.relay.resync{reason=dropped|publish}`) 다음 감시 틱에 `RESYNC` 를
  돌린다. 그러면 모든 인스턴스가 그 섬 세션을 resync 하고 세션 한정 FullState 를 다시 요청한다. 게이트가 이미 열린 세션은
  FullState 재요청 대상이 아니고 PING 은 앱의 actor 목록을 모르기 때문에 이 경로가 필요하다.
- **줄에 머무는 사이 리스 상실**: 송신 스레드가 배치를 꺼낸 뒤 프레임마다 지금 리스 «세대»를 다시 보고(같은 epoch 재획득도 구분), 없거나 다르면 PUBLISH
  직전에 버린다(`routing.failed{stale_queue}`). 큐 체류 창은 이것으로 닫히고, 남는 것은 재확인~PUBLISH 사이 μs 뿐이다.
- **옛 방의 늦은 콜백**: 방은 만들 때의 리스 세대(`Lease.generation`, 새 리스 기록마다 증가 — 같은 epoch 재획득도 구분)에 묶인
  콜백(`RoomRuntime.Listener.forRoom`)을 받는다. 리스를 잃고 다시 얻은 뒤 틱 스레드가 옛 방을 한 번 더 돌려도 그 사건은
  `routing.failed{stale_room}` 으로 버린다.
- **지표**: `movement.owner.{acquire{trigger},lost{reason},islands,forward{type},forward.stale{reason}}`,
  `movement.routing.failed{reason=redis|no_lease|stale_queue|stale_room|publish}`, `movement.relay.{stale,dropped,queue.depth,lag}`, `movement.cluster.evict{reason=dead_instance|ghost|missing}`(`dead_instance`·`ghost` 는 내보낸 원격 actor 수, `missing` 은 EVICTED 로 알린 세션 수 — 단위가 달라 reason 을 가로질러 합치지 않는다), `movement.cluster.poll`(1초 감시 한 틱 Timer — submit 작업 제외; `enabled=false` 여도 생성자에서 등록돼 0 샘플로 노출(무해). submit 작업은 같은 스레드의 다음 순번이라 poll p95 가 낮아도 스레드가 밀려 있을 수 있다).
- **배포 전후 확인**: 머지 PR 의 `deployed:dev-realtime` 라벨 → 롤링 중 `movement.cluster.evict{reason=dead_instance}` 일시 상승 뒤 0, `movement.owner.lost{reason=expired}`·`movement.fullstate.retry` 일시 상승 예상, `movement.cluster.poll` p95 는 늘지 않아야 한다. PING 드롭은 `movement.relay.dropped{kind=control}`·`movement.routing.failed{reason=publish}` 에 포함된다. 이 기준은 2대(GROMO-2353) 전제다 — 1대에선 소유자가 자기라 PING 이 안 나가 `dead_instance`·`ghost` 는 0 이 정상이고, 혼합 버전 구간(위 「혼합 버전 한계」)에선 `dead_instance` 가 한 번 더 오를 수 있다.

## Redis keys (A19 namespace table)

Only these. Adding a pattern means updating `common/redis/RedisKeys` **and** the
architecture decision A19 table. `movement:*`·`chat:movement:*` 는 이동 다중 인스턴스 플래그(기본 ON)가 쓴다 — 1대여도 생긴다.

| Key | Writer | This service | Purpose |
| --- | --- | --- | --- |
| `cache:chat:member:{userId}` | chat | read/write | the user's island ids; service-private, never shared |
| `cache:chat:membergen:{userId}` | chat | read/write | 멤버십 캐시 무효화 표식(GROMO-2141) — `MembershipService.evict` 가 무작위 값을 `SET … EX max(<cache-ttl>, 600)` 로 쓰고, 조회는 상류를 부르기 전에 읽어 둔 값과 같을 때만 `cache:chat:member:` 를 적재한다(Lua CAS). 표식 TTL 은 상류 조회가 멈출 수 있는 최장 시간(정상 ≈6 s)을 넘어야 해서 캐시 TTL 과 600 s 중 큰 값이다(동일성 비교만 하니 캐시보다 오래 살아도 무해) |
| `cache:chat:block:{userId}` | realtime | read/write | 그 유저가 차단한 id 집합 + 적재 당시 세대 `<gen>\|<id>,…` (GROMO-2182). TTL 은 백스톱일 뿐 |
| `cache:chat:blockgen:{userId}` | realtime | read/write | 그 유저의 차단 세대 — Data `user.blocks.updated` 수신마다 INCR, **수명 없음**(번호 재사용 금지). 캐시 세대와 다르면 캐시를 버린다 |
| `cache:chat:revoked:{sessionId}` | realtime | read/write | 폐기된 로그인 세션 펜스(GROMO-2350) — `SET 1 PX <payload accessTokenExpiresAt + 60 s, 없으면 30일>`. CONNECT·REST(`JwtFilter`)가 읽는다(프레임 검사는 인메모리). 쓰기 실패는 경고만, 읽기 실패는 fail-open. 사건은 `chat:events:v1` 제어 봉투로 전 replica 에 퍼져 각자 인메모리 펜스·세션 종료를 한다 |
| `chat:fanout` | chat | pub/sub | cross-instance delivery (채팅 전용 wire) |
| `chat:events:v1` | realtime | pub/sub | cross-instance delivery of **island events**; `{originInstanceId,destination,event}` |
| `lock:chat:emote:{islandId}:{userId}` | realtime | read/write | 응원 **성공** 창(3초). 존재가 곧 「이미 보냈다」 |
| `lock:chat:emote:try:{userId}` | realtime | read/write | 응원 **발신** 시도 창(600ms, **사용자 축**). 거절된 요청도 소모해 상류 조회를 누른다 |
| `lock:chat:emote:sub:{userId}` | realtime | read/write | 응원 **구독** 시도 창(600ms). SUBSCRIBE 도 상류 조회를 부르므로 같은 상한 |
| `lock:chat:movement:sub:{userId}` | realtime | read/write | 이동 **구독** 시도 창(600ms, GROMO-2247). 세션×섬의 첫 이동 토픽만 쓴다 — 짝 토픽은 그 판정을 이어받는다 |
| `lock:chat:events:sub:{userId}` | realtime | read/write | 섬 `events` **구독** 시도 창(600ms, 사용자 축, GROMO-2302). 이동 창과 나눈다 — 앱이 접속마다 두 토픽을 연달아 구독한다 |
| `sea:room:{roomId}:members` | realtime | read/write | 바다 방 구성원 SET(GROMO-2300). EXPIRE 24h(입장마다 갱신), 비면 DEL |
| `sea:rooms:open` | realtime | read/write | 빈자리 있는 바다 방 SET. **TTL 없음** — 입장·퇴장 스크립트가 스스로 정리한다 |
| `sea:user:{userId}` | realtime | read/write | 사용자 바다 상태 HASH(`roomId, state, remark, name, catColor, sessionId, destinationIslandId, sailingMinutes, startedAt, adriftSince`). EXPIRE 24h, 퇴장 시 DEL |
| `sea:adrift` | realtime | read/write | 떠 있는 사용자 ZSET(userId → adriftSince ms). 수명 없음 — 10분 정리의 색인 |
| `lock:chat:sea:enter:{userId}` | realtime | read/write | 바다 입장 시도 창(600ms, 사용자 축) |
| `lock:chat:sea:emote:try:{userId}` | realtime | read/write | 바다 방 이모트 발신 시도 창(600ms, 사용자 축) |
| `lock:chat:sea:emote:{roomId}:{userId}` | realtime | read/write | 바다 방 이모트 성공 창(3초) |
| `chat:sea:v1` | realtime | pub/sub | 인스턴스 간 **바다 방 사건** 전파(Pub/Sub). `chat:events:v1` 과 모양이 달라 나눈다 |
| `movement:owner:{islandId}` | realtime | read/write (Lua) | 섬 이동 방 소유자 리스 `<instanceId>:<epoch>`, PX 3000, 1초 갱신(GROMO-2339). 플래그 기본 ON — 옵트아웃(false) 하면 만들지 않는다 |
| `movement:epoch` | realtime | read/write (Lua) | 소유권 세대 카운터 `max(직전+1, TIME ms)`. **TTL 없음** — 지우면 시각으로 다시 시작하지만 같은 ms 안의 +1 몇 개만큼 뒤로 갈 수 있다 |
| `movement:room:{islandId}:handoff` | realtime | read/write | 종료하는 소유자의 위치 스냅샷 JSON, PX 30000. 새 소유자가 GETDEL |
| `chat:movement:cmd:v1` | realtime | pub/sub | 비소유 → 소유자 이동 명령, RECHECK 는 전원 |
| `chat:movement:cmd:v1:{instanceId}` | realtime | pub/sub | 그 인스턴스(소유자) 앞 PING 대조 — 수신자 null PING 은 위 전원 채널 |
| `chat:movement:frames:v1` | realtime | pub/sub | 소유자 → 전 인스턴스 이동 프레임(소유자 자신도 이 메아리로 받는다) |
| `presence:focus:{userId}` | **Data API** | **read only** | focus lease; existence is the signal, the value is not read |

`MembershipService.myGroupIds` 의 `multiGet`(MGET)과 `MembershipService.store` 의 CAS Lua 도 `cache:chat:member:`·`cache:chat:membergen:` 두 키를 한 번에 만져 같은 제약을 받는다. `Sourced.read` 는 `cache:chat:block:{userId}`·`cache:chat:blockgen:{userId}` 두 키를 한 Lua 로 읽는다. Redis Cluster 로 옮기면 두 키의 접두사가 달라 슬롯이 갈려 CROSSSLOT 이 난다. 여기서 `{userId}` 는 자리표시자이지 해시 태그가 아니다. 옮길 때 `{…}` 해시 태그로 묶거나 두 번 읽는다. 지금은 단일 노드(Sentinel 포함)라 무관하다.

**ACL 이 걸리는 날 이동 다중 인스턴스에 필요한 것**(지금은 dev·prod 모두 realtime Redis 에 ACL 파일이 없어 고칠 파일이 없다 — GROMO-1744):
키 `~movement:*`, 채널 `&chat:movement:*`, 명령 `+eval +evalsha +publish +subscribe +getdel +mget`(Lua 안의 `TIME`·`PEXPIRE` 는
EVAL 권한 아래에서도 각각 허용돼야 한다 — `+time +pexpire +set +get +del`). 빠지면 소유자 획득이 실패해 그 섬 이동 명령이 전부
`movement.routing.failed{reason=redis}` 로 떨어진다(fail-closed).

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

### 세션 폐기 운영 신호 (GROMO-2350)

`auth.session.revoked` 는 수신 인스턴스가 Redis 내구 펜스를 쓰고 기존 팬아웃 채널(`chat:events:v1`)로 전 replica 에 퍼뜨려 각자 인메모리 펜스·캐시·세션 종료를 한다.

| 신호 | 의미 | 조치 |
| --- | --- | --- |
| warn `폐기 세션 펜스 Redis 쓰기 실패`(`ChatUserFence`) · 지표 `realtime.session.revoked.fence{op=write,result=failed}` | 내구 펜스가 안 섰다 — 인메모리 펜스와 종료는 정상. 이 장애 중 재시작·팬아웃 유실이 겹치면 그 sid 의 CONNECT·REST 가 AT 만료까지 열린다 | Redis 상태 확인. **`increase(realtime_session_revoked_fence_total{result="failed"}[5m]) > 0` 이면 알림** |
| warn `폐기 세션 펜스 조회 실패`(`ChatUserFence`) · `op=read,result=failed` | **fail-open** — CONNECT·REST 의 폐기 펜스가 꺼진 상태(프레임·SEND 인메모리 펜스는 유효) | Redis 복구. **`increase(realtime_session_revoked_fence_total{result="failed"}[5m]) > 0` 이면 알림** |
| error `세션 폐기 팬아웃 발행 실패`(`RealtimeEventDelivery`) · 지표 `realtime.session.revoked.fanout{result=failed}` | 다른 replica 의 기존 세션이 AT 만료까지 살 수 있다(재연결·REST 는 Redis 펜스가 막는다) | Redis Pub/Sub 확인, 필요하면 사용자 재로그인 유도. **`increase(realtime_session_revoked_fanout_total{result="failed"}[5m]) > 0` 이면 알림** |
| 지표 `realtime.session.revoked.close{result=failed}` | 소켓 close 가 두 번 다 실패 — 수신 인스턴스는 500 을 돌려 relay 가 재시도한다(`closed`·`already_gone` 은 정상). 시도 기준이라 재시도가 성공하면 `failed` 1 뒤 `closed` 1 이 또 오른다 | 반복되면 해당 인스턴스 소켓 상태 확인 |
| warn `세션 폐기 사건에 userId/sessionId 가 없다`(`InboundEventService`) | Data 가 필드 없는 사건을 보냈다 — 200 + skip | Data 봉투 계약 점검 |
| warn `팬아웃 봉투가 섬 사건도 세션 폐기도 아니다`(`RealtimeEventFanoutSubscriber`) | 반쪽 제어 필드·옛 발행자 봉투를 버렸다(롤링 배포 중 소량은 정상) | 지속되면 발행자 버전 확인 |
| 소켓 종료 reason `SESSION_REVOKED`(1008) | 정상 — 폐기된 sid 의 연결을 닫았다 | — |
| realtime 이 `/internal/events` 에 400/500 | 폐기 사건이 거절됐다 | data-api outbox 의 그 사용자 USER 축 행이 백오프 중인지 확인(A18 보류라 폐기하지 않고 재시도 — 그동안 탈퇴 전파가 늦어진다) |

`realtime.session.revoked.{fence,close,fanout}` 계열은 기동 때 0 으로 등록한다 — `increase()` 알림이 첫 장애를 놓치지 않는다.
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
| `SUB /topic/islands/{islandId}/emotes` | 응원 수신. 주민은 그 섬의 **본인 진행 세션(active·paused)** 이 있어야 하고, 비주민(방문자)은 세션 없이도 연다(티켓 2258 — 방문자 판정은 캐시가 아니라 상류 그룹 조회). 거절 ERROR — 미인증 `UNAUTHORIZED`(토큰 불일치·폐기 sid) · 구독 id 중복·누적 상한(`requireSubscribable`)이나 목적지 UUID 형식 불량(`uuidOrReject`)의 `INVALID_REQUEST` · 시도 창 `EMOTE_TOO_FREQUENT` · `NOT_FOCUSING`(주민인데 진행 세션 없음) · 상류 장애 `UPSTREAM_UNAVAILABLE` · 방문자 판정 조회가 토큰·사용자를 거절하면 `UNAUTHORIZED`(`UpstreamRejectedCredentialException`) — 이 중 **어느 것에도 `channel` 헤더를 싣지 않는다**(`DomainException.channel` 이 null 이면 `ChatStompErrorHandler` 가 헤더를 붙이지 않고, 응원 경로는 세팅하지 않는다). 다만 헤더 없음 자체가 「응원 구독이 거절됐다」는 증거는 아니다 — `requireSubscribable`·`uuidOrReject` 거절은 focus·rest·events·movement 구독에서도 헤더 없이 나간다 — 이유는 events 행(GROMO-2354) |
| `SEND /app/islands/{islandId}/focus/emotes` | 응원 발신, body `{sessionId,type}`. 성공은 브로드캐스트가 ack |
| `SUB /topic/islands/{islandId}/events` | 섬 소식(GROMO-2302) — 지금은 `island.member.arrived{islandId,userId,name,catColor,arrivedAt}`(주민 첫 도착) 하나. **현재 소속 주민만**: 구독 때 사용자 축 시도 창 `lock:chat:events:sub:{userId}` 600ms(초과는 ERROR `MOVEMENT_TOO_FREQUENT`) → `requireMember`(집중 검사 없음, 비주민은 ERROR `NOT_A_MEMBER` 뒤 연결 종료). 전달 직전 프레임마다 캐시 멤버십을 다시 본다 — 비주민·조회 불가는 프레임만 버리고(fail-closed) 소켓은 유지, 강퇴는 `MEMBER_REMOVED` 캐시 삭제 + TTL 120s 가 상한(evict 실패 시 TTL 120s 잔여 창 — 전달 경로의 stale 표시·`requireMemberUncached` 보강은 후속). 배포 순서·점검·되돌릴 신호는 LLD §9. 관측(GROMO-2332): 카운터 `realtime.island.subscribe.total{channel=events|movement,result=allow|deny,code=<거절 코드|none>}`(snapshot 구독도 `movement` 로 센다·짝 토픽의 판정 이어받기도 allow 라 movement allow 는 접속당 약 2배 — 접속 수 대용으로 읽지 말 것·**인가 판정 거절만** 센다 — 미인증(`UNAUTHORIZED`)·UUID 형식 불량·구독 id 중복·누적 상한(둘 다 `INVALID_REQUEST`) 거절은 `requireSubscribable`·`uuidOrReject` 에서 나와 `try` 밖이라 미집계 — 이 거절들은 `channel` 헤더도 없다), 거절은 INFO 한 줄(`userId`·`islandId`·destination·`code`), 거절 ERROR 프레임에 헤더 `channel: events|movement` — 앱은 이걸로 어느 구독이 거절됐는지 가른다(없으면 종전 코드 분류 폴백). 헤더는 `DomainException.channel` 이라 `UpstreamUnavailableException`·`UpstreamRejectedCredentialException` 도 싣는다(GROMO-2354). `sea` 는 소켓이 따로라 싣지 않는다. **`emotes` 구독 거절은 일부러 싣지 않는다** — 배포된 앱은 헤더 없는 ERROR 를 «응원 구독 중단» 신호로 읽어서, 헤더가 붙으면 옛 빌드가 재접속마다 `/emotes` 를 다시 구독해 소켓이 끊겼다 붙는 루프에 빠진다. 모든 클라이언트 빌드가 `channel: emotes` 를 처리한 뒤에야 싣는다(앱 쪽 수정은 티켓 2160 의 PR #1258 빌드가 처음) |
| `SUB /topic/islands/{islandId}/movement` | 섬 이동 동기화(GROMO-2247): FullState·PathAccepted·MoveRejected·Arrived — 세션별 직접 전송, **members only**(`requireMember`, 비멤버는 ERROR `NOT_A_MEMBER` 뒤 연결 종료 — 관문 거절은 STOMP ERROR 경로라 close code 는 Spring 이 ERROR 프레임 뒤 세션을 닫을 때의 값(통상 1002)이고 코드가 직접 고르지 않는다). 판정은 세션×섬마다 한 번(사용자 축 시도 창 600ms, 초과는 ERROR `MOVEMENT_TOO_FREQUENT`) — 짝 토픽은 그 세션×섬의 살아 있는(강퇴 전) 판정만 이어받는다. 첫 메시지는 항상 자기 actor 가 든 그 세션 한정 FullState. 방 상태는 JVM 메모리다 — 플래그 ON(기본)이면 섬별 소유자 인스턴스 한 곳(1대여도 Redis 리스 경로), 옵트아웃(false)이면 단일 인스턴스 가정(위 「섬 이동 다중 인스턴스」, GROMO-2339). 구독 인가 관측은 `realtime.island.subscribe.total{channel=movement,…}`, 거절 ERROR 프레임에 헤더 `channel: movement`(GROMO-2332) — 구독 없이 보낸 intent 의 `NOT_A_MEMBER` 도 같은 헤더(GROMO-2354) |
| `SUB /topic/islands/{islandId}/movement/snapshot` | 같은 섬의 위치 Snapshot(≤20Hz, 세션당 최신 1개만 전송). members only. 그 세션이 movement 로 자기 FullState 를 받은 뒤부터만 보낸다 — 그 전(snapshot 먼저 구독 포함)·movement 해지 뒤·재검사로 멈춘 뒤 재동기화 전의 Snapshot 은 버린다 |
| `SEND /app/islands/{islandId}/movement/intent` | 목적지 전송, body `{commandSeq,navRevision,goalX,goalY}`. movement 구독 보유 세션만 — 구독 없이 보내면 ERROR `NOT_A_MEMBER` + 헤더 `channel: movement`(GROMO-2354); 응답은 PathAccepted/MoveRejected. 사용자당 10/s·순간 20 초과는 조용히 버림 |
| `SUB /user/queue/sea` | 바다 배정 결과(`sea.room.assigned{roomId}`)·방 스냅샷(`sea.room.snapshot{roomId, members[]}`)은 그 세션 한정(`broadcast=false`). 퇴장 통지 `sea.room.left{roomId, reason}` 는 **이 JVM 의 그 사용자 모든 세션**에 간다 — 방 소속이 사용자 단위라 기기 A 의 leave 가 기기 B 를 같이 빼기 때문(다른 인스턴스의 세션은 못 받는다). 인증만 |
| `SEND /app/sea/enter` | 먼바다 입장 `{}` → 배정(또는 기존 방 재확인). 사용자 축 시도 창 `lock:chat:sea:enter:{userId}` 600ms, 초과는 `SEA_ENTER_TOO_FREQUENT` |
| `SEND /app/sea/sync` | 내 방의 스냅샷 요청 `{}` — 답은 그 세션의 `/user/queue/sea`. **그 세션이 방 토픽을 구독한 뒤에만** 받는다(아래 순서를 서버가 강제) — 방이 없거나 구독 전이면 `NOT_IN_SEA_ROOM` 이 `/user/queue/errors` 로(연결 유지). **앱은 30~60초 주기 또는 재연결 때 sync 를 보내고 `NOT_IN_SEA_ROOM` 이면 재 `enter`** — Redis 장애·flush·JOIN 타임아웃 뒤 서버가 먼저 알릴 수 없는 조용한 구간의 상한(결정 N39) |
| `SEND /app/sea/leave` | 퇴장 `{}`. 방 토픽 UNSUBSCRIBE·마지막 세션 소켓 종료도 같은 퇴장이다 |
| `SUB /topic/sea/rooms/{roomId}` | 바다 방 사건(`sea.member.joined`·`left`·`updated`·`sea.emote`). 해시 `sea:user:{me}` 의 `roomId` 가 이 방일 때만, 아니면 `NOT_IN_SEA_ROOM`(403). 전달 직전에도 프레임마다 다시 본다(fail-closed) |
| `SEND /app/sea/rooms/{roomId}/emotes` | 바다 방 이모트, body `{type}`(5종). 방 소속 + 시도 창 `lock:chat:sea:emote:try:{userId}` 600ms, 성공 창 `lock:chat:sea:emote:{roomId}:{userId}` 3초. 성공은 방 토픽의 `sea.emote{userId, type}` 가 ack, 거절은 `/user/queue/errors`(`NOT_IN_SEA_ROOM`·`INVALID_EMOTE_TYPE`·성공 창 3초의 `EMOTE_TOO_FREQUENT`). 시도 창 600ms 초과는 관문의 ERROR 프레임 + 연결 종료(응원과 같음) |
| `GET /api/v1/chat/rooms` | my islands + unread counts |
| `GET /api/v1/chat/rooms/{groupId}/messages?cursor&size` | history, newest → oldest |
| `POST /api/v1/chat/rooms/{groupId}/read` | advance the read cursor (forward only) |

**바다 앱 프레임 순서(강제)**: `SUB /user/queue/sea` → `SEND /app/sea/enter` → `sea.room.assigned{roomId}` 수신 →
`SUB /topic/sea/rooms/{roomId}` → `SEND /app/sea/sync` → `sea.room.snapshot{members}` 수신. 방을 구독한 «뒤»에
스냅샷을 받으므로 그 사이의 입퇴장·상태 변경을 놓치지 않는다. 소속 전 방 SUBSCRIBE 는 ERROR + 소켓 종료다.

**바다 앱 계약 보충** (앱 티켓이 되묻는 것 — 근거는 `SeaRooms`·`StompAuthChannelInterceptor`·컨트롤러 코드):

- **`sea.room.left{roomId, reason}`** 는 개인 큐 `/user/queue/sea` 로 그 사용자의 **모든 세션**(발신 세션 포함)에 간다
  (`SeaRoomPublisher.publishToUser`). `reason` ∈ `left`(자발 퇴장·방 토픽 UNSUBSCRIBE·탈퇴 `user.withdrawn`) · `adrift`(10분 정리) ·
  `disconnected`(마지막 세션 소켓 종료)(`SeaRooms.LEFT/ADRIFT/DISCONNECTED`). 방 토픽의 `sea.member.left{userId, reason}` 도 같은
  값이다. 앱은 **멱등**으로 처리한다.
- **`member = {userId, state, remark, name, catColor, session}`** (`SeaRooms.member`). `state` ∈ `focusing`·`adrift`. `remark` 는 없으면 `null`.
  `name`(string|null)·`catColor`(`black`·`ginger`·`cream`·`gray`·`white`·`calico`|null, 미선택 = null)는 입장·입장 직후 보정(reconcile) 때 Data `sea-state` 에서 읽어 해시에 둔다 —
  옛 해시(배포 전 입장)는 둘 다 `null` 이니 앱은 '???'/기본색으로 폴백한다. `sea.room.snapshot`·`joined`·`updated` 모두 같은 `member` 다.
  `session` 은 세션이 없으면 `null`, 있으면 `{sessionId, destinationIslandId, sailingMinutes, activeSeconds, serverNow,
  startedAt}`. `activeSeconds` 는 저장값이 아니라 **발행 시각에 계산**한다 — `focusing` 이면 `serverNow − startedAt`, `adrift`
  이면 떠오른 시각(`adriftSince`)에서 멈춘 `adriftSince − startedAt`(0 미만은 0). `adriftSince` 자체는 `member` 에 실리지 않는다.
  10분 상수는 서버(`SeaAdriftSweeper.ADRIFT_LIMIT`)가 정하고, 정리는 60초 틱(`realtime.sea.adrift-sweep-seconds` 기본값)이라
  실제 퇴장은 떠오른 뒤 **10:00~11:00** 사이다 — 앱 카운트다운이 0 이어도 사건을 기다린다.
- **`sea.member.updated(ended)` 의 `arrived` 는 realtime 이 읽지 않는다**(`SeaRooms.transition` 의 `ended` 분기는 params 를
  보지 않고 `adrift` 로만 전이한다). 앱 결과창의 도착 여부는 Data 의 finish 응답으로 얻는다.
- **재연결 뒤에는 항상 `enter` 부터**: 소켓이 끊기면 구독이 사라지고 마지막 세션이면 `left{disconnected}` 로 퇴장이다. `enter` 는
  방이 남아 있으면 그 방의 `assigned` 를 돌려주고(`existingAssignment`, `joined` 없음) 없으면 새로 배정한다. 이어서
  `SUB /topic/sea/rooms/{roomId}` → `SEND /app/sea/sync`.
- **오류 코드** — 어디로 오는가:

| 코드 | 경로 | 근거 |
| --- | --- | --- |
| `NOT_IN_SEA_ROOM` | 소속 전 방 토픽 SUB → **ERROR 프레임 + 연결 종료**. `sync`·이모트 SEND → `/user/queue/errors`(연결 유지) | 인터셉터 `authorizeSeaRoomSubscription` / `SeaRooms.snapshot`·`SeaEmoteStompController.emote` |
| `UPSTREAM_UNAVAILABLE` | 방 토픽 SUB 중 소속 조회 실패 → **ERROR 프레임 + 연결 종료**. `enter`(Data 상태 조회 실패)·Redis 실패 → `/user/queue/errors` | 인터셉터 / `SeaStompController.handleDomain`·`handleRedis`, `SeaEmoteStompController.handleRedis` |
| `SEA_ENTER_TOO_FREQUENT` | `enter` 시도 창 600ms 초과 → **ERROR 프레임 + 연결 종료** | 인터셉터 SEND 분기 |
| `EMOTE_TOO_FREQUENT` | 시도 창 600ms 초과 → **ERROR 프레임 + 연결 종료**. 성공 창 3초 → `/user/queue/errors` | 인터셉터 SEND 분기 / `SeaEmoteStompController.emote` |
| `INVALID_EMOTE_TYPE` | `/user/queue/errors` | `SeaEmoteStompController.emote` |
| `INVALID_REQUEST` | 이모트 본문 오류(`type` 누락·깨진 JSON) → `/user/queue/errors` | `SeaEmoteStompController.handleInvalidPayload` |

- **이모트 `type`** ∈ `hello`·`cheer`·`sleepy`·`laugh`·`hearts`(`FocusEmoteType.wireName()`, 응원과 동일). 보낸 사람도 방 토픽에서
  자기 `sea.emote{userId, type}` 를 받는다 — 그것이 성공 ack 다.

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

1. `GET /internal/users/{userId}/islands` → `items[].id`의 현재 소속 섬 목록.
   `membership/client/GroupClient`가 소속 캐시·방 목록·방문자 응원 판정에 사용한다.
   요청자 AT는 로컬에서 검증하고 상류에는 `SVC_TOKEN_REALTIME_TO_DATA`와 검증된
   `X-User-Id`를 보낸다. Data의 `realtime-authorization` 프로필과 전용 토큰은 기본 배포에
   필수다. 내부 401/403은 서비스 배선 오류(503), `USER_NOT_FOUND` 404는 사용자 인증 거절이다.
   아래 3번의 세션·세대까지 확인하는 옵션과는 별도 계약이다.
2. `presence:focus:{userId}` in shared Redis — Data API writes, chat reads.
   Data API's side is `common/port/FocusPresencePort` and is **best-effort**: if the lease
   write fails, focus still starts and chat stays open for that person.

3. 선택 `POST /internal/realtime/membership-authorization` — Data 제공자는 PR753으로 main에 있으나 기본 비활성이다. 켤 때는 Data를 먼저 활성화한다.
   전용 서비스 Bearer + 검증된 subject의 X-User-Id, body `{sessionId,authGeneration,islandId}`를 보내고
   평평한 `{allowed:boolean}`을 받는다. Data는 primary 한 SQL snapshot으로 사용자/세션/섬/소속을 확인한다.
4. Inbound `POST /internal/events` (GROMO-1943) — Data's canonical `user.withdrawn` envelope, authenticated by
   the Data-only token `SVC_TOKEN_DATA_TO_REALTIME` (no `X-User-Id`). `message/service/ChatUserFence` writes
   `user_tombstones` and deletes the user's `chat_read_cursors` under a per-user advisory lock; every cursor
   write goes through the same fence. `user.withdrawn` also removes the user from their sea room (`SeaRooms.leaveCurrent`, room event `sea.member.left{reason:"left"}`, GROMO-2300): Data's withdrawal ends the progressing session with a bulk UPDATE (ABANDONED) and emits no `sea.member.updated(ended)`, so without this the user would stay in the room as a `focusing` ghost — outside the `sea:adrift` index, so the 10-minute sweep never sees it — until the 24h hash TTL. Not in a room → no-op; only a Redis failure throws, rolling back the receipt (and the tombstone) so the relay redelivers. Never 400. Wired by GROMO-1954 (2026-09-19 R-1): Data's relay sends every `REALTIME`
   row here over HTTP by default, or over the `realtime-events` Kafka topic when both flags are on
   (`event/KafkaEventInbound`, `REALTIME_EVENTS_KAFKA_ENABLED`, default false). Both entrances call
   `event/InboundEventService`, which inserts `inbound_events(event_id)` first and applies only on first sight.
   Of the 16 app event types, `focus.member.updated` and `rest.member.updated` are now **delivered to STOMP**
   (GROMO-1765): `InboundEventService` converts the canonical 10-field outbox envelope to the 7-field
   `RealtimeEventEnvelope` (`subjectId`→`islandId`, `version`→`aggregateVersion`, `params`→`payload`) and calls
   `EventRouter`. `island.member.arrived` (GROMO-2302) is delivered too, to `/topic/islands/{id}/events`, through
   its own projection (`arrivalEvent`): only `islandId·userId·name·catColor·arrivedAt` are copied from `params` —
   anything else the producer adds is dropped. The other 13 are still accepted-and-deduped only — their domain payload validators and
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
   `application-realtime-authorization.yml` — without that profile and token emotes are rejected wholesale,
   and (since GROMO-2182, item 6, once the block filter is switched on) **island chat and emote delivery stop too**.

6. `GET /internal/users/{userId}/blocks` with the same Realtime service token + `X-User-Id` (GROMO-2182) — the
   blocker's blocked-id set for **recipient-side block filtering**. `ChatOutboundChannelInterceptor` drops a
   `/topic/groups/{id}` chat or `/topic/islands/{id}/emotes` frame for a session whose subject blocked the sender
   (`senderId` / `payload.userId`). `block/BlockedUsers` caches the set in Redis tagged with a **block generation**;
   Data writes `user.blocks.updated` (REALTIME outbox, aggregate `USER_BLOCKS`) in the block/unblock transaction and
   `InboundEventService` INCRs `cache:chat:blockgen:{blocker}`, so the next frame re-reads Data. With the relay off
   the change only lands after the TTL — do not call that immediate. **Fail-closed (2026-10-01 decision)**: Redis or
   Data failure, timeout, non-200, non-JSON, >256KiB, unknown/duplicate fields, trailing tokens, non-canonical UUIDs
   and an unreadable sender all drop the frame (socket kept). A chat whose `senderId` is JSON `null` (withdrawn
   sender) has nobody to filter and is delivered. The lookup result is discarded (frame dropped) if the generation
   moved during the lookup. **Both ends are switched off by default** because Data and Realtime deploy independently:
   Realtime `REALTIME_BLOCKS_FILTER_ENABLED` (`realtime.blocks.filter-enabled`) and Data
   `USER_BLOCKS_REALTIME_EVENTS_ENABLED` (`user-blocks.realtime-events-enabled`). Enable order: Realtime deployed
   (accepts `user.blocks.updated`) → Data `realtime-authorization` profile + `SVC_TOKEN_REALTIME_TO_DATA` + producer
   flag → Realtime token wired → filter flag. The generation key has **no TTL** on purpose — an expiring
   key restarts at 0 and a number can collide with a live cache written just before expiry (so it also assumes a Redis
   that does not evict keys — likewise `cache:chat:revoked:*`). Rollback: turning the filter off is immediate and safe (cached sets are ignored);
   turning the Data producer off leaves already-queued events, which are harmless. **Never roll Realtime back to a
   version without `user.blocks.updated` while the Data producer is on** — the old consumer answers 400 and the
   relay marks that blocker's `USER_BLOCKS` axis permanent. Turn the producer off first.

### 선택적 현재 멤버십 인가

`realtime.authorization-client.enabled`는 기본 false다. `ChatAccessGuard.requireCanChat`은
집중 여부를 먼저 확인하고, OFF이면 기존 캐시를 사용한다. ON이면 원 AT의 서명·subject/sid/gen/exp를
엄격히 검증한 뒤 Data 현재 인가를 호출하고 HTTP 대기 뒤 exp를 재확인한다. «허용»만 인스턴스 로컬에
`cache-ttl-seconds`(30, 0=끔) 동안 캐시한다(거절·오류는 캐시하지 않고, ON 실패 시 기존 Redis 캐시 fallback도 없다).
항목은 사용자·섬 두 축의 무효화 세대를 품고 조회 때 현재 세대와 대조한다. evict 사건 3종: `island.members.updated`
(`memberUserId` 있으면 사용자 단위, 없으면 섬 단위), `user.withdrawn`. 이동 방 강퇴 재검사는 캐시를 우회하는
`requireMemberUncached`를 쓰고 거절이면 그 사용자의 허용을 지운다. 개별 세션 폐기는 스위치(기본 OFF) ON 이면
`auth.session.revoked` 가 와서 즉시 닫고, OFF 면 TTL이 상한이다. `allowed:false`는 `NOT_A_MEMBER`이며 어떤 내부 조건이
실패했는지 추측하지 않는다. 로컬 invalid AT는401, 서비스401/403/404·5xx·malformed·timeout은503이다.

현재 연결 범위는 그룹 SUBSCRIBE, SEND 서비스, 히스토리 GET, 읽음 POST, 기존 그룹 outbound
`beforeHandle`, 그리고 **movement 두 토픽의 SUBSCRIBE**(`ChatAccessGuard.requireMember` — 집중 여부 없이
멤버십만, GROMO-2247)이다. ON이면 movement SUBSCRIBE도 Data 현재 인가를 탄다. 그 뒤의 강퇴는
`island.members.updated`(MEMBER_REMOVED) 커밋 뒤 `MovementSubscriptionListener`가 그 사용자(`memberUserId`가 없으면
섬 전체)의 outbox를 **캐시 없이**(`requireMemberUncached`) 다시 판정한다. 재판정을 **예약하는 순간 전달을 멈추고**
(그동안의 사건도, 이미 채널에 넘겨 실행기에 밀린 프레임도 버린다) 통과로 판정될 때만 재개해 FullState 한 번으로 다시
맞춘다(세대 확인과 재개는 새 사건의 멈춤과 같은 잠금 안). 비멤버면 퇴장 — 두 토픽 구독 기록도 지워, 같은 id 로 다시
구독해도 관문이 처음부터 판정한다. 강퇴 사건의 캐시 삭제가 실패하면 그 (섬, 사용자)의 다음 movement 구독은 캐시 TTL
동안 캐시를 건너뛰고 판정한다(통과하면 표시를 지운다). 판정 실패면 멈춘 채
백오프(1·2·4·8·16초) 재판정, 예산 소진 시 1011 `MEMBERSHIP_UNVERIFIED` 종료 — 조회가 밀리거나 상류 장애 중에도 받지
못한다. 세션 토큰이 죽었으면(로컬 JWT 검증, 상류 401 포함) 소속을 묻지 않고 즉시 1008 `UNAUTHORIZED`. 판정은
`movement-recheck`(1스레드), 송신 워치독·소켓 종료는 `movement-watchdog`(2스레드)에서 돈다.
이동 소켓 종료 사유(close reason, 앱은 재연결·재구독 FullState 로 다시 맞춘다): 1008 `UNAUTHORIZED`·`MOVEMENT_BACKPRESSURE`(송신 큐 상한), 1011 `MEMBERSHIP_UNVERIFIED`·`MOVEMENT_SEND_FAILED`(reliable 프레임을 아웃바운드 채널에 넘기지 못했거나 핸들러가 처리 중 던짐 — Snapshot 실패는 버리기만).
CONNECT·방 목록·duplicates·개인큐는 이 추가 조회 범위가 아니다.
새14개 이벤트·시설·재연결·transport는 계속 닫혀 있고(이동 Snapshot 토픽은 GROMO-2247 로 열렸다) host-transfer도 OFF다.
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
그룹 채팅 경계401이고, dev AT 수명은30일이다.
sid 없는 AT 가 소진되면(prod 발급 뒤 1 h, dev 30 d) `.or(extractUserId)` 폴백 4곳(`JwtFilter:42`·`ChatOutboundChannelInterceptor:457`·`StompAuthChannelInterceptor:630`·CONNECT `:196`)을 제거할 수 있다. 발급 지점 조사는 아래 문서의 「켜기 전 조건」에 있다.
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
**지갑은 섬 단위 하나다**(GROMO-1989/2044) — `wallet.updated`는 `islandId`가 필수이고 `currency`는 `village_points`뿐이다.
섬 없는 지갑 사건은 봉투에서 거절한다. 개인 축(`ownerType:user`, `islandId=null`)이 남은 자산은 `inventory.updated` 하나다.

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
**총량**(세션당 `MAX_SUBSCRIPTIONS_PER_SESSION` = 96 → 임의 UUID 로 목적지를 바꿔도 막힌다).
하나만으로는 다른 하나가 샌다. 96 의 근거는 계정당 소속 상한(`GroupService.MAX_JOINED_GROUPS` = 10)
× 섬당 목적지 7(`focus`·`rest`·`emotes`·`events`·채팅·`movement`·`movement/snapshot`) + 개인 큐 2 = **72**,
거기에 바다 목적지 2(`/user/queue/sea`·`/topic/sea/rooms/{roomId}`)를 더한 **74** 에 약 30% 여유다(`events` 는 GROMO-2302).
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
