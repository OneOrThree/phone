# Kafka 소비 설계 — 커밋 시점 · 리밸런싱 · 소비 그룹 · 파티션 · 경계

브로커·토픽·DLT 가 **어떻게 생겼는지**는 [`decisions.md`](decisions.md) A12 와
[`server-separation/outbox.md`](../prd/fishcat/server-separation/outbox.md) §9 가 정했다.
이 문서는 그 위에서 **소비자가 어떻게 읽는지**를 정한다 — offset 을 언제 커밋하는지, 리밸런스가 나면
무슨 일이 생기는지, 소비 그룹을 몇 개 두는지, 파티션 수가 소비자 수를 어떻게 제한하는지, 그리고
왜 이 경계에 브로커를 뒀는지. 설정값은 전부 두 서비스의 `application.yml` 에 이 문서의 절 번호와
함께 적혀 있다 — 값을 바꾸면 여기 근거부터 고친다. (출발점: 2026-10-14 멘토링, GROMO-2290)

§1~§5 는 **문제 → 선택 → 버린 대안 → 근거 코드** 순서다. §3·§4 는 「문제」 자리에 판단 기준이나 사실을
먼저 두고, §6 은 체크리스트다.

## 0. 소비자 한 장

| 소비 그룹 | 토픽 | 서비스 | 파티션 | 인스턴스 × 스레드 | 커밋 | 켜는 스위치 |
|---|---|---|---|---|---|---|
| `notification-v1` | `notification-events` | `server/notification` `KafkaInbound` | 3 (+ `.DLT` 3) | 1 × 1 | `RECORD`, 수동 | `NOTIFICATION_KAFKA_ENABLED` |
| `realtime-v1` | `realtime-events` | `server/realtime` `KafkaEventInbound` | 3 (+ `.DLT` 3) | 1 × 1 | `RECORD`, 수동 | `REALTIME_EVENTS_KAFKA_ENABLED` |

두 소비자는 일부러 같은 모양이다 — 같은 outbox 봉투(`eventId` 멱등 · `version` 순서)를 받고, 같은
에러 핸들러(3회 재시도 → 원본 파티션의 `.DLT`)를 쓴다. 발행 쪽(키 = `userId`, 동기 확인 후 표시)은
`KafkaOutboxTransport` 와 A21.

## 1. 커밋 시점 — DB 트랜잭션이 끝난 뒤 offset 을 커밋한다

**문제.** `enable.auto.commit=true` 면 클라이언트가 `auto.commit.interval.ms`(5초)마다 **poll 로 받아 간
위치**를 커밋한다 — 처리가 끝났는지와 무관하다. 레코드를 받아 DB 에 쓰기 전에 커밋이 나가고 프로세스가 죽으면
그 사건은 영영 재전달되지 않는다(at-most-once). 알림은 「안 간 푸시」, realtime 은 「안 바뀐 화면」이 되고
outbox 는 이미 발행 성공으로 표시돼 있어 relay 도 다시 보내지 않는다.

**선택.** `enable-auto-commit: false` + `spring.kafka.listener.ack-mode: record`. Spring 컨테이너는 리스너
메서드가 **반환한 뒤** 그 레코드의 offset 을 동기(`commitSync`)로 커밋한다. 리스너가 부르는
`InboundService.accept()` / `InboundEventService.accept()` 는 `@Transactional` 이라 **반환 = DB 커밋 완료**다.
그래서 순서는 항상 `DB 커밋 → offset 커밋` 이고, 둘 사이에서 죽으면 같은 레코드를 **다시 받는다**.

다시 받아도 안전한 이유가 설계의 나머지 절반이다 — 소비 트랜잭션이 상태 반영과 **수신 마커**
(`inbound_events(event_id)`)를 한 커밋으로 묶는다. 재수신은 마커에 걸려 적용 없이 성공으로 끝난다
(알림은 같은 `eventId` 에 **다른 봉투**가 오면 409 → `.DLT`). 즉 at-least-once 는 **중복 쪽으로만** 틀리고
유실 쪽으로는 틀리지 않는다 — 발행 측 `KafkaOutboxTransport` 가 「확인 성공·표시 실패 → 재발행」으로 같은
방향을 택한 것과 짝이다.

