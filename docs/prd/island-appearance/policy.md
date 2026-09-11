# 보유품·외양 — 정책 정본과 미결 항목

GROMO-1782 · [PRD](prd.md) · [LLD](low-level-design.md)

## 확정된 표현과 소유

|슬롯/상품|소유자|적용 경로|표현|
|---|---|---|---|
|옷 clothes|본인 user|PATCH `/me/appearance`|ProductId 또는 null해제|
|배 소품 decor|본인 user|같음|ProductId 또는 null해제|
|선체 hull|본인 user / 기본 raft 표현|같음|raft 또는 보유 ProductId, null불가|
|소품 위치 position|본인 외양 상태|같음|front 또는 back, 좌표아님|
|섬 테마|경로 island|PATCH `/islands/{islandId}/appearance`|islandThemeId, default해제|
|건물 테마|경로 island|같음|buildingThemes의 BuildingId→ThemeId, default해제|
|공용 음원|경로 island|공용 playback의 별도변경|이 네 계약은 조회만, 재생을 수행하지 않음|

PATCH에서 미전달 키는 유지한다. 개인 null해제와 공동문자열 default해제는 원본의 구별을 유지한다. [LLD의 tri-state 전달 계약](low-level-design.md#patch-존재-여부와-멱등-지문)에 따라 Business/Data 사이에도 존재 mask와 values를 보존하며 fingerprint에서 생략과 명시 null을 합치지 않는다.
공동 buildingThemes는 전달한 건물만 바꾸며 생략한 건물을 default로 덮어쓰지 않는다.

## 선체 계보 — 구매와 착용을 구분

```mermaid
flowchart LR
  R[기본 뗏목 raft] --> S[돛단배 sailboat 보유]
  S --> C[선실 배 보유]
  C -. 하위 재착용 정책 결정 대기 .-> S
  S -. 기본 뗏목 재착용 정책 결정 대기 .-> R
```

원본은 "선실 배는 돛단배 보유 후 구매"를 요구한다. 착용중인 선체가 돛단배여야 구매 가능하다고 바꾸지 않는다.
선실 배의 실제 ProductId는 승인 카탈로그에서 정한다. 기존 소유를 업그레이드 구매 때 소각/교환하는 정책은 없다.
이 문서도 기존 선체의 소유 삭제나 자동착용을 추가하지 않는다.

|ID|미결 항목|확인할 선택|결정 전 범위|
|---|---|---|---|
|A01|공동 테마 적용 권한|방장만/주민허용/설정가능|1761의 SHARED_APPEARANCE 행과 동일 결정 사용; 신규 운영변경 비활성|
|A02|상위선체 구매 뒤 하위선체 재착용|보유한 선체 자유선택 또는 상위만|목업 예시를 최종정책으로 확정하지 않음|
|A03|선체별 소품 호환|모든선체 공통 또는 catalog별 호환조건|미승인 호환표가 있는 상품은 적용가능으로 노출하지 않음|
|A04|소품 해제시 position|일반 PATCH의 미전달 필드 유지 규칙 적용|decor=null이어도 position을 보내지 않았으면 유지. 소품이 없으면 렌더링 효과 없음|
|A05|기존캐릭터 자산승계|새모델분리 또는 명시매핑|상점S01 질문과 묶음, 기존데이터 변환금지|

A02의 기술 추천은 **보유한 선체 자유선택**이다. 구매 소유와 착용이 이미 분리되어 사용자가 산 자산을 계속
사용할 수 있고 하위재착용을 금지할 제품 근거가 원본에 없다. 다만 이 추천이 승인이나 구현 정책은 아니다.
A04는 별도 제품 질문이 아니라 앞의 PATCH 생략 의미론을 적용한 기술 규칙이다. decor 해제를 position 초기화로 확대하지 않는다.

공동 구매 권한과 공동 테마 적용 권한, 공용 곡 재생 권한은 별개다. 원본의 주민 공용음악 조작 허용을 공동소비나
테마변경 허용으로 확대하지 않는다. 방문자는 모든 mutation을 거절한다. 섬관리 담당 초안도 공동소비/테마행을
TBD로 두었으며 양쪽이 서로 다른 기본값을 내리지 않는다.

## 기술 결정

개인 변경은 외양행 잠금 아래 **제출된 필드만** 병합하고 현재 전체상태를 검증한다. 개인 expectedVersion을
새로 요구하지 않으므로 같은 슬롯의 동시선택은 서버 직렬화 순서의 마지막 변경이 된다. 서로 다른필드 patch는
상대변경을 지우지 않는다. stale전체객체를 자동재전송하지 않으며 네트워크재시도는같은key/본문으로만 한다.

외양버전은 실제변경이 확정될 때 단조증가한다. 같은 효과의 새 요청은200 최신상태와receipt만 만들고 불필요한
version/event를 발행하지 않는 기술안을 채택한다. 소유목록과 외양의 version은 분리한다.
시설 완공으로 전체 buildingThemes의 건물 집합이 바뀌는 경우도 외양 변경이다. 시설 producer가 같은 TX에서
공동 appearance.version을 올리고 전체 맵의 island.appearance.updated outbox를 저장한다. 현재 미지원인 철거
기능을 추가하지 않으며 향후 승인된 writer에도 이 전체 상태 불변식을 적용한다.

보유품의 kind/ownerType/targetBuilding/선체계보·착용호환은 productId 수명 동안 불변이다. 판매 가격 개정·퇴역은
기존 소유·착용 의미를 바꾸지 않는다. 외양 검증은 현재 판매 revision/구매 prerequisite가 아닌 불변 자산 정의와
실제 보유·현재 적용 권한/시설을 사용한다. [상점의 분리 규칙](../island-shop/low-level-design.md#보유-의미와-판매-revision-분리)을 함께 따른다.

개인 inventory의 hulls는 원본 예시대로 기본 raft와 실제 보유 유료 선체를 합친 표시 목록이다. 유료 선체 미보유는 hulls=[raft]이며 clothes/decor의 미보유는 []다. raft는 소유/지급 행을 만들지 않는 예약 표현이고 목록 포함이 A02 재착용 권한을 확정하지 않는다. 이는 기존 표현을 명확히 한 것으로 신규 무상 지급·재착용 정책을 채택한 것이 아니다.

기본표현 default/raft는 판매상품ID와 충돌하지 않는 예약키로 취급한다. 소유가 없는 유료상품을 default라는 이유로
허용하지 않는다. 미등록 catalog 상품 키는404 PRODUCT_NOT_FOUND, 등록됐지만 종류/대상시설이 다르면422, 보유권한이없으면403이다.
