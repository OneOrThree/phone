# 섬 상점 — 상세 계약

GROMO-1780 · 상태: 구조/와이어 설계, 제품 정책 미결 · [정책](policy.md) · [HLD](high-level-design.md)

## 1. 공통 와이어와 context

신규 API 성공은 `{data:...}`. 오류는 `{error:{code,message,field,retryable},requestId}`이고 현재 서버 생성
requestId를 헤더와 본문에 쓴다. UUID는 데이터 ID, ProductId는 카탈로그 문자열, 시각은 UTC instant다.
정수 balance/price/version은0~9007199254740991 범위이며 server/DB 연산도 overflow를 검사한다.
보상/가격은 정수이고 요청 소수/음수는422 OUT_OF_RANGE, 구조·필수필드 오류는400 INVALID_REQUEST다.

`islandId`는 상점 세션에서 선택한 현재 섬을 명시한다. Business는 request context를 한 번 확정하고 Data의
새 구매 TX가 `stored currentIslandId == path islandId` 및 현재 활성 membership을 확인한다. context가
바뀌었으면409 STATE_CONFLICT, membership/행동권한은403 FORBIDDEN, 상점/방송기 미해금은403 FACILITY_LOCKED다.
읽기도 동일한 명시 경로 context에서 조회하며 다른 섬의 포인트를 전역 current-state 재조회로 끼워 넣지 않는다.
이 정의는 개인 GET `/me/inventory`에 섬 선택을 강제하지 않는다. currentIsland 저장 모델/전환 잠금은 섬 담당 제공자에 의존한다.

개인 구매 내역의 owner는 항상 본인이다. `scope=personal`은 섬에서 무엇을 샀든 본인 개인 주문을 조회하고,
`scope=shared`는 경로 섬의 공동 주문만 조회한다. personal cursor는 요청자의 scope에, shared cursor는
요청자+해당 섬에 묶인다. 경로와 현재 섬 접근 검증은 내역에도 수행하지만 필터를 개인 구매시점의 섬으로 바꾸지 않는다.

## 2. 다섯 계약

### 2.1 wallet — GET `/islands/{islandId}/shop/wallets`

본문 없음. 본인과 현재 섬의 두 wallet을 **같은 Data 읽기 snapshot**에서 반환한다.

```json
{"data":{"fish":500,"villagePoints":1500,"fishVersion":4,"villagePointsVersion":7}}
```

금액은 원본 형태 예시다. fishVersion은 `(user,subject,fish)`, villagePointsVersion은 `(island,islandId,village_points)`
지갑의 실제 버전이다. 둘의 최댓값을 공용version으로 만들지 않는다. 본인 fish를 섬 전체 응답 캐시에 넣지 않는다.
회원 생성/경제 활성화에 필요한 wallet이 없으면0원으로 위장하지 않고503 SERVICE_UNAVAILABLE 및 운영 로그로 처리한다.

### 2.2 catalog — GET `/islands/{islandId}/shop/products`

Query: `category=personal|island|sound` 필수, `cursor` 선택, `limit` 선택(기본30,1~100).

```json
{"data":{"items":[{"id":"scarf","title":"바다 스카프","kind":"clothes","price":20,"currency":"fish","ownerType":"user","owned":false,"available":true,"reason":null,"productVersion":3}],"nextCursor":null}}
```

각 항목의 id/title/kind/currency/ownerType/owned/available/reason/productVersion은 필수, reason은 nullable.
price는 승인된 활성 revision의 정수이며 미승인 catalog preview를 허용한다면 null+available=false를 명시하는 별도
도메인 상태로 다룬다. 운영 초기값을 목업으로 채우지 않는다. catalog를 공개할지 자체도 경제 활성화 설정을 따른다.
카테고리가 같아도 권한·시설·소유·선행선체 조건은 상품별로 계산한다. `available`은 조회 시점 안내이며 구매 허가증이 아니다.
정렬 `(displayOrder ASC, productId ASC)`와 catalog 활성 revision을 cursor에 고정한다. 해당 revision이 더는 제공되지
않으면409 CURSOR_EXPIRED이며 첫 페이지부터 다시 읽는다. 사용자·현재섬·category·limit을 cursor scope에 포함한다.

