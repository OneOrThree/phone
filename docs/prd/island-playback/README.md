# 섬 공용 음악 API 설계

GROMO-1778 설계 / GROMO-1779 구현. 기준 main `529a396`에는 아래 신규 공유 재생 상태가 구현되지 않았다. [요구사항](prd.md), [정책](policy.md), [아키텍처](high-level-design.md), [상세 계약](low-level-design.md), [원본 두 계약](source-contracts.json)을 함께 읽는다. 충돌 시 policy.md가 정본이다.

원본 GROMO-1739 HTML은 154704 bytes, SHA-256 `2b56a4553d75863f1c1db50fd1c1f7123dd21ecf99bac4d38959ad945e9f9c30`이다. 원본 예시는 수정하지 않고 이번 확장 예시를 분리한다. 티켓 산출물의 `shared-playback` 경로 대신 이번 병렬 배정의 `island-playback`을 사용한다.

선행: [실시간 PR737](https://github.com/OneOrThree/phone/pull/737), [공통 PR738](https://github.com/OneOrThree/phone/pull/738), [계정 PR740](https://github.com/OneOrThree/phone/pull/740), [소속 PR741](https://github.com/OneOrThree/phone/pull/741), [상점·외양 PR742](https://github.com/OneOrThree/phone/pull/742), [집중 PR743](https://github.com/OneOrThree/phone/pull/743), [방송기 건설](../island-construction/README.md). 선행 설계 통합과 구현 검증을 별개로 추적한다.

문서 검증(2026-09-12): 원본 coverage의 요청·응답과 source-contracts.json 일치, JSON 코드 블록 파싱 및 로컬 링크 검사를 수행했다. 구현 코드·마이그레이션·빌드 결과는 이 설계 PR의 산출물이 아니다.
