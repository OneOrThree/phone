# 건설 아키텍처와 데이터 흐름

앱은 주문서를 보내고 Business는 본인 확인이 된 주문을 Data에 전달한다. Data가 시설과 통장을 같은 장부에서 고친다. 모든 쓰기가 성공해야 영수증과 알림 목록도 남는다. 알림 전달이 잠시 늦어도 영수증과 장부가 남아 있으므로 돈을 다시 빼지 않고 알림만 다시 전달한다.

```mermaid
flowchart LR
  App[회관 마을 발전 화면] --> Business[Business 인증·공통 계약]
  Business --> Data[Data 건설 명령 서비스]
  Data --> TX[(하나의 DB TX: 시설·공동 지갑·외양·receipt·outbox)]
  Policy[서버 불변 비용 정책 revision] --> Data
  Focus[집중 종료 정산] --> Completion[공통 시설 완공 연산]
  Data --> Completion
  Completion --> TX
  TX --> Relay[기존 outbox relay]
  Relay --> Realtime[Realtime 현재 소속 확인]
  Realtime --> App
```

```mermaid
flowchart TD
  Hall[회관: 초기 집중 기여] --> Board[게시판: 초기 집중 기여]
  Board --> Tower[전망대]
  Board --> Mail[우체통]
  Board --> Gram[방송기 100P]
  Tower --> Both{전망대 AND 우체통}
  Mail --> Both
  Both --> Shop[상점]
```

화살표는 선행 조건이며 자동 구매 명령이 아니다. 초기 기여 계산은 집중 설계 FR-D02 승인 후 같은 Data TX에 연결한다. 목표 선택과 결제는 다른 버튼/명령이며 목표 선택이 결제 예약·잔액 차감을 만들지 않는다.

```mermaid
sequenceDiagram
  participant A as 앱
  participant B as Business
  participant D as Data
  participant DB as Data DB
  participant R as Realtime
  A->>B: GET construction-options
  B->>D: 검증 주체로 현재 옵션 조회
  D-->>A: islandVersion + costPolicyVersion + walletVersion + 잔액/가능 사유
  A->>B: POST constructions + 두 expectedVersion + 같은 의도 키
  B->>D: 검증 주체·키·서버 requestId
  D->>DB: 사용자/receipt/섬/정책/지갑/외양 잠금·재검증
  alt 현재 권한·가격·선행·잔액 일치
    D->>DB: 시설+차감+각 버전+receipt+사건 원자 커밋
    D-->>B: data + 완성된 공개 events 목록
    B-->>A: 200 {data}
    DB-->>R: 커밋된 outbox 재전달 가능
    R-->>A: island.updated / wallet.updated / island.appearance.updated
  else 버전·상태 충돌
    D-->>A: 409 + 허용된 current, 차감 없음
  end
```

Business가 지갑 서비스 차감 후 별도 시설 저장을 조합하지 않는다. 섬 버전·지갑 버전·외양 버전은 각 projection의 시계다. 같은 커밋이라고 모두 같은 숫자를 붙이지 않는다. outbox 저장 봉투와 공개 전달 봉투도 구분한다.

기준 main `Group.java`는 기존 그룹 정보·낙관 버전만 갖고 신규 시설 상태가 없다. 기존 CurrencyLedgerService는 User 지갑 대상이다. 이 그림은 새 계약 설계이며 main에서 공용 건설이 이미 동작한다는 설명이 아니다.

## 공인 경로와 활성화 선행 조건

사용자 결정에 따라 신규5계약은 `/islands/**`를 사용한다. 기준 main의 Target-1 공인 노출은 `/api/v1/**`와 `/bff/**`만 허용하므로 Controller 추가만으로 외부에서 도달하지 않는다. 공통 구현 [PR744](https://github.com/OneOrThree/phone/pull/744)의 `server/scripts/nginx-satellites.include.conf.example` 및 인증 필터 통합을 먼저 적용하고 실제 공인 ingress에서 다섯 계약의 라우팅·JWT·외부 위임헤더 제거·내부경로 차단을 검증한 뒤1767/1779를 연다. 기존 `/api/v1` 경로는 유지한다. 이는 선행 배포 요구이며 이 문서 PR에서 운영 nginx를 변경했다는 주장이 아니다.
