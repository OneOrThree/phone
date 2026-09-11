# 건설 상세 설계

이 문서는 [정책](policy.md)의 미결 조건을 전제로 구현1767의 계약·저장 경계를 확정한다. 기준 main에 새 시설 도메인이 존재한다고 가정하지 않는다.

## 1. 원본 예시 보존

아래는 v0.3-proposed 원본 요청·응답이다. 운영 확정값이나 추가 필드 예시와 섞지 않는다. 경로만 채택 경로를 함께 표시한다.

### GET `/islands/{islandId}/construction-options`

원본: `GET /v1/islands/{islandId}/construction-options`. GET의 `{}`는 원본 표기이며 실제 GET body를 보내라는 뜻이 아니다. 성공은 원본대로200이다.

요청:

```json
{}
```

응답:

```json
{
  "data": {
    "islandVersion": 4,
    "selectedBuildingId": "gram",
    "villagePoints": 150,
    "items": [
      {
        "id": "tower",
        "name": "전망대",
        "cost": 300,
        "currency": "village_points",
        "selectable": true,
        "buildable": false,
        "blockedReason": "INSUFFICIENT_FUNDS"
      },
      {
        "id": "mail",
        "name": "우체통",
        "cost": 400,
        "currency": "village_points",
        "selectable": true,
        "buildable": false,
        "blockedReason": "INSUFFICIENT_FUNDS"
      },
      {
        "id": "gram",
        "name": "꽃나팔 방송기",
        "cost": 100,
        "currency": "village_points",
        "selectable": true,
        "buildable": true,
        "blockedReason": null
      },
      {
        "id": "shop",
        "name": "상점",
        "cost": 500,
        "currency": "village_points",
        "selectable": false,
        "buildable": false,
        "blockedReason": "REQUIRES_TOWER_AND_MAIL"
      }
    ]
  }
}
```

### POST `/islands/{islandId}/constructions`

원본: `POST /v1/islands/{islandId}/constructions`. GET의 `{}`는 원본 표기이며 실제 GET body를 보내라는 뜻이 아니다. 성공은 원본대로200이다.

요청:

```json
{
  "buildingId": "gram",
  "expectedVersion": 4
}
```

응답:

```json
{
  "data": {
    "buildingId": "gram",
    "status": "completed",
    "spent": {
      "currency": "village_points",
      "amount": 100
    },
    "version": 5,
    "villagePoints": 50
  }
}
```

### PUT `/islands/{islandId}/construction-target`

원본: `PUT /v1/islands/{islandId}/construction-target`. GET의 `{}`는 원본 표기이며 실제 GET body를 보내라는 뜻이 아니다. 성공은 원본대로200이다.

요청:

```json
{
  "buildingId": "gram",
  "expectedVersion": 4
}
```

응답:

```json
{
  "data": {
    "buildingId": "gram",
    "selected": true,
    "spent": 0,
    "version": 5
  }
}
```

## 2. 채택 스키마와 추가 예시

모든 경로 islandId는 UUID36, 인증은 서버가 검증한 활성 사용자다. 앱의 X-User-Id·session·generation 값을 그대로 신뢰하지 않는다. Business가 검증한 주체와 내부 서비스 인증만 전달하고 Data는 TX 안에서 현재 사용자·세션·소속·섬 종료 상태를 다시 검사한다. 모든 조회도 일관된 스냅샷에서 현재 소속과 시설/잔액/정책을 읽는다. 요청에 사용자 ID, 가격, 잔액, 완료 상태를 받지 않는다.

| API | request | data |
| --- | --- | --- |
| GET options | query/body 없음 | islandVersion, **costPolicyVersion**, selectedBuildingId nullable, villagePoints, **walletVersion**, items[] |
| PUT target | buildingId, expectedVersion 필수 | buildingId, selected=true, spent=0, version |
| POST constructions | buildingId, expectedVersion, **expectedCostPolicyVersion** 필수 | buildingId, status=completed, spent:{currency,amount}, version, villagePoints, **walletVersion** |

items의 id/name/cost/currency/selectable/buildable/blockedReason은 모두 필수이며 blockedReason만 nullable이다. 완료 시설은 options에서 제외한다. GET의 목록은 게시판 이후 후보 tower/mail/gram/shop이고 초기 hall/board 진행량은 이 목록에 가짜 상품으로 추가하지 않는다. 초기 단계의 선택 불가 상태에서 목록·가격의 반환 방식은 정책 P-D02 결정 시 함께 고정하며 그 전에 해당 조회 화면을 활성화하지 않는다. `buildingId`는 서버 시설 식별자이고 없는 ID는422 OUT_OF_RANGE(field=buildingId), 문자열 아닌 값/누락은400 INVALID_REQUEST다.

