# 섬 상점 — 상세 계약

GROMO-1780 · 상태: 구조/와이어 설계, 제품 정책 미결 · [정책](policy.md) · [HLD](high-level-design.md)

## 1. 공통 와이어와 context

신규 API 성공은 `{data:...}`. 오류는 `{error:{code,message,field,retryable},requestId}`이고 현재 서버 생성
requestId를 헤더와 본문에 쓴다. **409에만** 선택 top-level `current:{version,resource}`를 추가할 수 있다. 이는 [공통1750 LLD §1](https://github.com/OneOrThree/phone/blob/doc/prd-api-platform/docs/prd/api-platform/low-level-design.md)의 기존 계약이다. version은 충돌한 자원 축, resource는 현재 인가된 공개 DTO이며 공개할 수 없으면 current 전체를 생략한다. error 내부나 data 내부에 current를 넣지 않는다.
UUID는 데이터 ID, ProductId는 카탈로그 문자열, 시각은 UTC instant다.
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
정렬 `(displayOrder ASC, productId ASC)`와 **컬렉션 단위 catalogPublicationVersion**을 cursor에 고정한다. 첫 페이지는 활성 publication을 한 번 읽고 이후 페이지는 동일 publication의 불변 entry를 조회한다. entry에 고정된 productRevision/category/displayOrder로 집합과 순서를 복원하며, 이후 활성화된 상품 revision을 페이지 중간에 끼워 넣지 않는다. 사용자·현재 섬·category·limit·마지막 정렬키도 cursor에 포함한다.

publication은 목록 정의의 snapshot이며 사용자 owned/available·현재 멤버십/시설의 고정 snapshot은 아니다. 이 동적 값은 매 요청 현재 권한 아래 계산하며 구매도 현재 상품 정의를 다시 확인한다. 단순 catalog 교체로 기존 cursor의 집합을 바꾸지 않는다. publication이 보존 만료·명시 폐기로 제공되지 않으면409 CURSOR_EXPIRED, 처음부터 다시 읽는다. 즉시 상품 비공개가 필요하면 영향을 받는 publication을 폐기해 옛 페이지 재생을 막으며 레코드를 일부 수정해 snapshot을 변조하지 않는다.

### 2.3 product — GET `/islands/{islandId}/shop/products/{productId}`

```json
{"data":{"id":"rain","kind":"audio","title":"오두막의 빗소리","price":30,"currency":"village_points","ownerType":"island","productVersion":5,"previewUrl":"https://media.gromo.example/rain-preview.wav","owned":false,"available":true,"blockedReason":null,"requiredBuilding":"gram"}}
```

previewUrl/blockedReason/requiredBuilding은 nullable.

**선행 상품 안내 확장(2026-09-12, PR742 리뷰 반영):** 상세 data에 선택 필드
`requiredProduct:{id:ProductId,title:string}|null`을 추가한다. 이는 기존 product GET의 구조화된 안내 필드이며
새 endpoint가 아니다. 위 원본 JSON 예시는 그대로 보존한다. 새 서버는 선행 상품이 없으면 null, 있으면
현재 판매 revision이 가리키는 실제 카탈로그 ID와 그 불변 자산 정의의 표시 이름을 반환한다.

응답 data에 추가되는 필드만 보인 예시(실제 ID·표시 이름은 승인 카탈로그 사용):

```json
{"requiredProduct":{"id":"sailboat","title":"돛단배"}}
```

`blockedReason`은 실패 사유 코드이므로 선행 상품 ID를 대신하지 않는다. 앱은 reason 문구를 파싱하거나
선실 배의 선행 ID를 하드코딩하지 않고 requiredProduct.id로 상세 조회를 연결한다. 이 필드는 선행 상품이
현재 판매 중이라는 보증은 아니다. 선행을 아직 소유하지 않았는데 퇴역하여 구매할 수 없다면 대상 상품도
available=false로 안내하고, 상세 이동의404는 판매 종료 상태로 처리한다. 이미 소유한 선행 상품은 판매 퇴역과
관계없이 보유 조건을 충족한다. 구매 TX는 안내를 신뢰하지 않고 실제 소유와 현재 판매 조건을 다시 검사한다.
 다른 시설용 building_theme은 대상 buildingId를 추가 반환한다.
previewUrl은 서버 등록 media 자산만 반환하고 사용자 URL을 받아 서버가 대신 가져오는 기능을 만들지 않는다.
미리듣기는 기기 로컬이며 shared playback을 변경하지 않는다. 비활성/삭제 상품은404 PRODUCT_NOT_FOUND 또는 이미 소유한
상품의 별도 표시 가능 여부를 catalog 생명주기 정책과 함께 정한다. 과거 주문 snapshot을 이404로 삭제하지 않는다.

### 2.4 buy — POST `/islands/{islandId}/shop/orders`

Headers: 유효 JWT, application/json, 필수 UUID `Idempotency-Key`.

```json
{"productId":"scarf","expectedWalletVersion":4,"expectedProductVersion":3}
```

`expectedProductVersion`은 **1780 상세 설계에서 추가 채택한 명시적 확장**이다(2026-09-12 조정자 동의).
원본의 두필드 body만으로는 wallet 변동없이 가격이 오를 때 동의를 확인할 수 없다. 상품 조회가 반환한
productVersion을 비교하고 stale이면409 VERSION_CONFLICT, field=expectedProductVersion으로 최신 공개 상품을
공통 top-level `current:{version:<최신 productVersion>,resource:<인가된 상품 상세 DTO>}`에 제공한다. 앱은 새 가격/조건을 사용자에게 다시 보여준 뒤 새 키로 요청한다. 서버가 가격을 임의로 받는
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

실패:401 UNAUTHORIZED,403 FORBIDDEN/FACILITY_LOCKED,404 PRODUCT_NOT_FOUND,409 VERSION_CONFLICT/STATE_CONFLICT/
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
|catalog asset definition|productId 유일. kind/ownerType/targetBuilding/선체 계보·착용 호환 의미는 productId 수명 동안 불변. 과거 소유의 해석 정본이며 판매 퇴역 후에도 유지|
|catalog product revision|productId+revision 유일, asset definition FK, currency/price/구매용 requiredBuilding/requiredProduct/preview mediaKey. 발행 후 불변. 소유 의미를 덮어쓰지 않음|
|catalog publication|catalogPublicationVersion 유일, publishedAt/retiredAt/invalidatedAt. 컬렉션 전체의 불변 발행본|
|catalog publication entry|publicationVersion+productId 유일, productRevision FK, category/displayOrder. 해당 발행본의 상품 집합/정렬을 복원|
|catalog active pointer|현재 publicationVersion 한 개를 참조. 상품별 현재 정의도 이 publication의 entry로 결정하며 별도 가변 상품 포인터와 이중 정본을 두지 않음|
|economy wallet|ownerType+ownerId+currency 유일, balance>=0, version. user/fish 또는 island/village_points 조합만 허용|
|economy ledger|entryId, wallet FK, signedDelta, balanceAfter, 원인 order/settlement, 원인별 유일성, immutable|
|owned product|ownerType+ownerId+productId 유일, 불변 asset definition FK, grantedOrderId/명시 지급 근거, grantedAt. 판매 활성 포인터와 무관하게 의미 복원, user/island 실제FK무결성 확보|
|inventory aggregate|ownerType+ownerId 유일, 목록의 단조version; 개인과 섬 독립|
|order|orderId, requesterId, ownerType/ownerId, productId+productVersion, paidPrice/currency, walletVersionAfter, createdAt. 확정 주문 immutable|
|command receipt|검증사용자+정규 operation+key 유일, canonical request hash, 원status/result. 원문JWT·결제정보 금지|
|outbox|eventId와aggregate version, 대상범위, payload, 내구전달 상태. 동일 TX저장|

User/Group 소프트삭제와 실제FK를 만족하려면 polymorphic ownerId 하나의 선언만으로 FK 검증을 끝냈다고
주장하지 않는다. 개인/섬 소유 테이블 분리 또는 nullable userId/groupId + 정확히하나 CHECK와FK 중 구현 담당이
정본 schema에 맞춰 확정한다. Flyway 번호와 schema.dbml 변경은 조정자 소유다.

### 보유 의미와 판매 revision 분리

이 설계는 **소유 행을 가변 판매 revision에 고정하는 대신 productId의 자산 의미를 불변으로 제한**한다.
kind·ownerType·targetBuilding·선체 계보·착용 호환 조건을 바꾸려면 새 productId를 발행한다.
기존 상품 ID를 재사용하여 옷을 음원으로, 개인 소유를 섬 소유로, hall 테마를 board 테마로 바꾸지 않는다.
미결 A02/A03 정책은 최초 상품 활성화 전에 확정하고 그 productId의 의미에 고정한다. 기존 보유 의미를
개정/승격하는 기능은 현재 계약에 없으며 향후 필요하면 별도 명시 이관 계약으로 다룬다.

가격·판매 선행 조건·판매 가능 여부는 새 판매 revision/publication에서 바뀔 수 있다. `requiredProduct`는
새 구매 시 검사하는 선행 조건이며 이미 보유한 상품의 사용권을 소급해서 바꾸지 않는다. 외양은 제출한 상품과
기존 착용품 모두 불변 자산 정의+실제 보유+현재 적용 권한/시설로 검사하고, 현재 판매 revision의 가격·판매 선행·
판매 활성 여부를 착용 조건으로 재검사하지 않는다. 따라서 다른 필드만 PATCH해도 퇴역한 기존 옷 때문에 실패하지 않는다.

D18의 expectedProductVersion 검사는 **허용된 판매 정의 변경에 대한 동의 보호**이지 ownerType 변경을
허가하는 정책이 아니다. 이 상세 모델은 ownerType을 productId 수명 동안 불변으로 더 좁게 제한한다.
현재 통화 조합도 user/fish·island/village_points뿐이므로 같은 productId의 통화를 다른 소유 지갑으로 바꾸는
revision은 발행 validation에서 거절한다. 가격만 변경해도 productVersion은 반드시 오른다.
향후 승인된 통화 확장이 생긴다면 소유 의미를 유지하는 허용 통화 변경에도 version 검사가 필요하며,
이 문서가 그 확장을 미리 활성화하지 않는다. 주문은 결제 당시 owner/currency/price/revision을 그대로 보존한다.

판매 퇴역은 신규 주문과 상품 상세 노출을 제어하며 소유권 회수·착용 해제·자산 정의 삭제를 뜻하지 않는다.
inventory GET, 외양 병합 검증, 재적용은 active publication에 없는 보유품도 불변 정의로 복원한다.
상품 상세의 보유자 별도 표시 정책이 미정이더라도 이 내부 소유 해석은 계속 가능해야 한다.

catalog publication 발행은 모든 product revision/entry를 준비한 뒤 Data 한 TX에서 활성 포인터를 교체한다. 상품 하나의 가격 변경도 새 product revision과 그 revision을 가리키는 새 publication으로 공개한다. 다른 상품만 바뀌면 해당 상품의 productVersion은 유지하며 collection version만 오른다. 주문의 expectedProductVersion은 product revision과 비교하고 collection version을 요구하지 않는다.

퇴역한 publication/entry와 참조 product revision은 공통 cursor 최대 유효기간(초기15분) 동안 제공한다. 정확한 보존 하한은 retiredAt + 최대 cursor 수명이며 continuation이 최초 cursor 만료시각을 연장하지 않는다. 즉시 폐기한 publication은 명시409로 끝낸다. 주문/소유가 참조하는 상품 revision은 cursor 만료만으로 삭제하지 않는다. 물리 보존/파기 작업은 별도 정책을 따르며 이 문서가 자동 GC를 활성화하지 않는다.

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

공통 잠금 계열은 **활성 user → current-context/group/membership/시설 → catalog 자산 정의/판매 publication·revision → wallet → inventory → appearance**다. 주문은 appearance를 변경하지 않으므로 마지막 축을 건너뛰며 외양은 wallet만 건너뛴다.
이것은 구현자가 타 도메인과 별도로 확정할 락순서가 아니다. 계정탈퇴·섬전환·집중보상·건설·공동테마가 실제로
사용하는 순서와 대조하고 공통순서에 합류한 뒤 코드화한다. 여러 user/group/wallet을 잡는 명령은 각 종류에서
정렬된 ID 순서로 잡는다. shared구매의 승인근거 역할을 읽은 뒤 host-transfer가 commit하는 틈도 같은 잠금으로 닫는다.

상품 revision행만 immutable이어도 catalog 활성 publication 포인터가 바뀌면 oldrevision주문이 끼어들 수 있다. 새 구매는 활성 publication 포인터를
읽고 commit까지 직렬화하거나 비교조건으로 새revision활성화와 순서를 보장한다. 카탈로그 publish도 이 규율을 따른다.
Data 두 endpoint로 debit→grant를 나누거나 Business 보상요청으로 rollback을 흉내 내지 않는다.

## 5. 이벤트와 수신자

같은 주문에서 wallet.updated와 inventory.updated 두 eventId를 만들고 receipt 재생 때 새로 만들지 않는다.
wallet aggregateVersion은 해당 지갑 version, inventory는 해당 owner 목록 version이다. payload.version과 aggregateVersion이 일치한다. 공통 봉투는 schemaVersion=1을 포함한 7필드이며 outbox·즉시 발행·재전달에 그대로 보존한다.

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
|기존 productId의 kind/ownerType/targetBuilding/착용 호환 변경 발행|catalog validation 거절. 다른 의미에는 새 productId 필요|
|소유 상품 가격개정·퇴역 후 inventory/재착용·다른 슬롯PATCH|기존 소유 의미와 착용 유지, 현재 판매 revision 때문에403/404/422 발생하지 않음|
|선행 상품 requiredProduct 안내·선행 판매퇴역|구조화된 실제 ID/표시 이름 반환, 이미 보유한 선행은 인정, 미보유·구매불가이면 대상 available=false|
|이미 성공한키 이후 가격/지갑변경|현재version검사앞에서 원결과재생|
|권한위조·경로다른섬·current섬전환경쟁|잘못된섬 포인트 사용없음, role상실뒤새명령403|
|판매/시설/선체선행 변경과 동시주문|커밋경계에서 정본검증, partiallygranted상태없음|
|wallet성공후owned/receipt/outbox 실패주입|전체rollback; DB유일성예외catch후같은깨진TX재사용금지|
|개인 이벤트/내역을 타인·다른섬이 요청|개인정보비노출, 401/403이null이나성공으로숨겨지지않음|
|catalog/order cursor변조·다른scope·만료·동률|공통400/409, 중복페이징루프없음|
|catalog 페이지 사이 상품 추가/삭제/가격/displayOrder 개정|원 publication entry로 중복/누락 없이 탐색; 현재 구매는 새 productVersion 검사|
|publication 퇴역/폐기·cursor 수명 경계|보존 기간 조회 또는 명시 CURSOR_EXPIRED, 최신 publication으로 조용히 갈아타지 않음|
|Data timeout·outbox지연|같은키로원결과복구, DBcommit재실행없음|

이 표는 실행 예정 검증이며 현재 통과 결과가 아니다. 이번 작업은 문서9계약/링크/도식 정합 검토만 수행한다.
