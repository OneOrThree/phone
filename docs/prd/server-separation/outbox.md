# 공통 내구 이벤트·명령 기반 (outbox)

GROMO-1659(알림 서버 분리)·GROMO-1660(초대 링크 서버 분리)의 **공통 선행분**이다.
정본은 `docs/architecture/decisions.md` **A21**(요청형 이벤트의 내구화)과 **A22**의
㊸·㊢·㋥·ⓑ″·ⓝ 이며, 이 문서는 그 결정을 코드·스키마로 옮긴 결과를 적는다.
정본과 어긋나면 정본이 맞다.

## 1. 왜 필요한가

지금은 한 DB·한 트랜잭션이라 「도메인이 바뀌었다 = 이벤트가 생겼다」가 공짜로 성립한다.
소유권을 나누는 순간 그게 깨진다.

- Business API 는 DB가 없고 쓰기 트랜잭션은 Data API 가 갖는다. **Data 커밋 직후 HTTP 응답이
  유실되거나 Business 가 죽으면 도메인 상태만 바뀌고 이벤트는 아예 생기지 않는다.**
  이건 브로커 발행 실패(A18)보다 **앞선 구간**이라 발행 주체는 재발행할 게 있다는 사실조차 모른다.
- 친구 요청·챌린지 개설 같은 **요청형**은 상태 조회형과 달리 리컨실로도 복구되지 않는다.

그래서 명령 트랜잭션이 **같은 트랜잭션에서** 봉투를 적고, 발행은 그 행을 읽어서 한다.

## 2. 테이블 넷 (V51)

| 테이블 | 막는 실패 |
| --- | --- |
| `event_outbox` | 커밋만 되고 이벤트가 사라지는 구간. 불변이다 |
| `event_outbox_deliveries` | 한 대상만 실패했을 때의 중복(성공한 쪽 재발행)·유실(실패한 쪽 방치) |
| `aggregate_versions` | 시퀀스의 「할당 순서 ≠ 커밋 순서」로 최신 상태가 폐기되는 것 (㊸) |
| `command_idempotency` | 첫 응답이 유실된 재시도가 **새 도메인 객체 + 새 봉투**를 만드는 것 |

`command_idempotency`의 물리 키는 `(userId, 원래 멱등 키)`의 SHA-256이다. 서로 다른 사용자가 같은 헤더를 사용해도 독립적으로 실행하며, 같은 사용자의 키를 다른 명령·본문으로 재사용하면 409로 거부한다.

컬럼별 근거는 `server/data-api/src/main/resources/db/migration/V51__event_outbox.sql` 과
`server/data-api/docs/db/schema.dbml` §9 에 있다.

## 3. 봉투

`eventId` · `schemaVersion` · `type` · `occurredAt` · `scheduledAt` · `userId` · `locale` ·
`subjectId` · `version` · `params`.

JSON 정본은 **`docs/contracts/notification-event-v1.json`** 이다. 양쪽 CI 가 이 파일을 계약
테스트에 쓴다(ⓔ).

못 박아 둘 것 둘:

- **`schemaVersion`(호환)과 `version`(순서)은 다른 값이고 둘 다 필수다.** 하나로 합치면
  스키마를 올릴 때마다 순서 판정이 튄다.
- **`null` 필드도 키를 남긴다.** `scheduledAt`·`locale`·`subjectId` 의 「없음」은 의미가 있는 값이라
  (예약 아님 · 로케일 미보고 · 대상 없음), 키를 빼면 소비자가 「필드가 아직 없는 구 스키마」와
  구분할 수 없다.

## 4. 순서 축 = version 발급 축

`AggregateRef` 가 그 축이다.

- 유저: `("USER", userId)`
- 링크 멤버십 전이: `("LINK_MEMBERSHIP", "<groupId>:<inviterId>")`

**둘이 같은 값이어야 한다.** 잠금이 직렬화한 것은 발급 축의 커밋 순서뿐이라, relay 가 다른 축으로
정렬하면 늦게 커밋된 낮은 번호가 이미 전달된 높은 번호 뒤에 도착한다.