### 2.3 product — GET `/islands/{islandId}/shop/products/{productId}`

```json
{"data":{"id":"rain","kind":"audio","title":"오두막의 빗소리","price":30,"currency":"village_points","ownerType":"island","productVersion":5,"previewUrl":"https://media.gromo.example/rain-preview.wav","owned":false,"available":true,"blockedReason":null,"requiredBuilding":"gram"}}
```

previewUrl/blockedReason/requiredBuilding은 nullable. 다른 시설용 building_theme은 대상 buildingId를 추가 반환한다.
previewUrl은 서버 등록 media 자산만 반환하고 사용자 URL을 받아 서버가 대신 가져오는 기능을 만들지 않는다.
미리듣기는 기기 로컬이며 shared playback을 변경하지 않는다. 비활성/삭제 상품은404 NOT_FOUND 또는 이미 소유한
상품의 별도 표시 가능 여부를 catalog 생명주기 정책과 함께 정한다. 과거 주문 snapshot을 이404로 삭제하지 않는다.

### 2.4 buy — POST `/islands/{islandId}/shop/orders`

Headers: 유효 JWT, application/json, 필수 UUID `Idempotency-Key`.

```json
{"productId":"scarf","expectedWalletVersion":4,"expectedProductVersion":3}
```

`expectedProductVersion`은 **1780 상세 설계에서 추가 채택한 명시적 확장**이다(2026-09-12 조정자 동의).
원본의 두필드 body만으로는 wallet 변동없이 가격이 오를 때 동의를 확인할 수 없다. 상품 조회가 반환한
productVersion을 비교하고 stale이면409 VERSION_CONFLICT, field=expectedProductVersion으로 최신 공개 상품을
current에 제공한다. 앱은 새 가격/조건을 사용자에게 다시 보여준 뒤 새 키로 요청한다. 서버가 가격을 임의로 받는
방식이나 오래된 가격에 무조건 판매하는 방식이 아니다. 원본9개 버전제출표에 없던 **상점 한정 추가**다.

expectedWalletVersion은 상품 currency가 fish면 fishVersion, village_points면 villagePointsVersion이다.
ownerType/ownerId/currency/price/quantity를 요청에서 받지 않는다. 미등록 필드는400으로 거절한다.

```json
{"data":{"id":"order-1","productId":"scarf","spent":20,"currency":"fish","ownerType":"user","owned":true,"walletVersion":5}}
```

201. DTO id는 실제 UUID, 예시는 설명용이다. receipt는 이 결과와 HTTP201을 저장하며 나중의 현재 잔액/버전으로
바꿔 재생하지 않는다. 같은 key·같은 본문 **성공 재생은 현재 상품/지갑 버전 비교보다 먼저**다.
현재 사용자 인증과 결과 공개 자격은 여전히 필요하다. operation에는 method·정규 경로와 실제 islandId를 포함한다.
같은 사용자·operation·key에서 productId/expectedWalletVersion/expectedProductVersion 등 본문이 다르면409 IDEMPOTENCY_KEY_REUSED다.
경로 islandId가 다르면 공통 규약상 별도 operation scope이므로 같은 key라도 다른 명령으로 처리한다. 앱은 새 의도마다 새 키를 생성한다.
새 key인데 해당 owner가 이미 소유했으면409 STATE_CONFLICT이며 차감0이다.

실패:401 UNAUTHORIZED,403 FORBIDDEN/FACILITY_LOCKED,404 NOT_FOUND,409 VERSION_CONFLICT/STATE_CONFLICT/
INSUFFICIENT_FUNDS/IDEMPOTENCY_KEY_REUSED/REQUEST_IN_PROGRESS,422 OUT_OF_RANGE,503/504 공통 일시 실패.
예상 못한 내부 code/status는 공통 UPSTREAM_CONTRACT_ERROR로 처리하고 임의 문자열을 외부에 노출하지 않는다.