GET options는 활성 주민의 조회다. 변경 권한이 없는 주민도 GET에서는 항목별 selectable=false/blockedReason=FORBIDDEN을 받으며 변경 권한만으로 GET 전체를403으로 거절하지 않는다. PUT/POST는 승인된 실행 권한을 요구한다. selectable은 현재 사용자 실행 권한과 시설 선행 조건을 만족하는지 나타내며 잔액은 보지 않는다. buildable은 selectable에 건설 가능 상태와 현재 잔액을 더해 평가한다. blockedReason은 HTTP 오류 code가 아닌 UI 사유다. 우선순위는 FORBIDDEN → FACILITY_LOCKED → REQUIRES_TOWER_AND_MAIL → INSUFFICIENT_FUNDS이며 통과하면 null이다. 상점은 tower/mail가 하나라도 없으면 REQUIRES_TOWER_AND_MAIL이다. 서버 실행도 같은 evaluator를 쓰되 TX 안에서 재검사한다. 승인되지 않은 권한/가격 정책을 evaluator 기본값으로 통과시키지 않는다.

다음은 **승인된 추가 필드만** 보여주는 실행 예시다. 원본 응답 값/가격을 변경한 것이 아니다.

```json
{"buildingId":"gram","expectedVersion":4,"expectedCostPolicyVersion":1}
```

GET은 원본 data와 같은 스냅샷에서 읽은 `costPolicyVersion:1`을 추가한다. GET과 POST의 data에는 `walletVersion`도 필수 추가하며 반환 villagePoints의 공동 지갑 version이다. 원본 JSON은 보존하고 추가 필드 예시는 `{"walletVersion":7}`이다. islandVersion 및 costPolicyVersion과 비교하지 않는다. 앱은 응답 walletVersion이 이미 관측한 wallet.updated보다 낮으면 잔액과 잔액 의존 buildable을 적용하지 않고 새 GET으로 복구한다. 같은 지갑 버전이어도 island/cost 축이 낮으면 해당 옵션 부분을 적용하지 않는다. POST receipt는 원 walletVersion과 원 잔액을 보존하며 과거 성공 재생으로 최신 화면을 되돌리지 않는다. 이 숫자1은 예시 revision이다. cost revision이 바뀌었으면 섬 version이 같아도409 VERSION_CONFLICT(field=expectedCostPolicyVersion)다. current에는 현재 사용자가 볼 수 있는 options 공개 DTO만 넣고 재조회·금액 재확인 후 새 키를 사용한다. 가격 publication과 명령이 같은 정책 잠금 경계를 사용하여 검증 직후 가격만 교체되는 경합을 막는다.

목표 PUT은 costPolicyVersion과 잔액을 요구하지 않는다. target 변경에는 island version만 증가하고 wallet/appearance 사건은 없다. 같은 목표·현재 version은200/차감0/기존 version이며 receipt에 빈 events를 저장한다. 건설은 원본처럼 buildingId를 명시하는 별도 명령으로, 숨은 '현재 선택 목표와 반드시 일치' 제약을 새로 추가하지 않는다.

## 3. 멱등·오류·재생

PUT/POST에 Idempotency-Key(UUID36)를 요구한다. scope는 검증 사용자 + HTTP method + resource islandId + operation이며 fingerprint는 정규화한 본문 전체와 resource context를 포함한다. 두 버전 필드를 빠뜨리지 않는다. 같은 키/본문의 확정 receipt를 먼저 찾고 현재 활성·소속·행위 권한을 검증한 뒤 원 결과를 재생한다. 이후 달라진 expectedVersion/잔액으로 원 명령을 다시 검증하거나 차감하지 않는다. 이 도메인은 탈퇴/강퇴 후 특례 재생을 허용하지 않는다.