**실패 경로도 같은 순서다.** 처리가 실패하면 `DefaultErrorHandler` 가 같은 레코드를 1초 간격으로 3회 다시
시도하고, 그래도 실패하면 `DeadLetterPublishingRecoverer` 가 원본 파티션의 `.DLT` 로 발행한다.
`setFailIfSendResultIsError(true)` 라서 **`.DLT` 발행이 확정된 뒤에만** 원본 offset 을 커밋한다
(`KafkaInboundTest.missingDltNeverAcknowledgesUntilRecoveryCanPublish` 가 실제 브로커로 검증한다). 그래서
`.DLT` 발행 직후·offset 커밋 직전에 죽으면 같은 레코드가 `.DLT` 에 **두 번** 쌓인다. DB 쪽은 inbox 가 받지만
`.DLT` 에는 멱등 장치가 없다 — `.DLT` 재처리 소비자(A18 과 함께 결정)는 중복을 전제로 `eventId` 로 거른다.

「수동 커밋 시점은 서비스마다 다르다」가 보통의 답인데 우리 두 소비자가 **같은 시점**인 이유는, 둘 다
소비 트랜잭션 안에 **외부 I/O 를 두지 않거나 되돌려도 무해한 것만** 두기 때문이다:

- 알림: FCM 호출은 소비 트랜잭션 밖이다. `accept()` 는 `deliveries` 행(PENDING)만 적고, 발송은
  `DispatchService` 가 자기 잠금·자기 트랜잭션으로 한다. 그래서 「FCM 은 갔는데 DB 는 롤백」이 소비 경로에서
  생기지 않는다.
- realtime: STOMP 전달(`deliver` → `EventRouter`)은 `accept()` **안**이라 커밋 전에 나간다. 커밋이 실패하면
  이미 나간 전달 뒤에 재수신·재전달이 한 번 더 간다. 전달 대상은 `focus.member.updated`·`rest.member.updated`
  둘뿐이고(`InboundEventService.DELIVERED_TYPES`), 앱은 둘 다 전체상태형 사건으로 받아 **같은 투영·키의
  watermark 보다 큰 `aggregateVersion` 만** 적용하고 같은 `eventId` 는 한 번만 처리한다
  ([realtime-events LLD §5.2](../prd/fishcat/realtime-events/low-level-design.md) 4·5항).
  그래서 같은 사건이 두 번 가도 화면은 같다. 순서가 보장되지 않는 인스턴스 간 Redis 팬아웃도 같은 규칙에
  기댄다. 되돌릴 수 없는 외부 효과를 여기에 넣게 되면 알림처럼 밖으로 빼야 한다.

**버린 대안.**

| 대안 | 왜 아닌가 |
|---|---|
| auto-commit | 위의 유실 창. 「DB 처리가 끝난 뒤 커밋」이 원칙인데 처리와 무관한 시계가 커밋한다 |
| `MANUAL` ack + `afterCommit` 에서 `Acknowledgment.acknowledge()` | 같은 순서를 코드로 다시 쓰는 것. `RECORD` 가 리스너 반환 = 트랜잭션 커밋을 이미 보장한다 |
| `BATCH` ack | poll 한 묶음(최대 500)을 다 처리한 뒤 한 번 커밋. 묶음 중간에 죽으면 **이미 커밋된 앞 레코드까지** 재전달돼 중복 창이 묶음 크기만큼 커진다. 처리량이 문제가 되면 그때 |
| Kafka 트랜잭션(EOS) | 소비 결과가 Kafka 가 아니라 PostgreSQL 에 쓰인다. EOS 는 「Kafka→Kafka」만 원자적이고 외부 DB 는 덮지 못한다 — 결국 inbox 멱등이 필요해 얻는 게 없다 |

**근거 코드.** `KafkaInbound` javadoc 첫 줄 · `InboundService.accept()`(알림) · `InboundEventService.accept()`
(realtime) · `application.yml` 의 `ack-mode` · `enable-auto-commit`(notification 은 `application-{dev,prod}.yml`,
realtime 은 `application.yml`).

## 2. 리밸런싱 — 언제 나고, 나면 어디까지 다시 받나

**문제.** 리밸런스는 파티션의 주인을 다시 정하는 절차다. 트리거는 넷: 인스턴스 기동·종료(배포 재생성),
크래시(`session.timeout.ms` 45초 동안 heartbeat 없음), **처리 지연**(`max.poll.interval.ms` 안에 다음
`poll()` 을 못 부르면 클라이언트가 스스로 그룹을 떠난다), 구독 토픽 변경. 기본 할당 전략(`RangeAssignor`)은
**eager** 다 — 리밸런스가 시작되면 **모든 멤버가 모든 파티션을 반납**하고 재할당이 끝날 때까지 그룹 전체가
멈춘다. 인스턴스가 하나일 땐 어차피 그 하나가 멈추지만, 둘 이상이면 하나를 재배포할 때 나머지까지 멈춘다.

