# 위성 명령·사건 발신 규약 — outbox 를 부르는 쪽 (GROMO-1798)

기반(테이블 넷·봉투·relay·SSRF)은 [`docs/prd/fishcat/server-separation/outbox.md`](../prd/fishcat/server-separation/outbox.md)
가 다룬다. 이 문서는 그 반대편, **도메인이 그 기반을 어떻게 부르는가**를 정한다. 결정의 정본은
[`docs/architecture/decisions.md`](../architecture/decisions.md) A21·A22 이고, 이 문서와 어긋나면 그쪽이 맞다.

실측 기준: 2026-09-19 `main` + GROMO-1953(봉투·어댑터 통일). 호출 지점 목록(§3)은 시간이 지나면 낡는다 — 정본은
`grep -rln "OutboxCommandPort\|EventOutboxRepository" server/data-api/src/main` 이다.

## 1. 이 층은 무엇인가

**도메인 사실 → outbox 봉투 변환 + 대상별 전달 경로 지정.** 하는 일은 이 둘뿐이다.

- **영속 계층이 아니다.** repository 를 감싸지 않는다(`WithdrawalSatelliteCommandService` 는 repository 주입이 0개).
- **도메인 서비스가 아니다.** 상태를 판정하지 않는다 — 판정이 끝난 사실을 받아 적는다.
- 소유하는 것: 사건 이름(`EVENT_TYPE`·`EVENT_*`), 위성별 논리 키(`ENDPOINT_*`), 순서 축 이름(`AGGREGATE_TYPE`),
  `params` 모양. 예: 탈퇴 하나가 알림엔 Kafka 로, 링크엔 HTTP 로, realtime 엔 REALTIME 으로 나간다 —
  그 분기 지식이 어댑터(`WithdrawalSatelliteCommandService`)에 있다.

**단위는 「도메인당 하나」가 아니라 「사실을 내보내는 순서 축(aggregate)당 하나」다.** 섬 상태(`ISLAND`)와 주민 목록
(`ISLAND_MEMBERS`)은 같은 `group` 도메인이지만 어댑터가 둘이다(`IslandStateEvents` 주석 — 한 축에 얹으면 이름 변경마다
주민 목록 버전이 뛴다).

### 이름

**`<축>Events`** 로 짓는다(`IslandStateEvents`·`IslandWalletEvents`·`AppearanceEvents`·`FocusMemberEvents` 등 다수가 이미
이 이름이다). `*SatelliteCommandService`·`*EventService` 는 옛 이름이다 — §4 정리 대상(새 클래스는 옛 이름으로 짓지 않는다).

### 전용 어댑터를 두는 기준

다음 중 **하나라도** 해당하면 어댑터 클래스를 둔다.

1. 같은 사건을 적는 호출부가 **2곳 이상**이다 — 상수·`params` 모양이 갈라진다.
2. 사건 종류가 **2개 이상**이다.
3. 한 사건이 **대상 2곳 이상**으로 나간다.

해당하지 않으면 명령 서비스 안에서 직접 `append` 해도 된다. 지금 인라인으로 남은 곳과 그 근거:

| 인라인 호출부 | 기준 | 근거 |
| --- | --- | --- |
| `AuthSessionService` | ② 해당(2종) | **예외로 둔다.** 봉투가 세션 행 필드(`sessionEpoch`·`bootstrapNonceHash`)에서 바로 나오고, 세션 epoch 발급이 같은 USER 축 잠금을 쓴다. 떼어 내면 어댑터가 세션 행을 알아야 해 「영속 계층 아님」이 깨진다 |
| `InternalInviteLinkService` | 해당 없음(1종·1곳·1대상) | 허용. 게다가 `eventId` 를 확정 행에 저장하고 봉투의 `version` 을 확정 행에 되박는다(`applyEnvelopeVersion`) — 확정 행과 봉투가 한 몸이다 |
| `InternalIslandMailboxService` | 해당 없음 | 허용 |

`focus.member.updated`·`rest.member.updated` 는 두 호출부(`FocusSessionLifecycleService`·`FocusMembershipLossService`)가 각자
상수로 적던 ① 위반이었다 — GROMO-1953 에서 `FocusMemberEvents` 한 곳으로 모았다.

## 2. 호출 규약

### 2.1 같은 트랜잭션에서, 포트로만