### 2.5 orders — GET `/islands/{islandId}/shop/orders`

Query: `scope=personal|shared` 필수, cursor 선택, limit 기본30/최대100.

```json
{"data":{"items":[{"id":"order-1","productId":"scarf","price":20,"currency":"fish","createdAt":"2026-09-11T09:00:00Z"}],"nextCursor":null}}
```

불변 주문 snapshot의 paid price/currency를 반환한다. 현재 가격표와 join하여 과거 금액을 바꾸지 않는다.
정렬 `(createdAt DESC,id DESC)`; 동시 INSERT/COMMIT의 짧은 경계로 이미 지난 cursor 뒤에 늦게 보이는 row는
최신 페이지 재조회로 복구하며 전체 DB snapshot을 보장한다고 쓰지 않는다. 공동 내역에 구매자의 원문 닉네임,
개인 지갑, 자격 토큰을 끼워 넣지 않는다. 신청/퀘스트 결과 이력은 이 endpoint의 대상이 아니다.

## 3. 논리 저장 모델 — 실제 migration 아님

|aggregate/논리행|필수 내용·제약|
|---|---|
|catalog product revision|productId+revision 유일, kind/ownerType/currency/price/requiredBuilding/requiredProduct/targetBuilding/mediaKey/displayOrder, 활성 revision 참조|
|economy wallet|ownerType+ownerId+currency 유일, balance>=0, version. user/fish 또는 island/village_points 조합만 허용|
|economy ledger|entryId, wallet FK, signedDelta, balanceAfter, 원인 order/settlement, 원인별 유일성, immutable|
|owned product|ownerType+ownerId+productId 유일, grantedOrderId/명시 지급 근거, grantedAt. user/island 실제FK무결성 확보|
|inventory aggregate|ownerType+ownerId 유일, 목록의 단조version; 개인과 섬 독립|
|order|orderId, requesterId, ownerType/ownerId, productId+productVersion, paidPrice/currency, walletVersionAfter, createdAt. 확정 주문 immutable|
|command receipt|검증사용자+정규 operation+key 유일, canonical request hash, 원status/result. 원문JWT·결제정보 금지|
|outbox|eventId와aggregate version, 대상범위, payload, 내구전달 상태. 동일 TX저장|

User/Group 소프트삭제와 실제FK를 만족하려면 polymorphic ownerId 하나의 선언만으로 FK 검증을 끝냈다고
주장하지 않는다. 개인/섬 소유 테이블 분리 또는 nullable userId/groupId + 정확히하나 CHECK와FK 중 구현 담당이
정본 schema에 맞춰 확정한다. Flyway 번호와 schema.dbml 변경은 조정자 소유다.

소유권 revocation/환불은 현재9계약에 없다. 이후 추가하더라도 소유 삭제 후 같은 주문키를 새구매로 재사용하거나
지갑 version을 되감지 않는다. 탈퇴는 기존 환불→증거보존→익명화→지갑/설정삭제→PII 순서에 새 자산을 합류시킨다.

## 4. 원자 주문 알고리즘

1. JWT/service caller 및 body형식 검증. 검증 subject, method+route template, islandId와body를 포함한 canonical intent로 receipt를 조회/직렬화한다.
2. 활성 caller와 결과공개자격을 확인한 뒤 확정 같은 요청이면 원receipt 재생. 다른hash면409, 처리중이면 공통 retry 규약.
3. **새 실행만** 사용자/current-island context, membership/역할, 시설 상태와 상품 활성 revision을 정본 TX 안에서 확인한다. 앱/BFF가 넘긴 cached permit 금지.
4. 공유 변경은 `SHARED_PURCHASE` 권한 제공자 결정이 있어야 한다. 미구현/미승인 권한 제공자를 true로 대체하지 않는다.
5. 해당 owner wallet 잠금, inventory aggregate 잠금을 정해진 순서로 획득한다. 현재 productVersion과 walletVersion 비교 후 owned unique 및 prerequisites 확인.
6. 잔액이 모자라면409 INSUFFICIENT_FUNDS, 어떤 row도 확정하지 않는다. 차감/ledger/order/owned/inventory version/receipt/outbox를 함께 기록한다.
7. DB commit 후만 응답/relay전달. 외부전달 실패로 committed order를 취소하지 않고 outbox 재전달한다. DB rollback이면 원장/보유/receipt/outbox모두없다.

