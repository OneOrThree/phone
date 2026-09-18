# 보유품·외양 — 정책 정본과 미결 항목

GROMO-1782 · [PRD](prd.md) · [LLD](low-level-design.md)

## 확정된 표현과 소유

|슬롯/상품|소유자|적용 경로|표현|
|---|---|---|---|
|옷 clothes|본인 user|PATCH `/me/appearance`|ProductId 또는 null해제|
|배 소품 decor|본인 user|같음|ProductId 또는 null해제|
|선체 hull|본인 user / 기본 raft 표현|같음|`raft` 고정, null불가. ~~또는 보유 ProductId~~ — 배 종류 폐지(2026-09-16 B23·B25, GROMO-1851 「배 업그레이드 없음」)로 유료 선체 상품이 없다|
|소품 위치 position|본인 외양 상태|같음|front 또는 back, 좌표아님|
|섬 테마|경로 island|PATCH `/islands/{islandId}/appearance`|islandThemeId, default해제|
|건물 테마|경로 island|같음|buildingThemes의 BuildingId→ThemeId, default해제|
|공용 음원|경로 island|공용 playback의 별도변경|이 네 계약은 조회만, 재생을 수행하지 않음|

PATCH에서 미전달 키는 유지한다. 개인 null해제와 공동문자열 default해제는 원본의 구별을 유지한다. [LLD의 tri-state 전달 계약](low-level-design.md#patch-존재-여부와-멱등-지문)에 따라 Business/Data 사이에도 존재 mask와 values를 보존하며 fingerprint에서 생략과 명시 null을 합치지 않는다.
공동 buildingThemes는 전달한 건물만 바꾸며 생략한 건물을 default로 덮어쓰지 않는다.

## 선체 — 배 종류 폐지

~~뗏목 raft → 돛단배 sailboat → 선실 배~~ 계보와 그 위의 재착용 질문(A02)은 **2026-09-16 재영님 결정 B23 「배 종류 제거」·B25(`raft` 화면명)와
GROMO-1851 「모든 사용자가 같은 기본 뗏목을 쓴다(배 업그레이드 없음)」로 폐지**됐다 — [결정 로그](../decision-log.md).
선체는 기본 뗏목 `raft` 하나다. 유료 선체 상품·선행 구매·하위 재착용·선체별 호환이라는 질문 자체가 없다.
`hull` 슬롯의 wire 필드를 남길지 없앨지는 LLD 개정(구현 담당)에서 정하며, 이 문서는 기존 `raft` 고정 표현만 유지한다.

### 확정 (GROMO-1909, 2026-09-17)

|ID|항목|**결정된 값**|근거|
|---|---|---|---|
|A01|공동 테마 적용 권한|**방장만**|가장 좁게 열고 필요하면 넓힌다 — 넓히는 것은 언제든 되지만 좁히면 이미 쓰던 주민이 권한을 잃는다. 「정보 수정 = 방장만」과 같은 결이고, 공용 곡 변경(주민 허용)과는 성격이 다르다: 곡은 되돌리기 쉽지만 테마는 섬 전체 외형을 바꾼다|
|A03|선체별 소품 호환|**모든 선체 공통**(이어진 배 종류 폐지로 대상 소멸 — 선체가 `raft` 하나)|호환표 자체가 불필요해진다. 「미승인 호환표」의 소유 문서가 레포 어디에도 지정돼 있지 않았고, 아이템 마스터 데이터도 레포에 없어(마이그레이션 INSERT 0건·시드 없음·하드코딩 없음) 표를 만들 재료가 없다|
|A05|기존 캐릭터 자산 승계|**새 모델 분리 — 승계하지 않는다**|1.x 는 슬롯(HAIR/TOP/BOTTOM/SHOES) 기반, 2.0 은 종(cat/dog/parrot) + 선체·의상·소품 기반으로 모델이 근본적으로 다르다. 매핑할 목록 자체가 코드에 없고, 구매 이력 테이블도 없어(`currency_transactions` 에 `item_id` 컬럼 없음) 「무엇을 샀는지」가 남아 있지 않다|

A01 은 **[섬 관리 권한 행렬](../island-management/permissions.md)의 「공동 테마 적용」 행**에 같은 값으로 적힌다.
두 문서가 서로 다른 값을 갖지 않는다.

A05 의 결정 범위는 **승계 여부**다. 기존 `items`·`user_items`·`character_equipment` 와 그것을 쓰는
레거시 API 를 지우자는 뜻이 아니다 — 그 폐기는 `docs/engineering/legacy-v1-retirement/` 가 받는다.

### 해소

|ID|항목|처리|근거|
|---|---|---|---|
|A02|~~상위선체 구매 뒤 하위선체 재착용~~|**대상 소멸** — 배 종류 폐지로 선체가 `raft` 하나. `PATCH /me/appearance` 의 hull 재착용 분기 활성화 보류도 함께 소멸|2026-09-16 B23·B25, GROMO-1851 「배 업그레이드 없음」|

이 문서의 미결 항목은 없다.

A04 는 처음부터 제품 질문이 아니었다 — 앞의 PATCH 생략 의미론을 적용한 기술 규칙이라 결정 대상에서 뺀다.
decor 해제를 position 초기화로 확대하지 않는다. `decor=null` 이어도 `position` 을 보내지 않았으면 유지한다.

공동 구매 권한과 공동 테마 적용 권한, 공용 곡 재생 권한은 별개다. 원본의 주민 공용음악 조작 허용을 공동소비나
테마변경 허용으로 확대하지 않는다. 방문자는 모든 mutation을 거절한다. **공동 구매 권한(섬 관리 문서의
「공동 상품 구매」 행)은 2026-09-18 재영님 결정 D2 로 별도 확정됐다 — 섬 설정(방장 토글), 판정 이름 `SHARED_PURCHASE`.**
A01(방장만, `SHARED_APPEARANCE`)과 값이 다르므로 두 권한을 합치지 않는다는 위 문장이 그대로 유효하다.

## 기술 결정

개인 변경은 외양행 잠금 아래 **제출된 필드만** 병합하고 현재 전체상태를 검증한다. 개인 expectedVersion을
새로 요구하지 않으므로 같은 슬롯의 동시선택은 서버 직렬화 순서의 마지막 변경이 된다. 서로 다른필드 patch는
상대변경을 지우지 않는다. stale전체객체를 자동재전송하지 않으며 네트워크재시도는같은key/본문으로만 한다.

외양버전은 실제변경이 확정될 때 단조증가한다. 같은 효과의 새 요청은200 최신상태와receipt만 만들고 불필요한
version/event를 발행하지 않는 기술안을 채택한다. Data는 전체 외양 data와 대상별 완성 사건 events를 같은 receipt에 저장·반환하며 Business는 공개 data만 앱에 반환한다. 재생은 원 봉투를 재사용하고 새 사건을 만들지 않는다. 소유목록과 외양의 version은 분리한다.
시설 완공으로 전체 buildingThemes의 건물 집합이 바뀌는 경우도 외양 변경이다. 시설 producer가 같은 TX에서
공동 appearance.version을 올리고 전체 맵의 island.appearance.updated outbox를 저장한다. 현재 미지원인 철거
기능을 추가하지 않으며 향후 승인된 writer에도 이 전체 상태 불변식을 적용한다.

보유품의 kind/ownerType/targetBuilding 은 productId 수명 동안 불변이다(선체계보·착용호환은 배 종류 폐지로 대상 소멸). 판매 가격 개정·퇴역은
기존 소유·착용 의미를 바꾸지 않는다. 외양 검증은 현재 판매 revision/구매 prerequisite가 아닌 불변 자산 정의와
실제 보유·현재 적용 권한/시설을 사용한다. [상점의 분리 규칙](../island-shop/low-level-design.md#보유-의미와-판매-revision-분리)을 함께 따른다.

개인 inventory의 hulls는 배 종류 폐지 뒤 항상 `[raft]` 다(유료 선체 상품이 없다). clothes/decor의 미보유는 []다. raft는 소유/지급 행을 만들지 않는 예약 표현이다. 원본 예시의 `sailboat` 는 폐지 전 형태이며 신규 무상 지급 정책을 뜻하지 않는다.

기본표현 default/raft는 판매상품ID와 충돌하지 않는 예약키로 취급한다. 소유가 없는 유료상품을 default라는 이유로
허용하지 않는다. 미등록 catalog 상품 키는404 PRODUCT_NOT_FOUND, 등록됐지만 종류/대상시설이 다르면422, 보유권한이없으면403이다.