링크 축이 따로 있는 이유는 ㋥ 다 — confirm/revoke 의 순서는 `(groupId, inviterId)` 축인데 claim
사용자와 발급자는 **서로 다른 유저**라 유저 축으로 표현할 수 없다.

## 5. relay 가 지키는 두 가지

**① 같은 축의 선행 미전달을 건너뛰지 않는다.** 선점 쿼리의 `NOT EXISTS` 가 「같은 (대상, 축)에 더
낮은 version 의 미전달이 있으면 후보에서 뺀다」를 강제한다. 앞 행이 **남의 리스에 잡혀 있어도**
여전히 미전달이라 앞지르기가 성립하지 않는다. 건너뛰면 앞 사건이 재시도되는 동안 뒤 사건이 먼저
도착해 투영이 과거 상태로 되돌아간다 — `key=userId` 는 브로커 **도착 순서**만 보존하고
`eventId` dedup 은 역순 적용을 못 막는다.

**알림 상태 → Kafka 생산에는 전송 방식 사이 장벽도 둔다.** Kafka 후보는 같은 축의 더 낮은
version에 미완료 `NOTI` HTTP 전달이 있으면 선점하지 않는다. 설정 변경·기기 삭제·세션 폐기의
HTTP 응답은 알림 DB 커밋 이후이므로, 그 상태가 적용되기 전에 후행 요청이 발송되는 창을 닫는다.
리스 중·실패 백오프 중에도 장벽은 유지되고, LINK와 다른 유저는 독립적으로 진행한다.

역방향인 Kafka → NOTI HTTP는 기다리지 않는다. Kafka의 `delivered_at`은 **브로커 ACK**이며
소비 완료가 아니다. 대칭 장벽으로 바꿔도 소비 순서는 보장되지 않고, 오히려 최신 끔·삭제가
Kafka 장애에 막힌다. 지연된 Kafka 요청은 수신·발송 시 최신 설정·세대·탈퇴 tombstone을
다시 적용한다. 이미 억제된 요청은 이후 설정을 켜도 되살리지 않는다. 이는 전송 방식 사이의
완전한 수신 순서 보장이 아니라 **선행 상태 커밋 이전의 후행 생산 발행을 차단하는 장벽**이다.

**② 낡은 워커의 완료 표시를 거부한다.** 리스가 만료돼 다른 워커가 재클레임하면 `lease_token`
(펜싱 토큰)이 바뀌고, 옛 워커의 표시는 0행을 갱신한다. 그 경우 새 워커가 다시 보내 **중복**이
나지만 수신 측이 `eventId` 멱등이라 안전하다 — 반대로 낡은 표시를 받아 주면 **유실**이고 그건
복구할 수 없다.

같은 이유로 **발행 확인 후에 표시한다.** 표시를 먼저 하면 그 사이 죽었을 때 유실이다.
at-least-once 는 이 방향으로만 틀려야 한다.

## 6. 켜고 끄기 — 기본은 꺼짐

`outbox.relay.enabled` 의 기본값은 **false** 이고, 프로파일 파일에는 아무 값도 넣지 않았다.
이 기반이 들어가는 시점에 브로커도 위성 서비스도 아직 없어서, 켜진 채로 들어가면 기존 앱 기동이
매 틱 연결 타임아웃을 문다(`focus.presence.enabled` 가 같은 이유로 같은 모양이다).

**꺼져 있어도 봉투는 적힌다.** 꺼진 동안 쌓인 행을 버리면 기반을 넣는 의미가 없다 — 켜면 그때
밀린 분이 나간다.

켤 때 필요한 값(하나라도 비면 **기동 거부**):

```
outbox.relay.enabled=true
outbox.relay.batch-size / lease-duration / poll-interval
outbox.relay.retry.initial-backoff / max-backoff / max-attempts
outbox.relay.endpoints.<KEY>.target / url / method / token   # HTTP 대상이 있을 때
```

## 7. A18(보류)을 코드가 대신 정하지 않는다

최종 재시도 기간·고갈 처리·비요청형 유실 허용은 **보류**다. 그래서 이 기반에는

- **고갈 처리가 없다.** `retry.max-attempts` 는 **경고 임계값**일 뿐이고, 넘어도 행은 남고 재시도는
  최대 백오프로 계속된다. 폐기·DLQ 이동은 하지 않는다.