**선택.**

- `partition.assignment.strategy: CooperativeStickyAssignor` — 협력적 재할당. 옮겨야 하는 파티션만 반납하고
  나머지는 계속 소비한다(KIP-429). 지금(인스턴스 1)은 차이가 없고, §4 의 증설 때 **배포가 소비 정지를 부르지
  않게** 미리 못 박는다. 전환은 **1단계 배포로 안전하다.** 브로커는 그룹의 모든 멤버가 지원하는 전략 중에서만
  고르는데, 클라이언트 기본 목록이 이미 `[Range, CooperativeSticky]` 라 구 멤버도 `cooperative-sticky` 를
  지원한다. 재생성 중 구·신 멤버가 한 세대에 겹쳐도(구 컨테이너가 `session.timeout.ms` 동안 남는 경우)
  공통 전략은 `cooperative-sticky` 하나뿐이고, 롤백도 같은 이유로 안전하다. ⚠️ 2단계 롤링(두 전략을 함께 나열한
  배포 → 옛 전략을 뺀 배포)이 필요한 경우는 **구 멤버의 목록에 cooperative 가 없을 때**다 — 예를 들어 누군가
  `RangeAssignor` 만 명시해 둔 그룹을 바꿀 때. 브로커 쪽 새 프로토콜(KIP-848, `group.protocol=consumer`)은
  브로커 4.0 부터 정식이고 우리는 3.8.1 이라 쓰지 않는다.
- `max.poll.interval.ms: 300000`(기본값을 **명시**). 정상 경로에서 한 레코드 처리의 상한 = DB 트랜잭션 + 실패 시
  에러 핸들러 재시도 3회 × 1초 + `.DLT` 발행 = 수 초. 5분은 그 100배다. 단 **`.DLT` 장애 중에는 상한이 없다** —
  `setResetStateOnRecoveryFailure(true)` 라 `.DLT` 발행이 실패하면 재시도 횟수가 초기화돼 같은 레코드를 계속
  붙잡는다. 컨테이너는 재시도 사이에도 poll 을 부르므로 쫓겨나지는 않지만, 그 파티션은 `.DLT` 가 돌아올 때까지
  멈춘다. 이것은 의도다 — 보존하지 못한 레코드의 offset 을 넘기지 않는다. 줄이고 싶어지는 유혹(예: 30초)을
  막는 이유 — 알림 `accept()` 는 발송 워커와 **같은 advisory lock**(`device-ownership`)을 기다릴 수 있고,
  그 대기가 상한을 넘기면 소비자가 쫓겨나 리밸런스 → 재수신 → 또 잠금 대기 → 또 쫓겨남의 폭풍이 된다.
  반대로 늘릴 이유도 없다 — 이 값은 「죽은 소비자를 발견하는 시간」이기도 하다.
- `session.timeout.ms` 45초 · `heartbeat.interval.ms` 3초는 기본값 그대로. 바꿀 근거가 생기면 여기에 적는다.

**리밸런스 중에 처리 중이던 레코드는?** Spring 컨테이너는 리스너를 **poll 스레드에서** 돌린다. 반납
콜백(`onPartitionsRevoked`)은 `poll()` 안에서만 오므로 **레코드와 레코드 사이**에서만 난다 — 처리 도중에
파티션을 뺏기는 일은 없고, `RECORD` 모드라 직전 레코드는 이미 커밋돼 있다. 예외는 **쫓겨난** 경우(상한
초과)다: 그때는 처리가 끝난 뒤의 `commitSync` 가 `CommitFailedException` 으로 실패하고, 새 주인이 같은
레코드를 다시 받는다 → §1 의 멱등이 받는다. 즉 리밸런스가 만드는 것은 유실이 아니라 **중복 1건**이고,
그 중복은 설계가 이미 흡수한다.

**버린 대안.** 정적 멤버십(`group.instance.id`) — 재시작 때 리밸런스 자체를 피하지만 인스턴스마다 고유 id 를
배포가 보장해야 하고, 단일 인스턴스에선 얻는 게 없다. 인스턴스가 늘고 배포 리밸런스가 지표에 보이면 그때.

