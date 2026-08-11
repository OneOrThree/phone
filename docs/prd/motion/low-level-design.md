# Low-Level Design — 모션

> GROMO-1382 · 작성 2026-08-09 · 현재 구현 상태 기준
> 세트: [IA](information-architecture.md) · [PRD](prd.md) · [정책](policy.md) · [HLD](high-level-design.md) · **LLD**
> 고정 파라미터: press 110ms · quick 220ms · base 350ms · slow 600ms · entrance 800ms · celebrate 1200ms · stagger 60ms(상한 6단계) · spring.press d14/s300/m0.65 · spring.snappy d20/s260/m0.9 · overshoot `cubic-bezier(0.34,1.56,0.64,1)` · 토스트 자동해제 2200ms

---

## 1. 파일별 지도

### 1.1 신규 (5 파일)

| 파일 | 예상 줄 | 역할 |
| --- | --- | --- |
| `src/constants/motion.ts` | ~120 | **토큰 정본.** `M.dur` · `M.curve`(`.css`/`.fn` 쌍) · `M.spring` · `M.stagger` · `M.preset` · `ms()` |
| `src/constants/motion.test.ts` | ~60 | 값 고정 + duration 오름차순 가드 |
| `src/hooks/useMotion.ts` | ~70 | reduce-motion 3계 게이트. `useReduceMotion` 위 얇은 층 |
| `src/hooks/useMotion.test.ts` | ~70 | reduce=false 분기 |
| `src/hooks/useMotion.reduced.test.ts` | ~70 | reduce=true 분기 (모듈 스코프 단일 인스턴스라 파일 분리) |

### 1.2 신규 프리미티브 (6 파일)

| 파일 | 예상 줄 | 역할 |
| --- | --- | --- |
| `src/components/Skeleton.tsx` | ~90 | `Skeleton` · `SkeletonText` · `SkeletonCard`. 불투명도 펄스 |
| `src/components/AnimatedNumber.tsx` | ~80 | `<Text>` + JS 보간. 리프 전용 |
| `src/components/ProgressBar.tsx` | ~70 | `width` 애니메이션(둥근 캡 유지) |
| `src/components/ProgressRing.tsx` | ~90 | SVG `strokeDashoffset` + `animatedProps` |
| `src/components/Toast.tsx` | ~110 | 단일 토스트 뷰 + a11y 공지 |
| `src/store/ToastContext.tsx` | ~90 | 큐 · 자동해제 · `useToast()` |

### 1.3 변경 (기존 파일)

| 파일 | 현재 줄 | 건드리는 줄 | 무엇을 |
| --- | --- | --- | --- |
| `src/components/PressableScale.tsx` | 102 | 25(주석) · 28 · 30 · 72 · 83 · 95 | 톤 주석 교체 · `SPRING_BACK`→`M.spring.press` · `scaleTo` 0.96 · `useMotion` 이관 |
| `src/components/SheetShell.tsx` | 189 | 전면(~+70) | Reanimated 통일 · 등장/퇴장 상태기계 · 딤 연동 · `SheetCloseContext` |
| `src/components/SheetShell.test.tsx` | 210 | 재작성 | 기존 판정 규칙 보존 + 신규 단언 |
| `src/components/TabBar.tsx` | 240 | 49–54 | `highlightSlide`→`M.preset.transition` + `m.css()` |
| `src/components/liquidGlass.tsx` | 50 | 11–20 | `SLIDE_MS = M.dur.base` 재정의(**export 이름 유지**) · `glassSlide`→토큰 |
| `src/components/ConfettiBurst.tsx` | 253 | 렌더 진입부 | reduce면 미렌더 |
| `src/components/ScreenTimeAnalyzingOverlay.tsx` | 93 | 45–50 | reduce면 즉시 100% (타이밍 상수는 🟨 예외로 유지) |
| `src/screens/focus/FocusResultScreen.tsx` | 1044 | 57–80 · 426 · 519 | `growUp`/`checkPop`→`M.preset` · stagger 80→60 · `m.css()` |
| `src/screens/focus/FocusSessionScreen.tsx` | 1560 | 렌더 계층만 | `ProgressRing` · 페이즈 크로스페이드 · 도트 전환 |
| `src/screens/HomeScreen.tsx` | 840 | 132 · 590 · 카드 렌더 | `ProgressBar` · `AnimatedNumber` · `enterUp` |
| `src/screens/StatsScreen.tsx` | 554 | 491 + 카드 8종 | 스켈레톤 |
| `src/screens/stats/charts.tsx` | 470 | `LineChart` 렌더부 | **좌→우 draw-on**(정책 D16) — `AnimatedPolyline` `strokeDashoffset` + 점별 `AnimatedCircle`. ⚠️ `growUp` 아님 |
| `src/screens/stats/CategoryDonut.tsx` | 190 | `DonutBase` | 링 `fadeIn` + 범례 `enterUp(i)`. ⚠️ `growUp`은 원을 타원으로 눌러 못 쓴다 |
| `src/screens/stats/CalendarCard.tsx` | 420 | 그리드 행 | 행 단위 `fadeIn(m.stagger(ri))` — 값 축이 없어 `growUp`이 뜻을 못 만든다 |
| `src/screens/stats/WeeklyTimetableCard.tsx` | 330 | 세션 블록 | **`growUp(j)`** — 블록 자체가 '시간만큼 자란 막대'라 여기는 맞다 |
| `src/screens/league/LeagueScreen.tsx` | 1063 | 219 · 227 · 리스트 | `LayoutAnimation`→`LinearTransition` · `enterUp` |
| `src/screens/league/LeagueResultScreen.tsx` | 408 | 87–125 · 승급 분기 | `m.delay()` · 컨페티 + `hapticSuccess` |
| `src/utils/haptics.ts` | 20 | +8 | `hapticSuccess()` 추가 |
| `src/App.tsx` | — | Provider | `ToastProvider`를 `NavigationContainer` **밖·위**에 |

---

## 2. 토큰 정의 (`src/constants/motion.ts`)

