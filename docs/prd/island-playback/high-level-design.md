# 공용 음악 아키텍처와 흐름

방송기는 음악 파일을 실시간으로 중계하는 서버가 아니라 “어떤 곡을 몇 초부터 재생할지” 적어 둔 공용 메모다. 앱들은 같은 메모와 서버 시계를 보고 각자 재생한다. 내 휴대폰 음량을 줄여도 공용 메모는 바뀌지 않는다.

```mermaid
flowchart LR
  Focus[집중 화면 소리 시트] --> Client[기기 재생기 + 로컬 음량]
  Island[섬 방송기 시트] --> Client
  Client --> Business[Business 사용자 인증·계약]
  Business --> Data[Data playback 명령/조회]
  Data --> DB[(소속·방송기·소유·불변 미디어·재생 상태)]
  Data --> Outbox[(같은 TX receipt + outbox)]
  Outbox --> Relay[기존 relay]
  Relay --> RT[Realtime 현재 주민·시설 검사]
  RT --> Client
  Media[기존 미디어 배포 경로] --> Client
```

미디어 배포 URL·CDN 신설은 이 두 계약에서 정하지 않는다. 입력의 trackId는 기존 상점 자산과 연결한 서버 ID이며 클라이언트가 전송한 임의 파일 링크가 아니다. 오디오 바이트가 STOMP를 통과하지 않는다.

```mermaid
sequenceDiagram
  participant A as 주민 A
  participant B as Business
  participant D as Data DB
  participant R as Realtime
  participant C as 주민 B
  A->>B: PATCH trackId/playing + expectedVersion + key
  B->>D: 검증 사용자·session/generation·서버 requestId
  D->>D: 사용자/receipt/섬/소유/재생 잠금
  D->>D: 권한·gram·소유·version 검사, 서버 t로 상태 계산
  D->>D: 새 상태+version+receipt+playback.updated 커밋
  D-->>A: 200 data 전체 상태
  D-->>R: outbox 완성된 사건 전달
  R->>R: 현재 인증/주민/gram 재검사
  R-->>C: playback.updated 전체 상태
  C->>C: 서버 시각 추정으로 현재 위치 계산
  Note over A,C: 각 기기 volume/mute는 로컬
```

동시에 다른 주민이 이전 버전으로 바꾸면409를 받는다. 앱은 새 상태를 보여주고 사용자가 여전히 바꾸려 할 때 새 버전·새 키로 명령을 보낸다. 서버가 충돌한 명령을 최신 버전으로 자동 덮어쓰지 않는다.

입장 시 먼저 구독·버퍼링하고 GET 스냅샷을 받아 그 버전보다 큰 사건만 적용한다. 소켓 재연결·버전 공백·지원하지 않는 schemaVersion이면 GET으로 정본을 복구한다. GET 자체는 알림을 만들지 않는다.

공인 `/islands/**` 노출은 [건설 HLD의 공인 경로 선행 조건](../island-construction/high-level-design.md#공인-경로와-활성화-선행-조건)을 공유한다. PR744 nginx/인증 통합과 실제 공인 GET/PATCH 검증 전1779를 활성화하지 않는다.
