# 회관 기록·일일 측정 설계

GROMO-1768 설계, 구현1769. 기준 main `529a396`의 기존 통계·측정 코드와 신규 계약을 구분한다. [PRD](prd.md), [정책](policy.md), [HLD](high-level-design.md), [LLD](low-level-design.md), [원본3계약](source-contracts.json)을 제공한다. 정책 충돌 시 policy.md가 우선한다.

원본은 GROMO-1739의 화면별 API 스펙 v0.3-proposed HTML, 154704 bytes, SHA-256 `2b56a4553d75863f1c1db50fd1c1f7123dd21ecf99bac4d38959ad945e9f9c30`이다. source-contracts.json은 canonical coverage의 요청/응답을 변경 없이 보존한다. 날짜 축과 이번 asOf 추가는 정책의 명시 대조표를 따른다.

티켓의 island-statistics 대신 이번 배정 경로 island-records를 사용한다. [날짜 축](../../../conventions/date-axis.md), [공통 PR738](https://github.com/OneOrThree/phone/pull/738), [계정 PR740](https://github.com/OneOrThree/phone/pull/740), [소속 PR741](https://github.com/OneOrThree/phone/pull/741), [집중 PR743](https://github.com/OneOrThree/phone/pull/743), [같은 PR 랭킹](../island-rankings/README.md)을 참조한다. 선행 PR 설계가 기준 main에 이미 구현되었다고 가정하지 않는다.

**2026-09-19 구현(GROMO-1769)**: 개인 기록 범위(RC-D01)·결측/부분 기간(RC-D03)·측정 창(RC-D04)·legacy 범위(RC-D05)·날짜 축(UTC)은 소유자 결정 N26 으로 권장안(없으면 가장 보수적인 안)이 확정됐다. 복수 기기는 병합하지 않는다(합산·최대·대표 모두 반려) — 같은 날 기기가 둘 이상이면 그날 값을 `null`·`unavailable` 로 두는 것이 확정 계약이다(2026-09-22 GROMO-1806, [정책](policy.md) 「복수 기기 규칙과 입력·응답 예시」). 결정과 반려한 대안은 [결정 로그](../decision-log.md) 2026-09-19 RC-* 행·2026-09-22 RC-D02-병합, 구현 차이는 [LLD](low-level-design.md) 머리말.

> 아래 단락은 설계 당시의 gate 다. 1769 구현은 **타인 PII 가 들어가는 스냅샷을 만들지 않아**(scope=island 는 페이지 없음, scope=me 스냅샷은 본인 기록만·탈퇴 TX 에서 삭제) 이 gate 를 우회했다 — 결정 로그 2026-09-19 RC-P12-적용.

PII snapshot 동기 파기는 별도 구현 gate다. 현재 요청자 재인가뿐 아니라 표에 포함된 타인의 탈퇴도
중앙 withdraw와 같은 Data TX에서 전체 snapshot payload를 파기한다. 생성·페이지 반환은 같은 lifecycle
공유 잠금에 참여하며 외부 캐시는 사용하지 않는다. [LLD](low-level-design.md)의 잠금 순서와 양방향 경합
검증이 구현되기 전 공개 활성화를 허용하지 않는다. 이미 서비스에 적용된 기능이라는 뜻은 아니다.
