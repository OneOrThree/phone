# 공용 음악 상세 설계

[정책](policy.md)의 서버 권한·시간 규칙을 구현1779에서 적용한다. 공유 상태는 Data가 소유하고 Business가 메모리 시계나 브로커 도착 시각으로 새 상태를 만들지 않는다.

## 1. 원본 예시 보존

아래는 v0.3-proposed 원본 요청·응답이다. 운영 확정값이나 추가 필드 예시와 섞지 않는다. 경로만 채택 경로를 함께 표시한다.

### GET `/islands/{islandId}/playback`

원본: `GET /v1/islands/{islandId}/playback`. GET의 `{}`는 원본 표기이며 실제 GET body를 보내라는 뜻이 아니다. 성공은 원본대로200이다.

요청:

```json
{}
```

응답:

```json
{
  "data": {
    "trackId": "waves",
    "playing": true,
    "positionSeconds": 12,
    "effectiveAt": "2026-09-11T09:10:00Z",
    "changedBy": "minji",
    "version": 2,
    "serverNow": "2026-09-11T09:10:00Z"
  }
}
```

### PATCH `/islands/{islandId}/playback`

원본: `PATCH /v1/islands/{islandId}/playback`. GET의 `{}`는 원본 표기이며 실제 GET body를 보내라는 뜻이 아니다. 성공은 원본대로200이다.

요청:

```json
{
  "trackId": "campfire",
  "playing": true,
  "expectedVersion": 2
}
```

응답:

```json
{
  "data": {
    "trackId": "campfire",
    "playing": true,
    "positionSeconds": 0,
    "effectiveAt": "2026-09-11T09:10:00Z",
    "changedBy": "me",
    "version": 3,
    "serverNow": "2026-09-11T09:10:00Z"
  }
}
```

## 2. 채택 스키마와 확장 예시

GET은 body/query 없이 UUID36 islandId를 받는다. PATCH는 `expectedVersion` 필수와 `trackId`, `playing` 중 최소 하나를 받는다. 둘 다 생략·명시 null·알 수 없는 volume/mute/positionSeconds/effectiveAt/changedBy는400 INVALID_REQUEST다. 미지원 trackId 값은422 OUT_OF_RANGE, 등록된 곡이지만 섬 미소유면403 FORBIDDEN이다. 타입 검증과 현재 인가는 Data 명령 검증에서 다시 적용한다.

| data 필드 | 타입·불변식 |
| --- | --- |
| trackId | 서버 불변 미디어 ID 또는 초기 미선택 null |
| playing | boolean, trackId=null이면 false |
| positionSeconds | 0 이상 안전 정수 초, effectiveAt의 기준 위치. 곡이 있으면 durationSeconds 미만 |
| effectiveAt | UTC instant, 저장된 기준 위치의 시각 |
| changedBy | 초기 미선택 GET만 null, 실제 변경 후 검증 사용자 UUID |
| version | (playback,islandId) version, 초기0·실제 사건1 이상 |
| serverNow | GET은 스냅샷 관측 서버 시각, 명령 결과/사건은 확정 전이 기준 서버 시각 |
| **durationSeconds** | 불변 미디어의 양의 유한 초(소수 허용), trackId=null이면 null |

원본 예시를 수정하지 않은 **별도 확장 예시**:

```json
{"data":{"trackId":null,"playing":false,"positionSeconds":0,"effectiveAt":"2026-09-11T09:10:00Z","changedBy":null,"version":0,"serverNow":"2026-09-11T09:10:01Z","durationSeconds":null}}
```

초기 anchor는 섬 생성 시각 등 저장된 안정적 생성 시각을 사용하며 GET마다 상태 version을 올리지 않는다. 초기 GET은 사건을 생산하지 않는다. 최초 PATCH 뒤의 예:

```json
{"data":{"trackId":"campfire","playing":true,"positionSeconds":0,"effectiveAt":"2026-09-11T09:10:00Z","changedBy":"019f16a0-0000-7000-8000-000000000003","version":1,"serverNow":"2026-09-11T09:10:00Z","durationSeconds":120.5}}
```

120.5는 계산 설명용 미디어 예시이며 운영 곡 길이 설정이 아니다. 실제 파일의 서버 확정 메타데이터와 일치해야 한다. metadata가 없거나 duration<=0/NaN/무한이면 공유 재생 명령을 활성화하지 않는다. 잘못된 상류 DTO를 받은 Business는502 UPSTREAM_CONTRACT_ERROR로 fail closed하며 임의 길이60을 채우지 않는다.