- 어댑터 메서드는 `@Transactional(propagation = MANDATORY)` 다. 포트(`OutboxCommandPort`) 메서드도 전부
  MANDATORY 라 트랜잭션 밖에서 부르면 즉시 죽는다. 어댑터가 명령 진입점을 겸하지 않는다 — 진입 트랜잭션은 호출하는
  서비스가 연다(예: `UserSatelliteCommandService.record*` 는 MANDATORY, 내부 표면의 진입은
  `InternalDeviceTokenDeletionService`·`InternalNotificationSettingsService#replace`). 이유: 별도 트랜잭션으로 조용히 커밋되면 **도메인이 롤백돼도
  사건만 남는다.**
- 도메인 쓰기와 **같은 커밋**에 봉투를 적는다. 명령 트랜잭션 안에서 브로커·HTTP 를 부르지 않는다 — 발행은 relay 몫이다.
- 적는 길은 `OutboxCommandPort.append` 하나다. `EventOutboxRepository`·`EventOutboxDeliveryRepository`·
  `AggregateVersionRepository` 를 도메인이 직접 저장·잠그지 않는다(예외 없음 — GROMO-1953 이 마지막 두 곳을 포트로 옮겼다).
- 예외: `InternalIslandMailboxService` 는 메시지 정본이 다른 DB(`gromo_chat`)라 같은 커밋이 불가능하다. 저장 성공 뒤
  별도로 적재하며, 그 틈의 유실은 REALTIME 전달이 꺼져 있는 동안만 무해하다(클래스 javadoc 의 ponytail 주석).

### 2.2 eventId

`eventId` 는 소비 측 dedup 의 유일한 근거다. 같은 `eventId` 로 두 번 `append` 하면 UNIQUE 위반으로 트랜잭션이 죽는다 —
「이미 있으면 둔다」는 **호출부**가 판단한다(포트가 삼키지 않는다).

| 상황 | 키 | 예 |
| --- | --- | --- |
| 재시도가 멱등 receipt(§2.5)로 접히는 명령 안 | 무작위 UUID 허용 — 재생은 `append` 를 다시 부르지 않고 저장된 봉투를 돌려준다 | `IslandStateEvents`·`UserSatelliteCommandService` |
| 같은 사실이 두 번 적힐 수 있는 경로(리스너·크론·교차 DB 재시도) | **결정적 키** `<type>:<자연 키>[:<순번>]` | `user.withdrawn:<userId>`, `message.created:<messageId>`, `link.revoked:<groupId>:<inviterId>:<seq>` |
| 수신자별 fan-out | 수신자까지 키에 넣는다 `<사건 키>:<userId>`(㊢) | `join.request.updated:<requestId>:<recipient>:<status>:<ver>` |

**접두는 `<type>:` 이 원칙이고, 알림 두 사건만 `noti:` 로 남는다.** `noti:<KIND>:…`(`NotificationEventKey`)와
`noti:resultBundle:…` 는 공개 계약(`docs/contracts/notification-producer.md`)에 적힌 키이고, `ResultBundleCompletionService` 가
이미 적힌 행을 `event_id = 'noti:'||…` 로 대조해 중복을 거른다. 접두를 바꾸면 배포 경계 전후로 같은 사실이 다른 키로 두 번
적혀 알림이 중복 발송된다(GROMO-1953 결정 — 바꾸지 않는다).

결정적 키로 중복을 거를 때는 **조회 전에 축을 잠근다** — 잠그지 않은 「조회 후 삽입」은 동시 요청 둘이 모두 「없음」을 보고
뒤의 것이 UNIQUE 로 도메인 트랜잭션 전체를 되돌린다. 모범은 `NotificationOutboxProducer`(`allocateVersion` 으로 USER 축을
잠근 뒤 `findByEventId`).

### 2.3 순서 축과 version

- `version` 은 **`append` 가 발급한다.** 호출부는 번호를 만들지 않고, `params` 에 추정 version 을 중복 저장하지 않는다.
  receipt·응답에 version 이 필요하면 `append` 가 돌려준 `EventEnvelope` 를 쓴다.
