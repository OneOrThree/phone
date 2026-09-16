# 주간 랭킹 아키텍처·데이터 흐름

랭킹은 계속 움직이는 전광판을 페이지마다 다시 읽는 대신, 한 시점에 찍은 성적표를 넘겨 보는 방식이다. 성적표에는 순위와 시간, 본인 순위까지 같이 적는다. 새로고침하면 새 성적표를 받고, 페이지를 넘길 때는 원래 표를 사용한다.

```mermaid
flowchart LR
  Focus[ACTIVE 구간·확정 날짜 기여] --> Aggregate[공통 집중 집계]
  Membership[가입·탈퇴 이력 / 승인 주차 cohort] --> Aggregate
  Policy[분모·동점·진행분·마감 policy revision] --> Aggregate
  Aggregate --> Snapshot[(Data immutable 주차 snapshot)]
  Snapshot --> Query[Data 인가된 순위 조회]
  App[전망대 탭] --> Business[Business 인증·현재 섬 context·opaque cursor]
  Business --> Query
  Query --> Business
  Business --> App
```

```mermaid
sequenceDiagram
  participant A as 앱
  participant B as Business
  participant D as Data
  participant S as Snapshot 저장소
  A->>B: GET week, cursor 없음
  B->>D: 검증 사용자·현재 섬context·week
  D->>D: 현재 소속/전망대/참가 확인
  D->>S: 같은 asOf·정책·모수로 표 생성 또는 유효 표 조회
  S-->>D: snapshotId, scores/ranks/myRank/분모
  D-->>A: data + asOf + 서명 nextCursor
  A->>B: GET 같은 week + cursor
  B->>D: cursor 무결성·범위 검증
  D->>D: 현재 인가 재검증
  alt 표가 살아 있고 범위 일치
    S-->>A: 원래 표의 다음 페이지
  else 만료/개인정보 파기/인가 변경
    D-->>A: 409 CURSOR_EXPIRED 또는 현재 인가403/404
  end
```

하나의 표가 만들어지는 동안 DB의 읽기 snapshot과 asOf를 고정한다. 서로 다른 HTTP 호출로 주민별 점수를 모아 표를 만드는 N+1은 피한다. timestamp만 저장해 두고 나중에 현재 DB에서 점수를 재계산하는 것은 같은 표가 아니다. 참여 자격과 순위 의미가 미결이면 그 표를 생성·공개하지 않는다.

일주일 마감과15분 cursor 수명은 다르다. cursor15분이 지나면 페이지 탐색을 새로 시작하고, 지난 주 결과의 보관/수정 가능 기간은 승인된 별도 정책에 따른다. GET나 snapshot 생성은 기존 리그 지급 함수를 호출하지 않는다.


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