```ts
import { Easing, cubicBezier } from 'react-native-reanimated';

// 베지어 제어점 단일 출처.
// ⚠️ CSS prop용 cubicBezier(...)와 withTiming용 Easing.bezier(...)는 서로 다른 표현이다.
//    하나로 합치면 런타임에 조용히 무시된다 — 그래서 토큰마다 .css / .fn 두 필드를 쌍으로 둔다.
//    호출 규칙: animationTimingFunction/transitionTimingFunction → .css
//               withTiming(v, { easing }) → .fn
const OVERSHOOT = [0.34, 1.56, 0.64, 1] as const;
const GLIDE = [0.3, 1.15, 0.5, 1] as const;
const STANDARD = [0.2, 0, 0, 1] as const;
// ⚠️ easeOutQuad 의 베지어 근사. CSS 키워드 'ease-out'(=0,0,0.58,1)이 아니다 —
//    키워드를 쓰면 .fn(Easing.out(Easing.quad))과 다른 커브가 되어 쌍 계약이 깨진다.
//    PressableScale 눌림이 쓰는 커브라 두 표현이 반드시 같아야 한다.
const OUT_QUAD = [0.25, 0.46, 0.45, 0.94] as const;

export const M = {
  dur: { press: 110, quick: 220, base: 350, slow: 600, entrance: 800, celebrate: 1200 },

  curve: {
    standard:  { css: cubicBezier(...STANDARD),  fn: Easing.bezier(...STANDARD) },
    out:       { css: cubicBezier(...OUT_QUAD),  fn: Easing.out(Easing.quad) },
    linear:    { css: 'linear',                  fn: Easing.linear },
    glide:     { css: cubicBezier(...GLIDE),     fn: Easing.bezier(...GLIDE) },
    overshoot: { css: cubicBezier(...OVERSHOOT), fn: Easing.bezier(...OVERSHOOT) },
  },

  spring: {
    press:  { damping: 14, stiffness: 300, mass: 0.65 }, // 버튼 복귀 — 이동량의 16% 초과 · 안착 ≈367ms(2% 허용대)
    snappy: { damping: 20, stiffness: 260, mass: 0.9  }, // 시트·패널·토스트
    bouncy: { damping: 13, stiffness: 180, mass: 0.9  }, // 배지·팝·축하
    gentle: { damping: 16, stiffness: 120, mass: 1.0  }, // 큰 요소 진입
  },

  stagger: { tight: 40, base: 60, loose: 90 },
  staggerMaxSteps: 6,
} as const;

export const ms = (n: number): `${number}ms` => `${n}ms`;
```

### 2.1 프리셋 — 참조 동등성 캐싱이 필수다

```ts
// ⚠️ Reanimated CSS의 animationName은 참조 동등성으로 재시작 여부를 판단한다.
//    인라인으로 매 렌더 새 객체를 만들면 애니메이션이 계속 리셋된다.
//    → index별 결과를 모듈 스코프 배열에 캐싱해 같은 참조를 돌려준다.
const enterUpCache: object[] = [];

export function enterUp(index = 0) {
  const i = Math.min(index, M.staggerMaxSteps);
  if (!enterUpCache[i]) {
    enterUpCache[i] = {
      animationName: { from: { opacity: 0, transform: [{ translateY: 12 }] } },
      animationDuration: ms(M.dur.base),
      animationDelay: ms(i * M.stagger.base),
      animationTimingFunction: M.curve.standard.css,
      animationFillMode: 'backwards',
    };
  }
  return enterUpCache[i];
}
```

동일 패턴으로 `pop(delay)` · `fadeIn(delay)` · `pulse` · `transition(props)` 제공.

**`growUp(index)` — 차트 막대 전용 별도 프리셋.** `enterUp`은 `M.dur.base`(350) 고정이라 차트에 못 쓴다. 차트는 `scaleY 0→1` + `M.dur.entrance`(800) + `transformOrigin:'bottom'` + `overshoot` 커브로 다르다. `FocusResultScreen`의 기존 `growUp`을 그대로 승격한 것이며, **duration을 인자로 받는 대신 프리셋을 나눈다** — 인자를 받으면 참조 캐시 키가 (index, duration) 쌍으로 늘어나 §2-4의 동등성 보장이 복잡해진다.

---

## 3. `useMotion` 계약

```ts
export function useMotion(): {
  reduce: boolean;
  timing<V>(to: V, cfg?: WithTimingConfig): V;   // ⚠️ JS 스레드 전용 — 워클릿 안에서 호출 금지
  spring<V>(to: V, cfg?: WithSpringConfig): V;   // ⚠️ 동일
  css<S>(style: S): S | undefined;               // reduce면 undefined → 스타일 배열에서 사라짐
  delay(ms: number): number;                     // reduce면 0
  stagger(index: number, step?: number): number; // reduce면 0, staggerMaxSteps 상한 적용
};
```

**금지 사항** — `timing`/`spring`을 `useAnimatedStyle`·`useAnimatedReaction`·`runOnUI` 내부에서 부르면 안 된다(훅 반환값은 JS 클로저). 워클릿 안에서 분기해야 하면 `reduce`를 shared value로 옮겨 읽는다.

**호출 예**

```tsx
const m = useMotion();

// CSS
<Animated.View style={[s.card, m.css(enterUp(i))]} />

// layout
<Animated.View entering={m.css(cardDrop)} />

// imperative
sv.value = m.timing(1, { duration: M.dur.base, easing: M.curve.standard.fn });

// 단계 시퀀스 — reduce여도 반드시 완주해야 한다
setTimeout(next, m.delay(1100));
```

---

## 4. `SheetShell` 상세

### 4.1 상태 기계

```
mount → entering → idle ⇄ dragging → closing → onClose()
```

| 전이 | 애니메이션 | reduce |
| --- | --- | --- |
| entering | `translateY: h → 0` `withSpring(M.spring.snappy)` / dim `withTiming(1, M.dur.quick)` | 즉시 |
| dragging | PanResponder → `translateY` 직접. dim은 진행률에 연동(끌수록 옅어짐) | 그대로 동작 |
| 복귀(임계 미달 · `dismissible=false`) | `withSpring(0, M.spring.snappy)` — **entering과 같은 스프링(대칭)** | 즉시 |
| closing | `translateY: → h` `withTiming(M.dur.quick, M.curve.standard.fn)` + dim 0 → `runOnJS(onClose)` | 즉시 `onClose` |

### 4.2 등장 트리거는 `useEffect`가 아니라 패널 `onLayout`

`asModal`(탭 화면)은 iOS에서 `<Modal>`이 UIViewController를 present하느라 **1프레임 늦게 붙는다.** 초기 `translateY`를 어떤 패널 높이보다 큰 값(1000)으로 두고, `onLayout`에서 측정 높이 `h`로 스냅한 뒤 **같은 프레임에** `withSpring(0)`을 건다 → 레이아웃 전 깜빡임이 없고 높이 추정값도 필요 없다.

### 4.3 `onClose` 감사표 — **PR3 착수 전 필독**

