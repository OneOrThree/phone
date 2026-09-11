# 회관 기록 아키텍처와 데이터 흐름

기록 화면은 장부를 읽는 창구다. 집중 서비스가 적은 실제 집중 구간과 기기가 보낸 측정 봉투를 Data가 보관하고, 같은 시점의 표를 만든다. Business는 표의 권한과 형태를 확인해 앱으로 돌려준다. 표를 다시 열었다고 보상을 다시 주지 않는다.

```mermaid
flowchart LR
  Native[iOS DeviceActivity 실제 눈금 / 검증된 OS 수집] --> App[앱 기기 보고 어댑터]
  App --> B[Business 인증·strict DTO·서버 requestId]
  B --> D[Data 측정 명령 / 기록 조회]
  Focus[집중 ACTIVE 구간·종료 TX] --> Facts[(세션·날짜 기여 정본)]
  D --> Raw[(기기별 내구 측정·최신 포인터)]
  Raw --> Projection[승인된 병합/귀속 정책 projection]
  Facts --> Projection
  Projection --> Snapshot[일관된 조회 snapshot]
  Snapshot --> B
  D --> Outbox[(공통 receipt + outbox)]
  Outbox --> Quest[기존 퀘스트 진행 소비자]
  Quest --> Realtime[현재 인가된 진행 변경 사건]
```

원본 수집 범위와 KST 하루가 맞지 않으면 단말의 로컬 합계를 다른 날짜 이름으로 재포장하지 않는다. 서버는 총합90분만으로 어느 시간대에 썼는지 복원할 수 없다. 승인된 수집 경계가 없으면 숫자 대신 측정 상태를 사용한다.

```mermaid
sequenceDiagram
  participant A as 앱
  participant B as Business
  participant D as Data
  participant DB as Data DB
  A->>B: PUT date + deviceId + measuredAt + status/minutes + key
  B->>D: 검증 사용자·세션 + strict DTO
  D->>DB: 사용자/기기·receipt·날짜 원본 잠금
  alt 새 최신 시각
    D->>DB: 원본·최신 포인터·승인 projection·receipt·outbox 같은 TX
  else 같은 시각 다른 내용
    D-->>A: 409 STATE_CONFLICT, 최신값 보존
  else 동일 또는 과거 보고
    D->>DB: 최신값 유지, 새 경제/진행 반영 없음
  end
  D-->>A: 200 data, 실제 최신 선택 결과
```

집중 조회의 total/series/records는 한 snapshot에서 계산한다. 이후 페이지도 같은 snapshot을 읽고 현재 인가는 다시 확인한다. finish가 그 사이 일집계로 옮겨가도 완료와 진행을 동시에 두 번 더하지 않는다. 경제 원장·퀘스트 보상 정산은 조회나 snapshot 생성의 부수효과가 아니다.
