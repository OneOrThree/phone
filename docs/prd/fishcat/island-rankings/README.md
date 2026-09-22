# 전망대 주간 랭킹 설계

GROMO-1776 설계, **GROMO-1997 구현**. [PRD](prd.md)·[정책](policy.md)·[HLD](high-level-design.md)·[LLD](low-level-design.md)·[원본2계약](source-contracts.json). 정책 충돌 시 policy.md 가 우선한다.

> **2026-09-21 현행화** — 구현과 함께 세 가지가 확정돼 이 폴더 전체에 반영했다.
> ① **주민 랭킹 폐지**(2026-09-16 결정 B23·B15): `GET /islands/{islandId}/rankings/members` 는 엔드포인트 자체가
> 사라졌다. 남은 계약은 `GET /rankings/islands` 하나다. 종전 GROMO-1777 범위에서 줄었다.
> ② **주 = UTC 일요일 00:00Z ~ 다음 일요일**(재영님 확정). 종전의 「KST 월요일 + ISO week-year」는 폐기이고,
> 주 식별자도 `YYYY-Www` 가 아니라 **주 시작일 `YYYY-MM-DD`** 다(policy RK-P01·RK-P01-키).
> ③ **분모는 주 마감 시점으로 동결**(migration V85) — 강퇴로 분모를 줄여 순위를 올리는 조작을 막는다.
>
> ⚠️ [`open-decisions.md`](open-decisions.md) 는 2026-09-18 작성이고 **근거가 낡았다**(시작 게이트·`current_island_id`·
> cursor 설정·내부 허용목록·다음 migration 번호·RK-D05 가 전부 그 뒤에 바뀌었다). 사실 확인은 코드로 하고,
> 결정은 [policy.md](policy.md) 를 정본으로 본다.

원본 GROMO-1739 HTML: 154704 bytes, SHA-256 `2b56a4553d75863f1c1db50fd1c1f7123dd21ecf99bac4d38959ad945e9f9c30`.

[같은 PR 회관 기록](../island-records/README.md), [날짜 축](../../../conventions/date-axis.md), [결정 로그](../decision-log.md)를 참조한다.

**개인정보 snapshot 이 없다.** 응답은 섬 이름과 평균 초뿐이라 타인 PII 를 표에 복사하지 않는다 — 그래서 종전
설계가 요구하던 공통 lifecycle 잠금·전 사용자 역색인·불변 snapshot 저장소를 만들지 않았다(policy RK-D08,
선례 2026-09-19 결정 RC-P12-적용 「복사본이 없으면 필요 없다」). 페이지도 없앴으므로 cursor 수명·파기 경합도
없다(RK-D07).