| HTTP / code | field | retryable / 동작 |
| --- | --- | --- |
|400 INVALID_REQUEST / INVALID_IDEMPOTENCY_KEY|해당 입력 / Idempotency-Key|false, 누락·타입·키 수정|
|401 UNAUTHORIZED| null |false, 사용자 인증 복구|
|403 FORBIDDEN| null |false, 모든 API의 비주민; 실행 권한 없음은 PUT/POST에만 적용|
|403 FACILITY_LOCKED| null |false, 목표 선택의 게시판 미해금|
|404 USER_NOT_FOUND / GROUP_NOT_FOUND| null |false, 기존 대상 부재404 보존. GROUP_NOT_FOUND 공개 등록/명시404 매핑은1767 활성화 전 검증|
|409 VERSION_CONFLICT|expectedVersion 또는 expectedCostPolicyVersion|false, 현재 공개 상태 재확인|
|409 STATE_CONFLICT|buildingId|false, 이미 완료/건설 선행 조건 불충족|
|409 INSUFFICIENT_FUNDS|buildingId|false, 공동 잔액 부족|
|409 IDEMPOTENCY_KEY_REUSED|Idempotency-Key|false, 다른 본문; 원 본문/결과 공개 금지|
|409 REQUEST_IN_PROGRESS|Idempotency-Key|true, Retry-After:1, 같은 키/본문|
|422 OUT_OF_RANGE|해당 필드|false, 미지원 ID·범위 위반|
|429 RATE_LIMITED / 503 SERVICE_UNAVAILABLE| null |true, 유한 재시도; 알려진 Retry-After 준수|
|502 UPSTREAM_CONTRACT_ERROR / UPSTREAM_AUTH_FAILED| null |false, 상류 계약/서비스 인증 오류|
|504 UPSTREAM_TIMEOUT| null |true, 커밋 여부 미확정이므로 같은 키/본문|
|500 INTERNAL_ERROR| null |false, 서버 requestId로 조사|

상위 공통의413/415/405/빈406도 적용한다. code/message/field/retryable + requestId 기본 봉투를 유지하고 허용된409에만 top-level current를 추가한다. current는 공개 DTO·그 버전만, 내부 행/타인 정보/원 요청 본문은 금지한다. 예상 버전 충돌은 새 버전으로 자동 재실행하지 않는다. 검증4xx로 rollback되어 receipt가 없으면 재생 보장 밖이며 수정된 의도는 새 키다.

Data 커밋 뒤 응답 변환 실패 등으로500을 받으면 실패가 미차감을 증명하지 않는다. 공통 retryable=false를 유지하고 requestId로 조사·정본 GET 재확인 후 원 키/본문으로 receipt를 복구한다. 결과가 불명확하다고 새 키로 같은 건설을 다시 실행하지 않는다. 500을 무한 자동 재시도하거나 성공으로 추정하지 않는다.

## 4. Data 저장·원자 경계

논리 저장 단위는 섬 시설(섬+buildingId 유일, 완료 시각), 섬 목표/공개 island version, 불변 비용 revision과 publication, 초기 집중 기여 진행량, 공동 지갑/원장, 전체 외양 projection이다. 물리 테이블·Flyway 번호·DBML 컬럼은 구현 조정자가 배정한다. 기존 공통 PublicCommandService/receipt와 outbox를 재사용하며 별도 receipt/outbox 테이블을 발명하지 않는다.

잠금 순서는 PR743/742와 합류한다: 영향 사용자 UUID 정렬 lifecycle → receipt 선점 → 섬/현재 membership/context → 필요한 집중/시설 → 정책 publication/불변 자산 → 지갑(ownerType/id/currency 정렬) → 외양/각 projection. 건설은 없는 단계를 건너뛴다. 강퇴/탈퇴/집중 종료 writer도 같은 순서다. 그룹 잠금 뒤 새 사용자 잠금을 역순으로 잡아야 하면 TX를 다시 시작한다.

1. 검증 사용자·session/generation·활성 소속·섬 활성 및 승인된 실행 권한을 TX에서 검사한다. 동일 키 결과가 있으면 현재 권한을 확인하고 재생한다.
2. 새 명령은 expectedVersion과 가격 expectedCostPolicyVersion을 현재 publication과 비교한다. 시설 완료 유일성·선행 조건을 검사한다.
3. 게시판 이후 건설은 island/village_points의 충분한 잔액을 잠근 뒤 원장 debit와 잔액 갱신을 수행한다. 개인 fish를 대신 차감하거나 다른 서비스 TX로 보내지 않는다.
4. 동일 완공 primitive로 시설, 승인된 목표 후처리, island version, 새 기본 테마를 포함한 전체 외양 및 appearance version을 저장한다. 초기 집중 완료도 이 primitive를 쓰되 개인/기여 분배는 FR-D02 승인 전 구현 활성화 금지다.
5. 해당 지갑 version, 원 성공 data, 공개 events 전부, 내구 outbox를 같은 TX에 저장한다. 하나라도 실패하면 시설·차감·외양·receipt·사건 모두 rollback한다.
6. 커밋 후 Business는 data만 공개 봉투로 반환하고 기존 relay가 events를 재전달한다. 릴레이 실패가 이미 커밋한 차감을 다시 실행하지 않는다.

초기 earnedFish=E, personal=P, contribution=C이면 E=P+C 보존식 및 cap/초과분 결정이 필요하다. 초기 진행량을 공동 fish 잔액처럼 결제하거나 공개 POST의 spent.currency를 임의 확정하지 않는다. 초기 hall/board 수동 POST 허용 여부·spent 의미·자동 완공 응답은 P-D02 결정 후 계약을 보완해야 하므로 해당 명령은 출시 차단이다. 원본 세 계약의 예시는 게시판 이후 gram이며 이 부분은 village_points로 확정할 수 있다.

