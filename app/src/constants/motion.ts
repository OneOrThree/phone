import { Easing, ReduceMotion, cubicBezier } from 'react-native-reanimated';
import type {
  CSSAnimationProperties,
  CSSAnimationTimingFunction,
  CSSTransitionProperties,
  CSSTransitionProperty,
} from 'react-native-reanimated';

// 모션 토큰 정본 (GROMO-1381 / 설계 docs/prd/motion/low-level-design.md §2).
// 앱의 모든 duration·이징·스프링·진입 프리셋이 여기서 나온다. 심볼은 theme.ts의 `T` 관행을 따라 `M`.
//
// ⚠️ 왜 theme.ts(T)가 아니라 별도 파일인가 — 정책 D1.
//    theme.ts는 import가 0개인 순수 상수 모듈이다. 이징 토큰은 cubicBezier()/Easing.bezier()
//    호출 결과여야 하므로 theme.ts에 넣으면 T를 쓰는 모든 파일 — reanimated와 무관한
//    utils/services 단위 테스트까지 — 이 워클릿 모듈 그래프를 끌고 들어온다.
//
// ⚠️ 커브는 .css / .fn 을 **쌍으로** 둔다. 하나로 합치면 런타임에 조용히 무시된다.
//      animationTimingFunction · transitionTimingFunction → .css
//      withTiming(v, { easing })                          → .fn
//
// ⚠️ CSS API는 reduce-motion 내장 처리가 없다. 프리셋 결과는 반드시 useMotion().css()를
//    통과시켜 쓴다 — `style={[s.card, m.css(enterUp(i))]}`.

// 베지어 제어점 단일 출처.
const STANDARD = [0.2, 0, 0, 1] as const; // 표준 감속 — 오버슛 없음
const OVERSHOOT = [0.34, 1.56, 0.64, 1] as const; // 탭바 알약·차트 막대 (기존 2곳 중복을 수렴)
const GLIDE = [0.3, 1.15, 0.5, 1] as const; // 얕은 오버슛 — 이동거리가 긴 요소 (glassSlide 승격)
// ⚠️ easeOutQuad의 베지어 근사다. CSS 키워드 'ease-out'(=0,0,0.58,1)이 아니다 —
//    키워드를 쓰면 .fn(Easing.out(Easing.quad))과 다른 커브가 되어 쌍 계약이 깨진다.
const OUT_QUAD = [0.25, 0.46, 0.45, 0.94] as const;

export const M = {
  // duration 사다리 — 값을 새로 발명하지 않고 이미 튜닝된 값을 칸으로 승격했다.
  dur: {
    press: 110, // 눌림. 이 아래는 없다 (PressableScale 110 승격)
    quick: 220, // 칩·토글·드로어·딤 페이드·시트 퇴장 (FocusMenuDrawer 220 승격)
    base: 350, // 시트 등장·알약 슬라이드·기본 전환 (SLIDE_MS·TabBar 350 승격)
    slow: 600, // 진행바 채우기·카운트업·팝 (checkPop 600 승격)
    entrance: 800, // 차트 막대·큰 요소 진입 (growUp 800 승격)
    celebrate: 1200, // 축하 표면·스켈레톤 펄스 1주기
  },

  curve: {
    standard: { css: cubicBezier(...STANDARD), fn: Easing.bezier(...STANDARD) },
    out: { css: cubicBezier(...OUT_QUAD), fn: Easing.out(Easing.quad) },
    linear: { css: 'linear', fn: Easing.linear },
    glide: { css: cubicBezier(...GLIDE), fn: Easing.bezier(...GLIDE) },
    overshoot: { css: cubicBezier(...OVERSHOOT), fn: Easing.bezier(...OVERSHOOT) },
  },

  spring: {
    // 버튼 복귀 — ζ 0.50, 이동량의 16% 오버슛 1회, 안착 ≈367ms(2% 허용대).
    // ⚠️ 오버슛 상한은 배율이 아니라 **이동량 대비 비율**이다. scaleTo가 깊을수록 최대 배율이
    //    커진다 — scaleTo 0.90 버튼은 1.016까지 튄다.
    press: { damping: 14, stiffness: 300, mass: 0.65 },
    snappy: { damping: 20, stiffness: 260, mass: 0.9 }, // 시트·패널·토스트 — 빠르고 오버슛 거의 없음
    bouncy: { damping: 13, stiffness: 180, mass: 0.9 }, // 배지·팝·축하 전용
    gentle: { damping: 16, stiffness: 120, mass: 1.0 }, // 큰 요소 진입 (온보딩 카드 승격)
  },

  stagger: { tight: 40, base: 60, loose: 90 },
  // 시차 총합 상한 — 항목 20개 리스트의 끝이 1.2초 뒤에 뜨는 참사 방지
  staggerMaxSteps: 6,
} as const;

export type SpringParams = (typeof M.spring)[keyof typeof M.spring];
export type CurveName = keyof typeof M.curve;

