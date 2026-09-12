# 개인 보유품·섬 외양 API — PRD

GROMO-1782 · 2026-09-12 · 상태: **설계 초안, 하위 선체/호환·공동 권한 결정 대기**.

[정책](policy.md) · [구성 설계](high-level-design.md) · [상세 계약](low-level-design.md)

## 목표와 범위

구매한 옷·선체·소품은 내 배에, 공동 테마는 해당 섬/건물에 적용한다. 구매와 적용은 다른 행동이다.
서버가 본인/섬의 실제 소유, 상품 종류, 대상 시설, 변경권한을 검증하고 전체 외양과 버전을 반환한다.

|ID|method/path|행동|
|---|---|---|
|inventory|GET `/me/inventory`|본인 옷·배 소품·선체와 현재 착용 조회|
|equip|PATCH `/me/appearance`|보유 개인 상품 적용·해제·앞뒤 배치|
|shared-inventory|GET `/islands/{islandId}/inventory`|소속 섬의 테마·음원 보유 조회|
|theme|PATCH `/islands/{islandId}/appearance`|해당 섬/건물에 보유 공동 테마 적용|

- clothes/decor는 null로 해제, hull 기본값은 raft, position은 front/back이다.
- 상품ID를 보냈다는 사실이 소유권 증거가 아니다. 같은ID라도 다른 owner의 소유로 착용하지 않는다.
- 다른 시설에만 쓸 수 있는 테마를 hall에 적용하거나 개인 상품을 섬 외양에 적용하는 요청을 거절한다.
- 내 보유품 조회는 현재 섬이 없어도 가능하다. 공동 자산은 해당 섬의 현재 소속으로 검증한다.
- 개인 외양 전체는 user aggregate, 공동 외양은 island aggregate다. 개인 appearance.version과 inventoryVersion,
  섬 appearance.version과 island 일반version을 섞지 않는다.
- 공동 변경의 expectedVersion, 모든 변경의 Idempotency-Key를 공통규약에 맞춘다. 개인 PATCH에 원본에
  없는 expectedVersion을 일괄 강제하지 않는다.
- member.appearance.updated는 사용자 외양을 볼 수 있는 섬 주민에게만, island.appearance.updated는 해당 섬에만 보낸다.

## 기존 모델과 차이

기존 Data `item/repository/domain/SlotType`은 HAIR/TOP/BOTTOM/SHOES이다. 새 clothes/decor/hull/position을
구 슬롯의 이름 변경으로 취급하지 않는다. [상점 정책](../island-shop/policy.md)의 기존 자산 승계 결정이
없는 동안 원래 아이템/캐릭터 장비를 삭제·변환하지 않는다.

원본1739 v0.3-proposed의 inventory/equip/shared-inventory/theme와1782 목표를 대조했다. 소품의 실제 좌표,
고양이 보행, 배 애니메이션은 클라이언트 자산/렌더링의 책임이며 이 API는 픽셀좌표·프레임 스트림을 받지 않는다.
기본3곡은 예시이며 무료지급 정책을 뜻하지 않는다. 기본 raft 표현을 유료선체 구매나 기존 자산 이관으로 해석하지 않는다.

## 완료 기준

네 계약/소유 매핑/계보/배치/원자외양 변경/이벤트 설계를 문서화한다. 공동 적용 권한과 하위선체 재착용·소품호환
정책이 결정되지 않은 상태를 명시한다. 이 초안만으로 티켓의 정책 완료 조건이나 서버구현 완료를 주장하지 않는다.
검증은 LLD의 타인소유·잘못된종류·시설별테마·부분PATCH·동시기기·버전충돌·탈퇴경쟁을 실제DB로 확인하는 것이 기준이다.
