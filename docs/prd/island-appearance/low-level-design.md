# 보유품·외양 — 상세 계약

GROMO-1782 · [정책](policy.md) · [HLD](high-level-design.md)

## 1. 네 계약과 공통 타입

공통 1750의 신규 JSON 봉투·인증·현재 requestId·UUID Idempotency-Key를 사용한다. 원본의 `/v1`은 사용자 결정으로
제거했다. ProductId/ThemeId/BuildingId는 승인된 catalog 문자열, UUID는 실제 user/island 식별자다. 버전은 Data의 단조 정수이며,
공개 범위는 0~9007199254740991이다. 이벤트 version은 변경 후 1 이상이다. 개인과 공동 ownership/appearance를 구분한다.

409의 선택 top-level `current`는 [공통1750 LLD §1](https://github.com/OneOrThree/phone/blob/doc/prd-api-platform/docs/prd/api-platform/low-level-design.md)의 `{version,resource}` 계약을 사용한다. 공동 외양 충돌에서는 version이 해당 appearance.version이고 resource가 인가된 최신 전체 외양 DTO다. error/data 안에 넣지 않으며 공개 자격이 없으면 current를 생략한다. 새 외양 전용 오류 봉투를 만들지 않는다.

### 1.1 inventory — GET `/me/inventory`

현재 섬 선택 없이 본인 인증으로 조회한다. Data의 한 읽기 snapshot에서 소유 목록과 착용 상태를 함께 반환한다.

```json
{"data":{"clothes":["scarf"],"decor":["flag"],"hulls":["raft","sailboat"],"inventoryVersion":2,"equipped":{"clothes":"scarf","decor":"flag","hull":"sailboat","position":"front","version":4}}}
```

배열은 항상 존재하며, 보유품이 없으면 빈 배열로 표현한다. raft는 기본 외양이며 유료품 무상 지급이나 기존 자산 승계를 뜻하지 않는다.
inventoryVersion과 equipped.version은 원본에 없던 **복구용 명시 확장**이다. 1754의 목록 무효화와 전체 외양 이벤트를
각각 비교하려면 같은 조회에도 두 version 축이 필요하다. 배열은 ProductId 오름차순으로 정렬한다.
소유품 수의 상한과 페이지 필요성은 카탈로그 규모 검증에서 정한다. 원본의 단일 배열을 임의 cursor API로 늘리지 않는다.

### 1.2 equip — PATCH `/me/appearance`

Headers: JWT, application/json, Idempotency-Key 필수. 최소한 하나의 외양 필드가 필요하다.

```json
{"clothes":"scarf","decor":"flag","hull":"sailboat","position":"front"}
```

|필드|생략|null|값검증|
|---|---|---|---|
|clothes|현재 값 유지|해제|본인 소유+kind=clothes|
|decor|현재 값 유지|해제|본인 소유+kind=decor|
|hull|현재 값 유지|422|raft 또는본인 소유+kind=hull+승인된 재착용/호환 규칙|
|position|현재 값 유지|422|front/back만 허용|

#### PATCH 존재 여부와 멱등 지문

개인·공동 PATCH 모두 필드마다 `Absent`, `ExplicitNull`, `Value<T>`의 세 상태를 보존한다. 일반 nullable 필드 하나로 이 세 상태를 표현하지 않는다. Business는 원 JSON 객체의 `has(field)`와 `isNull()`을 구분해 읽고, 허용 필드·타입을 검사한 뒤 다음 내부 전달 계약으로 변환한다.

```json
{"fields":["clothes","decor"],"values":{"clothes":"scarf","decor":null}}
```

- fields는 **실제로 제출한** 최상위 외양 필드의 중복 없는 목록이며 values의 key 집합과 정확히 같아야 한다. 위 요청은 clothes 변경과 decor 해제이며 hull/position은 유지다. fields에 없는 값을 values에 넣거나 fields에 있으나 값을 누락한 내부 요청은400 INVALID_REQUEST다.
- Business→Data 재직렬화에서 명시 null을 제외하지 않는다. Data도 fields/values를 검사해 동일한 tri-state로 복원한다. JSON 필드 순서는 의미가 없지만 제출 여부는 의미다. 공동 expectedVersion은 별도 필수 명령 값으로 함께 전달하며 외양 field mask에 넣지 않는다.
- buildingThemes가 제출되면 내부 객체에 실제 존재하는 BuildingId key만 부분 패치한다. 없는 key를 null/default로 채우지 않고 null 맵·null value는 앞서 정한422 규약으로 거절한다. 명시한 `default` 문자열만 해제다.
- fingerprint는 내부 carrier 구조 자체가 아니라 mask와 values에서 복원한 **검증된 공개 의미 객체**로 계산한다. Absent는 key를 생략하고 ExplicitNull은 key:null로 포함한다. `{"clothes":"scarf"}`와 `{"clothes":"scarf","decor":null}`은 다른 지문이므로 같은 키로 보내면409다. 객체 key 정렬·숫자 정규화·배열 순서 보존은 공통 규칙을 사용한다. 현재 외양을 먼저 병합한 전체 상태로 지문을 만들지 않는다.
- 신규 실행에서만 잠금 후 현재 상태에 제출 필드를 병합한다. 재생은 원 mask/values/expectedVersion의 의미 지문을 대조하고 현재 version 검사보다 먼저 원 결과를 복구한다. 이 carrier는 외부 PATCH body를 변경하지 않는 내부 기술 계약이다.

200 응답은 반영 후 전체 상태다. 사용자 생성 버전이나 개인 expectedVersion을 받지 않는다. 원본에 없는 필드를 자동으로 필수화하지 않는다.

```json
{"data":{"clothes":"scarf","decor":"flag","hull":"sailboat","position":"front","version":5}}
```

모든 필드를 검증한 후 하나의 TX로 반영한다. hull이 바뀌어 현재 decor가 호환되지 않는다면 승인된 호환 정책에 따라 거절하거나
명시된 자동 해제 정책을 써야 한다. **현재 승인되지 않은 자동 해제를 구현하지 않는다.** 원본 소품 위치 규칙은 front/back일 뿐
선체별 좌표·애니메이션은 앱 자산이 담당한다. decor=null일 때도 position이 생략되면 기존 값을 유지한다(A04).

같은 key/본문은 원 응답 전체와 version을 재생하고, 다른 본문은 409 IDEMPOTENCY_KEY_REUSED로 거절한다. 서버 직렬화 뒤 동일 효과인 새 요청은
200 현재 상태와 receipt만 확정하고 추가 사건을 만들지 않는다. 미보유는 403 FORBIDDEN, 잘못된 종류/배치는 422 OUT_OF_RANGE,
미등록 상품은 404 PRODUCT_NOT_FOUND, 미확정 활성화는 503 SERVICE_UNAVAILABLE를 사용한다. 내부 예외를 원문 문구로 전달하지 않는다.

### 1.3 shared-inventory — GET `/islands/{islandId}/inventory`

활성 주민만 해당 섬 공동 소유를 조회한다. 현재 선택 섬이 없는 본인 inventory와 구별한다. 방송기 목록 등 실제 화면 usecase는
확정된 current-island context를 경로로 전달한다. 다른 소속 섬을 조회했다고 현재 섬을 암묵적으로 바꾸지 않는다.

```json
{"data":{"audio":["waves","campfire","forest-wind"],"islandThemes":["soda-theme"],"buildingThemes":[{"buildingId":"hall","themeId":"strawberry-roof"}],"inventoryVersion":3,"appearance":{"islandThemeId":"default","buildingThemes":{"hall":"default"},"version":4}}}
```

기본 3곡은 형태 예시이며 초기 무료 grant 정책이 아니다. 보유하지 않으면 빈 배열이다. appearance 추가는 **expectedVersion을
정확한 자원에서 얻는 복구용 명시 확장**이다. 공동 inventory GET과 island 일반 DTO의 다른 version을 혼동하지 않게 한다.
Data의 같은 snapshot에서 owned/appearance/version을 함께 읽는다. 외양 없는 신규 섬의 초기 default 맵은 시설 모델 정본과 맞춘다.
시설이 없다고 본인/섬 소유권을 삭제하지 않는다. 미해금 음원 재생 권한은 별도 playback 검사이며 소유 조회와 같지 않다.

### 1.4 theme — PATCH `/islands/{islandId}/appearance`

Headers: JWT/application/json/Idempotency-Key 필수. expectedVersion과 최소 한 개의 외양 필드가 필요하다.

```json
{"islandThemeId":"soda-theme","buildingThemes":{"hall":"strawberry-roof"},"expectedVersion":4}
```

islandThemeId 생략은 유지, default는 해제, null은 422다. buildingThemes 생략 및 객체 내 미전달 건물은 유지하고, 각 value를 default로 보내 해제한다.
null 맵/null value는 422이며 전체 삭제로 해석하지 않는다. 빈 맵만 보낸 요청은 실제 외양 변경 필드가 없으므로 400이다.
미등록 건물 키/종류 불일치 테마는 422다. buildingThemes의 각 항목에서 catalog.targetBuilding이 해당 맵 키의 BuildingId와 일치하는지 검증한다. 예를 들어 hall에는 hall 전용, board에는 board 전용 테마만 적용하며 예시인 hall을 모든 항목에 강제하지 않는다.
미완공 건물 적용 허용은 원본에 정책이 없으므로 시설 담당과 명시적으로 정의하기 전까지 비활성 gate를 유지한다.

```json
{"data":{"islandThemeId":"soda-theme","buildingThemes":{"hall":"strawberry-roof"},"version":5}}
```

200 응답은 전체 상태다. expectedVersion은 이 appearance.version이며 walletVersion/island 정보 version이 아니다.
신규 실행은 Data에서 current-island context와 활성 membership/SHARED_APPEARANCE 권한/시설/보유를 검증한다.
버전 충돌은 409 VERSION_CONFLICT(field=expectedVersion, current={version:최신 appearance.version,resource:인가된 최신 전체 외양})이며, 사용자가 최신 상태를 보고 새 키로 재확정한다.
같은 key의 확정 성공은 현재 version 검사 전에 원 결과를 재생한다. 현재 응답 공개 인가 실패를 receipt로 우회하지 않는다.

## 2. 논리 모델과 원자 변경

|논리aggregate|필드/제약|
|---|---|
|personal appearance|userId유일/FK,clothes nullable/decor nullable/hull/position/version.같은user전체외양단위|
|island appearance|groupId유일/FK,islandThemeId,buildingThemes또는정규화child rows,version.전체결과단위|
|owned product + inventory aggregate|상점정본재사용.새로운보유판정캐시/중복테이블을외양담당이만들지않음|
|catalog|kind/ownerType/targetBuilding/선체계보/호환revision.의미없는문자열prefix로종류판정금지|
|receipt/outbox|공통내구명령/사건정본.개인또는섬외양변경과같은TX|

정규화한building child rows를개별수정하더라도부모appearance.version을같은TX에서단조증가시켜전체스냅샷의
일관성을유지한다. parentversion만먼저올리거나child변경을별도TX로보내지않는다.개인appearance는소유자user,
공동appearance는섬소유이며작성자계정FK로소유를대체하지않는다.

처리순서:

1. 인증·형식검증 → receipt동일의도결과복구. 새실행일때만아래변경검증.
2. 활성user및해당context/멤버십/역할/시설을같은TX의공통생명주기잠금으로검증.
3. catalog 활성 publication/상품 revision → inventory → appearance 순서로 잠금을 획득하고, 존재 mask로 복원한 제출 필드만 현재 상태에 병합.
4. 병합된전체상태의owner/kind/선행/호환을검증.한필드라도실패하면전체rollback.
5. 변경있으면appearanceversion증가+정본저장+전체상태outbox생성.변경없으면사건생략.
6. 같은TXreceipt저장후COMMIT.추가WebSocket전달실패는outbox재전달,rollback된사건발행금지.

공통 잠금 순서는 계정/섬 생명주기 → catalog 활성 publication/상품 revision → wallet → inventory → appearance다. 외양은 wallet을 사용하지 않으므로 해당 축만 건너뛰어 catalog → inventory → appearance 순서를 유지한다. 상점·탈퇴·강퇴·방장이양·시설변경과
같은primitive를사용하도록구현전합의한다.권한확인후역할이변경된stale허가가commit되는틈을남기지않는다.
실제Migration번호/물리schema는구현담당과조정자소유이며이문서에서번호를배정하지않는다.

## 3. 사건·전체상태·재연결

|event|aggregateVersion|payload|audience|
|---|---|---|---|
|member.appearance.updated|user전체appearanceversion|userId,appearance:{clothes,decor,hull,position},version|표시권한이있는각섬주민|
|island.appearance.updated|섬appearanceversion|islandThemeId,buildingThemes,version|해당섬주민|

1754의 schemaVersion=1을 포함한 7필드 봉투를 사용하며 payload.version=aggregateVersion이다. 두 외양 사건의 outbox 저장·즉시 발행·재전달에도 최초 schemaVersion과 완성된 봉투를 보존한다. 개인외양은개인자산잔액/보유목록과달리주민에게
보이는전체착용상태만전달한다.공동외양은PATCH본문의부분맵이아니라반영된전체맵이다.

개인외양을여러섬으로발행하면대상별eventId/envelope.islandId를갖고같은userappearanceversion을유지한다.
지연된과거가입이벤트로이미권한이없는섬에전달하지않도록현재membership/수신자권한을최종검사한다.
가입/탈퇴가동시에일어나놓친표시는도메인snapshot과새로고침으로복구한다.지연된event만으로새주민을만들지않는다.

서버원자성은Postgrescommit까지다.서로다른디바이스의TCP전달순서까지원자라고하지않는다.앱은같은aggregate의
더높은version만전체상태에적용한다.개인외양과섬외양의version을서로비교하지않는다.소켓재연결/앱foreground는
GET inventory 또는해당화면snapshot을읽고버전기준을다시설치한다.

## 4. 검증 계획

|시나리오|기대증거|
|---|---|
|타인옷·다른섬테마·음원을옷slot에적용|403/422,appearance/receipt/outbox 변경없음|
|다른건물전용테마를hall에적용|422,부분맵도저장되지않음|
|clothes만PATCH,decor=null,hull=null,position허용범위|생략보존/해제/null거절/허용값정확분기|
|Business 파싱→내부 mask/values JSON→Data 파싱 왕복|Absent/ExplicitNull/Value 보존, 임의 null 채우기/삭제 없음|
|같은 key의 decor 생략 vs decor:null·공동 건물 맵 부분 입력|서로 다른 지문409, 미제출 외양/건물 보존|
|구매·개인/공동 외양·소유 회수 writer 경합|공통 잠금 순서 준수, inventory/appearance 역순 대기 없음|
|서로다른필드동시PATCH|행잠금뒤병합,상대필드유실없음|
|동일필드동시PATCH|서버직렬화최종상태·단조version,두receipt는각원결과|
|공동외양동시expectedVersion동일|한변경성공·다른409,최신current재조회|
|같은key응답유실후version전진|원결과재생,이벤트추가발행없음|
|신규key로같은효과|200,불필요version/event증가없음|
|회원탈퇴/강퇴/방장이양과적용경합|유령착용/권한상실후신규공동변경없음|
|구매와동시착용|commit되지않은소유로착용불가;승인된구매직후재시도성공|
|개인외양여러섬전달/철회/재연결|같은외양version,대상별eventId,권한없는수신차단|
|하위 선체 재착용·decor 호환·해제 위치|A02/A03 결정 후 각 분기 검증. A04는 일반 PATCH 생략/유지 회귀 검사|

이번문서작업은빌드/DB테스트를실행하지않았다.개인기존자산승계와공동권한이확정될때까지구현활성화보류다.
