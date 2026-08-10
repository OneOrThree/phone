# Low-Level Design — 모션 v2

> 2026-08-11 · 배치 GROMO-1474·1475·1476·1482·1491·1493·1494 · 현재 구현 상태 기준
> 세트: [README](README.md) · [정책 v2](policy.md) · **LLD v2** · [IA v2](information-architecture.md) · [시안](ui.html)
>
> **상위 정본은 [`docs/prd/motion/low-level-design.md`](../motion/low-level-design.md)다.**
> 이 문서는 ① 그 정본이 구현을 못 따라온 **드리프트 2건**을 닫고 ② 이번 배치의 구현 명세를 담는다.
> 토큰(`M.dur`·`M.curve`·`M.spring`)은 상위 §2가 그대로 정본이며 **이 배치에서 값이 바뀌지 않는다.**

---

## 1. 정본 드리프트 — 무엇이 어긋나 있나

| # | 정본 서술 | 실제 구현 | 닫는 절 |
| --- | --- | --- | --- |
| 1 | 상위 LLD §3의 `useMotion` 계약에 **`ready`와 `enter()`가 없다** | 구현 중 결정 `D-30`·`D-31`로 생겼다(`useMotion.ts:37`·`:66`). 이 배치의 여러 파일이 이미 그것에 의존한다 | [§2](#2-usemotion-현행-계약-정정) |
| 2 | **`whenReduceMotionReady`가 문서 어디에도 없다** | `useReduceMotion.ts:101-111`. 훅을 못 쓰는 비동기 흐름 전용. 실사용 2곳 | [§2.2](#22-whenreducemotionready-비동기-흐름용) |

**왜 지금 닫는가** — D18([정책 v2](policy.md#d18))이 "현행 처방이 세 갈래로 번졌다"를 근거로 쓰는데,
그 셋 중 둘이 정본에 없다. 정본만 읽고 새 표면을 붙이는 사람은 `m.css()`를 진입 프리셋에 쓰고
결정 `D-30`이 여덟 번 겪은 그 사고를 다시 낸다.

---

## 2. `useMotion` 현행 계약 (정정)

**상위 LLD §3의 코드 블록을 이걸로 교체한다.** 출처는 `app/src/hooks/useMotion.ts:29-71`.

```ts
export type Motion = {
  /** 시스템 '동작 줄이기'가 켜져 있는가. 확정 전(비동기 조회 중)에는 보수적으로 true. */
  reduce: boolean;
  /** 위 값이 **확정됐는가**. 확정 전의 보수적 true로 되돌릴 수 없는 결정을 내리면 안 된다. */
  ready: boolean;
  /** reduce면 애니메이션 없이 목표값을 그대로. ⚠️ JS 스레드 전용 — 워클릿 안에서 호출 금지 */
  timing<V extends AnimatableValue>(to: V, cfg?: WithTimingConfig): V;
  /** ⚠️ timing과 동일 — 워클릿 안에서 호출 금지 */
  spring<V extends AnimatableValue>(to: V, cfg?: WithSpringConfig): V;
  /** CSS 애니메이션 스타일·layout prop을 reduce면 통째로 끈다. ⚠️ **진입 프리셋은 enter()** */
  css<S>(style: S): S | undefined;
  /** **진입 애니메이션 전용.** 확정 전에는 시작 프레임(animationName.from)을 돌려준다. */
  enter(style: CSSAnimationProperties): CSSAnimationProperties | ViewStyle | undefined;
  /** reduce면 0. 단계 시퀀스는 지연만 없애고 **반드시 완주시킨다**. */
  delay(ms: number): number;
  /** reduce면 0. 아니면 staggerMaxSteps 상한을 적용한 시차. */
  stagger(index: number, step?: number): number;
};
```

### 2.1 `ready` / `enter()`의 계약 — 정본이 놓친 세 가지

1. **`ready === false`는 "동작 줄이기가 켜짐"이 아니다.** `useReduceMotion()`은 미확정 구간을
   **보수적으로 `true`로 읽는다**(`useReduceMotion.ts:74-75`) — 그게 옳다. 잘못된 것은 그 `true`로
   **되돌릴 수 없는 결정**(1회성 시퀀스 시작·마커 기록·`enteredRef` 확정)을 내리는 것이다.
2. **`enter()`의 결정 경계는 컴포넌트 마운트다.** `useMotion.ts:93-94`가
   `enterDecided` ref로 인스턴스당 한 번만 정하고 **양쪽 방향 모두 얼린다.** 확정 뒤 사용자가
   설정을 토글해도 이미 보이던 노드에 스타일이 붙었다 떨어지지 않는다. **늦게 나타나는 요소가
   최신 설정을 따라야 하면 그 요소를 자기 컴포넌트로 빼야 한다** — 그 용도의 최소 래퍼가
   `Enter`(`app/src/components/Enter.tsx`)이고, `Enter`는 결정 시점을 **`active`가 처음 true가 되는
   순간**으로 한 칸 더 미룬다(`Enter.tsx:47-48`).
3. **`css()`는 그대로 둔다.** 전환(값이 변해야 실행)과 무한 루프(`pulse`)까지 시작 프레임에
   붙들면 안 된다. ⚠️ `pulse`에도 `from`이 있어 **타입만으로는 오용을 막지 못한다** — 경계는
   테스트로 문서화돼 있다.

### 2.2 `whenReduceMotionReady` — 비동기 흐름용

**상위 LLD에 이 항목을 신설한다.** 출처 `app/src/hooks/useReduceMotion.ts:91-111`.

```ts
/** '동작 줄이기' 값이 **확정될 때까지** 기다린다. 훅을 쓸 수 없는 **비동기 흐름**용이다. */
export function whenReduceMotionReady(): Promise<void>;
```

| 항목 | 계약 |
| --- | --- |
| 반드시 resolve된다 | 초기 조회가 실패해도 `catch`에서 `false`로 확정한다(`useReduceMotion.ts:53-58`). 영구 대기가 없다 |
| 구독 부작용 | 호출이 `init()`을 트리거한다 — 훅을 한 번도 안 쓴 화면에서 불러도 안전 |
| **금지** | `await`을 몇 번 지났다고 확정을 가정하는 것. AsyncStorage 조회가 `isReduceMotionEnabled()`보다 **먼저 끝날 수 있다** |

**실사용 2곳** — 새로 쓸 때 이 둘을 본다.

| 위치 | 무엇을 기다리나 |
| --- | --- |
| `app/src/screens/focus/FocusResultScreen.tsx:403` | 축하 모달 개시 판정. 미확정 보수값으로 지연을 0으로 만들면 **일반 사용자도 모달이 즉시 열리고 마커까지 기록돼** 그날 다시 재생할 수 없다 |
| `app/src/screens/stats/useTimetableShareCapture.ts:110` | 진입 연출의 대기 길이 확정(확정된 시각을 1회 기록) |
| `app/src/screens/stats/useTimetableShareCapture.ts:213` | **캡처 직전.** `capturing`을 켜기 **전에** 기다린다 — 켜 놓고 기다리면 캡처 전용 chrome이 실제 화면에 보인다 |

### 2.3 알려진 중복 — `m.enter`가 `startFrameOf`를 인라인으로 다시 구현한다

`useMotion.ts:109-114`가 시작 프레임 추출을 인라인으로 갖고 있고, 같은 로직이
`app/src/constants/motion.ts:280-285`에 `startFrameOf()`로 export돼 있다(`Enter.tsx:56`이 그쪽을 쓴다).
**두 판본이 갈리면 `Enter`와 `m.enter`의 미확정 구간 모습이 달라진다.**
D18 작업(WS-6)에서 `useMotion.ts` 쪽을 `startFrameOf` 호출로 접는다 — 동작 변화 없음.

---

## 3. D18 — 명령형용 진입점 (제안)

> **⚠️ 이 절은 제안이다.** 4갈래 계약([정책 D18](policy.md#d18))은 확정이고, 아래 API 모양은
> 구현에서 조정될 수 있다. 조정하면 이 절을 고친다.

### 3.1 왜 컴포넌트가 아닌가

정본 D13이 래퍼 컴포넌트를 금지한다(Maestro `testID` 경로). `Enter`가 예외인 것은 **원래 있던
`Animated.View`를 그대로 대신**하기 때문이다(`Enter.tsx:11-12`). 대상 3곳에는 대신할 뷰가 없다 —
`useSharedValue`(오버레이·차트)와 `Animated.Value`(드래그 행)를 **직접 미는 코드**다.

### 3.2 모양

```ts
/** D18의 네 갈래. 새 표면은 이 넷 중 하나로 분류된다. */
export type MotionSurface = 'enter' | 'settle' | 'progress' | 'loop';

/**
 * 명령형 애니메이션(shared value · Animated.Value)이 '동작 줄이기'를 표면 유형대로 따르게 한다.
 * 훅은 표면 유형만 알고, 실제 값 대입은 호출부 콜백이 한다.
 */
export function useMotionRun(
  surface: MotionSurface,
  run: {
    /** 확정 전에 그릴 모습. 'enter'=시작 프레임 · 'progress'=0%. ('settle'·'loop'은 호출되지 않는다) */
    hold?: () => void;
    /**
     * 연출을 재생한다.
     * @param elapsedMs 확정을 기다리느라 흘러간 시간. 'progress'는 이 지점에서 **이어간다**
     *                  (되감지 않는다). 나머지 갈래는 무시해도 된다.
     */
    play: (elapsedMs: number) => void;
    /** 즉시 최종 상태. 되감기 금지 — 이미 최종이면 아무것도 하지 않는다. */
    finish: () => void;
  },
): void;
```

### 3.3 갈래 × 상태 → 호출되는 콜백

| 표면 | `ready=false` | 확정 `reduce=false` | 확정 `reduce=true` | 재생 중 reduce ON |
| --- | --- | --- | --- | --- |
| `enter` | `hold()` | `play(elapsed)` | `finish()` | `finish()` |
| `settle` | **`finish()`** | `play(0)` | `finish()` | `finish()` ※ |
| `progress` | `hold()` | `play(elapsed)` | `finish()` | `finish()` |
| `loop` | `finish()`(정지) | `play(0)` | `finish()` | `finish()` |

※ **드래그 중인 행은 호출부가 제외한다.** 그 행은 안착 애니메이션 중이 아니라 손가락을
추종하는 중이라, 슬롯으로 밀면 손가락 아래에서 제자리로 튄 뒤 다음 move 이벤트에 다시 돌아온다
(`DraggableSubjectRows.tsx:61-67`이 같은 규율을 이미 적어 뒀다). 훅은 그 사정을 모른다.

**불변식 2개 — 갈래와 무관하게 항상 성립한다.**

1. **되감기 금지.** `finish()`·`play()`는 현재 값보다 **뒤로 가는 값을 대입하지 않는다.**
   (`ScreenTimeAnalyzingOverlay.tsx:82-85`가 같은 규율을 손수 갖고 있다 — *"끝난 연출은 끝난 채로 둔다"*.)
2. **`m`을 effect 의존성에 넣지 않는다**(결정 `D-29`). 훅 내부는 `reduce`/`ready` **원시값**만
   의존성으로 쓴다. `m` 객체는 reduce가 바뀔 때마다 새 참조라 1회성 시퀀스가 중복 실행된다.

### 3.4 호출부 3곳 — 무엇이 어떻게 바뀌나

| 파일 | 갈래 | 지금 | 이후 |
| --- | --- | --- | --- |
| `ScreenTimeAnalyzingOverlay.tsx:57-110` | `progress` | 마운트 타임스탬프 + `take()` 앞깎기(`:73-81`)로 **남은 구간을 두 배속**으로 채운다 | `play(elapsed)`에서 **시작 진행률을 `elapsed/ANALYZE_MS`로 두고** 남은 구간을 원래 속도로 재생. `FILL_MS`/`HOLD_MS`/`FINISH_MS`는 [정본 D15](../motion/policy.md#d15) 예외 그대로 — **가드 타임 자체는 reduce여도 흐른다** |
| `DraggableSubjectRows.tsx:59-76` | `settle` | `settleInstantRef.current = m.ready && m.reduce` — **미확정을 모션 허용으로** 취급 | 미확정도 `finish()`(즉시 완료). ⚠️ **이 파일은 레거시 RN `Animated`다**(1492 제외) — `duration: 160`(`:127`·`:206`) 하드코딩과 `Animated.timing`은 그대로 두고, 진입점은 **불리언 판정만** 쓴다 |
| `charts.tsx:127-141` | `enter` | `startedRef` 1회 래치(`:132`)라 재생 중 설정을 켜도 즉시 반환 | 재생 중 ON에서 `finish()`가 불려 draw-on이 최종 상태로 끊긴다. **1회성(인스턴스당 한 번 진입)은 유지** — `plotW > 0` 게이트도 그대로 |

**⚠️ `charts.tsx`는 WS-3(1474)이 먼저 머지된 뒤 손댄다** — 같은 파일이다.

---

## 4. 1475·1476 — 순위 단계 재생

### 4.1 `rankSwapFrames` 반환 계약 (D17)

```
rankSwapFrames(from, to, finalSeconds, startSeconds, maxSteps) → RankSwapFrame[]
```

**빈 배열 = "재생할 것이 없다" = 최신 배열을 그대로 그린다.** 기존 반환 조건에 D17을 더한다.

| # | `[]`를 돌려주는 조건 | 위치 |
| --- | --- | --- |
| 1 | 순서가 이미 같다 / 길이가 다르다 / 구성원이 다르다 / 키 중복 | `rankSwap.ts:118-123`·`:139` |
| 2 | **점수가 하나라도 줄었다** | `rankSwap.ts:166` |
| 3 | **불변식을 동시에 만족하는 배정이 없다** (신규 · D17) — 아래 ③. 위 행부터 훑으며 천장을 접두 최소로 좁히고 `천장 < 바닥`이면 포기 | — (신규) |
| 4 | 도착 순서 자체가 비증가가 아니다 — `to`에서 `final(to[i-1]) < final(to[i])` (신규 · ①′의 전제) | — (신규) |

**불변식(정책 D17 재게시)** — ①에는 **리드 프레임 예외가 있다.** 이 예외는 정책이 정본이고
([D17](policy.md#d17)의 ⚠️ 항목), 아래 수식은 그것을 기계적으로 옮긴 것이다.

한 칸 이동은 프레임 **두 장**으로 나온다(`rankSwap.ts:212-218`):

| 프레임 | `at` | `order` | `seconds` |
| --- | --- | --- | --- |
| **리드** | `step × (LEAD+GAP)` | **`prevOrder`**(자리는 아직 그대로) | 이동이 **끝난 뒤 순서**로 배정된 값 |
| **자리** | `+ SWAP_LEAD_MS`(90ms) | `order`(이동 완료) | 같은 값 |

즉 리드 프레임에는 **곧 맞바꿀 쌍 하나가 반드시 역전돼 있다** — 그 역전이 자리 이동의 원인이고
정본 §6이 요구하는 연출이다. 따라서:

```
①′ 프레임 내 비증가 (리드 프레임 예외)
    ∀ 프레임 f, ∀ i<j  →  value(f, row_i) ≥ value(f, row_j)
    단, f가 리드 프레임이고 (row_i, row_j)가 **바로 다음 프레임에서 자리를 맞바꾸는 인접 쌍**
    이면 면제한다(90ms 안에 해소된다). 그 밖의 역전은 전부 위반.

②  행별 구간
    ∀ 프레임 f, ∀ 행 r  →  prevShown(r) ≤ value(f, r) ≤ final(r)

③  배정 가능성 (사전 판정 — 위 표 #3)
    ∀ 행 r  →  start(r) ≤ min{ final(r′) : r′ 는 from에서 r 위(자기 포함) }
    (= 아래 행의 바닥이 위 행들의 천장보다 높으면 ①′·②를 함께 만족할 배정이 없다)
```

**⚠️ "전 프레임 비증가"를 문자 그대로 단언하면 연출이 깨진다.** 그 단언은 리드 프레임을 위반으로
잡아내고, 그것을 통과시키려면 자리 이동의 원인이 되는 역전을 없애야 한다 — 보존 대상인 회귀
테스트(`rankSwap.test.ts` *"각 단계의 기록은 그 순간 앞지르는 상대보다 위다"*)와 정면으로 충돌한다.

**프레임 순회 헬퍼 명세** — 프레임을 **한 장씩** 보면 ①′을 판정할 수 없다. 헬퍼는 **`f`와 `f+1`을
짝지어** 읽는다.

| 입력 | 판정 |
| --- | --- |
| 프레임 `f`의 역전 쌍 목록 | 값을 **`f.order` 순서로**(= 그 프레임이 실제로 그리는 행 순서) 훑어 구한다. 서버가 준 `to` 순서로 훑으면 리드 프레임을 아예 못 본다 |
| `f`가 마지막 프레임 | 역전이 하나라도 있으면 **위반**(해소할 다음 프레임이 없다) |
| `f.order === f₊₁.order` | 자리 이동이 없는 프레임이므로 **예외 없음** — 역전이 있으면 위반 |
| `f.order ≠ f₊₁.order` | 두 순서의 차이는 **인접 전치 1회**여야 한다. 그 전치 쌍 **하나만** 면제하고, 다른 역전이 남으면 위반 |

**마지막 프레임은 예외 없이 서버 최종값이다**(`rankSwap.ts:221-222`). 이 보장은 유지한다 —
위 표의 "마지막 프레임에는 역전이 없다"와 같은 사실의 두 표현이다.

### 4.2 함께 닫는 잠복 크래시

`rankSwap.ts:222`:

```ts
frames[frames.length - 1].seconds = new Map();
```

**무가드다.** `total > 0`인데 모든 스왑이 `:208`(`if (ceiling < overtake) continue`)이나 `:211`
(묶음 구간 `i < bundledUpTo`)로 걸러지면 `frames`가 비어 `TypeError: Cannot set properties of undefined`가 난다.
D17이 이 함수를 다시 쓰므로 **같은 PR에서** 가드한다(빈 배열이면 그대로 `[]` 반환 — 의미가 같다).

### 4.3 1476 — ref → 렌더 중 setState

**대상 4개**: `lastTargetRef`(`useStagedRanking.ts:74`) · `frameRef`(`:71`) · `pendingRef`(`:73`) ·
`shownOrderRef`(`:76`). 파생인 `shownSecondsRef`(`:77`)·`shownLiveRef`(`:79`)도 함께 재설계한다.

**⚠️ 커밋을 늘리지 않는다.** 계획 수립을 effect로 미루면 새 배열이 도착한 렌더가 최종 순서·최종
기록 그대로 **한 번 커밋되고, 그 커밋에서 레이아웃 애니메이션이 이미 '여러 칸 한 번에'로 발화한다**
(`useStagedRanking.ts:19-22`). 되돌리는 두 번째 커밋이 뒤따라도 이 훅이 막으려던 그 이동을 이미
보여 준 뒤다. **렌더 중 계산은 그 대가로 존재한다** — React의 렌더 중 setState(같은 컴포넌트)는
이 목적의 정식 경로다.

**⚠️ 남겨야 하는 것 2개**

| 대상 | 왜 ref로 남나 |
| --- | --- |
| `planGenRef`(`:92`) | **커밋↔passive effect 사이의 구멍**을 막는다. 계획 교체는 렌더 본문에서 일어나는데 옛 타이머는 effect에서야 걷힌다. 회귀 테스트 `useStagedRanking.test.ts:231`이 이걸 고정한다 |
| `timersRef`(`:82`) | 타이머 id는 렌더 산출물이 아니다 |

**리그 스위트 30개**(`rankSwap.test.ts` 15 + `useStagedRanking.test.ts` 11 + `RankRowShell.test.tsx` 4)가
안전망이다. 1475는 그중 일부를 **D17에 맞게 다시 세우는 것이 정상 경로다** — "밀려나는 행의
기록은 재생 내내 서버 값 그대로다" 같은 규칙은 **모순 없는 입력에서만** 성립하는 규칙으로 재진술한다.

---

## 5. 1493 — 리그 화면 구조 전환

### 5.1 트리 변화

```
[지금]  ScrollView(:373, stickyHeaderIndices={showPodium ? [1] : [0]})
          ├ 포디움(:397)                       ← 자식 0 (조건부)
          ├ 내 순위 스트립(:498)                ← 자식 1 = sticky
          ├ 섹션 헤더(:537)
          └ RankRowShell × N(:559)

[이후]  <View>                                              ← position:relative
          ├ Animated.FlatList
          │    ListHeaderComponent = 포디움 + **스트립 높이 스페이서** + 섹션 헤더
          │    data = listRows · keyExtractor = userId
          │    renderItem = RankRowShell(layout={m.css(rankSwap)})   ← 그대로
          │    onScroll = useAnimatedScrollHandler → scrollY(shared value)
          └ 내 순위 스트립 (absolute · translateY = clamp(stripTop − scrollY, 0, ∞))
                                                     ← **sticky 거동을 손수 재현한다**
```

**스트립을 밖으로 빼는 이유** — `stickyHeaderIndices`는 **자식 인덱스 계약**이라 FlatList의
셀 인덱스와 뜻이 다르다. 헤더 안에 넣어도 sticky가 되지 않으므로 리스트 밖으로 뺀다.

### 5.1.1 ⚠️ 스트립은 **현재 거동을 그대로 재현한다** (오너 결정 · 시안 ⓑ)

> **오너 결정(2026-08-11): "리그 순위 스트립 기존사항 유지".** 즉 **스크롤이 포디움을 넘을
> 때만 스트립이 위에 붙는다.** 첫 화면 인상이 지금과 같아야 한다 — **포디움이 가려지지 않는다.**
> 시안 [ui.html](ui.html) §②가 이 ⓑ안으로 그려져 있다.

**"리스트 밖으로 뺐으니 항상 떠 있어도 거동이 같다"는 틀렸다.** 지금 스트립은 **포디움 아래에서
출발해** 스크롤하면서 위로 올라붙는다. 처음부터 맨 위에 띄우면 **포디움 상단이 스트립 뒤로 들어가**
첫 화면 인상이 달라진다. 이 문서 초판이 ⓐ(항상 오버레이)로 적혀 있었다(2026-08-11 정정).

**재현 방식 — 오프셋을 직접 추적한다.**

| 항목 | 명세 |
| --- | --- |
| `scrollY` | `useAnimatedScrollHandler`로 잡는 **shared value**. `scrollEventThrottle={16}` |
| `stripTop` | 헤더 안 **스페이서의 `onLayout` y**(콘텐츠 좌표). 포디움 유무(`showPodium`)로 값이 달라지므로 **상수로 박지 않고 측정한다** |
| 스트립 위치 | `useAnimatedStyle` → `translateY: Math.max(stripTop - scrollY, 0)` |
| 헤더 스페이서 | **스트립 높이만큼 자리를 비워 둔다.** RN의 sticky 자식도 콘텐츠 흐름에서 자리를 차지한다 — 스페이서가 없으면 랭킹 행들이 스트립 높이만큼 위로 올라온다 |

**⚠️ 등장 경계에서 떨림이 생기지 않게 하는 것이 이 티켓의 구현 과제다.**

| 함정 | 왜 떨리나 | 처방 |
| --- | --- | --- |
| `scrollY`를 **React state**로 들고 `setState`로 갱신 | 매 프레임 리렌더 + JS 스레드 왕복이라 경계에서 한 박자 늦게 붙는다. 단계 재생(390ms 간격 리렌더)과 겹치면 눈에 띈다 | shared value + `useAnimatedStyle`(UI 스레드). **JS 스레드로 넘기지 않는다** |
| 경계에서 **마운트/언마운트 토글**(`scrollY > stripTop && <Strip/>`) | 붙는 순간 노드가 새로 생겨 한 프레임 깜빡인다 | **항상 마운트**하고 `translateY`만 바꾼다. 조건부 렌더 금지 |
| `stripTop`이 **측정 전 0** | 첫 프레임에 스트립이 맨 위에 붙었다가 측정 후 내려온다 | 측정 전에는 스트립을 **그리지 않는다**(opacity 0) — 첫 프레임 한 장이고 사용자 조작 전이다 |
| 클램프 없이 `stripTop - scrollY` | 위로 당기는 바운스(음수 `scrollY`)에서 스트립이 아래로 밀린다 | 상한도 클램프: `min(max(stripTop - scrollY, 0), stripTop)` |
| 포디움 접힘/펼침으로 `stripTop`이 바뀜 | 측정이 늦어 한 프레임 어긋난다 | `showPodium` 변화 시 스페이서 `onLayout`이 다시 불린다 — 그 값만 쓰고 이전 값을 캐시하지 않는다 |

**검증** — 수동 QA(§9)에 "스크롤을 포디움 경계 앞뒤로 천천히 왕복" 항목을 포함한다.
경계에서 스트립이 **한 번도 깜빡이지 않아야** 한다.

### 5.2 무효가 되는 것 — 스크롤 제어

| 지금 | 왜 못 쓰나 | 이후 |
| --- | --- | --- |
| `myRowY.current = e.nativeEvent.layout.y`(`:568`) | **FlatList 셀 안의 `onLayout` y는 셀 기준**이다. 리스트 콘텐츠 오프셋이 아니다 | 측정 폐기. 행 **인덱스**로 판단 |
| `listRef.scrollTo({ y })`(`:238`·`:241`·`:254`·`:575`) | `ScrollView` API | `scrollToOffset({ offset })` |
| `scrollToMyRow()`의 `myRowY - MY_STRIP_SPACE`(`:241`) | 위와 같음 | `scrollToIndex({ index, viewOffset: MY_STRIP_SPACE })` + **`onScrollToIndexFailed` 필수** — 아직 렌더되지 않은 인덱스로 점프하면 던진다 |
| `pendingScrollToMe` 1회 자동 스크롤(`:565-584`) | `rowBottom > listHeight` 판정이 `myRowY`에 의존 | `onScrollToIndexFailed` 폴백에서 근사 오프셋으로 한 번 더 시도. **"내 행이 첫 화면 밖일 때만 스크롤"이라는 조건은 유지한다**(테스트로 고정) |

### 5.3 연출 배치 (D22)

| 목록 | layout 애니메이션 | 비고 |
| --- | --- | --- |
| 순위 목록(1열) | `RankRowShell`의 **행별** `layout={m.css(rankSwap)}` **유지**(`RankRowShell.tsx:66`) | `itemLayoutAnimation`을 **얹지 않는다.** 둘을 겹치면 같은 노드의 layout을 두 시스템이 다툰다 ([D22](policy.md#d22)) |
| 친구 그리드(**2열**) | **카드별** `layout={m.css(FRIEND_LAYOUT)}` | `itemLayoutAnimation`은 **쓸 수 없다** — 아래 ⚠️ |

**⚠️ 2열 `FlatList`에는 `itemLayoutAnimation`을 지정할 수 없다.** 현 의존성
`react-native-reanimated@4.5.0`(`app/package.json:65`)이 소스에서 명시적으로 금지한다 —
`app/node_modules/react-native-reanimated/src/component/FlatList.tsx:64-69` verbatim:

> *Lets you pass layout animation directly to the FlatList item. Works only with a single-column
> `Animated.FlatList`, `numColumns` property cannot be greater than 1.*

**대체 설계 — 2열은 유지하고 카드마다 `layout`을 단다.** 이 화면의 포디움이 이미 같은 처방이다:

```ts
// LeagueScreen.tsx:74·:77 — 포디움의 선례를 그대로 따른다
const AnimatedFriendCard = Animated.createAnimatedComponent(TouchableOpacity);
const FRIEND_LAYOUT = springify(new LinearTransition()); // 모듈 상수 — 매 렌더 새 빌더 금지
// renderItem / map 안에서
<AnimatedFriendCard key={f.userId} layout={m.css(FRIEND_LAYOUT)} … />
```

| 왜 이 모양인가 | 근거 |
| --- | --- |
| **래퍼를 새로 끼우지 않는다** — 카드 자체(`TouchableOpacity`)를 애니메이션 컴포넌트로 만든다 | 노드 수 불변 → Maestro `testID` 셀렉터 계약 유지. 포디움 주석이 같은 이유를 적어 뒀다(`LeagueScreen.tsx:69-71`) · 정본 D13(래퍼 금지) |
| **빌더는 모듈 상수** | `PODIUM_LAYOUT`(`:77`)과 같다. `springify`는 빌더 **인스턴스**를 받으므로 렌더마다 새로 만들면 안 된다 |
| **게이트는 `m.css()` 한 곳** | `springify`(`app/src/constants/motion.ts:256-274`)의 기본값은 `M.spring.snappy` + `ReduceMotion.Never`다 — '동작 줄이기' 판단은 `useMotion` 한 곳만 한다 |
| **컨테이너는 2열 그대로** | 목적은 재정렬 전환이지 가상화가 아니다. 친구 수는 화면 하나 분량이라 `Animated.FlatList`+`numColumns={2}`로 바꿀 이유가 없다 — `sortedFriends.map`(→ `useMemo`, §5.4) 유지로 충분하다 |

> **이 절은 D22를 뒤집지 않는다** — 오너 결정은 *"친구 그리드에 재정렬 전환을 붙인다"*이고,
> 연출 결과(`LinearTransition` + `M.spring.snappy`)는 그대로다. 바뀐 것은 **실행 불가능했던
> 수단**뿐이다([D22](policy.md#d22)의 📌 각주).

### 5.4 함께 정리하는 것

| 대상 | 지금 | 이후 |
| --- | --- | --- |
| `sortedFriends`(`:172`) | `[...friends].sort(...)`가 **매 렌더** 돈다 | `useMemo` |
| `visibleRanking.indexOf(row)`(`:587`) | `.map` 안에서 도는 **O(n²)**. 단계 재생 중 390ms마다 리렌더되는 리스트다 | `userId → rank` 인덱스 맵 |

**⚠️ 노드 동일성**(`key={userId}` → `keyExtractor`)은 `rankSwap`이 성립하는 전제다. 배치 계약의
「손대지 말 것」 항목이므로 깨지 않는다.

---

## 6. 1494 — 누끼 완성 리빌

### 6.1 지금

`CharacterCreator.tsx`에 **모션 프리미티브가 하나도 없다.** `ActivityIndicator` 3개가 전부다
(`:292` 처리 중 · `:329` 쿼터 조회 · 액션 영역 1개). 완성 신호는 정적 텍스트
`'나만의 그로몬 생성 성공'`(`:322`)이다.

### 6.2 ⚠️ 먼저 — `cutout → moderate → save`는 **연속된 3단계가 아니다**

이 문서 초판이 셋을 **하나의 진행률**로 묶어 명세했다. **틀렸다**(2026-08-11 정정). 코드로 확인한
실제 흐름은 이렇다 — **사이에 사용자 입력 대기가 있다.**

| # | 코드 | 무엇을 하나 | 끝나면 |
| --- | --- | --- | --- |
| 1 | `runCutout()` `CharacterCreator.tsx:144-154` | 온디바이스 누끼(`cutoutSubject`) | **즉시 `setPhase('ready')`**(`:153`) |
| — | — | **⏸ 사용자가 편집(회전·다시 고르기)하고 '저장'을 누를 때까지 기다린다** | — |
| 2 | `save()` `:216-259` | 캡처 → `moderateImage`(`:226`) → `saveCustomCharacter`(`:244`) | `onSaved(uri)` 또는 `setPhase('ready')` |

**하나로 묶으면 반드시 깨진다** — 링이 35%에서 **사용자 입력을 기다리며 멈춰 있고**(진행 중인
줄 아는데 아무 일도 안 일어난다), 리빌 시점이 누끼 완료와 어긋나 **저장이 끝나야** 캐릭터가
드러난다. 정작 사용자가 자기 캐릭터를 처음 보는 순간은 **누끼가 끝난 그때**다.

### 6.3 이후 — 두 구간을 따로 명세한다

**구간 A — 누끼(`phase === 'working'`) · 리빌의 대상**

| 구간 | 표시 | 토큰 |
| --- | --- | --- |
| 진행 중 | `ProgressRing`(불확정 회전) + `'물건만 오려내는 중…'` | 링은 `M.dur.base` 전환(`ProgressRing.tsx:84-88`) |
| **완성 순간**(`:153` `setPhase('ready')`) | 마스크가 벗겨지며 캐릭터가 드러난다 + 파티클 | `M.spring.bouncy` · `M.dur.celebrate`(1200) |
| 완성 직후 | `hapticSuccess()` + 완성 통보 문구 | — |
| '동작 줄이기' ON | **파티클·리빌만 생략.** 완성 통보·햅틱은 유지 | [정본 D7](../motion/policy.md#d7)과 같은 원리 |

**⚠️ `result.cutout === false`면 리빌도 햅틱도 없다.** `runCutout`은 실패해도 `phase`를 `ready`로
되돌리므로(`:153`) **`phase` 전이만 보면 실패와 성공이 구분되지 않는다.** 판정은
`cut.cutout`(`:152`가 `setError(cut.cutout ? null : …)`로 쓰는 그 값)으로 한다. 오려내지 못한
사진에 축하를 붙이면 **에러 배너와 축하가 같은 화면에 뜬다.**

**구간 B — 저장(`phase === 'checking'` / `'saving'`) · 축하가 아니다**

| 구간 | 표시 | 붙이지 않는 것 |
| --- | --- | --- |
| `checking`(`:219`) · `saving`(`:243`) | **진행 표시만** — 기존 잠금 규율(`busy` `:265`) 그대로 | **햅틱 · 리빌 · 파티클 금지** |

**왜 금지인가** — [D21](policy.md#d21)이 등급 3을 준 것은 **누끼가 완성된 순간**이다. 저장은 그
뒤에 오는 **별개의 짧은 대기**이고, 여기에 축하를 한 번 더 붙이면 `hapticSuccess`의 제약
(`app/src/utils/haptics.ts:24` — *"축하 표면에만 쓴다. 일반 성공 토스트에 붙이면 특별한 순간의
인상이 닳는다"*)을 같은 화면에서 두 번 쓰는 셈이 된다. 저장 성공의 통보는 **호출부(`onSaved`)가
받는 화면 전환**이 이미 한다.

**진행 신호를 어떻게 만드나** — 두 구간 모두 **진척률을 알 수 없다.** 구간 A는 단일 비동기 1건,
구간 B는 2건(모더레이션 → 저장)이다. 그래서:

| 구간 | 링 |
| --- | --- |
| A(누끼) | **불확정 회전 하나.** 확정 진행률 눈금이 없다 — 나눌 단계 경계가 없다 |
| B(저장) | 경계가 하나뿐이다(모더레이션 통과 → 저장). `checking` 0.5 · `saving` 1.0으로 **두 칸만** 올린다 |

`ProgressRing`은 `progress: number`(0~1)를 받는다(`ProgressRing.tsx:35`).

**⚠️ `ProgressRing` 사용 시 유의**

- **첫 마운트에는 애니메이션이 없다** — 현재 값 그대로 그린다(`ProgressRing.tsx:21-22`). 0에서 시작하려면 0으로 마운트한다.
- `decorative` prop은 **링의 progressbar 역할만** 없앤다(자식은 계속 읽힌다). 가운데에 정확한 값을 읽어 주는 텍스트가 없으면 **켜지 않는다.**

**⚠️ 실패 경로에서 중간 상태로 굳지 않는다** — `phase`가 `ready`로 되돌아오는 경로가 **구간마다** 있다.

| 구간 | 경로 | 무엇이 정리돼야 하나 |
| --- | --- | --- |
| A(누끼) | `cut.cutout === false`(`:152-153`) — **`phase`는 성공과 똑같이 `ready`가 된다** | 링 정지 + **리빌·햅틱 미발화**. 에러 배너만 남는다 |
| B(저장) | 모더레이션 `unavailable`(`:231`) · 차단(`:238`) · `catch`(`:257`) | 링이 진행률을 든 채 굳지 않게 **초기화**. 리빌은 애초에 없다 |

세 경로 모두 언마운트 가드 `activeRef`(`CharacterCreator.tsx:132-138`)와의 상호작용을 확인한다 —
`activeRef.current === false`면 `setPhase`조차 하지 않고 빠져나가므로(`:228`·`:245`) **링 정리를
`phase` 전이에만 매달면 안 된다.**

**⚠️ 무한 루프는 화면당 1개 이하** — 불확정 회전이 그 1개다(IA §2 공통 상한). 구간 A와 B는
**동시에 존재하지 않으므로**(A가 끝나야 사용자가 저장을 누른다) 상한을 넘지 않는다. 각 구간이
끝나는 순간 반드시 멈춘다.

**⚠️ `captureRef` 경계** — 저장은 `captureViewRef`(`:127`, `:297`)를 통째로 PNG로 굽는다. 결정 `D-22`가
못 박은 규율 그대로 **리빌 transform은 그 ref 바깥에 건다.** 안쪽에 걸면 찌그러진 중간 프레임이 구워진다.

---

## 7. 1474 — 조회 실패 상태 분리

### 7.1 계약 (D20)

```ts
// 지금: charts.tsx  — 실패를 삼켜 빈 배열로 만든다
const all = await getAllFocusSessions(from, to).catch(() => [] as FocusSessionResponse[]);
setPoints(firstStartPoints(period, dailyFirstStartMinutes(all)));

// 이후: 실패를 **별도 플래그**로 든다 (CalendarCard 패턴 · 정책 D20)
const [points, setPoints] = useState<StartTimePoint[] | null>(null); // null = 아직 없음
const [fetchFailed, setFetchFailed] = useState(false);               // 실패는 여기 하나

// ⚠️ 렌더 판정 순서가 계약이다 — **실패가 points보다 먼저다.**
if (fetchFailed)       return <실패: 안내 + 재시도 />;
if (points === null)   return <로딩 />;
if (points.length === 0) return <빈 상태: '아직 기록이 없어요' />;
```

**⚠️ 왜 `null` 하나로 로딩·실패를 겸하면 안 되나** — 겸하면 **최초 로딩에도 실패 UI가 뜬다.**
정책 D20의 표가 그래서 세 상태를 판별 가능하게 정의한다.

**⚠️ 왜 실패를 `points`보다 먼저 판정하나** — 이전 조회가 성공해 `points`가 남아 있어도 마찬가지다.
**첫 조회가 빈 결과(`[]`)였던 신규 사용자**가 재진입했다가 재조회에 실패하면, `points`를 먼저 보는
순서에서는 실패했는데도 `'아직 기록이 없어요'`가 다시 뜨고 **재시도 버튼도 없다** — 이 티켓이
없애려던 바로 그 화면이다. `CalendarCard`도 실패를 우선한다.

**⚠️ '다시 시도' 버튼은 `load()`를 그대로 걸지 않는다** — 남아 있던 `points`가 있으면 누른 순간
실패 안내가 사라지고 **낡은 차트가 정상 결과처럼** 돌아온다. `retry()`는 `setPoints(null)` 후
재조회해 **로딩으로 되돌린다**(재진입 재조회는 stale-while-revalidate가 맞지만, 사용자가 직접 누른
재시도는 진행 중임이 보여야 한다).

### 7.2 재사용하는 것 — `CalendarCard`가 사실상 정본이다

| 요소 | 위치 |
| --- | --- |
| prop 계약 `T[] \| null`(+ null=실패 주석) | `CalendarCard.tsx:30-32` |
| `noData` / `failed` / `loading` 파생 | `CalendarCard.tsx:74-78` |
| `retryPage()` — 현재 페이지는 부모 재조회, 과거 페이지는 실패 표시 제거 후 effect 재실행 | `CalendarCard.tsx:117-129` |
| 실패 UI 마크업 — `'불러오지 못했어요'` + `'다시 시도'` | `CalendarCard.tsx:312-318` |
| 스타일 `errorOverlay`/`errorText`/`retryBtn`/`retryText` | `CalendarCard.tsx:398-417` |

**문구·버튼 모양은 그쪽을 그대로 따른다.** 같은 화면에서 두 카드가 다르게 실패하면 안 된다.

### 7.3 자리 높이

`FIRST_START_BODY_H`(`app/src/screens/stats/constants.ts:67`, `= CHART_BLOCK_H + HINT_H` = **184**)를
**세 상태 전부**가 쓴다. 로딩(`charts.tsx:316`)·빈 상태(`:321`)는 이미 그렇다 — 실패만 맞추면 된다.
이 상수는 배치 계약의 「손대지 말 것」이다.

### 7.4 테스트

`charts.test.tsx`에 **실패 ↔ 무데이터를 가르는 2건** + 높이 불변 1건.
`getAllFocusSessions`를 **reject시키는 모킹**이 필요하다(현재 모킹은 never-resolving이라 로딩만 재현된다).

---

## 8. 테스트 표 (이 배치가 추가·수정하는 것)

| 파일 | 잠그는 규칙 |
| --- | --- |
| `screens/league/rankSwap.test.ts` | **D17 재정렬** — ③ 배정 불가 입력에서 `[]` · **①′ 단언**(프레임 순회 헬퍼가 `f`·`f₊₁`을 짝지어 읽고, **리드 프레임의 맞바꿈 쌍 하나만** 면제) · 여러 사용자 기록이 동시에 오르는 응답 · **빈 프레임 무가드 회귀**(`:222`) |
| ⚠️ 같은 파일 — **작성 금지** | **"전 프레임 비증가"를 문자 그대로 단언하는 테스트.** 리드 프레임의 역전은 자리 이동의 **원인**이라 그 단언은 정본 §6이 요구하는 연출을 위반으로 잡는다([§4.1](#41-rankswapframes-반환-계약-d17)) |
| `screens/league/useStagedRanking.test.ts` | 기존 11개 유지. 특히 `:231` **"옛 계획의 타이머가 뒤늦게 터져도 새 계획을 지우지 않는다"**가 1476 이관 후에도 통과 |
| `screens/league/components/RankRowShell.test.tsx` | 기존 4개 — FlatList 전환 후에도 `layout` prop·zIndex 규칙 유지 |
| `screens/stats/charts.test.tsx` | **실패 ≠ 무데이터** 2건 + `FIRST_START_BODY_H` 불변 |
| `hooks/useMotion.*.test.ts` (4종) · `useReduceMotion.*.test.ts` (3종) · `motion.test.ts` · `Enter.test.tsx` | D18의 안전망. **`m.enter`가 `startFrameOf`로 접힌 뒤에도 미확정 구간 모습이 같아야 한다** |
| D18 진입점 테스트 (신규) | 갈래 × 상태 4×4 표(§3.3) · **되감기 금지 불변식** |
| 리그 화면 테스트 | **자동 스크롤 목적지** — "내 행이 첫 화면 밖일 때만 스크롤"이 FlatList 전환 후에도 성립 |
| 알럿 이관 지점별 | `Alert.alert` **미호출** + `show({ tone: 'error' })` 호출. 모킹 관례는 `GroupProfileEditScreen.test.tsx:45-48` |

**작성 금지** — 애니메이션 중간 프레임·타이밍·이징 곡선 단언([정본 D14](../motion/policy.md#d14)).
jest에서 워클릿은 모킹돼 실제로 실행되지 않는다.

---

## 9. 수동 QA — 이 배치에만 해당하는 것

- **1482 세 곳은 앱을 켜고 1초 안에** 그 화면에서 조작해야 재현된다(미확정 구간이 그만큼 짧다).
  콜드 스타트 → ① 온보딩/홈 상세 사용시간 분석 진입 ② 과목 순서 드래그 ③ 통계 주 탭 꺾은선.
  **'동작 줄이기'를 켠 상태와 끈 상태 양쪽 다.**
- **1494**는 **두 구간을 따로** 본다(§6.2·§6.3) —
  ① 실제 사진으로 누끼 1회(리빌·햅틱이 **누끼가 끝난 그 순간** 나는가, 저장 뒤가 아닌가)
  ② **누끼 실패**(오려낼 물체가 없는 사진 — 리빌·햅틱이 **나지 않아야** 한다)
  ③ 저장 실패 경로(비행기 모드로 모더레이션 실패 — 저장 구간에 축하가 붙지 않는가).
- **1493**은 순위 갱신 + 리그 드롭다운 전환 + **내 행 자동 스크롤**(내 행이 첫 화면 밖일 때/안일 때)
  + **내 순위 스트립**: 첫 화면에서 포디움이 가려지지 않는가 · **포디움 경계 앞뒤로 천천히 왕복**할 때
  스트립이 한 번도 깜빡이지 않는가(§5.1.1).
- **1491**은 이관한 실패 통보를 **VoiceOver 켜고** 한 번씩 — 알럿은 자동으로 읽히지만 토스트는 아니다.
