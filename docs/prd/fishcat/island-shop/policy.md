# 섬 상점 — 정책과 결정 대기표

GROMO-1780 · [PRD](prd.md) · [LLD](low-level-design.md)

## 원본과 사용자 결정으로 고정된 범위

|항목|기준|출처|
|---|---|---|
|재화 표시|**섬 물고기(섬 통장) 한 종류뿐이다.** ~~개인 물고기(개인 지갑)와 섬 물고기 두 종류~~ 는 2026-09-21 재화-단일로 폐기 — 개인 물고기 지갑을 두지 않는다. 종전 「마을 포인트」가 섬 물고기다. ~~초기 건설 기여는 별도 표시 잔액이 아님~~ → 초기 건설도 섬 통장 잔액으로 짓는다(건설 D4·D6)|원본 wallet + **2026-09-21 재영님 결정 재화-단일**(~~2026-09-18 D1~~ 대체). 기획 정본 「재화는 물고기 하나이며 섬 소유다」|
|소유/결제|**결제 지갑은 섬 통장(서버 통화 식별자 `village_points` = 섬 물고기) 하나**이고 개인 상품도 여기서 뺀다. 물건 주인(ownerType)은 개인·섬 둘 다 남는다 — 재화 축과 소유 축은 다르다|SH-재화 + **재화-단일**. 식별자 개명은 결정에 없어 wire 는 그대로|
|상품 범위|clothes/decor는 개인, island_theme/building_theme/audio는 공동. ~~hull~~ 은 배 종류 폐지로 판매 상품이 아니다|원본 catalog/shared-inventory · 2026-09-16 B23·B25, GROMO-1851|
|구매 수량|현재 모든 상품은 1회 소유형, quantity/임의 가격 미지원|원본 buy|
|~~선체 선행~~|~~뗏목→돛단배→선실 배, 선실 배는 돛단배 보유 필요~~ → **폐지.** 배 종류가 없으므로 선체 계보·선행 구매가 없다|2026-09-16 재영님 B23 「배 종류 제거」·B25 `raft`, GROMO-1851 「배 업그레이드 없음」|
|음원 선행|방송기 `gram` 해금 뒤 ASMR 구매, 미리듣기는 내 기기에서만|원본 catalog/product|
|구매와 적용|구매가 개인 착용·공동테마·공용재생을 자동 수행하지 않음|원본 product|
|신규 경로|Business 외부 경로 접두어 없음, 기존 `/api/v1` 변경 없음|사용자 명시 결정|
|가격 변경 동의|productVersion/expectedProductVersion 을 상점 상세 설계의 명시 확장으로 채택 — [LLD §2.4](low-level-design.md)|2026-09-12 조정자 동의(구 S05 — 미결표에서 여기로 옮김)|

`island_theme`, `building_theme`, `hull` 등 카탈로그 kind 문자열은 원본 종류를 표현하는 상세 설계값이다.
기존 ItemType/SlotType 값과 동일하다고 간주하지 않는다. 실제 catalog ID는 승인된 자산 카탈로그가 정한다.

## 경제 소유 행렬

|상품/행동|ownerType/ownerId|currency|요청자 조건|원자 효과|이벤트 수신|
|---|---|---|---|---|---|
|옷·소품 구매(선체 상품 없음 — 배 종류 폐지)|user/검증 subject|village_points(섬 물고기)|활성 본인(게스트 제외, GROMO-1999/2000) + 상점 접근 가능한 현재 섬|**섬 통장** 차감 + 개인 소유 추가|본인|
|섬·건물 테마·음원 구매|island/대상 섬|village_points(섬 물고기)|활성 주민(`SHARED_PURCHASE` = 주민 누구나, 구매는 게스트 제외 — GROMO-2000) + 시설|섬 통장 차감 + 섬 소유 추가|해당 섬 주민|
|내역 personal|user/검증 subject|village_points(섬 물고기)|활성 본인 + 경로 context 접근|조회만|발행 없음|
|내역 shared|island/대상 섬|village_points(섬 물고기)|현재 섬 활성 주민|조회만|발행 없음|

