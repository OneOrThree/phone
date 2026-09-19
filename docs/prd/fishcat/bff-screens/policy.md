# BFF 정책·결정 기록

## 출처와 공통 규칙

| ID | 규칙 | 근거·상태 |
| --- | --- | --- |
| B01 | ~~신규 GET /screens13종. 도메인66계약과 별도로 보존~~ → B15 | 사용자 화면당1콜 결정·1784~1787 |
| B02 | ~~적용 가능한 재료는 단일 Data read-model snapshot의 R(필수) 묶음~~ → B24 (병렬 조합이 기본, 이 방식은 B24 예외 화면에만) | 기술 결정 D42. [아키텍처 A9](../../../architecture/decisions.md)의 “접근 패턴이 근본적으로 다를 때” 예외를 교차 리소스 원자 조회에 한정한다. 새 화면 자체는 예외 사유가 아니다 |
| B03 | N은 검증된 비적용으로 **조회하지 않음**. 실제403은 전체 실패 | A0·PR741.1786의 권한 없는 조각 문구를 이 의미로 구체화 |
| B04 | 초기 13개에 O(일시 실패 선택 조각)는 없음 | 승인된 기술 선택. 동일DB TX 실패를 부분 성공으로 꾸미지 않음 |
| B05 | 추후 독립O를 추가하려면 공개 상태/복구/시간 차 허용을 개정. 허용된 일시 실패만null | A0. auth·계약 실패·전체504는 항상 화면 전체 실패 |
| B06 | 모든 성공은 {data}; 실패는 {error:{code,message,field,retryable},requestId} | A0. 내부오류·권한필터는 공개 DTO에 넣지 않음 |
| B07 | ~~data.asOf는 같은 Data snapshot의 관측 UTC instant. 자원 버전/커서 snapshot ID가 아님~~ → B24: 병렬 조합 화면에는 화면 전체 `asOf`를 두지 않는다. 조각의 `serverNow`·`asOf`·`updatedAt`을 원래 의미대로 보존한다. B24 예외 화면에만 원래 규칙을 적용한다 | 신규 BFF 기술 계약. 여러asOf 문자열을 맞추는 것으로 snapshot을 위조하지 않음 |
| B08 | 현재 주체는 서버검증 값, session/islandId/currentContext를 Data에서 재검사 | 사용자 입력·헤더 복사로 주체/role/현재 섬 선택 금지 |
| B09 | domain version/watermark/cursor를 원래 자원 축으로 보존 | PR737/738. maxversion 하나로 합치지 않음 |
| B10 | 페이지형 목록의 첫 화면 페이지는 BFF, 다음 페이지/개별상세/재연결은 기존 도메인 GET. memberships는 전량·nextCursor=null, joinRequests는 PR741 명시 cursor 확장 | [LLD §1](low-level-design.md)의 정본 근거. 비페이지 목록을 잘라 성공하거나 cursor를 임의 추가하지 않음 |
| B11 |13개 외부 응답 TTL0, Cache-Control:no-store | 초기 기술 선택. 내부 불변 snapshot/자산 재사용도 현재 인가 필요 |
| B12 | 쓰기·자동 권한 복구·가입/세션 생성·정산·outbox는 화면GET의 부수효과가 아님 | 원본 행동 분리·공통 GET-only 조합 |
| B13 | MemberIslandDetail에 island.appearanceVersion 필수 제공. 실제 appearance.version에 직접 매핑 | 승인된 기술 확장. 원본/기존 부분 응답에 이미 있던 필드가 아님. island.version과 별도 watermark |
| B14 | focusMembers.items[].appearanceVersion은 같은 snapshot의 user appearance.version을 직접 반환 | 승인된 필수 응답 확장. 개인 외양 축 (member.appearance,userId)이며 focus.member/session/island 외양 버전과 비교하지 않음. 병렬 조합에서는 `focus-members` 도메인 GET 한 번의 읽기 안에서 같은 값을 반환한다 **구현 유예(GROMO-1765):** 개인 외양 정본(티켓 1783)이 main 에 들어오기 전까지 `focus-members` 는 이 필드와 `catColor`·`appearance` 를 싣지 않는다 — `null` 로 채우지 않고, 제공자가 생기면 필드를 추가한다 |
| B15 | `/screens` 14종: `launch` · `explore` · `home` · `visit/{islandId}` · `focus` · `town-hall` · `library` · `board` · `mailbox` · `shop` · `playback` · `raft` · `friends` · `account`. `travel`·`rest`·`tower` 폐지, `hall`→`library`, `island-manage`→`town-hall`. 진입 조회가 하나뿐인 화면(섬 간 랭킹·공지 상세·편지 상세·구매 내역)은 집계를 만들지 않고 도메인 GET을 바로 부른다. B11의 no-store는 14종에 그대로 적용한다. 경로 이름은 B25에서 확정했다 | 기획 API v1 0.6-proposed(2026-09-15) 화면 표 86프레임 대조 — 조회 계약이 2개 이상 붙은 프레임 51개. 공지 상세는 `GET /islands/{islandId}/notices/{noticeId}`가 댓글 첫 페이지를 이미 담는다([island-board LLD](../island-board/low-level-design.md)) |
| B16 | 경로·DTO 정본은 레포 도메인 LLD다. 기획 v1 문서의 `/v1` 경로와 새 이름(`/me/memberships`·`/islands/{islandId}/switch`·`…/members/{userId}/kick` 등)은 채택하지 않는다 | P01 무접두. 도메인 LLD가 경로를 이미 확정했다 |
| B17 | 항해(08·30·62)는 조회가 없다. 도착지 화면(`home`·`visit`·`focus`) 조회를 출발할 때 부른다. 모닥불 휴식(26)은 `home`이 `restMembers`를 함께 준다(BG11) | travel·rest 폐지 근거. 휴식은 원래 섬 모닥불(기획 확정 정책) |
| B18 | 집중 결과(27·29)는 finish 응답으로 그린다. 응답 유실은 finish 재호출로 복구하고 결과 조회 GET을 만들지 않는다. 기획 v1의 `progress` PUT은 채택하지 않는다 | [focus-rest-session LLD](../focus-rest-session/low-level-design.md) finish의 완료 세션 복구 계약, 구간 기반 시간 계산 |
| B19 | `explore`는 소속 섬이 0개면 `GET /islands/discover`, 있으면 `GET /islands?q=` 첫 페이지를 쓴다. 둘을 합치지 않는다 | [island-membership LLD](../island-membership/low-level-design.md) §3.2·3.3 — 검색만 전망대 해금이 필요하다 |
| B20 | 판매 음원은 `GET /islands/{islandId}/shop/products?category=sound`, 구매는 `POST /islands/{islandId}/shop/orders`다. 축음기 전용 구매 계약을 만들지 않는다 | [island-shop LLD](../island-shop/low-level-design.md) §2.2·2.3에 `category=sound`와 `requiredBuilding`이 이미 있다 |
| B21 | 상세·다음 페이지는 탭할 때 도메인 GET을 부른다(B10): 퀘스트 주민 달성 `…/quests/{questId}/progress`, 상품 상세 `…/shop/products/{productId}`, 목록 cursor | 화면 조회를 상세까지 키우지 않는다 |
| B22 | 실시간 구독은 [realtime-events LLD](../realtime-events/low-level-design.md) §3.1의 토픽 7개를 그대로 쓴다: `events`·`focus`·`rest`·`emotes`·`playback`·`messages`·`/user/queue/events` | 토픽이 인가 단위다(emotes는 집중 중, playback은 방송기, messages는 우체통 접근) |
| B23 | 기획 v0.6 정책 변경은 해당 도메인 LLD에서 고친다. 여기에는 목록만 둔다: 섬 물고기 단일 재화(island-shop 지갑·island-construction·island-quests 보상 통화), 건물 각자 몫·총액(기획 결정 1829), 섬 정원 1~15(기획 결정 1831), 기록 조회 도서관 이동(island-records), 전망대 주민 랭킹 폐지(island-rankings), 배 종류 제거(island-appearance), 단일 로그인 수단(account) | 화면 조합은 조각 DTO를 바꾸지 않는다. 필드가 바뀌면 도메인이 먼저 바뀐다 |
| B24 | **화면 조회는 Business가 도메인 내부 GET을 병렬로 조합하는 것이 기본이다.** ① 앞 응답이 다음 호출을 정할 때만 단계를 나눠 순서대로 부른다 — 현재 섬 확인(`GET /me/islands` → `GET /islands/{islandId}`) 뒤 조각, 역할 확인 뒤 방장 조각. ② 한 화면의 모든 단계가 `ScreenComposer`의 같은 context·deadline(3초)을 쓴다. ③ 화면 전용 Data read-model은 만들지 않는다. ④ **예외:** 한 화면 안의 값이 같은 순간이어야 사용자가 그 화면에서 틀린 판단을 하게 되는 경우에만, 그 화면 하나에 한해 Data 단일 스냅샷 read-model(B02 방식)을 쓴다. 예외를 쓰려면 이 표에 화면 이름·어긋나면 생기는 문제·명령 TX 재검사로 막을 수 없는 이유를 적는다. 표시가 잠깐 어긋나는 것만으로는 예외 사유가 아니다. 현재 예외 화면: 없음 | **2026-09-15 조재영 결정(BG09 해소).** 근거: ① 어긋남은 화면 표시에만 생기고 돈·보유·권한을 바꾸는 명령은 Data TX가 인가·version·가격을 다시 검사한다(B12·A21). ② 명령 뒤 outbox 사건과 version 비교(B09)가 곧 최신 값으로 맞춘다. ③ Data에 화면 전용 API 14개를 만들지 않고 A9 기본 규칙(정규 리소스 조회)을 지킨다. 대가: 화면당 내부 호출 5~7번. `ScreenComposer`의 pool16·queue64·3초는 출발값이라 부하 테스트로 확인한다. 알려진 표시 불일치 창: `shop` 잔액↔보유, `home` 현재 섬↔세션, `town-hall` 역할 확인 뒤 위임(화면 403). 따라 바뀐 것: B02·B07 개정, BG07 폐기, A9의 13개 read-model 예외 개정, [LLD §3](low-level-design.md)·[HLD](high-level-design.md)의 read-model 서술은 v0.3 기록 |
| B25 | **화면 경로 이름 확정:** `boat`→**`raft`** · `sound`→**`playback`** · `post-office`→**`mailbox`**. `library`·`town-hall`은 그대로 두되 **v0.3의 `hall`은 폐기한 이름이라 화면·조각·경로 어디에도 다시 쓰지 않는다**(옛 `hall`은 기록 화면이었고 지금은 `library`가 기록, `town-hall`이 섬 관리다). `wallets`는 복수를 유지한다. `launch`는 `/screens/` 아래에 둔다 | **2026-09-16 조재영 결정.** `raft`는 기획 화면명 「나의 뗏목」과 배 종류 폐지(B23)에 맞춘 것이고, `playback`·`mailbox`는 도메인 폴더 `island-playback`·`island-mailbox`에 맞춘 것이다. 화면 이름은 도메인 폴더 이름을 따르되 그 이름이 화면을 설명하지 못하는 `town-hall`(island-management)·`library`(island-records)만 건물 이름을 쓴다. 남은 이름 결정은 BG12 두 건 |
| B26 | **내부 경로 규칙과 availability 이름 확정:** ① 본인 것만 읽는 조회의 내부 경로는 `/internal/users/{userId}/…` 로 만든다(`GET /me` → `/internal/users/{userId}`, `GET /focus-sessions/current` → `/internal/users/{userId}/focus-sessions/current`). 섬 자원은 `/internal` + 공개 경로다. ② availability 필드 이름은 **조각 이름**을 따른다 — `playbackAvailability` · `joinRequestAvailability` · `joinRequestsAvailability` · `statisticsAvailability`. 값은 `available` 과 생략 사유(`facility_locked` · `host_only` · `none`) | 2026-09-16 확정(BG12 해소). ①은 `InternalAuthFilter` 가 `/internal/users/{userId}/…` 에서만 「경로의 사용자 = `X-User-Id`」를 대조하기 때문이다 — 헤더만 쓰면 그 검사가 사라진다. 선례: 알림 설정 `/internal/users/{userId}/notification-settings-commands`. ②는 기존 두 필드가 이미 조각 이름을 따르므로 같은 규칙을 기록 조각에도 적용한다 |