/** 숫자 ms를 CSS 시간 단위 문자열로. `ms(350)` → `'350ms'` */
export const ms = (n: number): `${number}ms` => `${n}ms`;

/** stagger 단계 지연(ms). staggerMaxSteps를 넘는 항목은 마지막 칸에 묶인다. */
export function staggerDelay(index: number, step: number = M.stagger.base): number {
  return Math.min(Math.max(index, 0), M.staggerMaxSteps) * step;
}

// ─────────────────────────────────────────────────────────────────────────────
// 프리셋 — 스타일 객체를 반환하는 **순수 함수**다. 래퍼 컴포넌트가 아니다.
// Maestro가 testID 셀렉터만 쓰므로 트리에 뷰를 추가하면 E2E 계약이 깨진다 (정책 D13).
//
// ⚠️ Reanimated CSS의 animationName은 **참조 동등성**으로 재시작 여부를 판단한다.
//    매 렌더 새 객체를 만들면 애니메이션이 계속 리셋된다 → index/delay별 결과를 모듈 스코프에
//    캐싱해 같은 참조를 돌려준다. 호출부에서 useMemo를 따로 걸 필요가 없다.
// ─────────────────────────────────────────────────────────────────────────────

const enterUpCache: CSSAnimationProperties[] = [];

/** 아래에서 12pt 올라오며 페이드인. 리스트·카드 진입의 기본값. */
export function enterUp(index = 0): CSSAnimationProperties {
  const i = Math.min(Math.max(index, 0), M.staggerMaxSteps);
  if (!enterUpCache[i]) {
    enterUpCache[i] = {
      animationName: { from: { opacity: 0, transform: [{ translateY: 12 }] } },
      animationDuration: ms(M.dur.base),
      animationDelay: ms(i * M.stagger.base),
      animationTimingFunction: M.curve.standard.css,
      // 딜레이 동안 시작 상태를 유지 — 먼저 그려졌다가 튀는 것 방지
      animationFillMode: 'backwards',
    };
  }
  return enterUpCache[i];
}

const growUpCache: CSSAnimationProperties[] = [];

/**
 * 차트 막대 전용 — 바닥부터 자란다. FocusResultScreen의 `barEnterAnim`을 승격한 것.
 *
 * ⚠️ 호출부 스타일에 `transformOrigin: 'bottom'`이 있어야 한다(애니메이션 프로퍼티가 아니라
 *    정적 스타일이다). height 대신 scaleY를 쓰는 이유는 매 프레임 레이아웃 패스를 피하려는 것.
 * ⚠️ 차트에 enterUp을 쓰지 않는다 — duration(entrance 800)·축(scaleY)·커브(overshoot)가 다르다.
 *    duration을 인자로 받지 않는 이유는 참조 캐시 키가 (index, duration) 쌍으로 늘어나서다.
 */
export function growUp(index = 0): CSSAnimationProperties {
  const i = Math.min(Math.max(index, 0), M.staggerMaxSteps);
  if (!growUpCache[i]) {
    growUpCache[i] = {
      animationName: { from: { transform: [{ scaleY: 0 }] } },
      animationDuration: ms(M.dur.entrance),
      animationDelay: ms(i * M.stagger.base),
      animationTimingFunction: M.curve.overshoot.css,
      animationFillMode: 'backwards',
    };
  }
  return growUpCache[i];
}

// ⚠️ delay를 키로 쓰는 캐시는 인자가 유한하다는 전제 위에 있다(enterUp/growUp은 index를
//    staggerMaxSteps로 클램프해 배열로 캐싱하지만, 여기는 원시 ms 값이라 클램프할 축이 없다).
//    호출부가 `pop(i * 80)` 같은 동적 값을 넘기기 시작하면 조용히 자란다 — 신호 없이 새는 걸
//    막으려고 개발 빌드에서만 임계치를 넘을 때 한 번 경고한다(codex·claude 리뷰).
//    상한(LRU 등)을 두지 않는 이유: 참조가 바뀌는 순간 애니메이션이 리셋되므로 "캐시가 있는데
//    가끔 리셋된다"는 더 나쁜 실패 모드가 된다. 새는 걸 고치는 게 맞지 덮는 게 아니다.
const CACHE_WARN_AT = 32;
const warned = new Set<string>();
function guardCacheSize(name: string, size: number): void {
  if (!__DEV__ || size < CACHE_WARN_AT || warned.has(name)) return;
  warned.add(name);
  console.warn(
    `[motion] ${name}() 캐시가 ${size}개를 넘었습니다. 동적 delay를 넘기는 호출부가 있는지 확인하세요 — ` +
      '프리셋은 인자가 유한하다는 전제로 참조를 캐싱합니다.',
  );
}

const popCache = new Map<number, CSSAnimationProperties>();