**근거 코드.** `application.yml` `spring.kafka.consumer.properties.*` · `KafkaInbound.notificationErrorHandler`
· `KafkaEventInbound.realtimeEventsErrorHandler`(둘 다 `FixedBackOff(1000, 3)`) · `InboundService.enqueue()` 의
`store.lock("device-ownership")`.

## 3. 소비 그룹 개수 — 「같은 스트림을 독립된 커서로 끝까지 읽어야 하는 읽는 이」마다 하나

**기준.** 소비 그룹 = offset 커서 하나. 한 사건을 **한 번만** 받으면 되는 단위 — 보통 서비스 — 마다 그룹
하나를 두고, 그 서비스의 인스턴스들은 **같은** 그룹에 들어가 파티션을 나눠 갖는다. 모든 인스턴스가
**다** 받아야 하는 일(브로드캐스트)은 인스턴스별 그룹이 정석이지만 우리는 쓰지 않는다 — realtime 의 다중
인스턴스 팬아웃은 Redis Pub/Sub(`chat:events:v1`)이 맡는다. HTTP 입구(로드밸런서 뒤)도 한 인스턴스에만
떨어지므로 두 입구를 같이 덮으려면 Kafka 그룹을 쪼개는 것으로는 부족하다
(`server/realtime/CLAUDE.md` §Contracts 4).

**선택.** 현재 2개(§0). 토픽도 소비자마다 따로다. 어느 토픽으로 갈지는 생산 쪽 `OutboxTarget`(KAFKA ·
REALTIME)이 정한다. `score-events` 소비자가 생기면 셋째 그룹·셋째 토픽이다(A20, 미구현).

**버린 대안.**

| 대안 | 왜 아닌가 |
|---|---|
| 한 토픽을 두 그룹이 읽고 관심 없는 사건을 버리는 「필터 소비」 | lag 지표가 남의 사건까지 세고, 소비자가 남의 스키마에 결합된다 |
| realtime 을 인스턴스별 그룹으로 브로드캐스트 | Kafka 입구만 고친다. HTTP 입구도 한 인스턴스에 떨어지므로 Redis 재분배가 두 입구를 함께 덮는다 |

**`-v1` 접미사.** 소비 의미(멱등 규칙·투영 스키마)가 호환되지 않게 바뀌면 `-v2` **새 그룹**으로 뜬다 — 새
커서라 `auto-offset-reset: earliest` 에 따라 보존 기간(7일, A12) 안의 사건을 처음부터 다시 읽고, §1 의
inbox 멱등이 이미 적용된 것을 걸러 준다. `latest` 였다면 「구 소비자를 끈 시각 ~ 새 소비자가 붙은 시각」
사이의 사건이 조용히 빠진다 — 그래서 두 서비스 모두 `earliest` 다. `.DLT` 를 다시 읽는 재처리 소비자는
**별도 그룹**이어야 한다(원본 그룹의 커서를 건드리면 안 된다) — A18 과 함께 결정한다.

**근거 코드.** `@KafkaListener(groupId = …)` 두 곳 · `auto-offset-reset`(notification 은
`application-{dev,prod}.yml`, realtime 은 `application.yml`) · `OutboxTarget`.

## 4. 파티션 수와 소비자 수 — 활성 소비자 ≤ 파티션

**사실.** 파티션은 토픽당 3 (`docker-compose.kafka.yml` `KAFKA_NUM_PARTITIONS` + `OutboxRelayConfig` 의
`NewTopic`, 자동 생성은 꺼 둠). 그룹 안의 활성 소비자 수 = **인스턴스 × `concurrency`** = 1 × 1. 한 파티션은
한 시점에 한 소비자만 읽으므로 **4번째 소비자부터는 아무것도 받지 않는다** — 늘렸는데 처리량이 그대로면
여기부터 의심한다.

**선택.**

- `spring.kafka.listener.concurrency: 1` 을 **명시**. 이 값은 인스턴스 **안**의 스레드 수다. 3 으로 올리면
  인스턴스 하나가 파티션 3 을 다 가져가 **인스턴스를 늘려도 분담할 파티션이 없다**. 증설의 단위를
  스레드가 아니라 인스턴스로 두는 게 장애 반경(한 프로세스 죽음 = 1/N)에 맞다. 지금 소비 쪽은 병목이
  아니다 — 알림의 병목은 FCM 발송 워커, realtime 은 STOMP 세션이라 1 로 충분하다.
