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
| GROMO-1476 | `useStagedRanking` ref → 렌더 중 setState | LLD §4.3 (정책 결정 없음 — 순수 내부 변경) | `afeat/GROMO-1476-staged-ranking-state`(1475 위 스택) |
| GROMO-1482 | '동작 줄이기' 미확정 구간 처리가 세 곳에 흩어져 있다 | **D18** · LLD §3 | `arefactor/GROMO-1482-reduce-motion-primitive` |
| GROMO-1491 | 실패 통보도 토스트로 | **D19** · IA §3.3 | `arefactor/GROMO-1491-error-toast` |
| GROMO-1493 | 리그 리스트 `Animated.FlatList` 전환 | **D22** · LLD §5 · ui.html §2 | `afeat/GROMO-1493-league-flatlist` |
| GROMO-1494 | 누끼 완성 리빌 | **D21** · LLD §6 · ui.html §1 | `afeat/GROMO-1494-cutout-reveal` |

**착수 전에 반드시 아래 「구현 상태」 표를 본다** — 위 표의 브랜치 이름은 *배정*이지 *미착수*라는
뜻이 아니다. **1474·1475·1491·1494는 이미 구현이 끝나 있다.**

### 구현 상태 — **문서 세트가 구현보다 먼저 머지된다**

**애니메이션 작업은 오너 결정으로 이번 릴리즈 범위에서 빠졌다**(결정 로그 `N13`, 2026-08-11).
그래도 이 세트가 머지되는 이유는 하나다 — **여기서 가린 결정·조사가 보존돼야 다음 배치가
처음부터 다시 하지 않는다.** 그래서 **틀린 명세를 남기면 이 세트의 존재 이유가 뒤집힌다.**

**⚠️ 아래 표를 보지 않고 착수하면 이미 끝난 구현을 다시 쓰게 된다.**

| 티켓 | 구현 | 상태 | 이어받을 곳 |
| --- | --- | --- | --- |
| GROMO-1474 | ✅ 완료 | **PR #606 ready · 이번 릴리즈 유지** — 연출이 아니라 *버그 수정*(네트워크 실패를 '기록 없음'으로 표시하던 것)이라 제외 대상이 아니다 | `afix/GROMO-1474-first-start-fetch-failure` |
| GROMO-1491 | ✅ 완료 | **PR #612 리뷰 중 · 이번 릴리즈 유지** — *문구 이관*이라 연출이 아니다 | `arefactor/GROMO-1491-error-toast` |
| GROMO-1475 | ✅ 완료 | **PR #608 · 리뷰 루프 중단, 미머지**(릴리즈 제외) | `afeat/GROMO-1475-staged-ranking-frames` |
| GROMO-1494 | ✅ 완료 | **PR 없음 · 브랜치로만 보존**(릴리즈 제외). 테스트 12건 포함 | `afeat/GROMO-1494-cutout-reveal` |
| GROMO-1476 | ⬜ 미착수 | 1475 위 스택으로 계획돼 있었고 **1475가 멈추면서 함께 멈췄다.** `N13`에 개별 언급 없음 | — (1475 위에 새로 딴다) |
| GROMO-1482 | ⬜ 미착수 | 릴리즈 제외 | — |
| GROMO-1493 | ⬜ 미착수 | 릴리즈 제외 | — |

> 📌 **같은 배치의 백엔드 2건은 이 문서 세트 범위 밖이다** — GROMO-1270(PR #607)·1285(PR #605)는
> 챌린지 축이고 둘 다 ready·릴리즈 유지다. 모션 문서와 무관하니 여기서 다루지 않는다.

**⚠️ 줄 번호 좌표계가 둘이다** — LLD §6.1·§6.2는 `main`(구현 전), §6.3 이하는 **1494 구현본**
기준이다. [LLD §6.3](low-level-design.md) 이하는 **추정이 아니라 그 구현을 옮긴 것**이므로,
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
- **D21이 넓힌 reduce 예외 → 상위 `policy.md` D7 + 상위 IA §5 등급 3 행에 반영**
  (*"컨페티만 생략"* → **"파티클·리빌·팝 = 화면 요소를 움직이는 것 전부 생략, 문구·햅틱·최종 상태 유지"**).
  **⚠️ 이 항목을 빠뜨리면 상위 정본만 읽은 구현자가 '동작 줄이기' 사용자에게 리빌을 재생시킨다** —
  근거는 [D21의 D7 확장 절](policy.md#이것은-정본-d7의-명시적-확장이다-2026-08-11-추가)
- LLD의 `useMotion` 계약(§3) · `whenReduceMotionReady`(§3.2) → 상위 LLD §3 교체
- IA 델타 → 상위 IA §3.x·§6 해당 행 교체
- ui.html 신규 3표면 → 상위 ui.html 갤러리에 슬롯으로 편입

병합 전까지 **상위 정본만 읽은 사람은 이 6개 결정을 모른다.** 그래서 상위 정본을 인용할 때는
이 README를 함께 링크한다.