## 3. 시간·전이 계산

서버 저장값을 track, playing, p=positionSeconds, a=effectiveAt, d=durationSeconds라 하자. 서버 시각 t에서:

```text
track=null : position(t)=0, playing=false
d>0, playing=false : position(t)=p
d>0, playing=true  : position(t)=(p+max(0,t-a)) mod d
```

t-a는 초 단위다. p는 이미 a의 위치이므로 GET에서 현재 위치를 다시 p로 써 놓고 예전 a를 유지하지 않는다. 그렇게 하면 앱이 시간을 두 번 더한다. 예를 들어 p=12,a=09:10:00,d=120.5에서 t=09:10:05이면17초, t=09:12:00이면11.5초다. 반복의 끝은 위 modulo로 처리하며 각 단말이 track-end PATCH를 자동 발행하지 않는다. 반복 플래그/다음 곡 자동 선택은 새로 만들지 않는다.

상태 잠금을 획득한 후 서버 clock을 한 번 읽어 `t=max(now,previousEffectiveAt)`로 역행을 막고 경고를 남긴다. 저장 p는 계산 위치를 초 단위로 내린 값으로 통일하고 anchor=t를 함께 저장한다. 이벤트와 응답은 같은 p/t다. pause 반복으로 초 미만 손실이 누적될 수 있는 기존 정수 wire의 한계를 기록하며 구현 테스트에서 이 동작을 고정한다. 초 미만 정밀화는 기존 Seconds 계약과 함께 별도 개정해야 한다.

| PATCH 입력 | 새 상태 |
| --- | --- |
| 다른 소유 trackId, playing 명시 | 위치0, 요청 playing, anchor=t |
| 다른 소유 trackId, playing 생략 | 위치0, 기존 playing 유지. 초기 미선택 false도 유지 |
| 같은 trackId만 | version 확인 후 무변경 성공, 기존 changedBy/anchor/version 유지 |
| playing=false, 기존 true | position(t)를 정수로 내리고 정지, anchor=t |
| playing=true, 기존 false이고 곡 있음 | 저장 위치에서 재생, anchor=t |
| playing=true, 선택 곡 없음 |409 STATE_CONFLICT, 임의 곡을 고르지 않음 |
| 같은 playing 또는 초기 playing=false | version 확인 후 무변경 성공, 새 사건 없음 |

trackId의 명시 null은 곡 지우기 명령이 아니다. 실제 변경은 changedBy=검증 사용자로 채우고 version을 한 번만 증가한다. trackId와 playing을 함께 바꿔도 사건1개다. pause 시 d<1인 곡도 floor(position)=0이므로 0<=p<d 불변식이 유지된다.

앱은 GET 왕복 시간 중간 시각과 serverNow로 서버 clock offset을 추정하고 수신 후 경과는 로컬 monotonic clock으로 더한다. 왕복 지연의 비대칭 때문에 정확한 동시성은 보장하지 않으므로 지연/드리프트를 관측하고 재조회로 보정한다. 이벤트 serverNow를 수신 순간 '현재 서버 시각'으로 대입하지 않는다. 유효한 clock 추정이 없거나 재연결했으면 새 GET으로 보정한다. pause 상태는 시간이 지나도 위치가 증가하지 않는다.

## 4. 원자 명령·재생·저장

논리적으로 섬당 playback 상태1개, 서버 자산 trackId별 불변 duration/미디어 메타데이터, 섬 inventory를 사용한다. 초기행은 섬 생성 TX에서 준비하거나 없는 행을 version0으로 읽고 최초 명령이 섬 잠금 아래 유일성으로 생성한다. 마이그레이션 물리 이름/번호는 구현 조정자가 정한다. 공통 receipt/outbox를 새로 만들지 않는다.

영향 사용자 lifecycle → 공통 receipt → 섬/활성 membership/context/시설 → 불변 자산 및 inventory → playback/projection 순서로 잠근다. 공용 재생은 지갑을 변경하지 않는다. inventory/시설 writer와 소속 변경 writer가 같은 섬·사용자 잠금 순서를 지키게 한다. 서버 인증을 거친 user/session/generation을 TX에서 다시 검사해 GET 직후 강퇴/탈퇴/gram 상태 변경을 통과시키지 않는다. 입력 주체·임의 X-User-Id를 복사하지 않는다.