- **예외: 도메인 행이 version 을 매기는 축** — 외양·재생(`AppearanceEvents`)은 `USER_APPEARANCE`·`ISLAND_APPEARANCE`·
  `ISLAND_PLAYBACK` 의 version 을 외양·재생 행이 잠금 아래 직접 올린다. 여기에 `aggregate_versions` 축을 하나 더 두면 시계가
  둘이 되어 공개 `payload.version` 과 봉투 `version` 이 어긋난다. 이 축은 `append(command, domainVersion)` 으로 적는다 —
  호출부가 그 도메인 행을 배타 잠근 채 부르고, `aggregate_versions` 는 건드리지 않는다. 한 축에 두 경로를 섞지 않는다.
  이 축의 `params.version` 은 공개 payload 필드이고 봉투 `version` 과 같은 도메인 값이라 「추정 중복」이 아니다.
- 스냅샷 응답의 경계처럼 **현재** version 만 필요하면 `currentVersion(aggregate)`(잠금 아래 읽기, 번호 불변)를 쓴다 —
  `InternalNotificationSettingsService#snapshot`.
- 축: 유저는 `AggregateRef.ofUser`, 링크 멤버십 전이는 `AggregateRef.ofLinkMembership`, 그 밖의 도메인 축은
  `new AggregateRef(AGGREGATE_TYPE, id)` 이며 `AGGREGATE_TYPE` 은 **그 축의 어댑터 한 곳에만** 상수로 둔다.
- `allocateVersion` 을 직접 부르는 경우는 셋뿐이다.
  1. 봉투가 아닌 도메인 fencing 값 — 세션 epoch(`AuthSessionService`), claim 의도 version(`InternalInviteLinkService`).
  2. 결정적 키 중복 검사 전 축 잠금 — `NotificationOutboxProducer`.
  3. 전이 순번을 `eventId`·`params` 에 실어야 할 때 — `LinkMembershipEventService`. 이 경우 `append` 가 번호를 한 번 더 쓰므로
     번호에 빈칸이 생긴다. 소비자는 「단조 증가」만 보고 「연속」에 기대지 않는다.
- 한 트랜잭션에서 **여러 유저**의 USER 축에 적으면(fan-out) 적기 «전»에 `lockUserAggregates` 로 정본 순서 잠금을 먼저
  잡는다(GROMO-893). CI 는 `outbox.user-lock-order.enforce=true` 로 순서를 거스르는 획득을 실패시킨다.

### 2.4 대상과 전송 상태

| 대상(`OutboxTarget`) | 수신 | `endpointKey` | transport 등록 |
| --- | --- | --- | --- |
| `KAFKA` | `notification-events` 토픽(key=userId) | 없음(`toKafka()`) | relay 가 켜지면 항상 |
| `NOTI` | 알림 서버 HTTP | `noti.*` 4개 | `application-satellites.yml` 에 `target: NOTI` 키가 있을 때 |
| `LINK` | 링크 HTTP(A23 로 서버 분리는 폐기됐고 걷어내기는 링크 구현 PR 몫) | `link.*` 7개 | `target: LINK` 키가 있을 때 |
| `REALTIME` | realtime `POST /internal/events` 예정 | 관례상 사건 `type` 과 같은 값 | **없음.** `OutboxRelayConfig` 는 HTTP transport 를 LINK·NOTI 에만 만든다 — 행은 미전달로 **보존**되고, transport 가 붙는 날 밀린 분이 나간다 |

- 대상 하나당 전달 요구 하나. **대상별 전달 상태를 합치지 않는다** — 합치면 한쪽만 실패했을 때 성공한 쪽이 재전달되거나(중복)
  실패한 쪽이 영영 안 간다(유실).
- REALTIME 을 NOTI·Kafka 로 우회시키거나, 저장만으로 전달 완료 처리하지 않는다(`OutboxTarget.REALTIME` javadoc).
- 새 HTTP 논리 키는 `application-satellites.yml` 의 `outbox.relay.endpoints` 허용목록에 **같은 PR 에서** 등록한다 — 목록에 없는
  키는 relay 가 보내지 않는다(SSRF 차단). 새 대상 값은 `V51__event_outbox.sql` 의 `target` CHECK 제약과 함께 늘린다.

### 2.5 멱등 receipt 와 사건은 다른 것이다