- 파티션 3 은 A12 가 정했고, 이 문서는 그 수의 **운영 의미**를 못 박는다: 그룹당 인스턴스 상한 3. 파티션은
  **줄일 수 없고**, 늘리면 `key=userId` → 파티션 매핑이 바뀌어 전환 시점에 걸친 같은 유저의 사건이 두
  파티션으로 갈라지고(순서 축 깨짐) `.DLT` 와의 파티션 정렬(A12)도 함께 다시 맞춰야 한다. 그래서 처음부터
  「예상 최대 인스턴스 수」로 잡고 그 안에서만 늘린다.

**버린 대안.**

| 대안 | 왜 아닌가 |
|---|---|
| `concurrency: 3` 으로 스레드 확장 | 인스턴스 하나가 파티션을 다 가져가 인스턴스 증설이 무의미해지고, 프로세스 하나가 죽으면 소비 전체가 멈춘다 |
| 파티션을 처음부터 크게(예: 12) | 단일 노드 브로커(A12)에서 파티션마다 파일·메모리 비용이 들고, 지금 소비자는 1 이다. 3 이면 Target-1 의 인스턴스 계획을 덮는다 |

**증설 순서.** 인스턴스 ≤ 3 까지는 그냥 늘린다(§2 의 협력적 리밸런스가 정지 없이 분담한다). 3 을 넘겨야
하면 파티션을 늘려야 하고, 그 절차는 decisions.md ⓧ(관리형 브로커 전환)의 컷오버 절차를 **준용**한다.
실행 전에 이 순서를 별도로 확정한다.

1. 소비 lag 로 정말 소비가 병목인지 확인한다. Datadog `kafka_consumer` 체크가 그룹을 자동 발견한다(compose 라벨).
2. **relay 를 멈춘다.** 멈출 것은 Data API 의 쓰기가 아니라 relay 다 — outbox 가 내구 저장이라 그동안의 사건은
   행으로 남는다.
3. drain 한다. 두 그룹의 lag 0, 그리고 **`.DLT` 에 쌓인 레코드를 먼저 처리**한다. 증설 뒤에는 같은 `userId`
   의 재처리분이 다른 파티션에 놓이기 때문이다.
4. 정본과 `.DLT` 의 파티션을 **같은 수로 함께** 늘린다.
5. relay 를 재개한다. 소비자 쪽 코드 변경은 없다.

⚠️ `OutboxRelayConfig` 의 `NewTopic` 빈은 기동할 때 선언된 파티션 수가 기존보다 크면 토픽을 **자동으로
늘린다**(Spring `KafkaAdmin`). 그래서 파티션 설정값만 바꿔 배포하면 위 2~3 단계 없이 증설이 일어난다. 그 값은
3단계가 끝난 뒤에 바꾼다(§6).

**근거 코드.** `docker-compose.kafka.yml` 의 `KAFKA_NUM_PARTITIONS` · `OutboxRelayConfig.notificationEventsTopic()`
· `OutboxRelayConfig.notificationEventsDltTopic()` · `application.yml` 의 `concurrency`.

## 5. 왜 이 경계에 브로커인가 — 트랜잭션 단위의 격차

**문제.** 서비스를 가르는 기준 가운데 하나는 **트랜잭션 단위의 격차**다 — 한쪽은 밀리초 단위 DB 커밋이고
다른 쪽은 외부 호출·시간 보류·부분 성공이 섞인 긴 작업이면, 동기로 묶는 순간 짧은 쪽이 긴 쪽의 지연과
실패를 그대로 떠안는다. 분석·배치·단순 요청·어드민처럼 단위가 다른 일은 끊어 둔다.

**gromo 의 격차.**

| 프로세스 | 트랜잭션 한 단위 | 길이 | 실패의 모양 |
|---|---|---|---|
| Data API | 요청 1건 = DB 트랜잭션 1개, 행 잠금 아래 `version` 발급(A21) | ms | 롤백 — 깨끗하다 |
| Notification | 사건 1건 → 기기 N대 FCM 호출, 조용한 시간이면 **다음 날 아침까지 보류**, 기기별 부분 성공, 3회 재시도 | 수백 ms ~ 시간 | 부분 성공 — 기기별로 기록해야 한다 |
| Realtime | 연결 수명(세션) 단위, 사건은 섬 단위 팬아웃 | 연결이 사는 동안 | 끊김 — 재연결이 복구 |
| Business API | 조합만 한다. 도메인 DB 가 없고, 전용 Redis 에는 다시 만들 수 있는 미리보기 캐시만 둔다 | 요청 1건 | 재시도(멱등 키) |