**2026-09-19 SH-재화 + 2026-09-21 재화-단일:** 재화는 섬 단위 하나뿐이고 **개인 물고기 지갑은 없다** — 상점은 개인
상품(옷·소품)도 섬 통장(`village_points`)에서 차감한다. 위 표의 `currency` 는 전부 `village_points` 이며
V74 `shop_product_revisions_currency_check`·`shop_orders_currency_check` 가 그 값만 허용한다(`fish` 통화 상품·주문은
존재할 수 없다). **물건 주인(ownerType)은 개인·섬 둘 다 그대로다** — 기획 정본 「개인 의상·장신구는 구매한 주민의
보유품이며 탈퇴해도 유지한다」. 재화가 섬 단위라는 사실이 소유권까지 섬 단위로 만들지 않는다. 구매 내역은 섬 귀속(SH-BG18).
개인 지갑 표(`user_fish_wallets`)는 남아 있으나 **상점은 읽지도 쓰지도 않고**, `personal_share_percent` 를 올려 개인
적립을 켜는 경로는 두지 않는다(결정 개인적립-차단 — 조정 주체 없음·정기 재검토 없음, 켜려면 결정 로그에 새 행이 먼저다).

방장이 공동 상품을 구매해도 물건 주인은 방장 계정이 아니다. 위임/퇴장으로 공동 자산을 개인에게 옮기지
않는다. 섬 종료 시 공동 자산 정리와 회원 탈퇴 시 개인 이력 보존/익명화는 해당 생명주기 정책과 함께 결정한다.

## 미결 정책 — 구현자가 대신 확정하지 않는다

|ID|결정 필요|현재 근거|결정 전 동작/작업|
|---|---|---|---|
|S01|**확정.** 보유품 승계 없음(GROMO-1909 A05, 새 모델 분리) + **기존 코인 잔액 이관 안 함(2026-09-18 재영님 결정 D11)** — 같은 결|기존 모델과 새 모델의 소유·슬롯이 다름. 보유품은 매핑할 목록 자체가 코드에 없고 구매 이력 테이블도 없다|보유품 매핑·잔액 이관 설계를 만들지 않는다. **양쪽 다 기존 데이터 삭제 금지** — 레거시 폐기는 `docs/engineering/legacy-v1-retirement/` 몫|
|S02|~~공동 구매 권한: 방장만/주민 허용/설정 가능 중 어느 정책인지~~ → **확정(GROMO-2000)**: 공동 구매(상점 상품·축음기 음원)는 **활성 주민 누구나**다 — 기획 정본 「주민 누구나 섬 물고기로 상점 상품·축음기 음원을 구매할 수 있다」. 권한 이름 `SHARED_PURCHASE` 유지|~~2026-09-18 D2 의 섬 설정 토글~~ 폐기 — 토글 기본값·설정 API 잔여도 함께 소멸. [권한 행렬](../island-management/permissions.md)·건설 C13 과 같은 값이되, **건설만 방장으로 갈렸다**|게스트 축은 **여기서 함께 본다** — `SharedPurchase.canSpend` 가 `User.isGuest` 를 읽어 목록 사유(FORBIDDEN)와 구매 거절이 같은 값이 되게 한다. GROMO-1992 의 컨트롤러 가드는 「명령 거절」이라 층이 다르다|
|S03|**미결 — 판매 활성화를 막는다.** 가격·보상표를 운영값으로 채택할지. 테이블은 선구축(2026-09-19 SH-테이블, V74) — 가격 행 없음·`price` NULL = 구매 불가|원본 가격·보상 대부분 목업(건설비·집중/퀘스트 보상은 1829·1830 으로 확정됐고 **상품 가격만** 남았다)|approved/effective 설정 없으면 구매 비활성. 0원으로 간주하지 않음. **2026-09-19 N24·N25 구현 상태**: 다섯 계약은 구현됐고 가격 NULL 은 목록 `available=false`·`reason=STATE_CONFLICT`, 구매 409 `STATE_CONFLICT` 다. 활성 발행본이 없으면 목록은 빈 배열(오류 아님), 상세·구매는 404 `PRODUCT_NOT_FOUND`|
|S04|**미결 — 판매 활성화를 막는다.** 기본3곡 무료지급 및 초기 뗏목/자산 제공 방식. V74 는 지급·시드 행을 만들지 않는다|waves/campfire/forest-wind는 목업 구성|미승인 곡 자동 grant 금지. 기본 raft 렌더/착용과 판매상품 지급은 구분|
|S06|~~하위 재착용(A02)~~ → **대상 소멸.** 배 종류 폐지(2026-09-16 B23·B25, GROMO-1851)로 선체가 `raft` 하나라 재착용·호환 질문이 없다. 1909 A03(모든 선체 공통)도 대상 소멸|외양 policy A02 와 같은 처리|미결 없음. 호환 조건·재착용 규칙을 상품 정의에 넣지 않는다|