| | 저장소 | 무엇 | 누가 읽나 |
| --- | --- | --- | --- |
| receipt | `command_idempotency` | 명령 **응답** — 재시도에 같은 응답을 재생 | 같은 명령의 재시도 |
| 사건 | `event_outbox` + `event_outbox_deliveries` | 위성으로 나갈 **사실** | relay |

- 공개 명령은 `PublicCommandService.run` 을 쓰고, 명령 본문이 `PublicCommandResult(httpStatus, data, events)` 의 `events` 에
  **`append` 가 돌려준 봉투를 그대로** 담는다. 사건이 없으면 빈 배열이다.
- 내부(legacy) 명령은 `OutboxCommandPort.runIdempotent` 로 봉투(`UserSatelliteCommandService`) 또는 그 `eventId`·`version`
  (`InternalInviteLinkService#confirmClaim` 의 `ClaimIntentAck`)을 응답으로 저장한다.
- **재생은 사건을 다시 만들지 않는다.** 재생 경로에서 명령 본문은 실행되지 않으므로 `append` 도 없다. `replayed` 를 보고
  사건을 재발행하지 않는다(`PublicCommandService` javadoc).
- receipt 로 감싸지 않은 경로에서 적는 사건은 재시도가 새 `eventId`·새 version 을 만든다. `GroupService`·`GroupMemberService`·
  `GroupAnnouncementService`·`IslandFacilityCompletionService` 는 멱등 래핑 없이 REALTIME 어댑터를 부르므로, 이들을 멱등 명령
  바깥(레거시 그룹 API 등)에서 부르는 경로가 여기에 해당한다. 소비자는 `eventId` 가 아니라 축 version 으로 거른다.

### 2.6 재전달

- relay 는 at-least-once 다. 수신 측은 `eventId` 멱등이어야 한다.
- 재전달은 **저장된 전달 행 payload 를 그대로** 보낸다 — 발행 시점의 도메인 상태를 다시 읽지 않는다. 그래서 봉투는 불변이다.
- **불변의 유일한 예외는 `eraseWithdrawnParam`** 이고 탈퇴 트랜잭션 전용이다. 이미 전달됐거나 한 번도 안 나간 행만 고치고,
  시도했지만 미완료인 행은 그대로 둔다 — 본문이 바뀐 재전달은 소비자의 `eventId` 대조에서 영구 실패가 되고, 고갈 처리가 없는
  relay(A18 보류)에서 그 축 전체를 막는다.

### 2.7 payload 와 개인정보 (GROMO-1946)

봉투는 브로커·로그·DLT 에 남는다.

- `params` 는 소비자가 필요한 최소만 싣는다. 식별자로 충분하면 식별자만 — `message.created` 는 본문 대신 `messageId`(M02).
- **자격 원문을 싣지 않는다.** 대조가 필요하면 해시 — `auth.session.revoked` 는 bootstrap nonce 대신 `bootstrapNonceHash`.
- 이름 같은 개인정보를 실으면 **같은 PR 에서** 탈퇴 트랜잭션의 지움 경로를 단다: 봉투는
  `eraseWithdrawnParam(userId, type, paramKey)`(예: `link.displayNameChanged` 의 `inviterDisplayName`), receipt 는
  `PublicCommandService.forgetReceiptsOf` 가 탈퇴자의 멱등 기록을 전부 지운다.
- `notification.deviceToken.deleted` 는 삭제 대상 식별에 기기 토큰이 필요해 싣는다. 그 legacy receipt 도 위 지움 대상이다.

### 2.8 생산을 막는 스위치와 전송을 막는 스위치

| 스위치 | 막는 것 | 꺼져 있을 때 |
| --- | --- | --- |
| `outbox.relay.enabled` | 전송 | 봉투는 **적힌다.** 켜면 밀린 분이 나간다 |
| REALTIME transport 미등록 | 전송(REALTIME 만) | 봉투·전달 행은 적히고 미전달로 남는다 |
| `notification.dispatch.mode`(`LEGACY`\|`OUTBOX`) | 알림 **생산** 경로 선택 | `LEGACY` 면 알림 봉투를 적지 않는다(`NotificationDispatcher`·`ResultBundleCompletionService`·`NotificationRequestOutboxListener`) |
| `island-playback.events-enabled` | `playback.updated` **생산** | 행을 쓰지 않고 receipt `events` 는 빈 배열 |
| `island-management.commands-enabled` 등 명령 스위치 | 명령 자체(503) | 명령이 없으니 사건도 없다 — 생산 스위치가 아니다 |