현재 모든 호출부가 `{open && <SheetShell/>}`로 **언마운트해서** 닫는다. 퇴장 애니메이션을 보이게 하려면 닫힘을 내부에서 가로채야 하는데, 경로마다 성격이 다르다.

| 경로 | 호출부 변경 | 퇴장 연출 | 비고 |
| --- | --- | --- | --- |
| 딤 탭 | **불필요** | ✅ 보임 | 내부에서 가로챔 |
| 그랩바 드래그 | **불필요** | ✅ 보임 | 이미 내부 소유 |
| 시트 안 CTA | 필요(`useSheetClose()`) | 미이관 시 즉시 스냅 | 아래 참조 |

**CTA 이관 대상 선별 — 계획 초안에서 수정됨**

| 시트 | CTA 닫힘 후 동작 | 이관 판단 |
| --- | --- | --- |
| `TimerMethodSheet` | `setSheet(null)` → **즉시 `navigate('FocusSession')`** (`FocusCategoryScreen.tsx:224–232`) | ❌ **이관 금지** — 220ms 퇴장이 붙으면 **집중 세션 시작이 그만큼 늦어진다.** 시작 지연은 톤 문제가 아니라 기능 저하다 |
| `CountdownSetupSheet` | 동일 경로 | ❌ 동일 이유로 금지 |
| `PomodoroSetupSheet` | 동일 경로 | ❌ 동일 이유로 금지 |
| `BetSheet` | `onClose`와 `onDone`이 **분리**됨(`BetSheet.tsx:122,124`). 닫기는 순수 닫기 | ✅ **이관 1순위** |
| `NoticeComposeSheet` | `onClose={() => setComposeOpen(false)}` (`GroupRoomScreen.tsx:969`) | ✅ 이관 |
| `ChallengeComposeSheet` | 순수 닫기 | ✅ 이관 |
| `TagSuggestionSheet` · `RecommendedTagsEditSheet` | `onCancel` 순수 닫기 | ✅ 이관 |
| `GroupFindSheet` · `GroupInviteSheet` | `onClose`/`onJoined` 분리. `onJoined`는 `navigate('GroupRoom')` | ⚠️ `onClose`만 이관, `onJoined`는 손대지 않는다 |
| `LastBetResultSheet` | `onClose={() => setLastBetView(null)}` (`ChallengeCard.tsx:702`) | ✅ 이관 |

> **초안 정정** — 계획서 PR3은 이관 대상으로 `TimerMethodSheet`·`CountdownSetupSheet`·`BetSheet`를 지목했으나, 감사 결과 **앞의 둘은 이관하면 안 된다.** 대체 3곳: `BetSheet` · `NoticeComposeSheet` · `LastBetResultSheet`.

### 4.4 보존해야 할 기존 판정 규칙

`SheetShell.test.tsx`가 PanResponder config를 가로채 `onPanResponderRelease`를 직접 호출하는 방식으로 아래를 잠그고 있다. **재작성해도 전부 유지한다.**

| 규칙 | 현재 단언 |
| --- | --- |
| 패널 높이 상한 | 화면의 85% |
| 스크롤 켜짐 조건 | 내용이 뷰포트 + 1pt를 넘을 때만 |
| `keyboardShouldPersistTaps` | `'handled'` |
| 드래그 임계 | 충분히 끌면 닫힘 / 조금 끌면 안 닫힘 |
| `dismissible=false` | 아무리 끌어도 안 닫힘 |
| 그랩바 a11y 라벨 | `'아래로 끌어 닫기'` |
| 딤 탭 | `onClose` 호출 |

⚠️ 퇴장 애니메이션이 붙으면 "딤을 누르면 `onClose`가 불린다" 테스트는 **fake timer로 220ms를 전진**시켜야 통과한다.

---

## 5. 프리미티브 API

