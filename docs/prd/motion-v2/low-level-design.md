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
| 3 | **두 불변식을 동시에 만족하는 배정이 없다** (신규 · D17) | — |

**불변식(정책 D17 재게시)**

```
① 프레임 내 비증가 : ∀ 프레임 f, ∀ i<j  →  value(f, row_i) ≥ value(f, row_j)
② 행별 구간       : ∀ 프레임 f, ∀ 행 r  →  prevShown(r) ≤ value(f, r) ≤ final(r)
```

**마지막 프레임은 예외 없이 서버 최종값이다**(`rankSwap.ts:221-222`). 이 보장은 유지한다.

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

[이후]  <View>
          ├ Animated.FlatList
          │    ListHeaderComponent = 포디움 + 섹션 헤더
          │    data = listRows · keyExtractor = userId
          │    renderItem = RankRowShell(layout={m.css(rankSwap)})   ← 그대로
          └ 내 순위 스트립 (리스트 **밖 오버레이**, absolute)          ← 항상 보이므로 거동 동일
```

**스트립을 밖으로 빼는 이유** — `stickyHeaderIndices`는 **자식 인덱스 계약**이라 FlatList의
셀 인덱스와 뜻이 다르다. 스트립은 스크롤 위치와 무관하게 **항상 보이는 요소**이므로 오버레이로
빼도 사용자가 보는 거동이 같다(그게 sticky의 목적이었다).

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
| 순위 목록 | `RankRowShell`의 `layout={m.css(rankSwap)}` **유지**(`RankRowShell.tsx:66`) | `itemLayoutAnimation`을 **얹지 않는다.** 둘을 겹치면 같은 노드의 layout을 두 시스템이 다툰다 |
| 친구 그리드 | **`itemLayoutAnimation={springify(new LinearTransition())}`** | `LeagueScreen.tsx:684`의 `sortedFriends.map`을 `Animated.FlatList` + `numColumns={2}`로 |

`springify`는 `app/src/constants/motion.ts:256-274` — 기본값 `M.spring.snappy` + `ReduceMotion.Never`
(게이트는 `useMotion` 한 곳만 판단한다).

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

### 6.2 이후

| 구간 | 표시 | 토큰 |
| --- | --- | --- |
| 처리 중(`phase === 'working'`) | `ProgressRing` + `'물건만 오려내는 중…'` | 링은 `M.dur.base` 전환(`ProgressRing.tsx:84-88`) |
| **완성 순간** | 마스크가 벗겨지며 캐릭터가 드러난다 + 파티클 | `M.spring.bouncy` · `M.dur.celebrate`(1200) |
| 완성 직후 | `hapticSuccess()` + 완성 통보 문구 | — |
| '동작 줄이기' ON | **파티클·리빌만 생략.** 완성 통보·햅틱은 유지 | [정본 D7](../motion/policy.md#d7)과 같은 원리 |

**진행 신호를 어떻게 만드나** — 실제 작업은 3단계 비동기(cutout → moderate → save)이고 각 단계의
진척률을 알 수 없다. **단계 경계만 확정 진행률로 쓰고, 단계 안은 불확정(회전)으로 둔다.**
`ProgressRing`은 `progress: number`(0~1)를 받으므로(`ProgressRing.tsx:35`) 단계 경계에서 값을 올린다.

**⚠️ `ProgressRing` 사용 시 유의**

- **첫 마운트에는 애니메이션이 없다** — 현재 값 그대로 그린다(`ProgressRing.tsx:21-22`). 0에서 시작하려면 0으로 마운트한다.
- `decorative` prop은 **링의 progressbar 역할만** 없앤다(자식은 계속 읽힌다). 가운데에 정확한 값을 읽어 주는 텍스트가 없으면 **켜지 않는다.**

**⚠️ 실패 3경로에서 중간 상태로 굳지 않는다** — `phase`가 `ready`로 되돌아오는 경로가 셋이다
(모더레이션 `unavailable` / 쿼터 차단 / `catch`). 세 경로 모두에서 링과 리빌이 정리돼야 하고,
언마운트 가드 `activeRef`(`CharacterCreator.tsx:132-138`)와의 상호작용을 확인한다.

**⚠️ 무한 루프는 화면당 1개 이하** — 불확정 구간 회전이 그 1개다. 완성 뒤 반드시 멈춘다(IA §2 공통 상한).

**⚠️ `captureRef` 경계** — 저장은 `captureViewRef`(`:127`, `:297`)를 통째로 PNG로 굽는다. 결정 `D-22`가
못 박은 규율 그대로 **리빌 transform은 그 ref 바깥에 건다.** 안쪽에 걸면 찌그러진 중간 프레임이 구워진다.

---

## 7. 1474 — 조회 실패 상태 분리

### 7.1 계약 (D20)

```ts
// 지금: charts.tsx  — 실패를 삼켜 빈 배열로 만든다
const all = await getAllFocusSessions(from, to).catch(() => [] as FocusSessionResponse[]);
setPoints(firstStartPoints(period, dailyFirstStartMinutes(all)));

// 이후: 실패를 별도 상태로 든다 (CalendarCard 패턴)
//   points === null && !failed → 로딩
//   points === null &&  failed → 실패(안내 + 재시도)
//   points.length === 0        → 진짜 무데이터
```

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
| `screens/league/rankSwap.test.ts` | **D17 재정렬** — 모순 입력에서 `[]` · 전 프레임 비증가 단언(프레임 순회 헬퍼) · 여러 사용자 기록이 동시에 오르는 응답 · **빈 프레임 무가드 회귀**(`:222`) |
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
- **1494**는 실제 사진으로 누끼 1회 + **실패 3경로**(비행기 모드로 모더레이션 실패 등).
- **1493**은 순위 갱신 + 리그 드롭다운 전환 + **내 행 자동 스크롤**(내 행이 첫 화면 밖일 때/안일 때).
- **1491**은 이관한 실패 통보를 **VoiceOver 켜고** 한 번씩 — 알럿은 자동으로 읽히지만 토스트는 아니다.