**전송만 막을 때는 적고 보내지 않는다. 생산을 막을 때는 적지 않고 receipt `events` 를 비운다.** 적어 두고 「생산 꺼짐」이라
부르면 켜는 날 계약이 안 맞는 옛 사건이 한꺼번에 나간다.

### 2.9 봉투 필드 `userId`·`subjectId` 의 뜻 (GROMO-1953)

- **`userId` 는 사건의 당사자 유저다 — 한 사람에게 가거나 한 사람에 관한 사건(KAFKA·NOTI·LINK, REALTIME 개인큐,
  `user.withdrawn`)은 그 사람(알림은 수신자), 섬에 방송하는 REALTIME 사건은 그 사건을 일으킨 명령 주체다.**
  수신자 권한의 근거가 아니다 — 섬 방송의 수신자는 realtime 이 현재 멤버십으로 정한다. `eraseWithdrawnParam` 은 이 값으로
  탈퇴자의 봉투를 찾는다.
- **`subjectId` 는 소비자가 사건을 적용할 대상이다 — realtime 앱 사건(realtime-events LLD §2 의 14종)은 전달 범위인 섬 id,
  그 밖의 사건은 각 수신 계약이 정한 대상 id(알림은 `notification-producer.md`, `user.withdrawn` 은 탈퇴 유저)다.**
  개인 wallet/inventory 처럼 섬 범위가 없는 앱 사건은 `null` 이다.

REALTIME 전달 행은 다른 대상과 같은 **10필드 정본 봉투**를 싣는다 — realtime `POST /internal/events` 도 정본 봉투를 받는다
(`InternalEventController`). 앱에 나가는 7필드 봉투(realtime-events LLD §1)로의 변환은 realtime 몫이며 이름 옮김뿐이다:
`islandId ← subjectId`, `aggregateVersion ← version`, `payload ← params`(타입별 공개 필드만). 그래서 생산자는 7필드 모양을
따로 만들지 않고, 순서 축(aggregate)이 섬이 아닌 사건(공지·가입 요청·메시지·집중/휴식·개인 외양)도 `subjectId` 에는 섬 id 를
넣는다. 대상 id(공지·요청·메시지·세션)는 `params` 와 aggregate id 에 있다.

GROMO-1953 에서 이 정의에 맞춰 바꾼 곳: `notice.updated`(noticeId → islandId), `join.request.updated`(requestId → islandId),
`message.created`(messageId → islandId), `focus.member.updated`·`rest.member.updated`(userId → islandId), 외양·재생 3종(7필드
전달 행 → 정본 봉투). REALTIME transport 가 아직 등록돼 있지 않아(§2.4) 이 행들을 읽는 소비자는 없었다. 외양 receipt 의
`events` 도 정본 봉투가 됐다 — Business 는 그 배열을 불투명 `JsonNode` 로 받고 앱에 넘기지 않는다(`AppearanceUseCase`).

예외(정의와 다르지만 두는 것):

| 호출부 | 무엇이 다른가 | 두는 이유 |
| --- | --- | --- |
| `IslandJoinRequestEvents` | REALTIME 인데 `userId` 가 명령 주체가 아니라 **수신자**(신청자·방장별 봉투) | 개인큐 사건이다 — 정의의 「한 사람에게 가는 사건」에 해당한다. 수신자별 결정적 키가 이 값에 기대므로 바꾸지 않는다 |

## 3. 현재 호출 지점

경로 접두 `server/data-api/src/main/java/com/oneorthree/phone/` 생략. 줄 번호는 `append`(또는 직접 저장) 호출 줄이다.

