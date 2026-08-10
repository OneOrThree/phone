# 모션 — 문서 세트 v2

> **문서 세트 v2 · 상위 정본(`docs/prd/motion/`)에 병합 대기(후속 티켓)**

작성 2026-08-11 · 베이스 `origin/main` @ `7c16dabd4`

**"v2"는 문서 세트의 버전이지 기능의 버전이 아니다.** 모션 기능은 하나뿐이고,
GROMO-1381 구현 배치가 끝난 뒤 그 위에 얹히는 후속 8건을 다루면서 생긴 결정을 담는다.

---

## 이 세트와 상위 정본의 관계

| | 상위 정본 `docs/prd/motion/` | 이 세트 `docs/prd/motion-v2/` |
| --- | --- | --- |
| 정책 결정 | `D1`~`D16` ([policy.md](../motion/policy.md)) | **`D17`~`D22`** ([policy.md](policy.md)) |
| 토큰·프리미티브 계약 | [low-level-design.md](../motion/low-level-design.md) | 정본 드리프트 2건 + 이번 배치 구현 명세 ([low-level-design.md](low-level-design.md)) |
| 표면 지도·부채 | [information-architecture.md](../motion/information-architecture.md) | **델타만** ([information-architecture.md](information-architecture.md)) |
| 시안 | [ui.html](../motion/ui.html) — 통계·집중 세션·리그 진입/재정렬·바텀시트·승급 축하 | **신규 표면만** ([ui.html](ui.html)) — 누끼 완성 리빌 · 리그 구조 변경 대조 · 에러 토스트 |
| PRD·HLD | [prd.md](../motion/prd.md) · [high-level-design.md](../motion/high-level-design.md) | 변경 없음 — 상위를 그대로 본다 |

**결정 번호는 정본을 이어 쓴다.** 별도 폴더라 GitHub 앵커(`#d17`)가 충돌하지 않고,
병합할 때 `D16` 뒤에 그대로 붙는다.

⚠️ **타이밍 정본은 여전히 상위 [`ui.html`](../motion/ui.html)이다.** 이 세트의
[ui.html](ui.html)은 **이번 배치의 신규 표면만** 담는다 — 기존 표면(통계·집중 세션·리그
진입/재정렬·바텀시트·승급 축하)의 값이 두 파일에서 갈리면 상위가 맞다.

---

## 이 세트가 다루는 티켓

| 티켓 | 무엇 | 이 세트에서 | 구현 워크스트림 |
| --- | --- | --- | --- |
| GROMO-1474 | 통계 '첫 시작 시각' 조회 실패가 무데이터로 보인다 | **D20** · IA §3.2 표면 행 | `afix/GROMO-1474-first-start-fetch-failure` |
| GROMO-1475 | 순위 단계 재생의 프레임 정합 | **D17** · LLD §4 | `afeat/GROMO-1475-staged-ranking-frames` |
| GROMO-1476 | `useStagedRanking` ref → 렌더 중 setState | LLD §4.3 (정책 결정 없음 — 순수 내부 변경) | `afeat/GROMO-1476-staged-ranking-state`(스택) |
| GROMO-1482 | '동작 줄이기' 미확정 구간 처리가 세 곳에 흩어져 있다 | **D18** · LLD §3 | `arefactor/GROMO-1482-reduce-motion-primitive` |
| GROMO-1491 | 실패 통보도 토스트로 | **D19** · IA §3.3 | `arefactor/GROMO-1491-error-toast` |
| GROMO-1493 | 리그 리스트 `Animated.FlatList` 전환 | **D22** · LLD §5 · ui.html §2 | `afeat/GROMO-1493-league-flatlist` |
| GROMO-1494 | 누끼 완성 리빌 | **D21** · LLD §6 · ui.html §1 | `afeat/GROMO-1494-cutout-reveal` |

### 이 문서 세트는 **구현보다 먼저 머지된다**

**애니메이션 구현은 오너 결정으로 이번 릴리즈에서 빠졌다.** 이 세트가 그래도 머지되는 이유는
하나다 — **여기서 가린 결정·조사가 보존돼야 다음 배치가 처음부터 다시 하지 않는다.**
그래서 **틀린 명세를 남기면 이 세트의 존재 이유가 뒤집힌다.**

| 티켓 | 구현 상태 |
| --- | --- |
| GROMO-1494 | **구현 완료 · 미머지.** 브랜치 `afeat/GROMO-1494-cutout-reveal`에 `CharacterCreator.tsx` + 테스트 12건이 보존돼 있다. [LLD §6.3](low-level-design.md) 이하는 **추정이 아니라 그 구현을 옮긴 것**이다 |
| 그 외 | 미착수. 문서의 명세가 착수 기준이다 |

**⚠️ 줄 번호 좌표계가 둘이다** — LLD §6.1·§6.2는 `main`(구현 전), §6.3 이하는 **구현본** 기준이다.
다시 여는 사람은 설계부터 하지 말고 **보존 브랜치를 먼저 꺼낸다.**

### 이번 배치 제외 — GROMO-1492

**GROMO-1492(레거시 `Animated` 8파일 장부)는 이번 배치에서 제외한다**(오너 결정).
D18이 `DraggableSubjectRows.tsx`를 손대지만 **Reanimated 이관은 하지 않는다** —
미확정 판정만 고치고 `160ms` 하드코딩과 레거시 `Animated`는 그대로 둔다.
그래서 그 파일은 `M` 토큰을 쓸 수 없는 상태로 남는다([D18](policy.md#d18)의 ⚠️ 항목).

---

## 읽는 순서

1. [policy.md](policy.md) — **D17~D22.** 무엇을 정했고 무엇을 버렸는가. 어긋나면 여기가 맞다.
2. [low-level-design.md](low-level-design.md) — 기계적 명세. 정본 LLD가 놓친 `ready`·`enter()`·`whenReduceMotionReady` 계약이 여기 있다.
3. [information-architecture.md](information-architecture.md) — 상위 IA의 어느 행이 바뀌는가(델타만).
4. [ui.html](ui.html) — 신규 표면 3종. **WS-5(1494)·WS-7(1493)의 착수 게이트다.**

---

## 병합 계획

이 세트는 상위 정본에 **병합 대기** 상태다. 병합 후속 티켓에서 다음을 옮긴다.

- `policy.md` D17~D22 → 상위 `policy.md` D16 뒤에 그대로 append + 부록 확정 이력 병합
- D19가 해제한 상위 `policy.md:147`의 `⏸ 보류` 행 → 상위 D8 표에서 직접 교체
- LLD의 `useMotion` 계약(§3) · `whenReduceMotionReady`(§3.2) → 상위 LLD §3 교체
- IA 델타 → 상위 IA §3.x·§6 해당 행 교체
- ui.html 신규 3표면 → 상위 ui.html 갤러리에 슬롯으로 편입

병합 전까지 **상위 정본만 읽은 사람은 이 6개 결정을 모른다.** 그래서 상위 정본을 인용할 때는
이 README를 함께 링크한다.
