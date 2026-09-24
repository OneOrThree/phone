# 전송 계약 초안

상태: wire v1 설계 제안. 구현 전 상호 운용 fixture와 함께 동결한다. 서버 언어·라이브러리 버전의 확정은 POC 이후다.

## 1. 전송 선택

**POC 추천:** QUIC 연결 하나에서 reliable stream과 DATAGRAM을 함께 사용한다. DATAGRAM은 손실 재전송을 기다리지 않는 좌표에, stream은 입장·명령·경로·퇴장에 사용한다. 둘 다 UDP 기반 QUIC 연결 안에 있다. DATAGRAM 협상이 실패하면 동기화 모드를 활성화하지 않고 이유를 표시한다. 임의로 평문 UDP로 내리지 않는다.

QUIC의 DATAGRAM 확장은 비신뢰성 데이터 전송을 제공하며 크기 제한과 혼잡 제어를 따른다. 실제 전송 가능 크기를 넘는 메시지를 애플리케이션이 나눠야 한다. [RFC 9221](https://www.rfc-editor.org/rfc/rfc9221.html)

TLS 기반 QUIC 보호를 사용하고 클라이언트는 서버 인증서·호스트를 검증한다. 티켓 인증은 이 보호된 연결 안에서 수행한다. 앱에 대칭 비밀을 심거나 자체 AES 패킷 프로토콜을 만들지 않는다. 상태 변경 0-RTT는 사용하지 않는다. [RFC 9001](https://www.rfc-editor.org/rfc/rfc9001.html)

대안 DTLS 1.3은 UDP 데이터그램 보호 후보지만 명령 전달 보장·혼잡·재전송·경로 전달을 추가 설계해야 한다. QUIC POC 실패 시 해당 비용을 포함해 재비교한다. [RFC 9147](https://www.rfc-editor.org/rfc/rfc9147.html)

### 라이브러리 후보와 검증 한계

| 위치 | POC 후보 | 확인한 근거 / 남은 검증 |
| --- | --- | --- |
| Java 서버 | Netty QUIC codec | 공식 API에 QUIC stream·DATAGRAM 지원이 있다. 지원 JDK·Netty 버전·네이티브 바이너리의 배포 OS/CPU 호환, 모바일 상호 운용과 팬아웃 처리량은 POC로 검증한다. [공식 API](https://netty.io/4.2/api/io/netty/handler/codec/quic/package-summary.html) · [DATAGRAM 설정](https://netty.io/4.2/api/io/netty/handler/codec/quic/QuicCodecBuilder.html) |
| iOS·Android | quiche C FFI를 감싼 네이티브 모듈 | upstream은 C API·모바일 빌드 지침을 제공한다. 이 앱의 Expo/RN·서명·배터리 호환은 미검증. [upstream](https://github.com/cloudflare/quiche) |
| 앱 JS | MovementTransport 추상화 | 기존 RN Fetch/WebSocket만으로 raw QUIC가 제공된다고 가정하지 않는다. 네이티브 구현 필요는 현재 앱 코드와 [RN networking 문서](https://reactnative.dev/docs/network)에 근거한 설계 판단 |

서버 도메인 로직은 Java로 작성하고, 네트워크 라이브러리의 네이티브 의존성은 빌드·배포에서 관리한다. 네이티브 의존성을 쓴다는 사실이 별도 C++ 게임 서버를 개발한다는 뜻은 아니다. 기존 서버의 Java 17을 POC 기준으로 삼되 선택 라이브러리와 JDK 조합은 검증 후 고정한다.

커스텀 ALPN `fishcat-movement/1` 후보로 raw QUIC를 사용한다. HTTP/3나 WebTransport 서버를 자동으로 함께 제공하는 설계가 아니다. 웹 미리보기에는 별도 mock transport를 사용하며 네트워크 검증 증거로 계산하지 않는다.

## 2. 입장 계약

`POST /islands/{islandId}/movement-sessions`는 **새 공개 API 제안**이다. 실제 prefix·응답 envelope·오류 코드는 기존 API 규약에 맞춰 구현 시 고정한다.

Business는 기존 로그인과 섬 컨텍스트를 검사하고, 소유자를 배정한 뒤 권한·배치 스냅샷 push의 준비 ack를 받는다. 응답에는 `endpoint`, `ticket`, `expiresAt`, `gameId`, `roomId`, `roomEpoch`, 지원 protocolVersion과 manifest를 넣는다. 티켓 payload는 audience·subject·room·epoch·sessionId·actorGeneration·permissionVersion·iat/exp·jti를 결합하고 Business가 서명한다.

worker는 서명·기한·scope와 준비된 권한 투영의 일치를 확인한다. jti는 방 단일 작성자가 원자적으로 소비한다. 같은 티켓을 다른 worker나 epoch에서 쓰지 못한다. 인증 전에는 snapshot·actor 목록을 보내지 않는다. 티켓은 입장에만 쓰고 갱신된 권한 lease가 세션 유지 여부를 결정한다.

## 3. 메시지 목록

| 메시지 | 방향 / 채널 | 주요 필드·처리 |
| --- | --- | --- |
| Join / Welcome | 앱→서버 / 서버→앱, control stream | ticket·protocolVersion / session·actor·epoch·nav·serverTick·tickMs·limits |
| MapReady | 앱→서버, control stream | navRevision·contentHash; 일치 전 이동 명령 거부 |
| MoveIntent | 앱→서버, command stream | commandSeq·navRevision·goalX/Y. 암호화된 목적지 좌표 |
| PathAccepted | 서버→관심 수신자, actor event stream | actorId·actorGeneration·commandSeq·pathId·navRevision·startTick·확정 시작/도착·waypoints·속도 |
| MoveRejected | 서버→요청자, command result stream | commandSeq·사유·현재 navRevision·확정 위치 |
| Snapshot | 서버→앱, DATAGRAM | 아래 바이너리 header + entity 배열 |
| ActorJoined / ActorLeft | 서버→앱, control stream | actorId·actorGeneration, 최소 표시 정보 / 퇴장 원인 |
| Arrived / Relocated | 서버→앱, actor event stream | pathId·serverTick·position / reason |
| MapChanged | 서버→앱, control stream | 새 manifest·effectiveTick; 전체 새 경로는 별도 actor stream |
| ResyncRequest / FullState | 앱↔서버, control stream | 마지막 유효 세대·버전 / 현 actor·경로·tick 기준 |
| Heartbeat / HeartbeatAck | 앱↔서버, DATAGRAM | session에 결합된 nonce·echo·serverTick, 1초 주기 |
| Leave / SessionClosed | 양방향 / 서버→앱, control stream | 종료 원인. 수신 못 해도 lease/liveness로 정리 |

인증된 연결에는 session·room 컨텍스트를 한 번 결합한다. 다른 방 ID를 패킷에 끼워 바꿀 수 없다. 주민별 경로 stream을 분리해 큰 경로 하나가 다른 주민의 명령·입장을 막지 않게 한다. 스트림 간 순서는 보장되지 않으므로 epoch/nav/pathId로 의존성을 검사한다.

stream 메시지는 `length:u32 + version:u8 + type:u8 + flags:u16 + payload` 프레임을 사용한다. length는 뒤따르는 모든 바이트 수이며 상한 64KiB, 타입별 더 작은 제한을 둔다. 경로 waypoint는 각 x/y uint16, 최대 4,096개로 제한한다. FullState는 actor 상태와 활성 pathId 목록을 담고 경로 본문은 actor event stream으로 분리한다. 경로 전체를 한 FullState 프레임에 모아 64KiB 상한을 넘기지 않는다. 앱은 필요한 경로가 모두 준비될 때까지 해당 actor를 정지 표시한다. 가변 배열은 개수·남은 길이를 검사한 뒤 할당한다. 알 수 없는 필수 타입·버전은 연결 오류로 종료하며 예약 확장 필드는 협상된 규칙에서만 건너뛴다.

## 4. Snapshot v1 바이너리

네트워크 바이트 순서(big endian), struct padding 없음. 맵·세션 식별의 나머지는 Welcome의 인증된 연결 컨텍스트에 결합한다. 좌표는 `round(world×100)`의 uint16, 범위 0..10000이다. uint64 epoch는 JS에서 Number로 변환하지 않고 BigInt 또는 두 uint32로 보존한다.

### Header — 32 bytes

| offset | 필드 | 형식 | bytes |
| --- | --- | --- | --- |
| 0 | version | uint8 | 1 |
| 1 | type | uint8 | 1 |
| 2 | flags | uint16 | 2 |
| 4 | roomEpoch | uint64 | 8 |
| 12 | packetSeq | uint32 | 4 |
| 16 | serverTick | uint32 | 4 |
| 20 | navRevision | uint32 | 4 |
| 24 | entityCount | uint16 | 2 |
| 26 | payloadBytes | uint16 | 2 |
| 28 | reserved | uint32, v1=0 | 4 |

### Entity — 24 bytes

| offset | 필드 | 형식 | bytes |
| --- | --- | --- | --- |
| 0 | actorId | uint32 | 4 |
| 4 | pathId | uint32 | 4 |
| 8 | x | uint16 | 2 |
| 10 | y | uint16 | 2 |
| 12 | segmentIndex | uint16 | 2 |
| 14 | speed | uint16, world unit/s × 100 | 2 |
| 16 | lastCommandSeq | uint32 | 4 |
| 20 | heading | uint8, 0..255를 한 회전으로 매핑 | 1 |
| 21 | state | uint8 enum | 1 |
| 22 | flags | uint16 | 2 |

`payloadBytes=entityCount×24`, 전체 길이 `32+payloadBytes`와 수신 길이가 정확히 같아야 한다. 인증이 성공해도 범위·enum·count·예약 필드·path segment를 검증한다. actorId는 epoch 안에서 재사용하지 않으며, 세션 교체 시 새 actorId를 배정한다. 같은 ID에 이전 세션 좌표가 붙는 일을 막는다.

### 크기·전송 예산

| actor 수 / 수신자 | 1회 payload | 20Hz payload / 수신자 |
| --- | --- | --- |
| 1 | 56B | 1,120B/s |
| 10 | 272B | 5,440B/s |
| 15 | 392B | 7,840B/s |

15명이 모두 15명 상태를 받으면 한 방 송신은 `7,840×15=117,600B/s`(약 0.941Mbps), 100개 방은 11.76MB/s다. **QUIC·TLS·UDP·IP·경로 메시지·ACK·재시도 비용을 제외한 값**이므로 실제 NIC 송신은 더 크다.

payload 상한 1000B일 때 snapshot당 최대 40 actor(992B)다. 협상/라이브러리의 현재 DATAGRAM 한도가 더 작으면 그 안으로 줄인다. 큰 방은 독립적인 actor 부분 집합으로 나눠 보낸다. 전체 프레임 재조립을 기다리지 않는다. 부분 패킷을 버리지 않도록 최신 여부는 actor별 `(tick,packetSeq)`로 판정한다.

처음에는 delta·gzip을 적용하지 않는다. 정수 양자화·고정 필드·가시 대상 제한으로 줄인다. delta가 필요해지면 수신자가 확인한 baseline, 누락 시 full 복구, 측정된 이득을 별도 wire 버전에 추가한다.

## 5. 중복·순서·실패 규칙

- `commandSeq`는 세션에서 증가한다. worker는 명령별 수락/거절 결과를 제한된 캐시에 보관해 중복에 같은 결과를 응답한다. 캐시에서 사라진 이전 seq는 재실행하지 않고 `STALE_COMMAND`로 돌려준다. 더 최신 명령이 있으면 오래된 비동기 A* 결과를 버린다.
- snapshot의 lastCommandSeq는 **처리 완료** 순번이다. A* 계산을 큐에 넣은 것만으로 ack하지 않는다. 새 명령을 확정하면 이전 pending 명령은 superseded로 종료한다.
- `pathId`는 actor 내 증가하고 `navRevision`에 묶인다. unknown path는 버퍼 상한 안에서 잠깐 대기하거나 resync하며 바로 보간하지 않는다.
- uint32 sequence·tick·revision이 랩어라운드하기 전에 새 세션/epoch로 재동기화한다. 단순 정수 비교가 랩어라운드에서 뒤집히지 않도록 수명 제한을 둔다.
- 역순·중복·다른 epoch의 좌표는 상태를 바꾸지 않는다. datagram 수신 자체를 명령 성공 ack로 취급하지 않는다.
- 암호화는 변조된 정식 클라이언트의 치팅을 막지 않는다. 서버는 목적지·속도·권한·빈도·맵·순서를 별도로 검사한다.
- handshake rate/동시 연결, 프레임 크기, actor당 pending 1개, 방별 연산 quota, 신뢰성 송신 큐를 제한한다. 미인증 연결에 큰 맵·상태를 응답하지 않는다.

## 6. 진단 필드

구조화 로그는 `event, traceId, gameId, roomId, roomEpoch, sessionCorrelationId, actorId, commandSeq, pathId, navRevision, serverTick, reason, durationMs`를 사용한다. 세션 상관 ID는 인증 토큰과 다른 불투명 값이다.

입장·권한 취소·맵 교체·소유권 변경·오류는 기록한다. 정상 20Hz 위치는 매번 로그로 남기지 않고 tick 지연·경로 시간·송신 bytes·drop·reconcile 거리·lease 만료 지표로 집계한다. 재현용 상세 좌표 로그는 기간·사용자 범위를 제한한 진단 모드에서만 켠다. 티켓·로그인 토큰·TLS 키는 기록하지 않는다.