| 호출 지점 | 사건 `type` | 대상 | 순서 축 | eventId |
| --- | --- | --- | --- | --- |
| `auth/service/AuthSessionService.java:302` | `auth.generation.bumped` | NOTI | USER | `<type>:<userId>:<generation>` |
| `auth/service/AuthSessionService.java:369` | `auth.session.revoked` | NOTI | USER | `<type>:<sessionId>` |
| `user/service/UserSatelliteCommandService.java:282` | `notification.deviceToken.deleted` · `notification.legacyDeviceToken.deleted` · `notification.settings.changed` | NOTI | USER | UUID |
| `withdrawal/service/WithdrawalSatelliteCommandService.java:53` | `user.withdrawn` | KAFKA·LINK·REALTIME | USER | `<type>:<userId>` |
| `group/service/LinkMembershipEventService.java:346` | `link.revoked` · `link.joined` · `group.closed` · `group.renamed` · `user.displayNameChanged` | LINK | LINK_MEMBERSHIP(`link.joined` 만 USER) | `<type>:<groupId>:<inviterId\|userId>:<seq>` |
| `internal/service/InternalInviteLinkService.java:403` | `link.claimConfirmed` | LINK | LINK_MEMBERSHIP | `<type>:<claimId>` |
| `notification/producer/NotificationOutboxProducer.java:166` | `notification.requested` | KAFKA | USER | `noti:<KIND>:<userId>:<subjectId\|none>:<시간축\|none>` |
| `notification/producer/ResultBundleCompletionService.java:169` | `notification.resultBundle.closed` | KAFKA | USER | `noti:resultBundle:<userId>:<groupId>:<slot>` |
| `group/service/IslandStateEvents.java:58` | `island.updated` | REALTIME | `ISLAND` | UUID |
| `group/service/IslandMembershipEvents.java:50` | `island.members.updated` | REALTIME | `ISLAND_MEMBERS` | UUID |
| `group/service/IslandNoticeEvents.java:53` | `notice.updated` | REALTIME | `NOTICE` | UUID |
| `group/service/IslandJoinRequestEvents.java:77` | `join.request.updated` | REALTIME | `JOIN_REQUEST` | `<type>:<requestId>:<recipient>:<status>:<ver>` |
| `construction/service/IslandWalletEvents.java:38` | `wallet.updated` | REALTIME | `ISLAND_WALLET` | UUID |
| `quest/service/IslandQuestEvents.java:41` | `quest.progress.updated` | REALTIME | `ISLAND_QUEST_PROGRESS` | UUID |
| `internal/service/InternalIslandMailboxService.java:145` | `message.created` | REALTIME | `MESSAGE` | `<type>:<messageId>` |
| `focus/service/FocusMemberEvents.java:77`(호출: `FocusSessionLifecycleService`·`FocusMembershipLossService`) | `focus.member.updated` · `rest.member.updated` | REALTIME | `FOCUS_MEMBER` · `REST_MEMBER` | UUID |
| `appearance/service/AppearanceEvents.java:103` | `member.appearance.updated` · `island.appearance.updated` · `playback.updated` | REALTIME | `USER_APPEARANCE` · `ISLAND_APPEARANCE` · `ISLAND_PLAYBACK` | UUID — `append(command, domainVersion)`, version 은 외양·재생 행이 발급(§2.3) |

포트를 부르지만 봉투를 적지 않는 곳: `allocateVersion` — `AuthSessionService`(세션 epoch)·`InternalInviteLinkService:185`(claim 의도);
`currentVersion` — `InternalNotificationSettingsService:92`(설정 스냅샷 경계); `eraseWithdrawnParam` — `LinkMembershipEventService:335`
(호출은 `GroupMemberService:386`).

## 4. 정리 대상

GROMO-1953 에서 8건 중 6건을 풀었다(한 사건 두 발행자 → `FocusMemberEvents`, 외양 포트 우회 → `append(command, domainVersion)`,
`userId`·`subjectId` 정의 → §2.9, `record*` MANDATORY → §2.1, 포트 밖 aggregate 잠금 → `currentVersion`). 남은 것과 남긴 이유:

1. **이름 3종이 규약과 다르다** — `UserSatelliteCommandService`·`WithdrawalSatelliteCommandService`·`LinkMembershipEventService`
   → `<축>Events`. 동작 변화는 없지만 참조가 main 14곳·test 11곳·문서 7곳에 걸쳐 있고 그중 `GroupService`·`GroupMemberService`·
   `AuthService` 는 병렬 작업이 자주 겹치는 파일이라, 이름만 바꾸는 diff 가 다른 PR 의 충돌을 만든다. 규약 강제(ArchUnit, ticket
   1724)와 함께 한 번에 바꾼다.
2. **eventId 접두 `noti:`** — 바꾸지 않기로 했다(§2.2). 정리 대상이 아니라 규약의 예외다.
