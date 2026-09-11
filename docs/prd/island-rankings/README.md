# 전망대 주간 랭킹 설계

GROMO-1776 설계, 구현1777. [PRD](prd.md)·[정책](policy.md)·[HLD](high-level-design.md)·[LLD](low-level-design.md)·[원본2계약](source-contracts.json). 정책 충돌 시 policy.md가 우선한다. 티켓의 island-ranking 대신 배정 경로 island-rankings를 사용한다.

원본 GROMO-1739 HTML: 154704 bytes, SHA-256 `2b56a4553d75863f1c1db50fd1c1f7123dd21ecf99bac4d38959ad945e9f9c30`. 원본 예시는 불변이며 asOf 추가와 정확한 DTO는 별도 기술 계약으로 적는다.

[같은 PR 회관 기록](../island-records/README.md), [날짜 축](../../conventions/date-axis.md), [공통 PR738](https://github.com/OneOrThree/phone/pull/738), [소속 PR741](https://github.com/OneOrThree/phone/pull/741), [집중 PR743](https://github.com/OneOrThree/phone/pull/743)을 참조한다. main529a의 기존 리그는 실제 집계지만 섬 주간 랭킹은 아니다.

분모·동점·가입/이탈·현재 주 진행분·지난 주 마감은 미결이다. 안정된 snapshot 기술을 정했다고 이 제품 정책을 확정한 것으로 계산하지 않는다. 정책 확정 완료 조건과 공개 출시에는 별도 결정이 필요하다.