Idempotency-Key(UUID36) scope는 사용자+PATCH+islandId+playback operation, fingerprint는 원래 제공한 필드의 존재 여부·값·expectedVersion과 resource context다. 생략 필드를 현재 상태로 채운 뒤 fingerprint를 바꾸지 않는다. 확정 receipt를 찾으면 현재 사용자·세션·주민·시설 접근을 확인하고 원 결과를 재생한다. 다른 본문은409 IDEMPOTENCY_KEY_REUSED. 현재 권한 소멸에 대한 특례 재생은 없다.

새 명령은 잠금 아래 소유·version 검증 후 §3 상태를 계산한다. expectedVersion 불일치이면 mutation/no-op 어느 쪽도 수행하지 않는다. 실제 변경이면 상태+version+성공 data+events+outbox를 한 Data TX로 확정한다. 무변경 명령도 receipt에는 성공과 빈 events를 저장한다. 확정 receipt 조회는 과거 version을 현재 version과 다시 비교하지 않으며 기존 결과를 실행하지 않는다.

원본 data.serverNow와 비즈니스 상태는 재생 시 보존한다. 서버 X-Request-Id는 현재 요청 ID를 사용한다. 앱은 먼저 받은 최신 version보다 오래된 receipt 결과를 화면에 덮어쓰지 않고 필요하면 GET한다. 그 GET은 새로운 조회일 뿐 명령을 다시 실행하는 것이 아니다. 일시 timeout504는 커밋 미확정이므로 같은 키/본문으로만 유한 재시도한다.

## 5. 실시간 봉투·복구

Data 내부 결과는 `{data:공개DTO,events:RealtimeEventEnvelope[]}`다. 아래 완성된 공개7필드 사건은 원 응답과 같은 TX에 저장한다. 기존 outbox10필드 저장 EventEnvelope는 별도 표현이며 이 내부 배열을 그 저장 DTO로 대체하지 않는다.

```json
{"schemaVersion":1,"eventId":"019f16a0-0000-7000-8000-000000000004","type":"playback.updated","islandId":"019f16a0-0000-7000-8000-000000000001","aggregateVersion":1,"occurredAt":"2026-09-11T09:10:00Z","payload":{"trackId":"campfire","playing":true,"positionSeconds":0,"effectiveAt":"2026-09-11T09:10:00Z","changedBy":"019f16a0-0000-7000-8000-000000000003","version":1,"serverNow":"2026-09-11T09:10:00Z","durationSeconds":120.5}}
```

axis `(playback,islandId)`, `aggregateVersion==payload.version`, destination `/topic/islands/{islandId}/playback`. changedBy는 실제 mutation 사용자 필수이며 초기 GET null을 사건으로 전파하지 않는다. GET은 생산하지 않는다. durationSeconds는 이번 승인된 추가 필드이며 현재 PR737의 payload에 이미 있는 필드가 아니다. **1779 producer 활성화 전에 1754의 playback.updated payload 계약과 1755의 해당 payload validator/adapter, 앱의 미디어 길이 처리를 동기화하고 회귀 검증해야 한다.** 이 선행 조건이 완료되기 전 확장 사건 생산을 활성화하지 않는다. PR737의 기존 문서를 이번 작업에서 수정하지 않으며 규약 동기화는 조정자가 별도 진행한다. PR737의 공통7필드 검증만 통과했다고 곡·소유·길이 검증까지 끝났다고 주장하지 않는다.

소켓 CONNECT의 인증/만료와 전달 직전 현재 소속·gram 검사를 모두 적용한다. 집중 중 채팅 목적지를 막는 가드를 playback에 적용하지 않는다. 만료 소켓은 재인증·재접속이 가능한 기존 명시 종료 정책을 따른다. full-state snapshot이므로 더 큰 version을 적용하고 이전/중복은 버린다. 누락을 감지하면 GET으로 복구한다. 다른 island의 버전을 비교하거나 공용 events에서 개인 인벤토리를 방송하지 않는다.

## 6. 오류·검증·운영