공통 잠금 계열은 **활성 user → current-context/group/membership/시설 → product revision → wallet → inventory**다.
이것은 구현자가 타 도메인과 별도로 확정할 락순서가 아니다. 계정탈퇴·섬전환·집중보상·건설·공동테마가 실제로
사용하는 순서와 대조하고 공통순서에 합류한 뒤 코드화한다. 여러 user/group/wallet을 잡는 명령은 각 종류에서
정렬된 ID 순서로 잡는다. shared구매의 승인근거 역할을 읽은 뒤 host-transfer가 commit하는 틈도 같은 잠금으로 닫는다.

상품 revision행만 immutable이어도 활성 포인터가 바뀌면 oldrevision주문이 끼어들 수 있다. 새 구매는 활성 포인터를
읽고 commit까지 직렬화하거나 비교조건으로 새revision활성화와 순서를 보장한다. 카탈로그 publish도 이 규율을 따른다.
Data 두 endpoint로 debit→grant를 나누거나 Business 보상요청으로 rollback을 흉내 내지 않는다.

## 5. 이벤트와 수신자

같은 주문에서 wallet.updated와 inventory.updated 두 eventId를 만들고 receipt 재생 때 새로 만들지 않는다.
wallet aggregateVersion은 해당 지갑 version, inventory는 해당 owner 목록 version이다. payload.version과 봉투version 일치.

|종류|개인|공동|
|---|---|---|
|wallet.updated|islandId=null, ownerType=user, ownerId=subject, currency=fish|islandId=ownerId=경로섬, ownerType=island, currency=village_points|
|inventory.updated|islandId=null, ownerType=user, ownerId=subject, productId|islandId=ownerId=경로섬, ownerType=island, productId|
|audience/destination|검증owner 하나, `/user/queue/events`|현재섬 주민, `/topic/islands/{islandId}/events`|

원문 balance/잔액전체/주문상세는 payload에 없음. 재연결과 버전 gap은 GET으로 복구한다. 1754 계약의 정적
라우터 및 1755 골격만 있다고 사건전달이 구현됐다고 주장하지 않는다. 전체payloadvalidator/내구producer/수신인가
활성화가 구현 티켓1781의 선행 검증이다.

## 6. 구현 검증 표

|조건|필수 증거|
|---|---|
|같은키 동시2건 및 commit후응답유실|order/ledger/owned 각1건, receipt동일201, outbox각type1건|
|새키로 동일상품 재구매·다른주민 공동중복구매|소유유일성이 이중차감 방지, 실패TX원장없음|
|다른상품 동시 구매|버전충돌 또는 직렬화 결과, 음수잔액없음, balance=원장합|
|가격만 변경·wallet불변|expectedProductVersion 충돌, 새가격재확인 없이 차감없음|
|이미 성공한키 이후 가격/지갑변경|현재version검사앞에서 원결과재생|
|권한위조·경로다른섬·current섬전환경쟁|잘못된섬 포인트 사용없음, role상실뒤새명령403|
|판매/시설/선체선행 변경과 동시주문|커밋경계에서 정본검증, partiallygranted상태없음|
|wallet성공후owned/receipt/outbox 실패주입|전체rollback; DB유일성예외catch후같은깨진TX재사용금지|
|개인 이벤트/내역을 타인·다른섬이 요청|개인정보비노출, 401/403이null이나성공으로숨겨지지않음|
|catalog/order cursor변조·다른scope·만료·동률|공통400/409, 중복페이징루프없음|
|Data timeout·outbox지연|같은키로원결과복구, DBcommit재실행없음|

이 표는 실행 예정 검증이며 현재 통과 결과가 아니다. 이번 작업은 문서9계약/링크/도식 정합 검토만 수행한다.