S05(가격 변경 동의)는 2026-09-12 에 채택돼 위 「고정된 범위」 표로 옮겼다. 남은 빈칸(S03·S04)을 "가격0"으로 채우지 않는다. 운영 활성화는 사용자 정책 승인,
서버 catalog validation, 실제 원자성/인가 검증이 모두 끝난 뒤다. 승인되지 않은 상품은 테스트 환경에서만
명시된 fixture로 검증하며 운영 응답은 available=false, 사유 STATE_CONFLICT로 다루는 안을 제시한다.

## 상세 설계에서 채택할 기술 불변식

- productId의 kind/ownerType/targetBuilding 의미는 불변 자산 정의에 고정한다(선체 계보·착용 호환은 배 종류 폐지로 대상 소멸). 변경하려면 새 productId가 필요하다. 가격과 구매용 prerequisite는 immutable 판매 product revision에 기록한다. 컬렉션은 catalogPublicationVersion과 불변 publication entry(productId→productRevision/category/displayOrder)로 식별한다. 발행 시 새 publication 전체를 단일 활성 포인터로 원자 전환하며 상품별 productVersion과 컬렉션 version을 혼용하지 않는다.
- 페이지 cursor는 첫 publication을 고정하고 이후 상품 개정으로 정렬 집합을 바꾸지 않는다. 현재 소유/권한/available은 별도 현재 상태이며 목록 snapshot이 구매 허가를 예약하지 않는다. 퇴역 publication 보존·폐기는 LLD의 cursor 수명 규약을 따른다.
- 주문은 현재 활성 판매 revision을 Data TX에서 확인하고 price/currency/owner를 snapshot으로 보존한다. D18의 version 검사는 가격/결제 조건 동의 보호이며 동일 productId의 ownerType 변경 허가가 아니다. 결제 통화는 `village_points`(섬 통장·섬 물고기) 하나뿐이므로 다른 통화의 판매 revision은 거절한다(재화-단일).
- 판매 퇴역/가격 개정은 기존 소유의 종류·대상·호환·착용을 바꾸지 않는다. 보유 조회/외양은 active publication 대신 불변 자산 정의를 사용하고 정의는 소유가 남아 있는 동안 보존한다. 구매용 prerequisite 변경을 기존 착용에 소급하지 않는다.
- product 상세는 선택 nullable requiredProduct:{id,title}를 명시 확장으로 제공한다. blockedReason은 원인 코드이고 선행 자산 식별자가 아니다. 실제 ID는 서버 카탈로그에서 얻으며 새 API를 추가하지 않는다.
- 같은 key·같은 본문 receipt는 원201과 결과를 재생한다. 새로운 key라도 `(ownerType,ownerId,productId)` 유일성이 중복 차감을 막는다.
- 개인 inventory는 ownerType=user, ownerId=subject, envelope.islandId=null. 공동은 ownerType=island, ownerId=envelope.islandId. **wallet 은 공동 하나뿐이라 ownerType=island 만 있다**(재화-단일) — 개인 wallet 사건은 발행되지 않는다.
- receipt는 초기 자동TTL 삭제하지 않는다(1750). PII 최소화·탈퇴 파기 규율을 지킨다. 다른 사용자의 receipt를 복구/재생하지 않는다.
- 소유권을 반환하는 read DTO와 이벤트의 inventoryVersion은 같은 목록 aggregate를 뜻한다. product별 개별version을 목록version으로 쓰지 않는다.

상품 부재는 **404 PRODUCT_NOT_FOUND**, retryable=false로 고정한다. 상품 상세/주문에서는 field=productId, 외양 적용에서는 해당 상품을 제출한 공개 필드(clothes/decor/hull/islandThemeId/buildingThemes의 해당 key 경로)를 사용한다. [기존 오류 계약 §4](../../../conventions/error-contract.md#4-상태-매핑-규칙)의 지목 대상별 코드 원칙을 따른다. Data의 상품 도메인 enum과 신규 Business status/code registry에 같은 계약을 등록하고 NOT_FOUND로 뭉치지 않는다. 현재 상점 비활성 상품의 보유자 별도 표시 정책은 여전히 미결이며 미등록 상품의 실패 코드를 정하는 것과 구분한다.

외부 잔액부족은 원본과 구현 티켓1781에 맞춰 **409 INSUFFICIENT_FUNDS**로 고정한다. 공통1750 초안의
INSUFFICIENT_BALANCE는 조정자가 정정하기로 확인했다(2026-09-12). 이 문서의 추가 버전 필드는 상점
설계에서 명시적으로 개정한 것이며 다른 신규 API에 일괄 강제하지 않는다.