공개 오류의 code/status/retryable은 [A0 고정 정본 표](https://github.com/OneOrThree/phone/blob/0646e6e764bba5340cc23f9be8f6e30e25a863fd/docs/prd/api-platform/policy.md#http-상태외부-오류-코드)를 사용한다. 아래 화면별 실패 요약으로 별도의 boolean 정책을 만들지 않는다.

## 화면별 적용표

> 아래 표는 B01(v0.3 13종) 기록이다. 14종의 조각은 [Business 구현](implementation-business-api.md) §4가 정본이다.

| 화면 | R 필수 재료 | N 조회 생략 조건/공개 상태 | 외부 TTL |
| --- | --- | --- | --- |
|home|island,focusSummary,session 조회|없음. session 자체의 정상null은 R 조회의 성공값|0|
|travel|목적지 island, 적용되면playback|검증 목적지에gram 없음: playback=null,playbackAvailability=facility_locked|0|
|focus|session,focusMembers, 적용되면playback|검증 섬에gram 없음: playback=null,playbackAvailability=facility_locked|0|
|sound|sharedInventory,playback|없음. gram없음은 전체403 FACILITY_LOCKED|0|
|rest|session,restMembers|없음. 세션 없는 모닥불 방문은 session=null 정상값|0|
|hall|focusStatistics,screenTimeStatistics|없음. 측정 unavailable/null은 조각 전체 실패가 아닌 도메인 데이터|0|
|island-manage|island,members, host이면joinRequests|검증 일반주민: joinRequests=null,joinRequestsAvailability=host_only|0|
|board|quests,notices|없음. 비활성 탭도 초기 계약에서필수|0|
|tower|memberRankings,islandRankings|미결 eligibility를 임의 N으로 만들지 않음. 참가 정책/응답 확정 전gate|0|
|explore|islands,memberships|없음. 소속 조회 실패를 미소속으로 바꾸지 않음|0|
|visit|public island, 본인요청있으면joinRequest|본인 최신 요청 없음: joinRequest=null,joinRequestAvailability=none|0|
|shop|wallets,products,sharedInventory|없음. 금액/소유 오류를0/false로 합성하지 않음|0|
|boat|me,inventory|없음. 현재 섬 필수 아님|0|

availability의 available은 해당 조각이 도메인 계약대로 조회됐다는 뜻이다. playback이 미선택 상태(trackId=null)여도 방송기가 있고 정상 조회했다면 playbackAvailability=available, playback 객체는 유지한다. none은 본인 신청이 없다는 뜻이며 타인의 요청 유무를 알려주지 않는다. host_only는 원본의 공개 역할 차이를 설명하며 내부 caller allowlist/SQL 권한을 노출하지 않는다. 실제403을 이 상태로 바꾸지 않는다.

## 미결과 활성화 gate

| ID | 선행 결정/구현 | 영향/승인 전 규칙 |
| --- | --- | --- |
| BG01 | IM-D06 currentIsland=null 복구·가입/이동 context | home/현재 섬 화면. 임의 첫 소속·자동 생성·시설 우회 금지 |
| BG02 | 초기 건설 기여/목표 DTO·가격/공동권한, focus 보상·강퇴·입력정책 | 필요한 island/session 재료가 실제로완성되기 전 해당 화면 활성화 금지. 조회가미답 정책을 채택하지 않음 |
| BG03 | 기록 개인범위/측정기기 병합/기간 상태와 랭킹 분모·동점·참가·마감 | hall/tower. 미결을0초/eligible로 반환하지 않음 |
| BG04 | 신규 me/catColor 및 1780/1782 명시 확장인 products.ownerType/productVersion·inventoryVersion/equipped.version/appearance.version·미디어 소유/길이·1759/1783 섬 외양 버전 및1765/1783 집중 주민 개인 외양 버전 제공 | home/travel/island-manage/focus/sound/shop/boat 7개 화면. 예시색/무료곡/샘플완공을 운영기본값으로 쓰지 않음. 두 appearanceVersion의 각 정본 직접매핑·역순 외양사건·늦은 GET 응답 회귀 필요. 집중 주민의 도메인 GET/BFF가 같은 개인 외양 버전을 제공하기 전 focus 화면 활성화 금지 |
| BG05 | private 비소속 visit의 초대 읽기자격 전달 | 기존 무자격GET403 유지. 원본resolve 공개요약 재사용 또는 명시자격 read-model 연동 전 해당 private 진입 활성화 금지 |
| BG06 | PR744의 구조화된 영구5xx strict 분류와 실제 HTTP 회귀 | 신규 public+composition 엄격 분류는 수정 중. legacy 동기호환과 분리하고 완료/배포로 가정하지 않음 |
| BG07 | ~~Data 화면 read-model GET 제공자·정확 allowlist·strict DTO·인가/snapshot 검증~~ → B24로 폐기 | ~~A9의 D42 예외 범위와 LLD §3의 13개 GET을 대조하고 기존 query 모듈을 재사용한다. 13개 BFF controller만 추가해 완료로 계산하지 않음~~. B24 예외 화면이 생기면 그 화면에 한해 이 조건을 다시 적용한다 |
| BG08 | PR744의 무접두 `/screens` ingress 설정 통합·배포 확인 | `/screens` 및 `/` 하위의 Business 연결과 URI 보존, 유사 접두어 제외·내부 경로 차단을 실제 배포 구성에서 검증하기 전 해당 화면 활성화 금지. 설정 예시·로컬 회귀가 운영 적용 완료의 증거는 아니다 |
| BG09 | ~~조합 방식: B02(Data 단일 스냅샷 read-model)를 Business의 도메인 GET 병렬 조합으로 바꿀지~~ → **B24로 확정 (2026-09-15)** | 해소. 병렬 조합이 기본이고 같은 순간 값이 필요한 화면만 개별 예외 |
| BG10 | ~~친구·편지 도메인 설계(레포에 LLD 없음)~~ → **해소: [친구·편지 설계](../friend-letter/)**(GROMO-1893 — 친구는 이미 구현돼 있었고 편지·요청 취소만 신규). 남은 것은 **가입 대기 신청 목록·공동 가계부·물고기 장 조회 계약**이며, 이 셋은 여전히 설계 전이라 해당 조각을 활성화하지 않는다. `mailbox`·`friends`·`raft` 의 친구·편지 조각은 friend-letter 설계의 내부 GET 과 허용목록이 들어간 뒤 켠다 |
| BG11 | 모닥불 휴식 주민이 섬 홈 장면에 보이는지, 다른 섬 도서관을 어디서 여는지 | B17의 rest 흡수와 `library`의 타 섬 경로. 확인 전 두 부분을 구현하지 않는다 |
| BG12 | ~~남은 이름 결정 2건~~ → **B25·B26으로 확정(09-16)**. 티켓 1888에는 기획 API v1 경로와의 대조표 전달만 남는다 | 이름이 또 바뀌면 [Business 구현](implementation-business-api.md)·[Data 구현](implementation-data-api.md)·`diagrams/`를 함께 고친다 |
| BG13 | **기획의 `convert`·`conflict` 경로에 대응하는 우리 경로가 없다** — 기획 `convert`(`POST /v1/me/auth-identity`)·`conflict`(`POST /v1/me/identity-conflicts/{conflictId}/resolve`) | **동작 자체는 이미 정해져 있다** — 게스트→소셜 승격과 기존 소셜 계정 충돌은 [account LLD](../account/low-level-design.md)의 `POST /auth/sessions` 가 선택 AT 의 guest 여부로 처리하고, 충돌은 `409 SOCIAL_ACCOUNT_ALREADY_LINKED`·`409 GUEST_ALREADY_PROMOTED` 로 돌려준다(:944-945). 따라서 이 gate 는 **기획 계약 이름 두 개를 우리 경로 어디에 대응시킬지**로 한정한다 — 별도 엔드포인트를 새로 만들지, `POST /auth/sessions` 응답으로 흡수한다고 기획팀에 회신할지. `account` 화면(프레임 80)은 이 결정과 무관하게 기존 계약으로 구현할 수 있다 |
| BG14 | **약관 재조회·재동의 계약이 없다** — 기획 `terms`(`GET /v1/terms/current`)·`consent`(`POST /v1/me/terms-consents`) | 로그인 요청의 `termsVersion` 필드가 **최초 동의만** 흡수한다([account LLD](../account/low-level-design.md) §2.1). 약관이 개정됐을 때 기존 세션에 다시 받는 경로가 없다. 법무 요구가 생기면 바로 필요해진다 |
| BG15 | **퀘스트 보상 알림 계약이 없다** — 기획 `reward-notifications`(`GET /v1/me/reward-notifications`)·`reward-ack` | `board` 화면(프레임 48·49)이 참조하는데 [island-quests LLD](../island-quests/low-level-design.md)에도, 알림 도메인에도 없다. 보상 수령 모달의 선점(ack)은 `ChallengeResultAckService` 선례가 있으나 **퀘스트 축 계약은 미설계**다 |
| BG16 | **공지 댓글 삭제 계약이 없다** — 기획 `comment-delete`(`DELETE /v1/comments/{commentId}`) | [island-board LLD](../island-board/low-level-design.md)는 댓글 **생성만** 다룬다. 삭제 권한(작성자만? 방장도?)과 소프트 삭제 여부가 정해져야 `board` 화면의 댓글 UI 를 확정할 수 있다 |
| BG17 | **건설 진행 상태 조회 계약이 없다** — 기획 `construction`(`GET /v1/islands/{islandId}/constructions/current`) | [island-construction LLD](../island-construction/low-level-design.md)의 `construction-options` 응답은 `selectedBuildingId` 와 옵션별 `selectable`·`buildable`·`blockedReason` 뿐이고 **진행 상태(`status`)가 없다** — `status` 는 POST `/constructions` 의 완료 응답에만 있다. **영향 화면은 `home`·`town-hall`·`board` 셋이다**([대조표](planning-v1-mapping.md) §4 에서 셋 모두 `construction` 을 집계한다). 세 화면 중 어느 것도 진행 중인 건설을 그리려면 도메인 계약에 필드를 더해야 하며, 결정 전에는 그 조각을 활성화하지 않는다 |
| BG18 | **섬 무관 전체 구매 이력 계약이 없다** — 기획 `my-orders`(`GET /v1/me/purchase-history`) | [island-shop LLD](../island-shop/low-level-design.md) §2.5 는 `/islands/{islandId}/shop/orders` 로 **한 섬 범위만** 정의한다. 여러 섬에서 산 개인 구매를 합친 이력이 없다. 화면(구매 내역, 프레임 74·75)이 전체를 보여줄지 섬 단위로 둘지 제품 결정이 필요하다 |

BG13~BG18 은 [기획 v1 대조표](planning-v1-mapping.md) §3 이 기획 계약 98개를 전수 대조하며 찾은 것이다 — BG10 이 적어 둔 6종과 **다른 집합**이라 장부에 따로 올린다. 여섯 모두 기획 화면이 참조하지만 레포 도메인 LLD 에 계약이 없다.

현재 작업은 설계이며 O가 없다는 선택이 향후 제품 부분 실패 지원을 영구 금지하지 않는다. O를 추가할 때도 N의 의미와 auth 실패 처리를 바꾸지 않는다.