| 컴포넌트 | props | 접근성 계약 |
| --- | --- | --- |
| `Skeleton` | `w` `h` `radius?` `testID?` | `accessibilityElementsHidden` — 스크린리더가 빈 블록을 읽지 않게 |
| `SkeletonText` | `lines` `gap?` | 동일 |
| `SkeletonCard` | `height` | 실제 카드 높이 상수를 **호출부가 넘긴다** |
| `AnimatedNumber` | `value` `format?` `style?` `duration?` `testID?` | `accessibilityLabel`에 **최종 포맷값**. 중간 숫자를 읽지 않게 |
| `ProgressBar` | `progress`(0~1) `color` `trackColor?` `height?` `radius?` `delay?` | `accessibilityRole="progressbar"` + `accessibilityValue={{ now, min:0, max:100 }}` |
| `ProgressRing` | `size` `stroke` `progress` `color` `trackColor?` `children?` | 동일 |
| `Toast` | (Context 경유) `message` `tone` `icon?` | **플랫폼당 공지 경로 하나** — Android `accessibilityLiveRegion="polite"` / iOS `announceForAccessibility()`. 둘 다 걸면 Android에서 두 번 읽힌다 ([정책 D8](policy.md#d8)) |

**`useToast()`**

```ts
const { show } = useToast();
show({ message: '캐릭터를 변경했어요', tone: 'success' });
```

큐잉(동시 요청은 순차) · 2200ms 자동 해제 · 탭 해제 · `testID="toast"` / `"toast.message"`.

---

## 6. 화면별 적용 명세

| 화면 | 요소 | 프리셋/컴포넌트 | duration | delay | 등급 |
| --- | --- | --- | --- | --- | --- |
| 홈 | 카드 3~5개 | `enterUp(i)` | base | i × 60 | 2 |
| 홈 | 집중·사용시간 진행바 | `ProgressBar` | slow | 120 | 1 |
| 홈 | 코인·스트릭 칩 | `AnimatedNumber` | slow | 0 | 1 |
| 통계 | 카드 8종 로딩 | `SkeletonCard` | 1200 loop | — | 1 |
| 통계 | 꺾은선 차트 진입 | **draw-on**(`strokeDashoffset`) | entrance | i × 60 | 2 |
| 통계 | 도넛 진입 | 링 `fadeIn` + 범례 `enterUp(i)` | base | i × 60 | 2 |
| 통계 | 캘린더 진입 | 행 단위 `fadeIn(m.stagger(ri))` | base | ri × 60 | 2 |
| 통계 | 타임테이블 세션 블록 | **`growUp(j)`** | entrance | j × 60 | 2 |
| 집중 세션 | 카운트다운·뽀모도로 | `ProgressRing` | 연속 | — | 1 |
| 집중 세션 | 페이즈 전환 | 크로스페이드 (진동은 기존 2연속 유지) | quick | 0 | 1 |
| 집중 결과 | 주간 막대 | **`growUp(i)`** | entrance | i × 60 | 2 |
| 집중 결과 | 스트릭 ✓ · 코인 | `pop` | slow | 400 | 3 |
| 리그 | 순위 행 | `enterUp(i)` | base | i × 60 | 2 |
| 리그 | 재정렬 | `LinearTransition` + `spring.snappy` | — | — | 1 |
| 리그 결과 | 승급 컨페티 | `ConfettiBurst` + `hapticSuccess` | celebrate | 시퀀스 후 | 3 |
| 시트 전체 | 등장 | `spring.snappy` | ≈base | 0 | 1 |
| 전역 | 토스트 | `spring.snappy` | quick | 0 | 1 |
| 그룹 목록 | 덱 카드(가로) | `enterUp(i)` — **이미 적용됨** | base | i × 60 | 2 |
| 그룹방 | 로딩 | `SkeletonGroup` — **이미 적용됨** | 1200 loop | — | 1 |
| 그룹방 | 챌린지 카드 M개 | `enterUp(i)` | base | i × 60 | 2 |
| 그룹방 | 멤버 3열 그리드 | **행 단위** `fadeIn(m.stagger(rowIdx))` | quick | row × 60 | **1** |
| 그룹방 | 멤버 타일 | `PressableScale` (타일 루트 = 이미 `TouchableOpacity`) | press | 0 | 1 |
| 챌린지 카드 | **내부 버튼만** 눌림 | `PressableScale` — 카드 루트는 **비터치 `View` 유지** | press | 0 | 1 |
| 챌린지 카드 | 멤버 진행 수치 | **없음(등급 0)** — [D25-1](policy.md#d25) | — | — | 0 |
| 챌린지 내역 | 첫 로딩 | **구조적 스켈레톤**(`Skeleton` 조합) × 3 — `SkeletonCard` 아님 ([D25-3](policy.md#d25)) | 1200 loop | — | 1 |
| 챌린지 내역 | 리스트 행 | `enterUp(pageIdx)` — **페이지 내 인덱스**(`CellRendererComponent`). ⚠️ 절대 인덱스 금지 — 아래 | base | pageIdx × 60 | 2 |
| 챌린지 결과 | 캐릭터 | **`pop()`** | slow | 0 | 3 |
| 챌린지 결과 | 명단 3구획 | `enterUp(i)` | base | i × 60 | 2 |
| 베팅 | 시트 참여자 진행 바 | **없음(등급 0)** — 최대 10행이라 `ProgressBar` 금지 ([D25-2](policy.md#d25)) | — | — | 0 |
| 베팅 | 지난 결과 **내가 이긴** 행 | `pop()` — 조건은 아래 ⚠️. 내 행 1개뿐이라 지연 인자 불필요 | slow | 0 | 3 |

**프리미티브 인자 계약 — 인덱스를 받는 것과 밀리초를 받는 것은 다르다**

위 표의 `delay` 열은 **결과값**이지 인자가 아니다. 프리미티브마다 무엇을 받고 **누가 `staggerMaxSteps`를 클램프하는지**가 다르므로, 구현 전에 이 표를 본다. (전부 `app/src/constants/motion.ts`·`hooks/useMotion.ts` 실제 시그니처와 대조한 값이다.)

| 호출 | 인자 | 상한 클램프 | 호출부가 해야 할 것 |
| --- | --- | --- | --- |
| `enterUp(index)` | **인덱스** | **내부** (`motion.ts:106`) | 인덱스를 그대로 넘긴다. `m.enter()` 통과 필수 |
| `growUp(index)` | **인덱스** | **내부** (`motion.ts:131`) | 위와 동일 |
| `fadeIn(delayMs)` | **지연 ms** | **없음** | **`m.stagger(i)`로 변환해서 넘긴다.** 선례: `CalendarCard.tsx:303`의 `fadeIn(mo.stagger(ri))` |
| `pop(delayMs)` | **지연 ms** | **없음** | 위와 동일. 동적 값을 계속 넘기면 참조 캐시가 샌다(`motion.ts:150` 경고) |
| `transition({ delay })` | **지연 ms** | **없음** | 위와 동일 |
| `staggerDelay(i, step?)` | 인덱스 | **내부** | **reduce-motion을 반영하지 않는다** — 화면에서는 `m.stagger()`를 쓴다 |
| `m.stagger(i, step?)` | 인덱스 | **내부** + reduce면 0 | 인덱스 → ms 변환의 **기본 도구**. 위 세 프리미티브 앞에 항상 이걸 끼운다 |
| `m.delay(ms)` | ms | 없음 (reduce면 0) | 상수 지연(시퀀스 대기)에만. 시차에는 쓰지 않는다 |
| `<ProgressBar delay={ms}>` | **지연 ms** | **없음** (`ProgressBar.tsx:46,79-84`) | `m.stagger(i)`. 그리고 **최초 채우기 1회에만** 걸린다 |
| `<SkeletonCard height>` | px, **필수** | — | 실제 카드의 **높이 상수**가 있을 때만 쓴다. 높이가 가변이면 `Skeleton` 블록을 조합한다 ([D25-3](policy.md#d25)) |

> ⚠️ **`fadeIn(i)`·`pop(i)`처럼 인덱스를 그대로 넘기면 지연이 0·1·2ms가 되어 시차가 사라진다.**
> 컴파일도 테스트도 통과하고 화면만 조용히 밋밋해지는 실패 모드라, 리뷰에서 잡히지 않는다.

> ⚠️ **페이즈 전환에 `hapticMedium`을 새로 붙이지 않는다.** 이 경계에는 이미
> `Vibration.vibrate([0, 400, 200, 400])`(iOS는 `[0, 500]`)가 붙어 있다 — GROMO-864에서
> "라이브 전환이면 진동 2번으로 경계를 알린다"로 넣은 것이고, `hapticMedium`(가벼운 임팩트)보다
> **훨씬 강하다**. 위에 겹쳐 붙이면 한 경계에서 신호가 두 번 난다. 초안이 `hapticMedium`으로
>적혀 있었으나 기존 구현이 더 나은 쪽이라 문서를 코드에 맞춘다(codex 리뷰 PR #562).

> ⚠️ **막대에 `enterUp`을 쓰지 않는다.** `enterUp`은 `M.dur.base`(350) 고정이고 duration 인자를 받지 않는다(참조 캐시 때문). 막대는 `scaleY`·`entrance`·`overshoot`가 다르므로 §2-1의 **`growUp` 프리셋**을 쓴다.
>
> ⚠️ **"차트 = `growUp`"이 아니다** (정책 D16). `growUp`은 **막대 전용**이다 — 값이 곧 높이라 바닥에서 자라는 게 값의 의미와 같기 때문이다. 꺾은선은 시간축을 따라 이어지는 궤적이라 **왼쪽에서 오른쪽으로 그리고**(draw-on), 도넛은 `scaleY`가 원을 타원으로 눌러 뜻이 깨지므로 링 `fadeIn`, 캘린더는 값 축이 없어 행 `fadeIn`이다.

**꺾은선 draw-on 구현.** `Polyline`에 선 길이만큼의 `strokeDasharray`를 깔고 `strokeDashoffset`을 길이 → 0으로 당긴다. `ProgressRing`과 같은 기법이며 같은 규칙을 따른다 — `Animated.createAnimatedComponent(Polyline)` + `useAnimatedProps`, 변환은 워클릿 콜백 **안에서** 처리(`SVGAdapter` 금지).

점은 선이 그 자리를 지나가는 순간 뜬다. 판정은 **각 점까지의 누적 길이 비율**이다:

```
seg[i] = |P(i+1) − P(i)|          // 구간 길이
at[i]  = (Σ seg[0..i−1]) / Σ seg  // 점 i가 뜨는 진행률 (at[0]=0, at[n−1]=1)
```

⚠️ 시차를 `i × 60ms` 같은 상수로 주면 안 된다. 구간마다 길이가 달라(꺾임이 클수록 길다) 점이 선보다 먼저 뜨거나 뒤늦게 따라온다.

**리그 재정렬 — 한 칸씩 스왑한다** (**타이밍 정본: [ui.html](ui.html) 리그 카드**. 문서와 어긋나면 시안이 맞다)

- 맨 아래에서 맨 위까지 **한 칸씩 4단계.** 여러 칸을 한 번에 뛰면 결과만 남고 과정이 사라진다.
- **호흡은 균일하다** — 스왑 간격 `300ms`, 기록 갱신 후 스왑까지 `90ms`. (초안의 "가속하다 마지막만 느리게"는 실제로 보면 부각되지 않아 폐기했다.)
- 자리가 바뀌기 직전에 **내 기록과 막대가 먼저 자란다**(`M.dur.quick`). 바로 위 사람을 앞지르는 값이라야 상승이 납득된다.
- **행 배경이 기록만큼 차오르는 가로 막대그래프**다. 순위표가 곧 그래프다.
- 올라가는 행과 밀려나는 행이 **서로 옆으로 비껴간다** — 올라가는 쪽 `-9px`, 밀려나는 쪽 `+9px`, `sin` 궤적으로 양끝 0. 세로로만 지나가면 두 행이 겹쳐 "리스트가 다시 그려진 것"처럼 보인다. 올라가는 행은 `scale 1.03`으로 살짝 뜬다.
- 순위 번호는 **자리에 붙는 값**이라 순서가 바뀔 때마다 다시 매긴다.
- **전제: 행 노드의 동일성이 유지돼야 한다.** 순서만 바뀌고 노드가 재생성되면 애니메이션이 성립하지 않는다. ✅ 확인됨 — `LeagueScreen.tsx:369,517`이 이미 `key={m.userId}`를 쓴다(인덱스 키가 아님). 리스트가 `.map()`+`ScrollView`라 `itemLayoutAnimation` 대신 **행마다 `layout={LinearTransition…}`** 을 직접 붙이는 형태가 된다.

**그룹방 — 한 화면에 리스트가 둘이다** (챌린지 카드 M개 + 멤버 타일 N개)

> ⚠️ 아래 `GroupRoomScreen.tsx`는 전부 **`app/src/screens/group/GroupRoomScreen.tsx`** 다.
> `app/src/legacy/screens/`에 같은 이름의 **동결된 옛 파일**이 하나 더 있다 — 줄 번호를 그쪽에서 찾으면 맞지 않는다.

`GroupRoomScreen.tsx:76-77`이 적어 둔 레이아웃 순서가 그대로 진입 순서다 — 헤더 → 공지 → 챌린지 → 멤버 3열 그리드. 두 리스트가 **하나의 `ScrollView` 안에** 있고 멤버 그리드가 맨 끝이다.

- **stagger 축은 챌린지 카드 하나뿐이다.** 멤버 그리드까지 `enterUp(i)`를 걸면 0에서 다시 시작하는 시차가 한 화면에 둘 생겨 "리스트가 두 번 그려진다"로 읽힌다. 그리고 그리드는 대부분 **첫 화면 밖**이라, 보이지도 않는 연출에 프레임을 쓴다.
- 그리드는 **행 단위 `fadeIn(m.stagger(rowIdx))`** 이다. ⚠️ `fadeIn`은 **인덱스가 아니라 지연 ms**를 받는다 — `fadeIn(rowIdx)`로 쓰면 행 지연이 0·1·2ms가 되어 시차가 통째로 사라진다(위 계약표). 타일마다 걸면 `staggerMaxSteps`(6)를 **2행 만에** 다 써 3행부터 전부 같은 칸에 뭉친다. 행 단위면 정원 상한(**최대 10명** — `GroupCreateScreen.tsx:58`)이 곧 **4행**이라 6칸 안에 온전히 들어간다. 렌더 구조가 이미 `memberRows.map(row => row.map(cell))`(`GroupRoomScreen.tsx:1125-1175`)이라 **행 래퍼가 이미 있다** — 뷰를 새로 끼우지 않는다(정책 D13).
- **등급은 1이다(2가 아니다).** `fadeIn`은 `M.dur.quick`(220ms) **고정**인데 [IA §2](information-architecture.md)의 등급 2는 `base`·`slow`·`entrance`만 허용한다 — 등급 2로 적으면 **구현자가 프리미티브와 등급 계약을 동시에 만족할 수 없다**. 등급을 낮추는 쪽이 [D24](policy.md#d24)의 "한 단계 낮춘다"와도 맞는다. 등급 2를 굳이 지키려면 `enterUp`(base) 계열로 갈아타야 하는데, 그건 위 첫 불릿이 배제한 축(stagger 둘)이다.
- 챌린지 카드에 `enterUp(i)`를 걸 자리는 `GroupRoomScreen.tsx:1072-1092`의 `.map()`이다. 키가 `c.id`라 노드 동일성이 유지된다.

**눌림은 카드가 아니라 버튼에 건다**

`ChallengeCard`의 **루트는 비터치 `View`** 다(`ChallengeCard.tsx:1113-1116`). GROMO-1101이 롱프레스 삭제를 없애며 의도적으로 제스처를 걷어냈고, 파일 주석이 *"눌리는 자리는 전부 안쪽의 명시적 버튼이다"* 라고 못박아 뒀다. **카드 루트에 `PressableScale`을 얹으면 안 된다** — 중첩 터치가 생기고, 지금까지 없던 "카드 전체 탭" 동선이 새로 열린다.

`PressableScale`로 바꿀 자리는 카드 안의 **실제 터치 버튼 10개**다. 아래는 `ChallengeCard.tsx`에서 `<TouchableOpacity`가 열리는 줄이며, **10개 전부 `onPress`를 갖고 있음을 개별 확인**했다:

| 자리 | testID | `<TouchableOpacity` 줄 | `onPress` |
| --- | --- | --- | --- |
| 챌린지 삭제 X | `group.challenge.delete.{id}` | `:1138` | `confirmDelete` |
| 다음 회차 참가 | `group.bet.joinNext.{id}` | `:1257` | `openJoinNextSheet` |
| 내기 열기 | `group.bet.create.{id}` | `:1295` | `openBet('create')` |
| 오늘 참여 취소 | `group.bet.leaveToday.{id}` | `:1336` | `confirmLeaveToday(...)` |
| 내기에서 빠지기 | `group.bet.leave.{id}` | `:1349` | `confirmLeaveBet` |
| 내기 닫기 | `group.bet.cancel.{id}` | `:1366` | `confirmCancelBet` |
| 참가 | `group.bet.join.{id}` | `:1402` | `openBet('join')` |
| 다음 회차 빠지기 | `group.bet.leaveNext.{id}` | `:1437` | `confirmLeaveNext(nextStake)` |
| 이번 주 참가 | `group.bet.week.{id}` | `:1453` | `openWeekSheet` |
| 지난 내기 | `group.bet.last.{id}` | `:1474` | `setLastBetView({kind:'last'})` |

> ⚠️ **`group.bet.leaveCountdown.{id}`는 버튼이 아니다.** `ChallengeCard.tsx:1384`의 `<LeaveCountdown>`은 `onPress` 없는 **표시 전용 `<Text>`** 다(`:137-171` — 남은 시간을 초 단위로 다시 그리는 자식으로, 매초 리렌더를 카드 본체에서 떼어내려고 분리한 것이다). 여기에 `PressableScale`을 얹으면 **비대화형 요소를 버튼으로 만들고** 통과할 수 없는 테스트가 생긴다. 카드 안의 `<TouchableOpacity`는 정확히 **10개**이고 이 컴포넌트는 그중에 없다.

`MemberTile`은 반대다 — 루트가 이미 `TouchableOpacity`(`MemberTile.tsx:58-65`)이고 타일 전체가 탭 대상이므로(멤버 통계 비교로 이동, GROMO-1200) **루트를 그대로 `PressableScale`로 바꾼다.** 동선이 늘지 않는다.

**지난 내기 결과의 `pop`은 `isMe`가 아니라 `isMe && 승리`에만 건다**

`LastBetResultSheet`의 행은 **참가자 전원**에게 렌더되고 `isMe`는 **강조 스타일만** 고른다(`LastBetResultSheet.tsx:246-257` — `s.rowMe`·`s.nicknameMe`). `isMe`를 그대로 조건으로 쓰면 **진 사람·미판정인 사람에게 등급 3 축하 연출이 재생된다.** [IA §3.4](information-architecture.md)가 지정한 대상은 "베팅 **승리**"다.

판정은 그 파일이 이미 계산해 둔 지역 변수로 한다(`:247-249`):

```ts
const isMe    = !!myUserId && r.userId === myUserId;
const pending = r.payout === null || r.achieved === null;   // 미판정
const delta   = pending ? 0 : (r.payout as number) - lastBet.stake;

const celebrate = isMe && !pending && r.achieved === true && delta > 0;  // ← pop 조건
```

- **`delta > 0`이 핵심이다.** 전원이 달성하면 `payout === stake`가 되어 `delta === 0` — 달성은 했지만 **딴 것이 없다.** 축하할 사건이 아니다.
- **`achieved === true`를 함께 본다.** 서버가 계약을 어겨 `achieved:null`인데 `payout`이 온 경우를 축하로 칠하지 않는다 — `ChallengeCard.tsx:1205`가 같은 이유로 `p.achieved === true && p.progressMinutes !== null`을 쓴다.
- **승자 0명 결말(`REFUNDED`·`FORFEITED`)은 자동으로 걸러진다.** 환불이면 `delta === 0`, 몰수면 `delta === -stake`다. 배너 상태를 따로 볼 필요가 없다.

**챌린지 내역 스켈레톤 — `SkeletonCard`를 쓸 수 없다**

`SkeletonCard`는 `height`를 **필수 prop**으로 받는다(`Skeleton.tsx:127-138`). 호출부가 실제 카드 높이 **상수**를 넘기도록 강제해서 D11의 "치수는 실제 콘텐츠와 같아야 한다"를 지키는 장치인데, 이 화면의 카드에는 **그 상수가 없다.** 높이가 두 축으로 변한다:

- `cardMission` 줄이 **조건부**다 — 카테고리를 모르는 과거 이력(V39 백필 이전)은 이 줄을 아예 안 그린다(`GroupChallengeHistoryScreen.tsx:271-275`)
- `cardSummary`가 `flex: 1`이라(`:491`) 문구 길이에 따라 **줄바꿈**된다

따라서 이 화면은 **전용 구조적 스켈레톤**을 쓴다 — 실제 카드와 같은 프레임(`padding: T.space.lg` · `borderRadius: 16` · `gap: T.space.xs`, `:467-474`) 안에 `Skeleton` 블록을 카드의 줄 구성대로 3개 쌓고, 묶음 전체를 `SkeletonGroup` 하나로 감싼다(펄스는 묶음당 하나 — `Skeleton.tsx:31-36`). 그룹방·그룹 목록이 이미 쓰는 형태와 같다(`GroupRoomScreen.tsx:855-881` · `GroupScreen.tsx:412-424`).

**높이 기준은 카드의 최소 형태**(mission 줄 없는 3줄)로 잡는다. 가변 높이에서 점프를 0으로 만들 수는 없으니 **어느 쪽으로 틀릴지**를 고른 것이다 — 스켈레톤이 실제보다 작으면 도착 시 콘텐츠가 **아래로 밀리고**(내용이 더 왔다는 뜻으로 읽힌다), 크면 **위로 당겨져** 방금 보던 자리가 어긋난다. 밀리는 쪽이 낫다.

**그룹 목록 — 이미 끝나 있다** (`GroupScreen.tsx`는 껍데기고 실물은 `GroupListScreen.tsx`다)

세로 목록이 아니라 **가로 카드 덱**이다. 하이드레이션 스켈레톤(`:1137-1141`) → `FlatList horizontal`(`:1144`) 이고, 진입 시차는 `CellRendererComponent`를 `Animated.View`로 갈아끼워 건다(`GroupListScreen.tsx:175-190`). 뷰를 새로 끼우지 않으므로 E2E `testID` 계약이 그대로다 — **챌린지 내역 리스트도 같은 기법을 쓴다.**

> ⚠️ **다만 챌린지 내역은 페이지네이션 목록이라 인덱스 축이 다르다.** 가로 덱은 한 번에 다 오지만 내역은 `loadMore`로 이어 붙는다. `enterUp`에 **절대 인덱스**를 넘기면 21번째 행부터 전부 상한 `staggerMaxSteps`(6) × 60 = **360ms 동안 `animationFillMode: 'backwards'`로 투명 대기**한다. 이 화면은 `loadingMore`가 끝나는 즉시 꼬리 스피너를 지우므로, 사용자는 **빈 영역을 보다가 행이 나타나는** 것을 겪는다 — 스피너도 없고 내용도 없는 구간이 생긴다.
>
> 그래서 **페이지 내 인덱스**(`index - 이번 페이지 시작 오프셋`)를 넘긴다. 각 페이지가 자기 안에서 0부터 시차를 매기므로 어느 페이지든 첫 행이 즉시 뜬다. 첫 페이지만 걸고 이후는 시차 없이(`enterUp(0)`) 붙이는 것도 같은 목적을 달성하며, 둘 중 어느 쪽이든 **절대 인덱스만 아니면 된다**.

> ⚠️ **`GroupCardDeck.tsx`는 배선돼 있지 않다.** `GroupCardDeck.test.tsx` 말고는 import 하는 곳이 없다 — 화면이 쓰는 것은 `GroupListScreen`의 `FlatList` + `PageIndicator` + `GroupCardFlip`(`:1210`)/`GroupCardFront`(`:1270`)/`GroupCardBack`(`:1219`)이다. 여기에 모션을 얹으면 **아무 화면에서도 보이지 않는다.**

> ⚠️ **그룹·챌린지의 반복 요소에는 `AnimatedNumber`도 `ProgressBar`도 얹지 않는다** ([정책 D25-1·D25-2](policy.md#d25)). 그룹 정원이 **최대 10명**이라 멤버 타일도 내기 참가자 행도 10개까지 늘어난다 — `AnimatedNumber`는 P5(JS 스레드 3개)를, `ProgressBar`는 D10(`width` 애니메이션 1~3개)을 각각 넘긴다. **"시트니까 하나"로 세지 않는다.**

> **홈 stagger는 첫 마운트에서만.** 탭 복귀 시 재생하면 앱이 느려 보인다. `useRef(false)` 가드로 1회만.

---

## 7. 테스트 표

| 테스트 파일 | 잠그는 규칙 |
| --- | --- |
| `constants/motion.test.ts` | duration 6값 고정 · **오름차순 가드** · 베지어 제어점 · spring 파라미터 |
| `hooks/useMotion.test.ts` | reduce=false → `css(x)===x` · `delay(n)===n` · `stagger(3)===180` |
| `hooks/useMotion.reduced.test.ts` | reduce=true → `css(x)===undefined` · `timing(1)===1` · `delay(n)===0` |
| `components/Skeleton.test.tsx` | reduce → `animationName` 부재 · a11y 숨김 |
| `components/ProgressBar.test.tsx` | `progress=0.5` → 계산된 width 50% · a11y value |
| `components/AnimatedNumber.test.tsx` | fake timer 후 최종 텍스트 · reduce면 첫 프레임 최종값 · a11y 라벨 |
| `components/Toast.test.tsx` | 큐잉 순차 · 2200ms 자동 해제 · **iOS에서만** `announceForAccessibility` 호출 / **Android에선 미호출**(`Platform.OS` 목킹) |
| `components/SheetShell.test.tsx` | §4.4 기존 규칙 전부 + 퇴장 후 `onClose` + reduce 시 애니메이션 스타일 부재 |
| `components/PressableScale.test.tsx` | **무수정 통과**가 톤 변경(PR2)의 안전망 |
| 알럿 이관 지점별 | `Alert.alert` **미호출** + `show` 호출 |
| `screens/group/GroupRoomScreen.test.tsx` | 챌린지 카드 M개에 **서로 다른** `animationDelay` · 멤버 그리드는 **행 수만큼**의 delay 단계(타일 수가 아니다) · **행 delay가 `0/1/2ms`가 아니라 `0/60/120ms`** (`fadeIn`에 인덱스를 넘기는 사고 차단) · reduce → 둘 다 `animationName` 부재 |
| `screens/group/components/MemberTile.test.tsx` (신규) | 눌림이 `PressableScale` 경유 · `onPress` 없으면 비활성 유지 |
| `screens/group/components/ChallengeCard.test.tsx` | **카드 루트에 `onPress`가 없다**(비터치 `View` 유지 — 회귀 방지) · 내부 버튼 **10개**가 `PressableScale` 경유 · **`group.bet.leaveCountdown`은 여전히 눌리지 않는다**(표시용 `<Text>` — 버튼화 방지) |
| `screens/group/components/ChallengeResultModal.test.tsx` | **레거시 `Animated` 미사용** · reduce → 캐릭터 `pop` 부재 + **모달·문구·수치·명단은 그대로** ([IA §5](information-architecture.md)) · 결과 키가 바뀌면 진입이 다시 걸린다 |
| `screens/group/GroupChallengeHistoryScreen.test.tsx` | 첫 로딩에 `ActivityIndicator` **미사용** + 스켈레톤 `testID` 존재 · `SkeletonCard` **미사용**(높이 상수가 없다 — D25-3) · **꼬리 스피너는 그대로 존재**(회귀 방지) |
| `screens/group/components/BetSheet.test.tsx` | 참여자 행에 `ProgressBar`·전환 스타일이 **없다**(D25-2 회귀 방지) · 폭이 `dayBarPercent` 그대로 |

> ⚠️ **꼬리 스피너를 지웠는지가 아니라 남았는지를 단언한다.** 챌린지 내역의 `ListFooterComponent`
> 스피너(`GroupChallengeHistoryScreen.tsx:363-368`)와 시트 CTA 안 스피너는 **스켈레톤 대상이 아니다** —
> "스피너를 전부 없앤다"로 읽고 지우면 다음 페이지 로딩이 무음이 된다.

**작성 금지** — 애니메이션 중간 프레임·타이밍·이징 곡선 단언. jest에서 워클릿은 모킹돼 실제로 실행되지 않는다 ([정책 D14](policy.md#d14)).

---

## 8. 수동 QA 체크리스트

**공통 (매 PR)**
- [ ] `npm run typecheck && npm run lint && npm test`
- [ ] iOS 설정 › 손쉬운 사용 › 동작 › **동작 줄이기 ON**으로 해당 화면 순회
- [ ] **애니메이션 재생 도중** 동작 줄이기를 켰을 때 요소가 중간 상태로 굳지 않는가

**PR2 (톤)**
- [ ] 홈 FAB · 탭바 · 시트 CTA · 작은 아이콘 버튼(`scaleTo 0.90`)
- [ ] 연타 시 스프링 인터럽트가 자연스러운가
- [ ] "활기 있되 캐주얼하지 않은가" — 최종 판정

**PR3 (시트)**
- [ ] 시트 14곳 전부 열고 닫기
- [ ] **키보드가 뜬 상태**의 등장/퇴장 — `NoticeComposeSheet` · `GroupFindSheet`
- [ ] 저장 중(`dismissible=false`) 드래그 → 복귀
- [ ] 저사양 기기에서 `asModal` present 타이밍 vs 등장 스프링
- [ ] `./scripts/e2e.sh` **전체**

**PR4~PR6**
- [ ] 네트워크 스로틀링으로 통계 탭 진입 — 스켈레톤 8개 동시, 도착 시 **레이아웃 점프 없음**
- [ ] Android 실기기 — CSS 애니메이션 동작, `AnimatedNumber` 폰트 메트릭, translate 중 `elevation` 그림자
- [ ] VoiceOver — 진입 중 포커스 순서, 숫자가 중간값을 읽지 않는가

**PR5 (토스트)**
- [ ] `.maestro/flows/` 알럿 문구 grep 선행 → 깨지는 플로우 같은 PR에서 수정
- [ ] `./scripts/e2e.sh` 전체

**PR7~PR8**
- [ ] 홈 탭 복귀 시 카드 stagger가 **재생되지 않는가**
- [ ] 25분 뽀모도로 1사이클 · 백그라운드 왕복 · 가로모드(`FlipClock` 경로 무영향)
- [ ] 리그 재정렬이 **한 칸씩** 오르는가 · 마지막 상승이 뜸 들인 뒤 느리게 넘어서는가
- [ ] 온보딩 전체 통과 + `./scripts/e2e.sh` 전체

**성능 허용선 (매 PR — [PRD §6](prd.md) 이 정본)**

기준 기기: iOS는 **최소 지원 16.4가 도는 최하위 기기 실물**(시뮬레이터 불인정), Android는 보급형 실기기.

- [ ] **P1** 진입·전환 중 33ms 초과 프레임 0회 — PR3·PR6·PR7
- [ ] **P2** 통계 스켈레톤 8~12개 동시 60fps — PR4
- [ ] **P3** 컨페티 재생 중 45fps 이상 — PR8
- [ ] **P4** 시트 탭 → 첫 프레임 100ms 이내 — PR3
- [ ] **P5** JS 스레드 애니메이션 화면당 3개 이하 — PR6 (코드 리뷰)
- [ ] **P6** 무한 루프 화면당 1개 이하 + 도착 시 언마운트 — PR4 (코드 리뷰)
- [ ] **P7** 콜드스타트 → 홈 조작 가능 시점이 늦어지지 않음 — PR7
- [ ] **P8** 집중 세션 시작 지연 0ms — PR3 (§4.3 이관 금지 목록 준수 확인)
- [ ] **P9** 축하 연출 후 메모리 누수 없음 — PR8

> 기준 기기 실물이 없으면 **미검증으로 남기고 PR 설명에 명시**한다. 미달 시 처리 순서는 [PRD §6.3](prd.md) — 등급 낮추기 → duration 단축 → 동시 실행 수 축소 → 연출 제거(+정책에 예외 기록). **순서를 건너뛰지 않는다.**

---

## 9. 의도적 예외 (토큰 밖)

> ⚠️ **정본은 [정책 D15](policy.md#d15)의 표다.** 이 절은 구현자가 한 문서 안에서 보도록 둔 사본이며,
> 감사가 리터럴을 판정할 때 보는 목록은 D15 쪽이다. 어긋나면 D15가 맞다.

| 값 | 위치 | D15 등록 | 이유 |
| --- | --- | --- | --- |
| `FILL_MS 2000` · `HOLD_MS 900` · `FINISH_MS 300` | `ScreenTimeAnalyzingOverlay.tsx:18–21` | ✅ | 네이티브 리포트 렌더 **가드 타임**. 모션 토큰과 같이 움직이면 안 됨 |
| `150 + order * 250` | `ProblemEmpathyStep.tsx:15` | ✅ | "알림이 연달아 도착"하는 **서사 연출** |
| `290` · reduce `150` | `GroupCardFlip.tsx:67` | ✅ | 그룹 카드 앞↔뒤 **3D 플립**. `rotateY 180°`의 지각 임계라 duration 사다리와 다른 축이다 ([정책 D25-4](policy.md#d25)) |
| `FLIP_MS` | `FlipClock.tsx` | ❌ **미등록** | 가로모드 전용 3D 플립. GROMO-1382가 "이번 범위 밖"으로 두고 **감사하지 않은** 값이라, 영구 예외로 올릴지 판단이 남아 있다 |
| 강등 3단계 `1500ms` 대기 | `LeagueResultScreen.tsx:98` | ❌ **미등록** | 연출 호흡. `m.delay()`만 통과시키고 값은 유지 |

> ⚠️ **아래 2건은 D15 표에 없다.** 이 절에만 적혀 있어 지금 상태로 구현 감사를 돌리면 **위반으로 잡힌다.**
> 둘 다 GROMO-1402의 범위 밖 값이라 여기서 임의로 등록하지 않았다 — **오너 판단이 필요한 미결 항목**이다.
