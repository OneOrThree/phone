# Low-Level Design — 모션 v2

> 2026-08-11 · 배치 GROMO-1474·1475·1476·1482·1491·1493·1494 · 현재 구현 상태 기준
> 세트: [README](README.md) · [정책 v2](policy.md) · **LLD v2** · [IA v2](information-architecture.md) · [시안](ui.html)
>
> **상위 정본은 [`docs/prd/motion/low-level-design.md`](../motion/low-level-design.md)다.**
> 이 문서는 ① 그 정본이 구현을 못 따라온 **드리프트 2건**을 닫고 ② 이번 배치의 구현 명세를 담는다.
> 토큰(`M.dur`·`M.curve`·`M.spring`)은 상위 §2가 그대로 정본이며 **이 배치에서 값이 바뀌지 않는다.**
>
> ⚠️ **애니메이션 구현은 이번 릴리즈에서 빠졌다**(오너 결정). 이 문서가 그래도 머지되는 이유는
> 여기서 가린 결정·조사를 보존하기 위해서다 — 자세한 것과 **줄 번호 좌표계 주의사항**은
> [README](README.md#구현-상태--문서-세트가-구현보다-먼저-머지된다).

---

## 1. 정본 드리프트 — 무엇이 어긋나 있나

| # | 정본 서술 | 실제 구현 | 닫는 절 |
| --- | --- | --- | --- |
| 1 | 상위 LLD §3의 `useMotion` 계약에 **`ready`와 `enter()`가 없다** | 구현 중 결정 `D-30`·`D-31`로 생겼다(`useMotion.ts:37`·`:66`). 이 배치의 여러 파일이 이미 그것에 의존한다 | [§2](#2-usemotion-현행-계약-정정) |
| 2 | **`whenReduceMotionReady`가 문서 어디에도 없다** | `useReduceMotion.ts:101-111`. 훅을 못 쓰는 비동기 흐름 전용. 실사용 2곳 | [§2.2](#22-whenreducemotionready--비동기-흐름용) |

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
| `ScreenTimeAnalyzingOverlay.tsx:57-110` | `progress` | 마운트 타임스탬프(`:55`) + `take()` 앞깎기(`:73-81`)로 **남은 구간을 두 배속**으로 채운다 | `play(elapsed)`가 **시작 진행률을 [§3.5의 구간별 함수](#35-경과-시간--진행률은-구간별-함수다-단일-비율이-아니다)로 두고** 남은 구간을 원래 속도로 재생. `FILL_MS`/`HOLD_MS`/`FINISH_MS`는 [정본 D15](../motion/policy.md#d15) 예외 그대로 — **가드 타임 자체는 reduce여도 흐른다** |
| `DraggableSubjectRows.tsx:59-76` | `settle` | `settleInstantRef.current = m.ready && m.reduce` — **미확정을 모션 허용으로** 취급 | 미확정도 `finish()`(즉시 완료). ⚠️ **이 파일은 레거시 RN `Animated`다**(1492 제외) — `duration: 160`(`:127`·`:206`) 하드코딩과 `Animated.timing`은 그대로 두고, 진입점은 **불리언 판정만** 쓴다 |
| `charts.tsx:127-141` | `enter` | `startedRef` 1회 래치(`:132`)라 재생 중 설정을 켜도 즉시 반환 | 재생 중 ON에서 `finish()`가 불려 draw-on이 최종 상태로 끊긴다. **1회성(인스턴스당 한 번 진입)은 유지** — `plotW > 0` 게이트도 그대로 |

**⚠️ `charts.tsx`는 WS-3(1474)이 먼저 머지된 뒤 손댄다** — 같은 파일이다.

### 3.5 경과 시간 → 진행률은 **구간별 함수**다 (단일 비율이 아니다)

이 문서 초판이 시작 진행률을 `elapsed / ANALYZE_MS`로 적었다. **틀렸다**(2026-08-11 정정).
그 식은 **원 시퀀스의 진행률이 아니다.**

시퀀스는 세 구간이다(`ScreenTimeAnalyzingOverlay.tsx:27-30`·`:89-108`):

| 구간 | 길이 | 진행률 |
| --- | --- | --- |
| `FILL_MS` | 2000ms | 0 → **0.9** (`Easing.linear`) |
| `HOLD_MS` | 900ms | **0.9 유지** (가드 타임) |
| `FINISH_MS` | 300ms | 0.9 → **1.0** (`Easing.out(Easing.cubic)`) |
| `ANALYZE_MS` | **3200ms** | — |

**검산 — 두 지점이면 충분하다.**

| 확정까지 경과 | 원 시퀀스의 값 | `elapsed / ANALYZE_MS` | 차이 |
| --- | --- | --- | --- |
| **1000ms**(fill 한가운데) | `0.9 × 1000/2000` = **45.0%** | `1000/3200` = **31.3%** | **13.7%p 낮다** |
| **2500ms**(hold 구간) | **90.0%**(홀드 중) | `2500/3200` = **78.1%** | **11.9%p 되감는다** |

**그 식은 자기가 고치려던 문제도 못 고친다.** 남은 시간은 현행 `take()`가 이미 옳게 깎으므로
(1000ms 경과면 `fillMs = 1000`), 시작값 31.3%에서 0.9까지 1000ms에 채우면 속도가
`0.587/1000ms` — 원래 속도(`0.45/1000ms`)의 **1.3배**다. 2500ms 경과면 `fillMs = 0`이라
78.1%에서 90%로 **한 프레임에 튄다.** 즉 두 배속을 없애는 대신 **배속 + 점프**로 바꾼 셈이다.

**계약** — 시작값은 아래 함수로, 남은 시간은 **현행 `take()` 그대로** 쓴다. 고칠 것은 **시작값 하나**다.

```ts
/** 확정까지 흘러간 시간(ms) → 그 순간 시퀀스가 그리고 있어야 할 진행률(0~1). */
function progressAt(elapsed: number): number {
  if (elapsed <= 0) return 0;
  if (elapsed < FILL_MS) return 0.9 * (elapsed / FILL_MS);          // 차오르는 중
  if (elapsed < FILL_MS + HOLD_MS) return 0.9;                       // 홀드(가드 타임)
  if (elapsed < ANALYZE_MS) {
    const t = (elapsed - FILL_MS - HOLD_MS) / FINISH_MS;
    return 0.9 + 0.1 * easeOutCubic(t);                              // 마무리
  }
  return 1;
}
```

| 남은 시간 | 값 | 근거 |
| --- | --- | --- |
| `fillMs` | `max(0, FILL_MS − elapsed)` | 현행 `take(FILL_MS)`(`:74-79`)와 **같다** |
| `holdMs` | `clamp(FILL_MS + HOLD_MS − elapsed, 0, HOLD_MS)` | 현행 `take(HOLD_MS)`와 같다 |
| `finishMs` | `clamp(ANALYZE_MS − elapsed, 0, FINISH_MS)` | 현행 `take(FINISH_MS)`와 같다 |

**검산(속도가 원래와 같은가)** — 1000ms 경과: 시작 45.0% → 목표 90%를 `fillMs = 1000ms`에.
`0.45 / 1000ms` = 원래 `0.9 / 2000ms`와 **동일**. 2500ms 경과: `fillMs = 0`이라 90%가 그대로
현재 값이므로 **점프가 없고**, 홀드 400ms 뒤 마무리 300ms가 남는다.

**⚠️ 마지막 구간의 이징은 근사다.** `finishMs`가 깎인 채 `Easing.out(Easing.cubic)`을 다시 걸면
곡선 모양이 원본과 정확히 같지는 않다. **되감기는 없고 종료 시각도 그대로**이며 구간이 300ms라
수용한다 — 정확히 맞추려면 이 잔여 구간만 선형으로 이어도 된다.

**⚠️ 되감기 금지 불변식과 함께 쓴다**([§3.3](#33-갈래--상태--호출되는-콜백)의 불변식 1).
`play()`가 대입하는 시작값은 `max(현재 값, progressAt(elapsed))`다. 현행 `:85`의
*"이미 100%면 되감지 않는다"* 가드는 그 특수 경우이며 그대로 남는다.

**왜 D18이 이 함수를 요구하는가** — [D18](policy.md#d18)의 진행바 갈래가 *"**시간에 비례해
이어가기** — 되감으면 안 된다"* 인데, **"시간에 비례"의 기준은 총 길이가 아니라 그 시점에
시퀀스가 그리고 있어야 할 값**이다. 홀드 구간이 있는 순간 둘은 갈라진다 — 총 길이 기준으로는
홀드 900ms 동안에도 진행률이 계속 오르는데, 시퀀스는 그동안 90%에 멈춰 있다. 총 길이 기준식은
**되감기 금지 불변식을 스스로 어긴다.**

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
          ├ RankRowShell × N(:559)
          ├ 조회 실패+재시도 / 빈 상태(:606-622)   ← ⚠️ 초판이 빠뜨렸던 후행 UI
          ├ 핀 모드 빈 상태(:624-626)             ← ⚠️ 같음
          └ TierGuide 진입 스트립(:628-637)       ← ⚠️ 같음 · **무조건 렌더**

[이후]  <View>                                              ← position:relative
          ├ Animated.FlatList
          │    ListHeaderComponent = 포디움 + **스트립 높이 스페이서** + 섹션 헤더
          │    data = listRows · keyExtractor = userId
          │    renderItem = RankRowShell(layout={m.css(rankSwap)})   ← 재정렬은 그대로
          │                  + enterEnabled prop 신설 (§5.3.1 — 진입 1회 보장)
          │    ListFooterComponent = 위 후행 UI **3덩어리 전부** (§5.1.2)
          │    ListEmptyComponent = **쓰지 않는다** (§5.1.2 — 술어가 다르다)
          │    onScroll = useAnimatedScrollHandler → scrollY(shared value)
          │    refreshControl · contentContainerStyle · onLayout = 그대로 이관
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

### 5.1.2 후행 UI — `ListFooterComponent` 하나에 담고 `ListEmptyComponent`는 쓰지 않는다

**이 문서 초판이 랭킹 행 뒤에 있는 UI 세 덩어리를 통째로 빠뜨렸다**(2026-08-11 정정).
`ScrollView`는 임의 자식을 담지만 **`FlatList`는 못 담는다** — 헤더/데이터만 정의한 채 전환하면
**저 UI가 화면에서 사라진다.**

| # | 무엇 | 위치 | 렌더 조건 |
| --- | --- | --- | --- |
| 1 | **조회 실패 + 재시도** `'랭킹을 불러오지 못했어요'` / `'다시 시도'` | `LeagueScreen.tsx:608-619` | `visibleRanking.length === 0 && showRankingError` |
| 1′ | **빈 리그** `'아직 이 리그엔 아무도 없어요'` | `:620-622` | `visibleRanking.length === 0 && !showRankingError` |
| 2 | **핀 모드 빈 상태** `'랭킹에서 핀을 누르면 여기에 담겨요'` | `:624-626` | `pinnedOnly && !showRankingError && listRows.length === 0` |
| 3 | **TierGuide 진입 스트립**(`내 티어 · {name}` → `navigation.navigate('TierGuide')`) | `:629-637` | **없다 — 무조건 렌더된다** |

**⚠️ `ListEmptyComponent`를 쓰면 안 된다 — 술어가 다르다.** `ListEmptyComponent`가 보는 것은
`data.length === 0`, 즉 **`listRows.length === 0`**이다. 그런데 위 1·1′이 보는 것은
**`visibleRanking.length === 0`**이고, 일반 모드의 `listRows`는
`visibleRanking.slice(3)`이다(`:233` — 포디움이 앞 3명을 가져간다). 둘이 갈리는 실제 케이스:

> **리그에 1~3명만 있을 때** — `visibleRanking.length`는 1~3이라 빈 상태가 아니지만
> `listRows`는 **비어 있다.** `ListEmptyComponent`를 걸면 포디움에 사람이 서 있는 화면에
> **`'아직 이 리그엔 아무도 없어요'`가 함께 뜬다.** 지금은 아무것도 뜨지 않는다.

핀 모드에서도 갈린다 — 2의 술어는 `listRows.length === 0`이지만 **`pinnedOnly` 조건이 더 붙는다.**

**처방 — 세 덩어리를 `ListFooterComponent` 하나에 그대로 넣는다.** `ListFooterComponent`는
`data`가 비었든 아니든 **항상, 그리고 행들 뒤에** 렌더되므로 **현재의 자식 순서와 술어가
그대로 보존된다.** 조건문을 FlatList의 술어로 번역하지 않는 것이 핵심이다 — 번역하는 순간
위 케이스가 생긴다.

| 항목 | 명세 |
| --- | --- |
| 담는 것 | 1·1′·2·3 **전부**. 각 블록의 `&&` 조건식은 **한 글자도 바꾸지 않고 옮긴다** |
| `ListEmptyComponent` | **지정하지 않는다** |
| 참조 안정성 | **element**(`ListFooterComponent={footer}`) 또는 `useCallback`으로 안정화한 컴포넌트를 쓴다. **렌더마다 새로 만드는 인라인 함수 컴포넌트는 금지** — FlatList가 매 렌더 언마운트/리마운트해 '다시 시도' 버튼의 눌림 상태가 끊기고, 단계 재생 중(390ms마다 리렌더) 반복된다 |
| 스트립 오버레이와의 관계 | 후행 UI는 **스크롤 콘텐츠 안**이다. §5.1.1의 오버레이 스트립(리스트 밖)과 섞지 않는다 |

**그대로 이관되는 나머지 props** — `refreshControl`(`:382-388`) · `contentContainerStyle`
(`paddingBottom: insets.bottom + TAB_BAR_SPACE + 16` `:380`) · `onLayout`(`listHeight` `:376-378`)
는 `FlatList`도 같은 이름으로 받는다. **빠뜨리면 당겨서 새로고침과 탭바 여백이 사라진다.**

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

### 5.3.1 가상화가 **진입 연출을 되풀이시킨다** — 1493 설계의 구멍

**이 문서 초판(과 [IA §3.1](information-architecture.md))이 "진입 연출은 FlatList 전환 후에도
같다"고 적었다. 틀렸다**(2026-08-11 정정). 같지 않고, **고치지 않으면 스크롤할 때마다 행이 날아든다.**

**왜 깨지나** — 세 사실의 결합이다.

| # | 사실 | 출처 |
| --- | --- | --- |
| 1 | `FlatList`는 창 밖으로 나간 셀을 **언마운트**했다가 다시 들어오면 **다시 마운트**한다 | 가상화의 정의 그 자체 — 1493이 얻으려는 것이 바로 이 동작이다([IA §6](information-architecture.md#6-부채-목록--델타)) |
| 2 | `m.enter()`의 **결정 경계는 컴포넌트 마운트**다. 새 인스턴스면 그 시점 설정으로 **다시 정하고**, 진입 스타일이 새로 붙는다 | `useMotion.ts:93-94` · [§2.1-2](#21-ready--enter의-계약--정본이-놓친-세-가지) |
| 3 | `RankRowShell`은 **마운트마다** `m.enter(enterUp(enterIndex))`를 실행한다 | `RankRowShell.tsx:67` |

**`useRef(index).current`는 이걸 못 막는다.** 그 래치(`RankRowShell.tsx:37`)가 얼리는 것은
**시차 인덱스**이지 재생 여부가 아니다 — 애초에 *"재정렬로 인덱스가 바뀌어도 같은 노드에서
진입이 재생되지 않게"* 하려고 넣은 것이고(그 파일 `:12-23` 주석), **노드가 죽었다 살아나는
경우는 그 주석의 사정 범위 밖**이다. 오히려 악화된다: 40번째 자리에서 재마운트되면
`enterUp(40)`으로 굳어 시차 상한까지 지연된 뒤에 날아든다.

**지금은 왜 안 보이나** — `ScrollView`(`LeagueScreen.tsx:373`)라 **행이 전부 마운트돼 있다.**
진입은 화면당 1회이고, 살아남은 노드는 자리만 옮긴다. 즉 **이 결함은 1493이 만든다.**

**핵심 — `RankRowShell`은 자기 마운트만 보고는 판단할 수 없다.** *"이 행이 이미 진입한 적이
있는가"* 는 **셀 수명보다 오래 사는 지식**이라 셀 안의 ref로는 표현되지 않는다(셀과 함께 죽는다).

**처방 A (권장) — 부모 수명의 `seen` 집합**

| 항목 | 명세 |
| --- | --- |
| 어디에 | **`FlatList` 바깥**(`LeagueScreen`)의 `useRef<Set<string>>`. 키는 **`userId`**(= `keyExtractor`와 같은 키) |
| 무엇을 넘기나 | `RankRowShell`에 prop 하나 추가 — `enterEnabled = !seen.has(userId)`. 셸은 이 값이 거짓이면 `m.enter(...)`를 **스타일 배열에 넣지 않는다** |
| 언제 기록하나 | 셸의 마운트 effect에서 `seen.add(userId)` |
| **언제 비우나** | **목록의 정체성이 바뀔 때** — 리그 전환(`selectLeague` `:254`) · 핀 모드 토글(`pinnedOnly`). 그때는 "새로 들어온 목록"이라 시차 진입이 맞다. **비우지 않으면 리그를 갈아탄 뒤 진입 연출이 영영 나지 않는다** |
| 왜 모듈 전역 `Set`이 아닌가 | 화면을 떠났다 돌아와도 진입이 안 나고, 계정 전환에서 새는 것을 막을 자리가 없다. **수명이 화면과 같아야 한다** |

**처방 B (대안) — 초기 창 밖은 진입 없음**: `index < INITIAL_ENTER_COUNT`에만 진입을 허용한다.
집합 수명 관리가 없어 단순하지만, **스크롤해서 처음 나타나는 행이 진입 연출을 못 받는다** —
진입 연출의 의도(요소가 없다가 나타난다)와 어긋나므로 A가 실패할 때만 쓴다.

**⚠️ `removeClippedSubviews={false}` + 큰 `windowSize`로 언마운트를 줄이는 것은 처방이 아니다.**
그건 가상화를 되돌리는 것이고, 1493이 존재하는 이유([IA §6](information-architecture.md#6-부채-목록--델타)
*"순위 목록이 `ScrollView` 안이라 가상화가 없다"*)를 지운다.

**함께 기록해 두는 것 — 같은 원인의 무해한 부작용 2개.** 처방이 필요 없지만 QA에서 보이면
이것들이다.

| 부작용 | 왜 무해한가 |
| --- | --- |
| 재마운트된 셀은 `prevIndexRef`(`RankRowShell.tsx:47`)를 잃어 `rising`이 `false`로 시작 → zIndex 상승 표시가 없다 | 그 행은 **화면 밖에 있었다.** 교차 연출이 보이지 않는 자리에서 일어난 것이라 잃은 그림이 없다 |
| 재마운트된 셀은 이전 레이아웃이 없어 `layout={m.css(rankSwap)}` 궤적이 성립하지 않는다 | 같은 이유. 노드 동일성(`keyExtractor = userId`)은 **화면 안에 있는 동안** 유지되므로 보이는 재정렬은 그대로 연출된다 |

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

> 📌 **여기서부터 `CharacterCreator.tsx:NNN`은 구현본 기준이다.** 이 절 이하의 명세는 추정이
> 아니라 **이미 구현된 것을 옮긴 것**이다 — 출처는 브랜치 `afeat/GROMO-1494-cutout-reveal`의
> `app/src/screens/character/CharacterCreator.tsx`(+ `CharacterCreator.test.tsx`)이고, 이 배치의
> 애니메이션 구현이 릴리즈에서 빠지면서 **머지되지 않은 채 보존돼 있다.**
> **§6.1·§6.2의 줄 번호는 `main`(구현 전) 기준**이라 두 좌표계가 섞이지 않게 주의한다.
> 다음에 이 표면을 여는 사람은 이 절을 처음부터 설계하지 말고 그 브랜치를 먼저 꺼낸다.

**구간 A — 누끼(`phase === 'working'`) · 리빌의 대상**

| 구간 | 표시 | 토큰 |
| --- | --- | --- |
| 진행 중 | `ProgressRing`(**고정 호 + 회전** — [§6.4 불확정 링 계약](#64-불확정-링-계약--progressring에는-불확정-모드가-없다)) + `'물건만 오려내는 중…'` | 회전 한 바퀴 `SPIN_MS = 1600`(로컬 상수 · `M` 토큰 아님) |
| **완성 순간** = [§6.3.1의 논리곱](#631-리빌-발화-시점은-두-조건의-논리곱이다) | 마스크가 위에서 아래로 벗겨지며(스캔선이 경계를 따라간다) 캐릭터가 드러난다 | `M.dur.celebrate`(1200) · `M.curve.standard` |
| 리빌 **50% 지점** | 물체 팝(`scale 0.86 → 1`, 원점 `50% 100%`) + `hapticSuccess()` + 완성 통보 문구 | `M.spring.bouncy` · `POP_AT = M.dur.celebrate / 2` |
| '동작 줄이기' ON | **리빌·팝만 생략**하고 즉시 최종 상태로 간다. 완성 통보·햅틱은 **유지** | ⚠️ [정본 D7](../motion/policy.md#d7)의 *"컨페티만 생략"* 을 **넓힌 것**이다([D21](policy.md#d21)) — 정본만 읽으면 리빌이 재생된다 |

**햅틱이 완성 순간이 아니라 리빌 50%에 나는 이유** — 축하의 **정점을 리빌이 끝나는 지점에 맞추기
위해서다.** 팝 스프링(`M.spring.bouncy`)은 시작한 뒤 오버슛 정점까지 시간이 걸리므로, 리빌
시작과 동시에 터뜨리면 캐릭터가 아직 절반쯤 가려진 상태에서 정점이 지나간다. `POP_AT`은
`REVEAL_MS / 2` 하나로 팝·햅틱·문구를 함께 건다(`CharacterCreator.tsx:98`·`:163-167`).
'동작 줄이기'에서는 대기 없이 즉시 발화한다(`:147-154`).

**⚠️ 완성 통보는 실행당 한 번이다.** 재생 도중 '동작 줄이기'가 켜져 effect가 다시 돌아도 햅틱이
두 번 나가면 안 된다 — `celebratedRef`(`:129`·`:138-145`)가 그 래치다.

**⚠️ `result.cutout === false`면 리빌도 햅틱도 없다.** `runCutout`은 실패해도 `phase`를 `ready`로
되돌리므로(`:338`) **`phase` 전이만 보면 실패와 성공이 구분되지 않는다.** 판정은
`cut.cutout`(`:331`이 `setError(cut.cutout ? null : …)`로 쓰는 그 값)으로 한다. 오려내지 못한
사진에 축하를 붙이면 **에러 배너와 축하가 같은 화면에 뜬다.**

**⚠️ 리빌 노드는 실행마다 새로 마운트한다.** 진입 연출의 결정 경계는 마운트다(§2.1) — 같은
노드를 재사용하며 shared value만 되감으면 이미 1로 안착한 물체가 0.86으로 순간 이동했다가 다시
튀어오른다. 누끼가 **성공**할 때마다 증가하는 시퀀스를 `key`로 쓴다(`:247-248`·`:334-337`·`:526`).
`key`가 0이면 리빌할 것이 없다는 뜻이다(폴백 결과·회전만 한 결과).

> 📌 **파티클은 구현되지 않았다.** 등급 3의 시각 예산은 마스크 리빌 + 스캔선 + 물체 팝이 쓴다.
> 정책 D21·IA §3.4의 "파티클"은 **허용 목록**이지 필수 요소가 아니며, 구간 B의 **금지** 목록에
> 있는 파티클은 그대로 금지다.

**구간 B — 저장(`phase === 'checking'` / `'saving'`) · 축하가 아니다**

| 구간 | 표시 | 붙이지 않는 것 |
| --- | --- | --- |
| `checking`(`:412`) · `saving`(`:436`) | **진행 표시만** — 기존 잠금 규율(`busy` `:459`) 그대로 | **햅틱 · 리빌 · 파티클 금지** |

**왜 금지인가** — [D21](policy.md#d21)이 등급 3을 준 것은 **누끼가 완성된 순간**이다. 저장은 그
뒤에 오는 **별개의 짧은 대기**이고, 여기에 축하를 한 번 더 붙이면 `hapticSuccess`의 제약
(`app/src/utils/haptics.ts:24` — *"축하 표면에만 쓴다. 일반 성공 토스트에 붙이면 특별한 순간의
인상이 닳는다"*)을 같은 화면에서 두 번 쓰는 셈이 된다. 저장 성공의 통보는 **호출부(`onSaved`)가
받는 화면 전환**이 이미 한다.

**진행 신호를 어떻게 만드나** — 두 구간 모두 **단계 안쪽의 진척률을 알 수 없다.** 구간 A는 단일
비동기 1건(나눌 경계가 없다), 구간 B는 2건(모더레이션 → 저장)이라 경계가 **하나** 있다. 그래서
두 구간은 같은 링을 쓰되 **`progress`에 넣는 수의 뜻이 서로 다르다.**

| 구간 | `progress` | 그 수의 뜻 |
| --- | --- | --- |
| A(누끼) | `INDETERMINATE_ARC = 0.3` **고정** | **아무 뜻도 없다.** 눈에 보이는 호를 남기기 위한 길이일 뿐이고, 상태를 말하는 것은 **회전**이다 |
| B(저장) | `checking` 0.5 · `saving` 1.0 (`SAVE_STEP[stage] / SAVE_TOTAL`) | **단계 서수**(2단계 중 몇 번째)이지 완료율이 아니다 |

출처 `CharacterCreator.tsx:74-90`. 두 척도는 **이어 붙이지 않는다** — 구간 A가 0.3에서 끝나고
구간 B가 0.5에서 시작하는 것은 되감기가 아니라 **다른 자에 눈금을 새로 그린 것**이다(사이에
사용자 입력 대기가 있어 링 자체가 한 번 걷힌다).

**⚠️ 저장 구간의 1.0은 `saveCustomCharacter()`를 await 하기 _전에_ 대입된다**(`:436-437`).
서버 저장이 느리면 **호가 꽉 찬 채로 회전만 남는다.** 그래도 "끝났다"는 **거짓 통보가 되지 않는
조건**이 셋이고, 이건 권고가 아니라 **계약이다.**

| # | 조건 | 깨지면 |
| --- | --- | --- |
| 1 | 링에 **`decorative`**를 켠다(`:553`) | `accessibilityValue.now = 100`이 나가 **끝나지 않은 작업을 끝났다고 통보한다**(`ProgressRing.tsx:99-102`) |
| 2 | `busy`인 동안 **회전이 계속 돈다**(`:466-483`) | 정지한 꽉 찬 링 = 완료된 링. 회전이 "아직 일하는 중"을 말하는 유일한 신호다 |
| 3 | 링 아래 **단계 문구**가 현재 단계를 말한다(`STAGE_LABEL` `:81-85`·`:557`) | 무엇이 진행 중인지 읽을 수단이 사라진다(1이 progressbar 역할을 이미 뗐다) |

> **남는 대가** — 세 조건을 다 지켜도 **시각적으로는 꽉 찬 호**다. 수동 QA(§9)에서 "다 된 것처럼
> 보인다"가 나오면 **구간 B도 `INDETERMINATE_ARC` 고정 호로 통일한다** — 단계 경계 정보는 문구가
> 이미 주므로 잃는 것이 없다. 이 강등은 상수 한 줄(`stageProgress`)이다.

### 6.3.1 리빌 발화 시점은 **두 조건의 논리곱**이다

이 문서 초판이 발화 시점을 `setPhase('ready')` **한 지점**으로 적었다. **틀렸다**(2026-08-11 정정).

`cutoutSubject()`가 돌려주는 것은 **파일 경로**이고, 그 파일이 `<Image>`로 **디코드되는 것은
그 뒤**다. 디코딩이 누끼보다 늦게 끝나는 기기에서는 `phase`가 `ready`가 된 순간 **캐릭터 픽셀이
아직 없다** — 마스크를 벗겨 봐야 빈자리가 드러나고, 리빌·햅틱이 다 끝난 뒤에 이미지가 툭 나타난다.

**계약** — 리빌은 아래 **둘을 모두** 만족한 시점에 시작한다.

| # | 조건 | 출처 |
| --- | --- | --- |
| 1 | `cut.cutout === true` (누끼가 실제로 성공했다) | `CharacterCreator.tsx:334-337` — 이 조건에서만 `revealKey`가 증가해 리빌 노드가 마운트된다 |
| 2 | **오브젝트 이미지 디코드 완료** = `ObjectCharacter`의 `onLoad` | `CharacterCreator.tsx:241`(`imageLoaded` 상태) · `:506` (`onLoad={() => setImageLoaded(true)}`) |

②는 리빌 노드의 **`armed` prop**으로 전달되고, `armed === false`면 마스크를 **덮은 채로 기다린다**
(`:103-105`·`:131-133`). 즉 ①은 *리빌을 할 것인가*를, ②는 *지금 시작해도 되는가*를 정한다.

**⚠️ `imageLoaded`를 새로 만들지 않는다 — 이미 있는 가드다.** 이 상태는 1494 이전부터
**저장 잠금**에 쓰이고 있었다: 디코드 전에 저장하면 `captureRef`가 **사진 물체가 빠진 채로**
PNG를 굽는다(`:238-241` 주석 · 저장 버튼 `disabled={busy || !imageLoaded}` `:605`·`:607`).
새 사진·회전으로 `uri`가 바뀔 때마다 `false`로 리셋된다(`:322`·`:385`·`:399`). 리빌은 **그 기존
가드를 재사용**할 뿐이므로 새 실패 모드가 늘지 않는다 — 캡처가 안전한 시점과 리빌이 안전한
시점은 같은 시점이다.

**⚠️ 확정 대기와 순서를 섞지 않는다.** `armed`가 참이어도 `m.ready === false`면 시작 프레임
(마스크가 덮은 상태)에서 더 기다린다(`:136`). 두 게이트는 AND이고, 둘 다 통과한 뒤 한 번만 발화한다.

### 6.4 불확정 링 계약 — `ProgressRing`에는 불확정 모드가 **없다**

이 문서 초판이 "불확정이면 회전"이라고만 적었다. **그런 prop은 없다**(2026-08-11 정정).
`ProgressRing`의 prop은 `size`·`stroke`·`progress`·`color`·`trackColor`·`testID`·`decorative`·
`children` 여덟 개가 전부다(`app/src/components/ProgressRing.tsx:29-48`). 회전도, 불확정 모드도,
호 길이를 진행률과 분리하는 수단도 없다.

**결정 — 컴포넌트를 넓히지 않고 호출부에서 만든다.**

| 무엇 | 어떻게 | 출처 |
| --- | --- | --- |
| 회전 | 링을 `Animated.View`로 **한 겹 감싸** `rotate`를 건다 | `CharacterCreator.tsx:545-556` |
| 보이는 호 | `progress`에 **고정값 0.3**을 넣는다 | `:79`·`:89` |
| 접근성 | **`decorative` 필수** — progressbar 역할을 없앤다 | `:553` |

**왜 `progress: 0`이 아닌가** — `ProgressRing`은 `strokeDashoffset` 방식이다:

```ts
// ProgressRing.tsx:66
const target = circumference * (1 - clamped);
```

`progress = 0`이면 오프셋이 둘레 전체가 되어 **호가 아예 그려지지 않는다.** 남는 것은 정적인
트랙 원 하나뿐이고, **아무것도 없는 원이 도는 것은 굳은 화면과 구분되지 않는다.** 그래서 불확정
구간에도 **보이는 호를 남긴다**(`CharacterCreator.tsx:76-79`가 같은 이유를 적어 뒀다).

**왜 `decorative`가 선택이 아니라 필수인가** — 링은 `progress`를 **백분율로 접근성에 노출한다**:

```ts
// ProgressRing.tsx:99-102
accessibilityRole={decorative ? undefined : 'progressbar'}
accessibilityValue={decorative ? undefined : { now: Math.round(clamped * 100), min: 0, max: 100 }}
```

즉 임의의 호 길이를 넣는 순간 VoiceOver가 **"30퍼센트"라는 아무 뜻 없는 진행률**을 읽는다.
정확한 정보는 **링 아래 단계 문구**가 준다 — 링 **가운데**일 필요는 없다. 같은 접근성 층에
값을 읽어 주는 텍스트가 있으면 족하다.

> **초판의 규칙을 정정한다.** *"가운데에 정확한 값을 읽어 주는 텍스트가 없으면 `decorative`를
> 켜지 않는다"* 는 **`progress`가 완료율일 때**의 규칙이다. 완료율이 **아닌** 값(고정 호·단계
> 서수)을 넣는 순간 규칙이 뒤집힌다 — 그때는 `decorative`를 **켜야** 하고, 대신 **같은 화면에
> 상태를 읽어 주는 텍스트를 두는 것이 조건**이 된다.

**⚠️ 첫 마운트에는 전환이 없다** — 현재 값 그대로 그린다(`ProgressRing.tsx:21-22`·`:68`).
구간 A는 값이 고정이라 `M.dur.base` 전환이 애초에 발화하지 않고, 구간 B의 경계
(0.5 → 1.0)에서만 한 번 돈다.

**⚠️ 회전은 이 화면의 유일한 무한 루프다**(IA §2 화면당 1개 상한). D18의 **무한 루프 갈래**를
그대로 따른다 — `!m.ready`(확정 전)에도, 재생 도중 `m.reduce`가 켜져도 **정지**다. `busy`가 풀리는
즉시 `cancelAnimation` + 0으로 되돌린다(`CharacterCreator.tsx:466-483`). 저장 버튼 안에 스피너를
따로 두지 않는 것도 이 상한 때문이다(`:610-613`).

**⚠️ `withRepeat`의 게이트는 다섯 번째 인자다**(`:473-481`). 안 넘기면 reanimated 기본값(정적
System 플래그)이 걸려 '동작 줄이기'를 켠 채 앱을 켰다가 끈 사용자에게 회전이 **영영 돌지 않는다.**
조합자마다 게이트 자리가 다르다 — `withSequence`는 첫 번째, `withDelay`는 세 번째.

**⚠️ 실패 경로에서 중간 상태로 굳지 않는다** — `phase`가 `ready`로 되돌아오는 경로가 **구간마다** 있다.

| 구간 | 경로 | 무엇이 정리돼야 하나 |
| --- | --- | --- |
| A(누끼) | `cut.cutout === false`(`:331`·`:338`) — **`phase`는 성공과 똑같이 `ready`가 된다** | 링 정지 + **리빌·햅틱 미발화**. 에러 배너만 남는다 |
| A(누끼) | `cutoutSubject`가 **던진다**(`:339-343`) | `phase`를 `idle`로 되돌린다 — `working`에 굳으면 사진을 다시 고를 수 없다 |
| B(저장) | 모더레이션 `unavailable`(`:422-428`) · 차단(`:429-433`) · `catch`(`:448-451`) | 링이 진행률을 든 채 굳지 않게 **초기화**. 리빌은 애초에 없다 |

네 경로 모두 언마운트 가드 `activeRef`(`CharacterCreator.tsx:308-314`)와의 상호작용을 확인한다 —
`activeRef.current === false`면 `setPhase`조차 하지 않고 빠져나가므로(`:421`·`:439`) **링 정리를
`phase` 전이에만 매달면 안 된다.**

**⚠️ 구간 A와 B는 동시에 존재하지 않는다**(A가 끝나야 사용자가 저장을 누른다). 그래서 링을
하나만 두고 `stage`(`:457-458`)로 갈아 끼워도 화면당 무한 루프 1개 상한(IA §2)을 넘지 않는다.

**⚠️ `captureRef` 경계** — 저장은 `captureViewRef`(`:303`·`:500`)를 통째로 PNG로 굽는다. 결정 `D-22`가
못 박은 규율 그대로 **리빌의 마스크·스캔선·팝 스케일은 전부 그 ref 바깥에 건다**(`:194-206` —
팝 스케일은 `children`을 감싸는 바깥 래퍼에, 마스크·스캔선은 형제로). 안쪽에 두면 **마스크 패널이
저장 PNG에 함께 구워진다.**

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
| `screens/league/components/RankRowShell.test.tsx` | 기존 4개 — FlatList 전환 후에도 `layout` prop·zIndex 규칙 유지 · **진입 1회 보장**([§5.3.1](#531-가상화가-진입-연출을-되풀이시킨다--1493-설계의-구멍)): 같은 `userId` 행이 **재마운트돼도** 진입 스타일이 다시 붙지 않고, **목록 정체성이 바뀌면**(리그 전환·핀 토글) 다시 붙는다 |
| `screens/character/CharacterCreator.test.tsx` | **1494 구현본에 이미 있다**(브랜치 `afeat/GROMO-1494-cutout-reveal`, 12건). 잠그는 것: 리빌이 **디코드 전에는 발화하지 않는다** · `hapticSuccess` **정확히 1회**(리빌 50%) · 누끼 실패/예외에 축하 없음 · '동작 줄이기'에서 마스크 미렌더 + 통보·햅틱 유지 · **저장 성공에 햅틱 없음** · 실패 3경로에서 링이 굳지 않음 |
| `screens/stats/charts.test.tsx` | **실패 ≠ 무데이터** 2건 + `FIRST_START_BODY_H` 불변 |
| `hooks/useMotion.*.test.ts` (4종) · `useReduceMotion.*.test.ts` (3종) · `motion.test.ts` · `Enter.test.tsx` | D18의 안전망. **`m.enter`가 `startFrameOf`로 접힌 뒤에도 미확정 구간 모습이 같아야 한다** |
| D18 진입점 테스트 (신규) | 갈래 × 상태 4×4 표(§3.3) · **되감기 금지 불변식** · **`progressAt()` 구간별 검산**([§3.5](#35-경과-시간--진행률은-구간별-함수다-단일-비율이-아니다)): `elapsed=1000 → 0.45` · `elapsed=2500 → 0.90`(홀드) · `elapsed ≥ 3200 → 1`. 순수 함수라 워클릿 모킹 제약([정본 D14](../motion/policy.md#d14))에 걸리지 않는다 |
| 리그 화면 테스트 | **자동 스크롤 목적지** — "내 행이 첫 화면 밖일 때만 스크롤"이 FlatList 전환 후에도 성립 |
| 리그 화면 테스트 — **후행 UI 보존**(신규 · [§5.1.2](#512-후행-ui--listfootercomponent-하나에-담고-listemptycomponent는-쓰지-않는다)) | 전환 후에도 **렌더된다**: ① 조회 실패 시 `'랭킹을 불러오지 못했어요'` + `'다시 시도'`(누르면 재조회) · ② 빈 리그에서 `'아직 이 리그엔 아무도 없어요'` · ③ 핀 모드·핀 0개에서 `'랭킹에서 핀을 누르면 여기에 담겨요'` · ④ **`TierGuide` 진입 스트립은 모든 상태에서** 렌더된다 |
| ⚠️ 같은 파일 — **거짓 빈 상태 회귀** | **리그 인원 1~3명**(포디움만 차고 `listRows`가 빈 경우) 에 `'아직 이 리그엔 아무도 없어요'`가 **뜨지 않는다.** `ListEmptyComponent`로 번역하면 깨지는 지점을 이 테스트가 고정한다 |
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
  ③ 저장 실패 경로(비행기 모드로 모더레이션 실패 — 저장 구간에 축하가 붙지 않는가)
  ④ **큰 사진으로 디코드를 늦춰** 리빌이 **빈 자리에서 터지지 않는가**(§6.3.1의 논리곱).
  ⑤ **VoiceOver를 켜고 저장** — 링이 **진행률을 읽지 않고**(`decorative`), 단계 문구만 읽히는가.
  느린 회선에서 **꽉 찬 링이 "다 됐다"로 읽히지 않는가**(§6.3의 남는 대가 — 읽히면 구간 B도
  고정 호로 통일한다).
- **1493**은 순위 갱신 + 리그 드롭다운 전환 + **내 행 자동 스크롤**(내 행이 첫 화면 밖일 때/안일 때)
  + **내 순위 스트립**: 첫 화면에서 포디움이 가려지지 않는가 · **포디움 경계 앞뒤로 천천히 왕복**할 때
  스트립이 한 번도 깜빡이지 않는가(§5.1.1)
  + **진입 연출 되풀이**(§5.3.1): 순위가 **긴 리그**에서 아래까지 스크롤했다가 되돌아올 때
  행이 **다시 날아들지 않는가**. 반대로 **리그를 갈아타면** 시차 진입이 **다시 나는가**
  + **후행 UI 보존**(§5.1.2): 목록 맨 아래까지 내려 **`내 티어 · …` 스트립이 있는가**(누르면
  TierGuide로 가는가) · **비행기 모드로 재진입**해 실패 안내 + `'다시 시도'`가 뜨는가 ·
  **핀 0개로 '핀한 사람만'** 을 켜 안내 문구가 뜨는가 · **인원 1~3명인 리그**에서
  `'아직 이 리그엔 아무도 없어요'`가 **뜨지 않는가**.
- **1491**은 이관한 실패 통보를 **VoiceOver 켜고** 한 번씩 — 알럿은 자동으로 읽히지만 토스트는 아니다.
