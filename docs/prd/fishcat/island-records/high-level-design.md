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


표의 복사본에 포함된 다른 주민이 탈퇴해도 동기적으로 폐기한다. 조회와 탈퇴가 같은 Data 문을 통과하게
해서, 탈퇴가 끝났는데 유효기간이 남은 표로 옛 개인정보가 다시 나오는 틈을 없앤다.

```mermaid
sequenceDiagram
  participant Q as snapshot 생성 또는 페이지 조회
  participant G as Data 공통 lifecycle 잠금
  participant W as 중앙 withdraw
  participant S as Data snapshot 및 사용자 역색인
  Q->>G: 공유 잠금 - 사용자 락보다 먼저
  Q->>S: 현재 인가와 유효 상태 확인 / 응답 내용 확정
  Q->>G: TX 종료 및 공유 잠금 해제
  W->>G: 배타 잠금 - 선행 조회가 끝날 때까지 대기
  W->>S: 동일 TX에서 사용자 PII 파기 + 영향 snapshot 전체 파기/무효화
  W->>G: 커밋 및 배타 잠금 해제
  Q->>G: 다음 페이지 공유 잠금
  Q->>S: 현재 요청자 인가 + 정본 상태 재검사
  S-->>Q: 무효 표는 CURSOR_EXPIRED
```

탈퇴가 먼저 잠금을 얻으면 이후 조회가 무효화를 본다. 조회가 먼저 응답 내용을 확정한 경우는 조회가
먼저 일어난 순서이며 이미 전송 중인 응답을 회수한다고 주장하지 않는다. Data 밖 payload 캐시는
사용하지 않고 공개 응답은 no-store로 지정한다. 이 흐름과 잠금 순서가 구현·검증되기 전 공개 활성화는
금지한다. 실제 정산/분모/귀속 정책은 이 기술 선택으로 결정되지 않는다.
