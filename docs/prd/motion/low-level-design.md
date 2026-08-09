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
| `src/hooks/useMotion.test.tsx` | ~70 | reduce=false 분기 |
| `src/hooks/useMotion.reduced.test.tsx` | ~70 | reduce=true 분기 (모듈 스코프 단일 인스턴스라 파일 분리) |

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

export const M = {
  dur: { press: 110, quick: 220, base: 350, slow: 600, entrance: 800, celebrate: 1200 },

  curve: {
    standard:  { css: cubicBezier(...STANDARD),  fn: Easing.bezier(...STANDARD) },
    out:       { css: 'ease-out',                fn: Easing.out(Easing.quad) },
    linear:    { css: 'linear',                  fn: Easing.linear },
    glide:     { css: cubicBezier(...GLIDE),     fn: Easing.bezier(...GLIDE) },
    overshoot: { css: cubicBezier(...OVERSHOOT), fn: Easing.bezier(...OVERSHOOT) },
  },

  spring: {
    press:  { damping: 14, stiffness: 300, mass: 0.65 }, // 버튼 복귀 — 최대 배율 1.006 · ≈230ms
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
| `Toast` | (Context 경유) `message` `tone` `icon?` | `accessibilityLiveRegion="polite"` + `announceForAccessibility()` **필수** |

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
| 통계 | 차트 진입 | `enterUp(i)` | entrance | i × 60 | 2 |
| 집중 세션 | 카운트다운·뽀모도로 | `ProgressRing` | 연속 | — | 1 |
| 집중 세션 | 페이즈 전환 | 크로스페이드 + `hapticMedium` | quick | 0 | 1 |
| 집중 결과 | 주간 막대 | `enterUp` 계열(`growUp`) | entrance | i × 60 | 2 |
| 집중 결과 | 스트릭 ✓ · 코인 | `pop` | slow | 400 | 3 |
| 리그 | 순위 행 | `enterUp(i)` | base | i × 60 | 2 |
| 리그 | 재정렬 | `LinearTransition` + `spring.snappy` | — | — | 1 |

**리그 재정렬 — 한 칸씩 오른다** ([ui.html](ui.html) 리그 카드)
- 여러 칸을 한 번에 뛰면 **결과만 남고 과정이 사라진다.** 3위→1위는 3→2, 2→1 두 단계로 나눠 재생하고 사이에 ~820ms를 둔다.
- 자리가 바뀌기 **직전에 내 기록을 먼저 갱신**한다(~180ms). 바로 위 사람을 앞지르는 값이라야 상승이 납득된다.
- 올라가는 행과 밀려나는 행이 **함께** 움직인다. 한쪽만 움직이면 겹쳐 보인다.
- 순위 번호는 **자리에 붙는 값**이라 순서가 바뀔 때마다 다시 매긴다.
- **전제: 행 노드의 동일성이 유지돼야 한다.** 순서만 바뀌고 노드가 재생성되면 애니메이션이 성립하지 않는다. ✅ 확인됨 — `LeagueScreen.tsx:369,517`이 이미 `key={m.userId}`를 쓴다(인덱스 키가 아님). 리스트가 `.map()`+`ScrollView`라 `itemLayoutAnimation` 대신 **행마다 `layout={LinearTransition…}`** 을 직접 붙이는 형태가 된다.
| 리그 결과 | 승급 컨페티 | `ConfettiBurst` + `hapticSuccess` | celebrate | 시퀀스 후 | 3 |
| 시트 전체 | 등장 | `spring.snappy` | ≈base | 0 | 1 |
| 전역 | 토스트 | `spring.snappy` | quick | 0 | 1 |

> **홈 stagger는 첫 마운트에서만.** 탭 복귀 시 재생하면 앱이 느려 보인다. `useRef(false)` 가드로 1회만.

---

## 7. 테스트 표

| 테스트 파일 | 잠그는 규칙 |
| --- | --- |
| `constants/motion.test.ts` | duration 6값 고정 · **오름차순 가드** · 베지어 제어점 · spring 파라미터 |
| `hooks/useMotion.test.tsx` | reduce=false → `css(x)===x` · `delay(n)===n` · `stagger(3)===180` |
| `hooks/useMotion.reduced.test.tsx` | reduce=true → `css(x)===undefined` · `timing(1)===1` · `delay(n)===0` |
| `components/Skeleton.test.tsx` | reduce → `animationName` 부재 · a11y 숨김 |
| `components/ProgressBar.test.tsx` | `progress=0.5` → 계산된 width 50% · a11y value |
| `components/AnimatedNumber.test.tsx` | fake timer 후 최종 텍스트 · reduce면 첫 프레임 최종값 · a11y 라벨 |
| `components/Toast.test.tsx` | 큐잉 순차 · 2200ms 자동 해제 · `announceForAccessibility` 호출 |
| `components/SheetShell.test.tsx` | §4.4 기존 규칙 전부 + 퇴장 후 `onClose` + reduce 시 애니메이션 스타일 부재 |
| `components/PressableScale.test.tsx` | **무수정 통과**가 톤 변경(PR2)의 안전망 |
| 알럿 이관 지점별 | `Alert.alert` **미호출** + `show` 호출 |

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

| 값 | 위치 | 이유 |
| --- | --- | --- |
| `FILL_MS 2000` · `HOLD_MS 900` · `FINISH_MS 300` | `ScreenTimeAnalyzingOverlay.tsx:18–21` | 네이티브 리포트 렌더 **가드 타임**. 모션 토큰과 같이 움직이면 안 됨 |
| `150 + order * 250` | `ProblemEmpathyStep.tsx:15` | "알림이 연달아 도착"하는 **서사 연출** |
| `FLIP_MS` | `FlipClock.tsx` | 가로모드 전용 3D 플립. 이번 범위 밖 |
| 강등 3단계 `1500ms` 대기 | `LeagueResultScreen.tsx:98` | 연출 호흡. `m.delay()`만 통과시키고 값은 유지 |
