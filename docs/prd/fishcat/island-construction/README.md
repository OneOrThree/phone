# 섬 건설·마을 발전 API 및 구현

GROMO-1766 설계 / GROMO-1767 구현. GROMO-1815에서 진행 중인 공사 상태 복원과 건설 스프라이트 모션을 추가했다. 이 문서는 API·저장 계약의 정본이며, 문서의 제품 미결 항목은 별도로 표시한다.

[요구사항](prd.md) → [정책·미결 결정](policy.md) → [아키텍처와 흐름](high-level-design.md) → [상세 계약·검증](low-level-design.md) 순서로 읽는다. 충돌 시 policy.md가 정본이다. [원본 세 계약](source-contracts.json)은 v0.3-proposed 예시를 그대로 보관한다.

원본은 GROMO-1739의 `GROMO-화면별-API-스펙.html`(154704 bytes)이며 SHA-256은 다음과 같다.

`2b56a4553d75863f1c1db50fd1c1f7123dd21ecf99bac4d38959ad945e9f9c30`

예상 계약의 `/v1` 제거, 비용 동의 버전 추가, 공통 오류·명령 멱등성은 policy.md 대조표에 구분한다. 목업 가격을 운영 기본값으로 사용하지 않는다.

선행: [공통 PR738](https://github.com/OneOrThree/phone/pull/738), [실시간 PR737](https://github.com/OneOrThree/phone/pull/737), [섬 관리 PR741](https://github.com/OneOrThree/phone/pull/741), [상점·외양 PR742](https://github.com/OneOrThree/phone/pull/742), [집중 PR743](https://github.com/OneOrThree/phone/pull/743). 같은 PR의 [공용 음악](../island-playback/README.md)과 연결된다. 이 선행 문서들이 기준 main에 이미 통합되었다고 가정하지 않는다.

문서 검증(2026-09-12): 원본 coverage의 요청·응답과 source-contracts.json 일치, JSON 코드 블록 파싱 및 로컬 링크 검사를 수행했다. 이후 구현 범위는 각 구현 PR의 변경과 검증 결과를 따른다.