- **실패가 행을 없애지 않는다.** 재시도 불가(설정 누락 같은 것)도 기록만 하고 남긴다 — 사람이
  설정을 고치면 그때부터 나간다.
- **HTTP 자동 폴백이 없다.** Kafka 가 죽었다고 HTTP 로 우회하지 않는다(같은 EC2 라 함께 죽을 확률도
  크다).

A18 이 정해지면 그 정책만 이 자리에 얹으면 된다.

## 8. SSRF 를 구조로 막는다

HTTP 대상의 목적지는 **설정의 허용목록에만** 있다. 전달 행은 논리 키(`endpoint_key`)만 갖고,
그 키가 목록에 없으면 **보내지 않는다**(「모르면 일단 보낸다」로 열면 저장 시점에 잘못 들어간 키가
곧 임의 목적지 호출이 된다). 경로 자리표시자 `{userId}` 조차 **봉투의 `userId`** 에서만 채운다 —
payload 가 호스트·포트·경로를 고를 수 있는 길이 하나도 없다.

인증은 caller 별 서비스 토큰(`Authorization: Bearer <token>`)이다. 위성 수신부는 그 토큰과 명시한 method/path
허용목록으로 호출자를 가른다 — **위성은 앱 JWT 로 인증하지 않는다**(계약 §2).

## 9. Kafka

`server/scripts/docker-compose.kafka.yml` — `apache/kafka` KRaft 단일 노드, 힙 512 MB, retention
7일, **볼륨 필수**, 외부 미노출(포트 매핑 없음 + advertised listener 가 컨테이너 이름).
내부 토픽 복제 계수를 전부 1 로 내린다 — 기본값 3 이면 `__consumer_offsets` 생성이 실패해
**컨슈머 그룹 자체가 불가**해진다.

토픽 자동 생성은 **끈다**. `notification-events` 와 `notification-events.DLT` 는 각 3파티션이
계약인데, 자동 생성은 오타 난 토픽 이름까지 조용히 만들어 발행만 성공하고 소비는 없는 상태를 만든다.
두 토픽은 Data API 의 `NewTopic` 빈이 만든다.

`.DLT` 의 파티션 수가 정본과 달라선 안 된다 — 달라지면 `key=userId` 의 파티션 배치가 어긋나
같은 유저의 재처리분이 흩어져 순서가 사라진다.

## 10. 검증

목이 생산 경로를 대신 세우지 않는다(계약 §8). 전부 실물이다.

| 테스트 | 무엇을 실물로 쓰는가 |
| --- | --- |
| `OutboxV51MigrationTest` | PostgreSQL + **실제 Flyway** — CI 는 `create-drop` 이라 마이그레이션에만 있는 제약·부분 인덱스·CHECK 는 이걸 돌려야만 드러난다 |
| `OutboxCommandIntegrationTest` | PostgreSQL + Flyway V51 + `ddl-auto=validate` — 엔티티↔마이그레이션 드리프트를 여기서 잡는다 |
| `OutboxRelayIntegrationTest` | 위 + **실물 Kafka**(`apache/kafka`, compose 와 같은 배포물) + 진짜 소켓을 여는 위성 스텁 |
| `OutboxRelayPropertiesTest` | 순수 단위 — A18 보류 규약과 허용목록 검증 |

`ddl-auto=validate` 로 도는 것이 중요하다. CI 는 마이그레이션을 돌리지 않아 엔티티↔DDL 드리프트가
**dev/prod 부팅에서만** 터져 왔다(GROMO-1506).

> ⚠️ 테스트는 `SPRING_PROFILES_ACTIVE=ci` 로 돌린다. 기본 `application.yml` 이 gitignored 라
> 프로파일 없이는 `jwt.secret` 미해결로 컨텍스트가 뜨지 않는다.

## 11. 이 기반이 하지 않는 것

기존 알림 리스너 전환, Business 어댑터, 새 알림 서버, 도메인 producer 배선은 별도 모듈이 담당한다.
이 문서가 다루는 것은 「봉투를 적고 · 순서를 지켜 · 대상별로 내보내는」 기반까지다.
도메인 쪽 배선은 `OutboxCommandPort` 하나만 보면 된다.
