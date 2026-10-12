# FocusCat 서버 스모크 테스트 케이스

작성: 2026-10-12 · 갱신: 2026-10-13 · 상태: 실행기 구현, GCP dev 검증 중

작업 티켓: [GROMO-2285](https://romance.atlassian.net/browse/GROMO-2285)

이번 구현에 포함되는 **SMOKE-SERVER-001~010·014~018, 총 15개 TC**를 정리한다. 각 TC는 식별자·목적·연결 요구사항·사전 조건·입력값·기대 결과 양식을 따른다. 요청·응답은 현재 코드·계약에 맞춰 실행기에서 판정한다. 공통 계획과 실행 방법은 [README.md](README.md), 실제 검증 기록은 [verification.md](verification.md)에 둔다.

## 공통 실행 조건

- 대상: dev에 배포된 서버. `BASE_URL=https://oneorthree.dev.mooo.com`.
- 공개 API는 게스트 로그인 이후 `Authorization: Bearer <accessToken>`을 보낸다. 쓰기 요청은 계약에 맞는 새 `Idempotency-Key`를 사용하고, version은 직전 조회값을 사용한다.
- 기본 실행 순서: 001 → 002 → 003 → 004 → 005 → 007 연결·구독 → 006 시작·조회 → 010 수신 → 006 종료 → 016 → 009. 이벤트 발생 전에 구독을 완료한다.
- 추가 실행 순서: 기본 세트 → 014 → 015 → 016. 008·017·018은 `[self-hosted, dev]` 러너에서 실행한다.
- 014는 별도 전용 게스트·섬을 사용한다. 016의 주민·친구 준비는 014의 단독 섬·잔액 검사와 분리한다.
- 선행 단계 실패 시 후속 단계는 SKIP. 요청·판정·정리 실패는 FAIL로 기록한다. 정리는 실패 여부와 관계없이 실행하며, 토큰·DB·Redis 접속값은 로그에 남기지 않는다.
- 기본 세트 목표 2분, 014 목표 3분. 015·016의 처리 시간을 확인한 뒤 전체 실행 시간 예산을 확정한다.

TC는 아래 도메인별로 구분한다. 식별자는 기존 번호를 유지하며 실행 순서는 공통 실행 조건을 따른다.

## 인증·계정

### SMOKE-SERVER-002 — 게스트 로그인

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-002 |
| 목적 | 게스트 세션 발급 경로(business → data-api → DB → JWT) |
| 연결 요구사항 | `docs/prd/fishcat/account` (게스트 시작) |
| 사전 조건 | 001 통과. repo 변수 `SMOKE_DEVICE_ID`(UUID36) |
| 입력값 | `POST /auth/sessions/guest`, 헤더 `X-Device-Id: <SMOKE_DEVICE_ID>` |
| 기대 결과 | 201. `accessToken`·`refreshToken`·`userId`(UUID)·`onboardingComplete`(bool). `userId`는 같은 기기 UUID의 5분 복구 창 내 재로그인 시 동일. 기본 실행은 매번 새 UUID 사용 |

### SMOKE-SERVER-003 — 내 계정 조회

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-003 |
| 목적 | 액세스 토큰 검증 + 계정 읽기 |
| 연결 요구사항 | account |
| 사전 조건 | 002 `accessToken` |
| 입력값 | `GET /me`, `Authorization: Bearer <accessToken>` |
| 기대 결과 | 200. `data.id` == 002의 `userId` |

## 섬

### SMOKE-SERVER-004 — 섬 생성·조회

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-004 |
| 목적 | 섬 소속 확보(자가복구). 005·006·010 전제 |
| 연결 요구사항 | island-membership, island-management |
| 사전 조건 | 003 통과 |
| 입력값 | ① `GET /me/islands` ② 0개면 `POST /islands`, `Idempotency-Key: <새 UUID>`, 바디 `{"name":"smoke-island","approvalRequired":false}` ③ `GET /me/islands` 재조회 |
| 기대 결과 | ③ 섬 ≥ 1, `islandId` 확보. ② 실행 시 2xx |

## 홈

### SMOKE-SERVER-005 — 홈 정보 조회

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-005 |
| 목적 | 홈 화면에 필요한 섬·주민·지갑 정보를 받을 수 있는지 확인한다 |
| 연결 요구사항 | bff-screens |
| 사전 조건 | 004 통과 |
| 입력값 | `GET /screens/home?date=<오늘 KST yyyy-MM-dd>&timezone=Asia/Seoul` |
| 기대 결과 | 200. `buildings`(배열)·`members.items`(배열)·`wallets.fish`·`wallets.villagePoints` 존재 |

## 집중·실시간

### SMOKE-SERVER-006 — 집중 세션 저장·종료

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-006 |
| 목적 | 집중을 시작하고 집중 세션이 DB에 저장되는지 쓰기 경로를 확인한다. 010의 이벤트도 이 과정에서 발생한다 |
| 연결 요구사항 | focus-rest-session (low-level-design §2) |
| 사전 조건 | 004 `islandId`. `GET /focus-sessions/current` → `data:null`. 있으면 먼저 finish |
| 입력값 | ① `POST /focus-sessions`, `Idempotency-Key: <새 UUID>`, 바디 `{"islandId":"<id>","subject":"smoke","targetMinutes":1}` ② `GET /focus-sessions/current` ③ (010 수신 후) `POST /focus-sessions/{id}/finish` 바디 `{"expectedVersion":<version>}` + 새 멱등키 |
| 기대 결과 | ① 2xx, `id`·`version` ② `data.id` == ① `id` ③ 정상 종료 및 current 세션 없음. 거절·정리 실패는 FAIL로 기록하고 `always` 정리에서도 종료 시도. 최소시간 제약 확인 후 필요한 대기 시간을 명세에 반영 |

### SMOKE-SERVER-007 — 웹소켓 연결

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-007 |
| 목적 | 실시간 서버에 웹소켓 연결이 잘되는지 확인한다. 연결 과정에서 STOMP·토큰 검증과 Origin 403 재발도 확인한다 |
| 연결 요구사항 | realtime-events |
| 사전 조건 | 002 `accessToken` |
| 입력값 | `wss://<host>/ws/realtime` → STOMP `CONNECT`, `Authorization: Bearer <accessToken>`, `accept-version:1.2` |
| 기대 결과 | 5초 내 `CONNECTED`. `ERROR` 프레임·HTTP 403·타임아웃은 실패. 연결은 010까지 유지 |

### SMOKE-SERVER-010 — 집중 이벤트 수신

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-010 |
| 목적 | 집중 상태가 바뀌면 실시간 서버를 거쳐 구독한 사용자에게 이벤트가 도착하는지 확인한다(data-api outbox → relay → realtime → 웹소켓) |
| 연결 요구사항 | realtime-events, `docs/conventions/outbox-events.md` |
| 사전 조건 | 007 연결 유지, 004 `islandId`. `/topic/islands/{islandId}/focus` 구독 후 006 ① 실행 |
| 입력값 | 006 ① 직후 구독 채널 수신 대기 |
| 기대 결과 | 3초 내 `type=focus.member.updated` 사건 수신, `payload.userId` == 002·`payload.sessionId` == 006·`payload.status`는 `active`. 미수신·ERROR는 실패 |

### SMOKE-SERVER-016 — 집중 중 주민·친구 정보 조회

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-016 |
| 목적 | 집중 중에도 같은 섬 주민·친구 정보와 집중 상태를 받아올 수 있는지 확인한다 |
| 연결 요구사항 | 현재 주민·친구 조회 및 집중 상태 응답 계약, realtime-events. members.items[].id·focus-members의 userId/sessionId/status=active·friends의 isFocusing/ focusStartedAt 판정 |
| 사전 조건 | 전용 테스트 계정과 같은 섬 주민·친구 관계 준비. 대상 주민·친구 ID 확보. 014의 단독 섬·잔액 검사와 분리. 진행 중 세션이 없는 상태에서 시작. 게스트는 공개 친구 요청을 보낼 수 없으므로 두 전용 계정의 관계만 guarded SQL로 준비 |
| 입력값 | ① 집중 세션 시작 ② 집중 중 주민·친구 정보를 제공하는 현재 API 조회 ③ 집중 상태 확인 후 세션 종료. `GET /islands/{id}/members`, `GET /islands/{id}/focus-members`, `GET /friends?date=...` 사용 |
| 기대 결과 | 조회 정상 응답. 준비한 주민·친구 ID가 응답에 존재하고 계약상 집중 상태가 실제 세션과 일치. 실행 불가능한 계약·설정은 차단 사유를 기록하고 구현 완료로 판정하지 않음 |

실패 여부와 관계없이 진행 중 집중 세션을 종료하고 테스트 관계·데이터의 잔여 상태를 기록한다. 다음 실행의 초기 준비가 같은 조건을 복구하도록 한다.

## 알림·기기

### SMOKE-SERVER-009 — 기기 토큰 등록

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-009 |
| 목적 | 기기 토큰이 알림 서버의 전용 DB에 저장되는지 확인한다(business → notification 내부 호출 → 전용 DB) |
| 연결 요구사항 | `server/notification/README.md` §1 기기·설정 |
| 사전 조건 | 002 토큰 |
| 입력값 | `PUT /api/v1/users/me/device-token`, 바디 `{"deviceToken":"smoke-<고정값>"}`에 현 등록 계약의 `deviceBootstrap` 또는 직전 등록의 `ownershipToken`을 포함. 로그인 응답의 `X-Device-Bootstrap` 사용 (`DeviceTokenRegisterRequest` 기준, `platform` 필드 없음) |
| 기대 결과 | HTTP 200, raw JSON의 `ownershipToken`이 UUID. 가짜 토큰이라 FCM 기기 도착을 검증하지 않음 |

## 스크린타임

### SMOKE-SERVER-015 — 스크린타임 업로드·통계 조회

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-015 |
| 목적 | 스크린타임을 서버에 올리고 같은 날짜의 통계에 반영되는지 확인한다 |
| 연결 요구사항 | `PUT /me/screen-time/{date}`, `GET /islands/{id}/statistics/screen-time?from={date}&to={date}&scope=me&timezone=UTC`. 같은 날의 최신 측정을 선택하며 가산하지 않음 |
| 사전 조건 | 게스트 로그인 완료. 테스트 계정·날짜·타임존 확정. 기존 표본과 충돌하지 않는 테스트 데이터 준비. 해당 날짜 통계의 초기값 확보 |
| 입력값 | ① 해당 날짜의 통계 조회 ② 날짜·시간이 명확한 스크린타임 표본 업로드 ③ 같은 날짜·타임존의 통계 재조회. UTC 오늘 날짜·minutes=7·measurementStatus=authorized·timezone=UTC·measuredAt=현재 UTC·deviceId=AT의 서명된 sid 사용 |
| 기대 결과 | 업로드 정상 응답. UTC 오늘 날짜의 totalMinutes=7, series의 minutes=7·measurementStatus=authorized. 요청 날짜·사용자 정보가 일치. 계약·설정 미확정 또는 실행 불가라면 차단 사유를 기록하고 구현 완료로 판정하지 않음 |

테스트 표본은 런별로 식별 가능하게 준비한다. 이전 실행의 표본이 중복 합산되지 않도록 계약에 맞춰 초기 준비·정리하며, 실제 통계 결과를 DB에 직접 써서 만들지 않는다.

## 집중 보상·건설·게스트 상점 제한

### SMOKE-SERVER-014 — 집중 적립·건설·게스트 구매 거절

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-014 |
| 목적 | 홈에서 집중으로 섬 통장을 적립하고 건설 비용을 차감한다. 게스트 구매는 소셜 로그인 필요로 거절되고 잔액·주문·소유가 유지됨을 확인한다 |
| 연결 요구사항 | focus-rest-session, island-construction, island-shop, bff-screens, 인증·게스트 계정 정책. 사용자 선택에 따라 회원 구매·장착 성공은 이번 TC에서 제외 |
| 사전 조건 | 신규 전용 게스트·단독 섬·방장 권한·진행 중 세션 없음. guarded SQL로 상점·도서관 완공과 회관 건설에 충분한 섬 통장 잔액 준비. 계정의 게스트 상태 유지. 활성 보상·회관 비용 정책 존재 |
| 입력값 | 홈·지갑·건설 옵션 조회 → 집중 시작·정책 시간 실제 대기·종료 → 회관 목표·착공 → 개인 상품 조회·구매 요청 → 지갑·개인 주문·인벤토리·홈 재조회 |
| 기대 결과 | 집중 후 B1 > B0. 건설 후 B2 = B1 − 조회한 회관 비용. 구매는 HTTP 403·SOCIAL_LOGIN_REQUIRED. B3 = B2, 지갑 version·개인 주문·인벤토리 변화 없음. 홈 최종 잔액·회관 착공 반영. 세션 종료 후 current=null |

#### 단계별 입력·판정

| 단계 | API·동작 | 기대 결과 |
|---|---|---|
| 초기 상태 | 홈·shop/wallets·construction-options 조회 | 상점·도서관 준비, 회관 미건설·선택 가능, B0 확보 |
| 집중·적립 | POST /focus-sessions → 현재 정책 secondsPerFish+2초 실제 대기 → 최신 version으로 finish → 지갑 조회 | active·유효 집중 시간 확인, earnedFish > 0, B1 > B0, current=null |
| 건설 | 회관 목표 PUT → 옵션/version 재조회 → constructions POST → 지갑 조회 | 회관 BUILDING, B2 = B1 − 비용. 완공 대기는 제외 |
| 게스트 구매 | 상품·지갑 version 확인 → shop/orders POST | 403 SOCIAL_LOGIN_REQUIRED. 활성 상품이 없으면 문법상 유효한 smoke-guest-denied ID·revision 1로 회원 gate가 먼저 적용됨을 확인 |
| 무변경·최종 조회 | 지갑·개인 주문·인벤토리·홈·건설 옵션 조회 | B3 = B2·지갑 version 유지, 주문·인벤토리의 data 내용이 요청 전후 동일, 홈 잔액·회관 착공 일치 |

#### 데이터 준비·정리

- DB 준비는 30분 이내 신규 게스트·활성 로그인 세션·단독 방장·smoke-core-UUID 이름·기존 집중/주문/원장/소유/건설 이력 부재를 트랜잭션에서 대조한다. 이미 사용한 fixture를 reset하지 않는다.
- 초기 잔액에는 준비용 원장을 함께 남긴다. 계정의 회원 승격·전역 카탈로그/가격 발행·집중 구간 시각 조작은 하지 않는다.
- 보상은 일반 집중 적립으로 판정하며 황금 물고기 추첨 결과를 PASS 조건으로 삼지 않는다.
- 실패 시 단계·B0~B3·안전한 오류 코드를 기록하고 진행 중 세션을 API로 종료한다. 다음 실행은 새 전용 계정·섬을 사용한다.

## 서비스·인프라

### SMOKE-SERVER-001 — 공개 API 접속

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-001 |
| 목적 | 공개 진입점(Nginx·TLS·business-api) 생존 |
| 연결 요구사항 | `docs/prd/fishcat/server-separation` (dev 2.0 라우팅) |
| 사전 조건 | 없음 |
| 입력값 | `GET /health` |
| 기대 결과 | HTTP 200, 2초 내 |

### SMOKE-SERVER-008 — 서비스 기동 상태

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-008 |
| 목적 | 서버가 잘 떠서 동작하는지 확인한다. 외부에서 직접 확인할 수 없는 컨테이너까지 포함해 5개 서비스의 health 상태를 검사한다 |
| 연결 요구사항 | server-separation (dev compose 구성) |
| 사전 조건 | `[self-hosted, dev]` 러너 |
| 입력값 | `docker inspect -f '{{.State.Health.Status}}'` × `phone-data-api`·`phone-realtime`·`phone-business-api-1`·`phone-notification-1`·`phone-kafka` |
| 기대 결과 | 5개 전부 `healthy`. `unhealthy`·없음·`restarting` 하나라도 있으면 실패 |

### SMOKE-SERVER-017 — 공유 Redis 읽기·쓰기

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-017 |
| 목적 | 공유 Redis에 접속해 값을 저장·조회·삭제할 수 있는지 확인한다 |
| 연결 요구사항 | dev 공유 Redis 접속 설정·인증·키 접근 권한 |
| 사전 조건 | `[self-hosted, dev]` 러너. 기존 Redis 접속·인증 설정 사용. 앱 키와 충돌하지 않고 ACL이 허용하는 런별 임시 키 이름을 구현 중 확정 |
| 입력값 | 고유 임시 키·값 생성 → TTL 60초로 `SET` → `GET` → `TTL` 확인 → 해당 키 `DEL` → `GET` |
| 기대 결과 | SET 성공·GET 값 일치·TTL이 0보다 크고 60초 이하·DEL 결과 1·삭제 후 GET 결과 없음. 연결·인증 오류·값 불일치·정리 실패는 FAIL |

실패 시에도 해당 임시 키만 삭제한다. 전체 키 삭제·FLUSH는 사용하지 않는다. 이 TC는 Redis 접속·읽기·쓰기를 증명하며 앱의 실제 사용 경로·Pub/Sub를 판정하지 않는다.

### SMOKE-SERVER-018 — business 전용 Redis 읽기·쓰기

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-018 |
| 목적 | business 전용 Redis에 접속해 값을 저장·조회·삭제할 수 있는지 확인한다 |
| 연결 요구사항 | business Redis 접속 설정·인증·기존 ACL의 `cache:business:*` 키 범위 |
| 사전 조건 | `[self-hosted, dev]` 러너. 기존 business Redis 접근 설정 사용. 기존 SET·GET·EXPIRE·DEL 권한 사용. TTL/PTTL 조회 권한은 요구하지 않음. 접근 권한이 없으면 차단 사유를 기록하며 명세를 구현 완료로 판정하지 않음 |
| 입력값 | 런별 `cache:business:smoke:<uuid>` 키·고유 값 생성 → EX 60으로 SET·GET → EXPIRE 1 후 실제 대기·GET 없음 → 다시 SET·GET → DEL·GET 없음 |
| 기대 결과 | SET 성공·GET 값 일치·EXPIRE 성공·만료 후 GET 결과 없음·DEL 결과 1·삭제 후 GET 결과 없음. 연결·인증·ACL 오류·값 불일치·정리 실패는 FAIL |

실패 시에도 해당 임시 키만 삭제한다. 앱 세션·미리보기 캐시 키는 변경하지 않는다. 앱 캐시 적중은 이 TC의 PASS 조건에 포함하지 않는다.