시설 완공은 island.updated, 실제 공동 차감은 wallet.updated, 외양 변경은 island.appearance.updated를 각각 만든다. 각 사건은 해당 projection 버전과 고유 eventId를 갖는다. 기본 테마 값은 PR742 자산 정본에서 찾고 임의 문자열로 seed하지 않는다. Data 내부 명령 결과는 `{data:공개DTO,events:완성된RealtimeEventEnvelope[]}`다. 7필드 schemaVersion/eventId/type/islandId/aggregateVersion/occurredAt/payload를 모두 저장해 응답 유실에도 그대로 재생한다. Data outbox의 기존10필드 저장 EventEnvelope와 이 공개7필드 배열은 다른 표현이며 같은 작성 TX가 둘 다 보관한다. Business에서 outbox를 다시 읽어 사건을 재구성하지 않는다.

공동 wallet.updated와 island.updated는 현재 주민의 `/topic/islands/{islandId}/events`, 외양 사건은 PR737의 events 라우팅을 따른다. 개인 지갑이 함께 바뀌는 승인된 집중 정산이면 그 사건은 해당 개인큐로만 보낸다. 집단 events에 개인 지급 상세를 섞지 않는다.

## 5. 기존 코드·구현 순서·검증

기준 main 증거:

- [기존 Group](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/group/repository/domain/Group.java#L37): id/name/description/status/version만 있고 새 시설·재생 컬럼은 없다.
- [GroupQueryService:79/94](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/group/repository/GroupQueryService.java#L79)는 GROUP_NOT_FOUND404와 잠금 조회를 제공하지만 종료·삭제·행위 권한은 호출 서비스 몫이다. 조회 helper만 호출했다고 안전한 명령이 되지 않는다.
- [CurrencyLedgerService:73/83/165](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/currency/service/CurrencyLedgerService.java#L73)는 User 지갑용이다. WalletOwner.CALLER/TARGET을 user/island로 오독하지 않는다. 원장·잠금 패턴은 재사용하고 공동 지갑 모델은 PR742 구현과 합류해야 한다.
- [FocusService:487](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/focus/service/FocusService.java#L487)의 기존 서버 보상은 신규 초기 건설 분배를 구현한 근거가 아니다.

구현 순서: 미결 권한/목표/비용 승인 → 공통/섬/경제/외양 기반 통합 → 불변 비용 publication·조회 → 목표 PUT → 게시판 이후 건설 원자 명령 → FR-D02 승인 후 초기 기여 연결 → Realtime producer 검증. 기존 `/api/v1` writer가 새 시설·지갑·섬 버전을 건드리는 부분을 전수 조사하고 같은 잠금/버전/사건 경계로 합류시킨 뒤 노출한다.

실제 PostgreSQL·HTTP·relay 회귀는1767에서 실행한다:

- 옵션 표의 각 선행 조합, gram이 shop 조건이 아닌 경우, 잔액부족이어도 목표 선택 가능, 비주민/권한/게시판403.
- 같은 키 동시 두 요청에서 차감1·시설1·각 사건1·같은 결과; 다른 키의 동시 동일 시설은 성공1과409, 음수 잔액0.
- 조회 후 가격만 교체하면 expectedCostPolicyVersion409; 가격 publication과 실행 경합에서도 검증한 가격으로만 확정.
- 외양/receipt/outbox 저장 실패 주입 시 원장까지 rollback; 응답 유실 후 같은 키 재생에서 버전/사건 추가0.
- 집중 cap에 동시 도달할 때 승인된 보존식·완공1·기존 테마 보존 및 전체 외양 version 일치.
- 강퇴/탈퇴/섬 종료와 건설 경합, 전달 직전 소속 상실, 서비스 토큰 실패502와 사용자401 분리.
- 실제 HTTP 공개 오류 registry와 current 필드, 각 이벤트7필드·자기 axis 버전, 지갑 정보 audience 검사.

로그는 서버 requestId, commandId/eventId, operation, phase, outcome, durationMs와 정책 revision을 연결한다. 키 원문·토큰·헤더·전체 payload는 기록하지 않는다. debit/완공/재생·conflict·relay 지연은 유한 label로 계측한다. 이 문서 작업에서 빌드·테스트를 실행했다는 주장은 하지 않는다.

검증 추가: 다른 주민 거래/GET/POST receipt가 역순 도착해도 walletVersion으로 오래된 잔액·buildable 적용을 막고 새 options GET으로 복구한다. 무접두어 공인 ingress/JWT/내부 차단은 HLD 선행 조건을 실제 배포 환경에서 검증한다.