집중 세션 종료 하나에 「세션 커밋 + 상대방 푸시 + 섬 화면 갱신」이 걸린다. 이를 동기 호출로 엮으면 세션
종료 API 의 지연이 FCM 응답에, 성공 여부가 알림 서버의 생존에 묶인다. 그래서 Data 의 커밋 안에는 **outbox
행 하나**만 넣고(A21), 전달은 `relay → 브로커 → 소비 트랜잭션(§1) → 발송 워커 트랜잭션` 의 네 토막으로
끊는다. 토막마다 **자기 길이의 트랜잭션**과 자기 재시도를 갖고, 토막 사이는 브로커의 보존(7일)과 outbox
의 미표시 행이 이어 준다. 브로커가 그 자리에 있는 이유는 「비동기」가 아니라 **격차를 흡수하는 버퍼**다 —
알림 서버가 1시간 죽어 있어도 Data 는 모르고, 깨어나면 §3 의 커서에서 이어 읽는다.

**반대로 브로커를 두지 않은 곳.** Business → Data 는 동기 HTTP 다 — 요청형이라 **응답이 필요**하다(격차가
아니라 응답 유무가 기준). 요청형 이벤트도 Business 가 직접 발행하지 않는다 — Data 가 같은 트랜잭션에
outbox 행으로 내구화하고 relay 가 발행한다(A21). 알림 → Data 의 조회 3종(리컨실·ack 수렴·발송 적격)도 동기다 — 읽기라 트랜잭션
격차가 없다. 어드민(콘솔)은 Business 안의 `/console/**` 이고 분석은 Datadog 이라 별도 프로세스가 아니다 —
분석용 소비자가 필요해지면 **같은 토픽을 새 그룹으로 읽는 것**(§3)이 길이지 Data 에 조회를 더하는 게
아니다.

**버린 대안.**

| 대안 | 왜 아닌가 |
|---|---|
| Data 가 커밋 뒤 FCM·STOMP 를 직접 호출 | 세션 종료 API 의 지연·성공이 외부 호출에 묶이고, 커밋 직후 죽으면 호출이 사라진다(A21 이 막으려던 구간) |
| 서비스를 나누지 않고 한 DB 의 모듈러 모놀리스로 | 발송 워커의 긴 잠금·보류가 코어 DB 커넥션 풀과 잠금을 같이 쓴다. 알림이 별도 DB(A10)를 갖는 이유와 같다 |
| 브로커 없이 outbox → HTTP 로만 전달 | 지금도 기본 경로로 남아 있다(realtime). 하지만 수신 측이 죽어 있는 동안 relay 가 재시도를 떠안고, 여러 소비자가 같은 사건을 읽을 수 없다 |

**근거 코드.** `KafkaOutboxTransport`(키 = `userId`, 동기 확인 후 표시) · `OutboxTarget` · decisions.md A21(outbox)
· A23(콘솔은 Business 안).

**남은 것.** 브로커 자체가 죽었을 때 relay 가 얼마나·어떻게 재시도하고 그 뒤 무엇을 하는지는 A18(보류)
이다 — 이 문서는 소비 쪽만 닫는다.

## 6. 바꿀 때 체크리스트

- **인스턴스를 늘린다** → 합이 파티션 수(3)를 넘지 않는지(§4). 그룹 안의 전략이 전부 cooperative 인지(§2).
- **파티션을 늘린다** → 정본과 `.DLT` 를 같이(A12), relay 정지·drain(`.DLT` 처리 포함) 뒤에(§4).
  `OutboxRelayConfig` 의 `NewTopic` 파티션 값도 drain 이 끝난 뒤에 바꾼다 — 먼저 바꾸면 기동이 증설을 해 버린다.
- **처리가 길어진다**(외부 호출을 소비 트랜잭션 안에 넣고 싶다) → 넣지 말고 알림처럼 행을 적고 워커로 뺀다
  (§1). 정 넣어야 하면 `max.poll.interval.ms` 를 그 상한의 10배 이상으로 두고 여기 근거를 적는다(§2).
- **새 소비자를 붙인다** → 새 토픽 + 새 그룹(§3), `.DLT` 접미사·원본 파티션 명시(README 「바꾸는 법」),
  §0 표에 한 줄.
- **소비 의미가 호환되지 않게 바뀐다** → 그룹 `-v2`, `earliest` 재독을 inbox 멱등이 받는지 먼저 확인(§3).
