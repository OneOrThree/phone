# FocusCat 서버 스모크 테스트 케이스

작성: 2026-10-12 · 상태: 구현 전 명세

작업 티켓: [GROMO-2285](https://romance.atlassian.net/browse/GROMO-2285)

이번 구현에 포함되는 **SMOKE-SERVER-001~010·014~018, 총 15개 TC**를 정리한다. 각 TC는 식별자·목적·연결 요구사항·사전 조건·입력값·기대 결과 양식을 따른다. 아직 확정하지 않은 요청·응답은 해당 TC에 명시하고 구현 중 현재 코드·계약으로 확정한다.

## 공통 실행 조건

- 대상: dev에 배포된 서버. `BASE_URL=https://oneorthree.dev.mooo.com`.
- 공개 API는 게스트 로그인 이후 `Authorization: Bearer <accessToken>`을 보낸다. 쓰기 요청은 계약에 맞는 새 `Idempotency-Key`를 사용하고, version은 직전 조회값을 사용한다.
- 기본 실행 순서: 001 → 002 → 003 → 004 → 005 → 007 연결·구독 → 006 시작·조회 → 010 수신 → 006 종료 → 009. 이벤트 발생 전에 구독을 완료한다.
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
| 기대 결과 | 201. `accessToken`·`refreshToken`·`userId`(UUID)·`onboardingComplete`(bool). `userId`는 전일과 동일 |

### SMOKE-SERVER-003 — 내 계정 조회

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-003 |
| 목적 | 액세스 토큰 검증 + 계정 읽기 |
| 연결 요구사항 | account |
| 사전 조건 | 002 `accessToken` |
| 입력값 | `GET /me`, `Authorization: Bearer <accessToken>` |
| 기대 결과 | 200. `userId` == 002 |

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
| 기대 결과 | 3초 내 `focus.member.updated` 사건 수신, `params.userId` == 002·`params.sessionId` == 006·`params.status`는 시작 후 상태와 일치. 미수신·ERROR는 실패 |

### SMOKE-SERVER-016 — 집중 중 주민·친구 정보 조회

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-016 |
| 목적 | 집중 중에도 같은 섬 주민·친구 정보와 집중 상태를 받아올 수 있는지 확인한다 |
| 연결 요구사항 | 현재 주민·친구 조회 및 집중 상태 응답 계약, realtime-events. 조회 API·필드와 010 이벤트 연계는 이번 구현에서 코드·계약으로 확인·확정 |
| 사전 조건 | 전용 테스트 계정과 같은 섬 주민·친구 관계 준비. 대상 주민·친구 ID 확보. 014의 단독 섬·잔액 검사와 분리. 진행 중 세션이 없는 상태에서 시작 |
| 입력값 | ① 집중 세션 시작 ② 집중 중 주민·친구 정보를 제공하는 현재 API 조회 ③ 집중 상태 확인 후 세션 종료. 실제 조회 경로·응답 필드는 계약 확인 후 확정 |
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
| 입력값 | `PUT /users/me/device-token`, 바디 `{"deviceToken":"smoke-<고정값>"}`에 현 등록 계약의 `deviceBootstrap` 또는 직전 등록의 `ownershipToken`을 포함. 로그인 응답·기존 등록에서 자격 확보 방식 확정 후 실행 (`DeviceTokenRegisterRequest` 기준, `platform` 필드 없음) |
| 기대 결과 | 2xx. 가짜 토큰이라 FCM 발송 없음 |

## 스크린타임

### SMOKE-SERVER-015 — 스크린타임 업로드·통계 조회

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-015 |
| 목적 | 스크린타임을 서버에 올리고 같은 날짜의 통계에 반영되는지 확인한다 |
| 연결 요구사항 | 2.0 스크린타임 업로드·통계 조회의 현재 공개 API 및 코드·계약. 경로·필드·합산 방식·중복 업로드 정책은 이번 구현에서 확인·확정 |
| 사전 조건 | 게스트 로그인 완료. 테스트 계정·날짜·타임존 확정. 기존 표본과 충돌하지 않는 테스트 데이터 준비. 해당 날짜 통계의 초기값 확보 |
| 입력값 | ① 해당 날짜의 통계 조회 ② 날짜·시간이 명확한 스크린타임 표본 업로드 ③ 같은 날짜·타임존의 통계 재조회. 실제 요청 경로·본문·반영 대기 시간은 현재 계약 확인 후 확정 |
| 기대 결과 | 업로드 정상 응답. 업로드한 날짜·표본의 시간이 현재 계약의 집계 방식대로 통계에 반영됨. 요청 날짜·사용자 정보가 일치. 계약·설정 미확정 또는 실행 불가라면 차단 사유를 기록하고 구현 완료로 판정하지 않음 |

테스트 표본은 런별로 식별 가능하게 준비한다. 이전 실행의 표본이 중복 합산되지 않도록 계약에 맞춰 초기 준비·정리하며, 실제 통계 결과를 DB에 직접 써서 만들지 않는다.

## 집중 보상·건설·상점·장착

### SMOKE-SERVER-014 — 집중 적립·건설·아이템 구매·장착

| 항목 | 내용 |
|---|---|
| 식별자 | SMOKE-SERVER-014 |
| 목적 | 홈에서 시작해 집중으로 물고기를 적립하고, 건물과 아이템을 소비한 뒤 장착 결과까지 확인한다 |
| 연결 요구사항 | focus-rest-session, island-construction, island-shop, island-appearance, bff-screens. 현재 계약은 `FocusRewardAccrualService`·`IslandConstructionController`·`ShopController`·`AppearanceController` 기준 |
| 사전 조건 | 기본 세트 통과. `SMOKE_CORE_DEVICE_ID`에 연결된 전용 게스트·단독 섬, 해당 게스트의 방장 권한. 상점 완공, 구매할 건물은 미건설·개인 아이템은 미소유. 활성 보상·건설 비용·상품 정책과 구매·장착 조건 확인. 건물·아이템 비용보다 충분한 초기 섬 통장 잔액 준비 |
| 입력값 | ① 홈·섬 지갑·건설 옵션·상품 조회 ② 집중 시작 → 정책상 적립에 필요한 유효 집중 시간 유지 → 최신 version 조회 → 종료 ③ 섬 지갑 조회 ④ 건설 목표 선택·옵션 재조회·건설 요청 ⑤ 상품·지갑 재조회·아이템 구매·주문/보유 내역 조회 ⑥ 아이템 장착·홈 재조회. 아래 단계별 API 사용 |
| 기대 결과 | 시작 전 잔액 B0 대비 집중 후 B1 > B0. 건설 후 B2 = B1 − 조회한 건설 비용. 아이템 구매 후 B3 = B2 − 조회한 상품 가격. 새 건설 상태·주문·아이템 소유·장착 확인. 홈 재조회에 최종 잔액 B3와 외양·건설 상태 반영 |

#### 단계별 입력·판정

| 단계 | API·동작 | 기대 결과 |
|---|---|---|
| 1. 초기 상태 | `GET /screens/home`, `GET /islands/{id}/shop/wallets`, 건설 옵션·상품 조회 | 전용 섬·완공 상점 확인. 초기 섬 통장 잔액 B0·version 확보. 대상 건물 미건설·아이템 미소유 |
| 2. 집중 | `POST /focus-sessions` → ACTIVE 상태로 유효 집중 유지 → 최신 version 조회 → `POST /focus-sessions/{id}/finish` | 생성·조회·종료 성공. 현재 정책의 `secondsPerFish`가 60이면 60초 이상 실제 집중, 다른 값이면 해당 정책 시간 적용 |
| 3. 적립 | 종료 결과·섬 지갑 재조회 | B1 > B0이며 일반 집중 적립 근거 확인. 크론이 먼저 적립할 수 있으므로 집중 시작 전 B0와 비교 |
| 4. 건설 | `GET /islands/{id}/construction-options` → 필요 시 `PUT /islands/{id}/construction-target` → 옵션/version 재조회 → `POST /islands/{id}/constructions` | 정상 응답·새 건설 상태 존재. B2 = B1 − 조회한 건설 비용. 건설 시작까지 확인하며 완공 대기는 제외 |
| 5. 아이템 구매 | 상품·지갑 version 재조회 → `POST /islands/{id}/shop/orders` → 주문 조회·`GET /me/inventory` | 201. 주문·아이템 소유 존재. B3 = B2 − 조회한 상품 가격 |
| 6. 장착 | `PATCH /me/appearance` → 인벤토리·홈 재조회 | 해당 슬롯에 구매한 itemId 반영. 홈 주민 외양·건설 상태와 섬 통장 잔액 B3 일치 |

#### 데이터 준비·정리

- DB 준비는 dev internal 러너에서 전용 deviceId·userId·islandId·방장 소속을 대조한 뒤 트랜잭션으로 수행한다. 상점 완공·초기 자금·미건설 건물·미소유 아이템 조건만 준비하고, 적립·구매·장착 결과는 API로 만든다.
- 잔액과 준비용 원장을 일치시킨다. 이전 건설·주문·보유·장착·기여·원장·멱등 명령·version·미전달 outbox의 정리 범위는 스키마로 확정한다. 이미 전달된 사건을 미전달로 되돌리지 않는다.
- 일일 보상 상한·튜토리얼 상태를 확인해 일반 집중 적립이 가능한 조건을 준비한다. 집중 시각·구간·보상 기록은 시간을 줄이기 위해 변경하지 않는다.
- 적립·차감은 `wallets.villagePoints`(섬 통장)로 판정한다. `wallets.fish`는 현재 항상 0인 호환 필드다. 황금 물고기 추첨 결과는 PASS 조건으로 삼지 않는다.
- 준비부터 정리까지 전용 섬 단위로 직렬 실행한다. 실패하면 후속 단계는 SKIP하고 B0~B3·상품/정책 revision·주문/세션 ID를 남긴다. 실패 여부와 관계없이 진행 중 세션 종료·잔여 상태 기록을 수행하고 다음 실행 전 초기 준비로 복구한다.

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
| 사전 조건 | `[self-hosted, dev]` 러너. 기존 business Redis 접근 설정 사용. SET·GET·TTL·DEL 권한을 구현 중 확인. 접근 권한이 없으면 차단 사유를 기록하며 명세를 구현 완료로 판정하지 않음 |
| 입력값 | 런별 `cache:business:smoke:<runId>:<uuid>` 키·고유 값 생성 → TTL 60초로 `SET` → `GET` → `TTL` 확인 → 해당 키 `DEL` → `GET` |
| 기대 결과 | SET 성공·GET 값 일치·TTL이 0보다 크고 60초 이하·DEL 결과 1·삭제 후 GET 결과 없음. 연결·인증·ACL 오류·값 불일치·정리 실패는 FAIL |

실패 시에도 해당 임시 키만 삭제한다. 앱 세션·미리보기 캐시 키는 변경하지 않는다. 앱 캐시 적중은 이 TC의 PASS 조건에 포함하지 않는다.
