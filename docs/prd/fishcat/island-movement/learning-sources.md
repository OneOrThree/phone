# 이동 서버 학습 자료: 근거와 읽는 순서

확인일: 2026-09-23. 그림 설명은 [학습 안내](learning-guide.md), 구현 제안은 [아키텍처](architecture.md)와 [HLD](high-level-design.md)를 함께 읽는다.
이 문서는 공식 규격과 현재 코드를 설명한다. Java·Netty QUIC 선택이나 서비스 분리를 새로 확정하는 문서가 아니다.

## 1. 먼저 네 가지 질문을 분리한다

| 질문 | 예시 | 무엇을 결정하는가 |
| --- | --- | --- |
| 누가 계산하는가? | 서버 A*, 클라이언트 예측 | 경로·좌표의 최종 결정권 |
| 어떤 언어로 만드는가? | Java, TypeScript | 프로그램 구현 도구 |
| 어느 프로세스에서 실행하는가? | Realtime JVM에 통합, 별도 Movement | 자원·배포·장애를 공유하는 범위 |
| 어떤 연결로 전달하는가? | WebSocket, QUIC stream, QUIC DATAGRAM | 데이터의 순서·재전송·보안·흐름 제어 |

이 분류는 설계를 읽기 위한 설명이다. Java 이동 서버를 별도로 만들면서 QUIC으로 연결할 수도 있고, Realtime JVM 안에 QUIC 수신기를 추가할 수도 있다.
Java에서 QUIC을 다룰 수 있다는 근거는 [Netty QUIC 공식 API](https://netty.io/4.2/api/io/netty/handler/codec/quic/package-summary.html)의 `QuicChannel`, `QuicStreamChannel`, `QuicDatagramExtensionEvent`다.

## 2. TCP와 WebSocket: 앞부분을 복구한 뒤 순서대로 읽는다

TCP는 애플리케이션에 **순서가 보장되는 바이트 흐름**을 제공한다. 손실을 감지하면 재전송하며 혼잡 제어를 수행한다.
뒤쪽 바이트가 먼저 도착해도 앞부분이 비었다면 일반적인 순차 읽기는 그 앞부분을 기다린다. 근거: [RFC 9293 §2.2·§3.8.2](https://www.rfc-editor.org/rfc/rfc9293.html#section-2.2).

RFC 6455의 WebSocket은 TCP 위에서 양방향 메시지를 주고받으며 텍스트와 바이너리 메시지를 모두 지원한다.
메시지 구분을 추가해도 같은 TCP 흐름의 손실 대기 특성이 없어지지는 않는다. `wss`의 기밀성·무결성은 TLS로 보호한다. 근거: [RFC 6455 §1.2·§5.6·§10.6](https://www.rfc-editor.org/rfc/rfc6455.html#section-1.2).

**설계에 적용한 해석:** 좌표 10·11·12 중 앞선 바이트가 빠지면 최신 좌표를 읽는 시점도 늦어질 수 있다. 그렇다고 WebSocket이 항상 느리다는 뜻은 아니다.
동시 인원, 패킷 손실, 큐 적체가 작으면 목표 성능을 만족할 수도 있다. 실제 조건에서 비교 측정해야 한다.

## 3. UDP와 QUIC: UDP 위에서도 서로 다른 전달 방식을 고를 수 있다

UDP 기본 규격은 메시지 전달이나 중복 방지를 보장하지 않는다. 순서 복구·신뢰성·암호화가 UDP라는 이름만으로 생기지는 않는다. 근거: [RFC 768](https://www.rfc-editor.org/rfc/rfc768.txt).

QUIC은 UDP 위에서 동작하는 보안 전송 프로토콜이다. QUIC stream은 스트림별로 순서가 있는 바이트 흐름을 제공하며 손실된 데이터를 재전송한다.
서로 다른 스트림에는 전송 계층의 순서 의존성이 없지만, 같은 연결의 혼잡 상황까지 독립되는 것은 아니다. 근거: [RFC 9000 §1·§2·§2.2](https://www.rfc-editor.org/rfc/rfc9000.html#section-2), [RFC 9002](https://www.rfc-editor.org/rfc/rfc9002.html).

QUIC DATAGRAM은 별도 확장이다. 유실된 DATAGRAM을 전송 계층에서 다시 보내지 않으며 전달 순서도 보장하지 않는다.
그래도 QUIC 연결의 암호화와 혼잡 제어를 사용한다. 혼잡하면 전송을 늦추거나 버릴 수 있으므로 **20Hz 생성이 매초 20회 도착을 보장하지 않는다**. 근거: [RFC 9221 §5·§6](https://www.rfc-editor.org/rfc/rfc9221.html#section-5).

| 전달 방식 | 순서와 손실 처리 | 읽을 때 주의할 점 |
| --- | --- | --- |
| WebSocket/TCP | 같은 TCP 흐름에서 순서 복구·재전송 | 최신 좌표도 앞선 손실의 영향을 받을 수 있음 |
| QUIC stream | 같은 스트림에서 순서 복구·재전송 | 여러 스트림 사이의 앱 의미 순서는 별도 계약 |
| QUIC DATAGRAM | 순서·재전송 보장 없음 | 앱이 번호·유효기간을 보고 낡은 상태를 버려야 함 |

표는 위 RFC의 요약이며 마지막 열은 우리 앱에 적용할 때의 해석이다.
**현재 제안:** 입장·이동 명령·경로 확정은 신뢰 가능한 stream, 주기적인 위치 스냅샷은 DATAGRAM으로 나눈다. 상세 계약은 [protocol.md](protocol.md)에 있다.

## 4. STOMP: 소켓 위에서 쓰는 메시지 주소와 동작 규칙

STOMP는 `SEND`, `SUBSCRIBE`, `MESSAGE` 같은 프레임을 정의한다. `/topic/...`의 구체적인 의미와 전달 보장은 서버 구현에 달려 있다.
STOMP를 쓴다는 사실만으로 영구 저장, 재연결 후 재생, 모든 구독자의 처리 완료가 보장되지는 않는다. 근거: [STOMP 1.2 개요·SUBSCRIBE·ACK](https://stomp.github.io/stomp-specification-1.2.html).

우리 앱은 STOMP를 WebSocket에 실어 보낸다. 채팅이나 집중 상태 이벤트의 목적지를 나눌 수 있지만, 이것이 A* 계산이나 방별 좌표 정본을 대신하지는 않는다.
현재 연결과 구독 코드는 [islandRealtime.ts](../../../../app/app-dev/src/services/islandRealtime.ts)의 `stompIslandChannel`에서 확인한다.

## 5. Kafka consumer group: 나눠 받기와 모두 받기는 다르다

Kafka의 같은 `group.id`에 속한 소비자들은 파티션을 나누어 맡는다. 정상적인 그룹 배정에서는 파티션 하나를 그룹 안의 한 소비자가 담당한다.
서로 다른 그룹은 같은 토픽을 각자 소비할 수 있다. 따라서 Realtime A·B를 같은 그룹에 넣는 것만으로 양쪽에 연결된 앱 모두에게 사건이 방송되지는 않는다.
근거: [KafkaConsumer 공식 문서 — Consumer Groups and Topic Subscriptions](https://kafka.apache.org/41/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html).

그룹 재배정·실패 복구 시 재처리가 생길 수 있으므로 “한 그룹의 한 소비자가 담당”을 “업무 처리가 영원히 정확히 한 번”으로 읽으면 안 된다.
소비 위치를 기록하는 offset commit과 실제 업무 처리는 별개다. 근거: 같은 문서의 **Offsets and Consumer Position**, **Manual Offset Control**.

**우리 설계에서의 해석:** Kafka 소비는 서버가 사건을 받아 처리하는 단계이고, 앱 소켓으로 내보내기는 별도 단계다.
현재 Realtime은 단일 소비 그룹에서 받은 사건을 Redis Pub/Sub로 다른 Realtime 인스턴스에 퍼뜨린다. 이는 아래 코드로 확인한 구현 사실이다.

## 6. 현재 저장소는 무엇을 구현했는가?

코드를 읽을 때의 기준은 이 브랜치이며, 운영 환경의 활성화 여부까지 확인한 것은 아니다.

| 확인한 코드 | 확인 결과 |
| --- | --- |
| [KafkaEventInbound.java](../../../../server/realtime/src/main/java/com/oneorthree/realtime/event/KafkaEventInbound.java) | `@KafkaListener`의 그룹은 `realtime-v1`. 입력은 `InboundEventService.accept`로 전달 |
| [application.yml](../../../../server/realtime/src/main/resources/application.yml) | `REALTIME_EVENTS_KAFKA_ENABLED`의 기본값은 `false`; Kafka 수신기는 조건부 활성화 |
| [RealtimeEventDelivery.java](../../../../server/realtime/src/main/java/com/oneorthree/realtime/event/RealtimeEventDelivery.java) | 로컬 STOMP 전달 뒤 `RedisKeys.EVENT_FANOUT_CHANNEL`로 전파. 실패 로그를 각각 남김 |
| [islandRealtime.ts](../../../../app/app-dev/src/services/islandRealtime.ts) | 옵션과 수신 자격에 따라 `focus`·`rest`·`emotes`·`playback`을 구독하며 스냅샷·버전으로 복구 |

주의할 오래된 설명도 있다.

- [Realtime README](../../../../server/realtime/README.md)의 “신규 이벤트 채널은 닫힘”, `DisabledRealtimeDelivery` 설명은 현재 전달 클래스와 맞지 않는다.
- `KafkaEventInbound` 상단의 “앱 전달을 켜면 인스턴스별 소비 그룹으로 바꾼다”는 주석도 현재 구현을 설명하지 못한다. 실제 그룹과 Redis 전파 코드를 기준으로 읽는다.
- 앱의 기존 STOMP 구독 구현을 새 20Hz 이동 좌표 서버가 이미 있다는 뜻으로 읽지 않는다. 이동 서비스는 여전히 이 문서 묶음의 제안이다.

## 7. 큐와 역압: 받는 쪽보다 빨리 만들면 기다리는 데이터가 쌓인다

큐는 아직 처리하거나 전송하지 못한 데이터를 보관하는 대기 공간이다. 역압은 이 밀림을 상류에 알려 생산·읽기·전송을 조절하는 방식이다.
이는 아래 API와 전송 규격을 설명하기 위한 개념 정리다.

Netty의 `Channel.isWritable()`과 `WriteBufferWaterMark`는 전송 버퍼 상태를 판단하는 수단이다.
쓰기 불가 상태에서도 계속 쓰면 요청이 큐에 쌓일 수 있으므로, 임계값 설정만으로 우리 데이터 폐기 정책까지 완성되지는 않는다. 근거: [Netty Channel API](https://netty.io/4.2/api/io/netty/channel/Channel.html#isWritable()).

혼잡 제어는 네트워크가 감당할 속도를 조절하고, 흐름 제어는 수신 측이 허용하는 데이터 양을 제한한다.
QUIC DATAGRAM에는 stream과 같은 명시적 흐름 제어가 없으며, 수신 측 자원이 부족하면 버릴 수 있다. 근거: [RFC 9221 §5.3·§5.4](https://www.rfc-editor.org/rfc/rfc9221.html#section-5.3).

**현재 제안:** 위치 스냅샷은 전송 전에 오래된 대기 상태를 최신 상태로 대체한다. 이동 명령·권한 변경은 별도의 완료·중복 제거 계약을 둔다.
이미 TCP 버퍼에 넘긴 바이트를 앱 큐에서 없애는 것처럼 취소할 수는 없으므로, 대체 판단은 전송 계층에 넘기기 전에 해야 한다.
큐 크기뿐 아니라 가장 오래 기다린 데이터의 나이, 버린 스냅샷 수, 틱 지연을 함께 측정한다. 구체적인 한도는 [HLD](high-level-design.md)의 검증 대상이다.

## 8. Java와 같은 JVM 통합을 평가하는 법

Java에서 네트워크 처리가 가능하다는 사실과 기존 Realtime 프로세스가 이동 부하까지 잘 감당한다는 주장은 별개다.
Netty API의 존재는 첫 번째 근거이며, 두 번째는 부하 시험으로 확인할 문제다. 모바일 클라이언트 네이티브 연동의 완성도도 별도 검증이 필요하다.

Java GC는 애플리케이션 응답 지연에 영향을 줄 수 있고, 처리량과 지연을 실제 작업 부하로 측정해야 한다.
이를 “Java는 실시간 처리가 불가능하다”로 확대해서는 안 된다. 근거: [Java 17 GC 튜닝 가이드 — Performance Considerations](https://docs.oracle.com/en/java/javase/17/gctuning/garbage-collector-implementation.html).

**설계 비교의 해석:** 같은 JVM에 넣으면 배포·관측 체계를 함께 쓸 수 있다. 반면 CPU·힙·프로세스 장애도 공유한다.
별도 서비스는 프로세스 자원과 배포 범위를 나누지만, 연결·인증·배치·장애 복구를 추가로 운영해야 한다. 어느 쪽도 측정 없이 자동으로 우월해지지 않는다.

## 9. 추천안과 검증된 사실을 구분하는 마지막 점검

| 문장 | 구분 |
| --- | --- |
| Java에서 Netty QUIC API를 사용할 수 있다 | 공식 라이브러리 기능 |
| QUIC DATAGRAM은 손실 재전송 없이 혼잡 제어를 적용한다 | 전송 규격 |
| 같은 Kafka 그룹은 Realtime 인스턴스 전체 방송을 대신하지 않는다 | 소비 그룹 규칙과 앱 전달 구조의 차이 |
| Java 별도 이동 서버에 앱이 직접 QUIC으로 연결하는 안을 우선 검증한다 | 현재 설계 제안; 채택 완료 아님 |
| 기존 Realtime 중계가 목표 지연·운영 비용을 더 잘 만족할 수 있다 | 비교 시험으로 확인할 가설 |
| 20Hz 서버 계산이면 화면도 초당 20장이다 | 오해. 계산·수신·렌더링 주기는 별도 계약 |

RFC와 라이브러리 문서는 기능·보장의 범위를 알려 준다. 우리 방 크기, 모바일 망, 비용에서 어떤 배치가 적합한지는 [검증 계획](validation.md)으로 결정한다.