/** 0에서 1.25까지 튀었다가 안착. 스트릭 ✓·배지·보상 순간 전용 (checkPop 승격). */
export function pop(delayMs = 0): CSSAnimationProperties {
  let cached = popCache.get(delayMs);
  if (!cached) {
    cached = {
      animationName: {
        from: { transform: [{ scale: 0 }] },
        '70%': { transform: [{ scale: 1.25 }] },
        to: { transform: [{ scale: 1 }] },
      },
      animationDuration: ms(M.dur.slow),
      animationDelay: ms(delayMs),
      animationTimingFunction: M.curve.out.css,
      animationFillMode: 'backwards',
    };
    popCache.set(delayMs, cached);
    guardCacheSize('pop', popCache.size);
  }
  return cached;
}

const fadeInCache = new Map<number, CSSAnimationProperties>();

/** 이동 없이 불투명도만. 이동거리를 줄 수 없는 자리(오버레이·크로스페이드)에만. */
export function fadeIn(delayMs = 0): CSSAnimationProperties {
  let cached = fadeInCache.get(delayMs);
  if (!cached) {
    cached = {
      animationName: { from: { opacity: 0 } },
      animationDuration: ms(M.dur.quick),
      animationDelay: ms(delayMs),
      animationTimingFunction: M.curve.standard.css,
      animationFillMode: 'backwards',
    };
    fadeInCache.set(delayMs, cached);
    guardCacheSize('fadeIn', fadeInCache.size);
  }
  return cached;
}

/**
 * 스켈레톤 펄스 — 불투명도만 왕복한다.
 *
 * 시머(sweep)를 쓰지 않는 이유: LinearGradient + 마스크 + translateX가 필요해 요소당 뷰가 2개
 * 늘고, 통계 화면처럼 8~12개를 동시에 띄우면 비용이 크다. 펄스는 레이아웃 패스가 없다 (정책 D11).
 * ⚠️ 무한 루프다 — 데이터가 도착하면 반드시 언마운트할 것(화면당 무한 루프 1개 상한).
 */
export const pulse: CSSAnimationProperties = {
  animationName: { from: { opacity: 0.45 }, to: { opacity: 1 } },
  animationDuration: ms(M.dur.celebrate),
  animationTimingFunction: M.curve.standard.css,
  animationIterationCount: 'infinite',
  animationDirection: 'alternate',
};

const transitionCache = new Map<string, CSSTransitionProperties>();

/**
 * "값이 바뀌면 부드럽게 따라가라" — 탭바 알약·진행바처럼 목표값만 바뀌는 자리.
 * (TabBar `highlightSlide` · liquidGlass `glassSlide` 승격)
 */
export function transition(opts: {
  property: CSSTransitionProperty;
  duration?: number;
  curve?: CurveName;
  delay?: number;
}): CSSTransitionProperties {
  const { property, duration = M.dur.base, curve = 'standard', delay = 0 } = opts;
  const key = `${Array.isArray(property) ? property.join('|') : String(property)}:${duration}:${curve}:${delay}`;
  let cached = transitionCache.get(key);
  if (!cached) {
    cached = {
      transitionProperty: property,
      transitionDuration: ms(duration),
      transitionTimingFunction: M.curve[curve].css as CSSAnimationTimingFunction,
      ...(delay > 0 ? { transitionDelay: ms(delay) } : {}),
    };
    transitionCache.set(key, cached);
    guardCacheSize('transition', transitionCache.size);
  }
  return cached;
}

// 레이아웃 애니메이션 빌더(LinearTransition 등)에 스프링 토큰을 얹는다.
// `layout={springify(LinearTransition)}` 형태로 쓴다.
type SpringifiableBuilder = {
  springify(): SpringifiableBuilder;
  damping(v: number): SpringifiableBuilder;
  stiffness(v: number): SpringifiableBuilder;
  mass(v: number): SpringifiableBuilder;
  reduceMotion(v: ReduceMotion): SpringifiableBuilder;
};

export function springify<B extends SpringifiableBuilder>(
  builder: B,
  s: SpringParams = M.spring.snappy,
): B {
  return (
    builder
      .springify()
      .damping(s.damping)
      .stiffness(s.stiffness)
      .mass(s.mass)
      // ⚠️ 내장 reduce-motion 게이트를 **명시적으로 끈다** (정책 D6).
      //    레이아웃 빌더의 기본값은 ReduceMotion.System인데, 그건 reanimated가 모듈 로드 시 1회
      //    계산하는 **정적** 플래그다. '동작 줄이기'를 켠 채로 앱을 켰다가 실행 중에 끄면
      //    useMotion은 반응해서 layout prop을 다시 내주지만 이 정적 플래그가 애니메이션을 계속
      //    억제한다 — 앱 안에 '동작 줄이기' 진실이 둘 생긴다.
      //    켜고 끄는 판단은 useMotion 한 곳만 한다(codex 리뷰).
      .reduceMotion(ReduceMotion.Never) as B
  );
}
