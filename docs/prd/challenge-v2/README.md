# 챌린지 — 문서 세트 v2 (델타)

> **문서 세트 v2 · 상위 정본(`docs/prd/challenge/`)에 병합 대기(후속 티켓)**
>
> ⚠️ 이것은 **문서 세트의 버전**이지 기능 버전이 아니다. 챌린지 기능 자체가 이미 "v2"라
> 혼동하기 쉽다. 여기서 말하는 v2는 **이 문서 묶음의 판 번호**일 뿐이고, 기능·API·DB의
> 버전과는 아무 관계가 없다.

---

## 1. 이 세트는 무엇인가

상위 정본 `docs/prd/challenge/`는 챌린지 기능 전체를 다룬다(`policy.md` 1,130줄 ·
`low-level-design.md` 1,545줄 등). **이 세트는 그 복사본이 아니다.**
2026-08-11 배치(GROMO-1270 · GROMO-1285)가 건드리는 **좁은 델타**만 담는다.

**전체 복사를 하지 않는 이유.** 같은 문장이 두 벌 존재하면 한쪽만 고쳐지고 나머지가
어긋난 채 남는다. 이 리포에는 07:00 고정 상수가 4곳에 복사돼 있던 전례가 있다.
그래서 이 세트는 **상위 정본을 인용하고 링크할 뿐, 대체하지 않는다.**

**정본 우선순위**: 어긋나면 상위 정본(`docs/prd/challenge/policy.md`)이 맞다.
단, 이 세트가 "정본의 이 줄이 거짓이다"라고 **file:line과 근거를 들어 적은 항목**은
이 세트가 맞다 — 그 항목들은 후속 티켓으로 상위 정본에 병합된다.

---

## 2. 다루는 범위

| 티켓 | 주제 | 이 세트에서 |
|---|---|---|
| **GROMO-1270** | 창 겹침 판정에 **요일 교집합 + 15분 간격** 반영 | [`policy.md`](./policy.md) §A5 · [`low-level-design.md`](./low-level-design.md) 전체 |
| **GROMO-1285** | 좀비 값 정리 — **서술만** 고치고 값은 남긴다 | [`policy.md`](./policy.md) 「손대지 말 것」 |

**범위 밖**: 상위 정본의 나머지 조항, 다른 배치 워크스트림(GROMO-1474 · GROMO-1475),
모션 문서 세트(`docs/prd/motion-v2/`).

---

## 3. 이 세트의 문서

| 문서 | 내용 |
|---|---|
| [`policy.md`](./policy.md) | §A5 창 겹침(정본 인용, **변경 없음**) + 「손대지 말 것」(1285가 지우면 안 되는 것) |
| [`low-level-design.md`](./low-level-design.md) | 1270 구현 계약 — `conflicts()` 기대 구현 · 경계값 표 · 구현 주의 2건 · 낡은 주석 2건 |

---

## 4. 상위 정본 링크

| 문서 | 링크 |
|---|---|
| 한눈에 보기 | [`../challenge/README.md`](../challenge/README.md) |
| PRD | [`../challenge/prd.md`](../challenge/prd.md) |
| **정책 정본** | [`../challenge/policy.md`](../challenge/policy.md) |
| IA | [`../challenge/information-architecture.md`](../challenge/information-architecture.md) |
| HLD | [`../challenge/high-level-design.md`](../challenge/high-level-design.md) |
| LLD | [`../challenge/low-level-design.md`](../challenge/low-level-design.md) |
| UX 시안 | [`../challenge/ux.html`](../challenge/ux.html) |

특히 자주 되짚게 되는 자리:

- 창 겹침 정책 원문 — `docs/prd/challenge/policy.md:179-202` (§A5)
- 겹침 판정 기대 구현 — `docs/prd/challenge/low-level-design.md:1014-1036` (§3.6)
- 백엔드 배선표 — `docs/prd/challenge/policy.md:945-964` (§9.2, B8 = 1270 · B13 = 1285)
- 폐기 코드 잔존 지시 — `docs/prd/challenge/low-level-design.md:842-844`

---

## 5. 병합 조건

이 세트는 다음이 끝나면 상위 정본으로 접힌다(후속 티켓).

1. GROMO-1270 구현이 머지되어 `policy.md` §A5와 코드가 일치할 것.
2. GROMO-1285가 「서술 3곳」만 고치고 값(`refundedCount` · `BET_FOCUS_ONLY`)을 남겼을 것.
3. 상위 `policy.md` §9.2 B13 행이 이 세트의 정정을 반영할 것.

접을 때 **이 폴더는 삭제한다** — 델타 문서를 남겨 두면 그게 곧 두 벌 문제다.