오류 기본은 code/message/field/retryable + requestId다. 409 VERSION_CONFLICT(field=expectedVersion,retryable=false)는 허용된 top-level current에 최신 **공개 playback data**를 제공한다. 사용자 재확인 뒤 새 키·새 버전을 사용하며 서버 자동 덮어쓰기는 없다. 내부 행·소유 전체·타 사용자 정보는 current에 넣지 않는다.

| HTTP / code | 조건 | retryable |
| --- | --- | --- |
|400 INVALID_REQUEST / INVALID_IDEMPOTENCY_KEY|필수/타입/금지 필드, 키 누락·형식|false|
|401 UNAUTHORIZED|위조/만료 사용자 자격|false|
|403 FORBIDDEN|현재 비주민 또는 곡 미소유|false|
|403 FACILITY_LOCKED|GET/PATCH 모두 gram 미건설|false|
|404 USER_NOT_FOUND / GROUP_NOT_FOUND|본인 또는 섬 부재. 기존404 등록/명시 매핑을1779 진입 시 검증|false|
|409 VERSION_CONFLICT / STATE_CONFLICT|낡은 버전 / 선택 곡 없이 play|false|
|409 IDEMPOTENCY_KEY_REUSED|같은 키 다른 본문, field=Idempotency-Key|false|
|409 REQUEST_IN_PROGRESS|동일 명령 처리중, Retry-After:1|true|
|422 OUT_OF_RANGE|trackId·version 범위 위반|false|
|429 RATE_LIMITED / 503 SERVICE_UNAVAILABLE|일시 제한/과부하, 알려진 Retry-After 준수|true|
|502 UPSTREAM_CONTRACT_ERROR / UPSTREAM_AUTH_FAILED|잘못된 상류 DTO / 서비스 인증|false|
|504 UPSTREAM_TIMEOUT|필수 호출 deadline 초과, 같은 키 복구|true|
|500 INTERNAL_ERROR|서버 결함, requestId 조사|false|

그 외 공통405/413/415/빈406은 PR738을 따른다. 상류 서비스401을 사용자401로 바꾸지 않는다. 오류 상수·상태 조합의 신규 registry 매핑과 실제 HTTP 검증을1779 완료 조건으로 둔다.

기준 main [Group:37](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/group/repository/domain/Group.java#L37)은 새 재생/시설 속성이 없고 [GroupQueryService:94](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/group/repository/GroupQueryService.java#L94)의 잠금 조회도 활성·시설·소유 판정을 대신하지 않는다. 기존 공통1751~1753/1659 창구와 명령 기반을 통합해 확장하며 새 내부 HTTP 클라이언트/외부 재생 서버를 중복 생성하지 않는다.

1779 검증 순서: 미디어/소유·gram 기반 통합 → GET 정본 → PATCH Data TX/receipt → producer/상세 adapter → 실제 WebSocket+HTTP+PostgreSQL 회귀.

- GET/PATCH의 무인증·위조 주체·미소속·gram 미건설403, 소유 없는 곡403, 집중 중 정상 접근.
- 실제 병렬 다른 키/같은 expectedVersion은 변경1·409 하나, 같은 키는 결과 동일·사건1, 응답 유실 재생은 변경0.
- pause/resume/same track/new track/partial/no-op, 트랙 끝 modulo, server clock 역행, fractional duration·초 단위 anchor 일치.
- 부정/누락 duration, 임의 URL·volume·seek·null 입력, version overflow 거부.
- 소유/소속/탈퇴 writer 경합, 중간 outbox 오류 시 playback·receipt 모두 rollback.
- 실제 WebSocket에서 현재 주민만 수신, gram 미해금 차단, 만료 종료·재연결 GET, 집중 가드와 독립.
- subscribe/GET 사이 변경·중복/역순/구버전 receipt가 최신 화면을 되돌리지 않음, 사건/GET 시간 이중 가산 없음.
- 과거 current나 내부 데이터가403/502에 섞이지 않고 새 requestId로 추적됨.

로그는 requestId/commandId/eventId, operation/phase/outcome/durationMs와 projection version을 연결하고 토큰·헤더·전체 payload·미디어 비밀 URL을 남기지 않는다. 이벤트 지연·버전 충돌·재생 명령/no-op/receipt replay·시계 역행·드리프트를 유한 label로 계측한다. 이 문서는 테스트 계획이며 아직1779 실서비스 검증을 실행한 결과가 아니다.
