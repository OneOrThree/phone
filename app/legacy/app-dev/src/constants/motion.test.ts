// 모션 토큰 값 고정 테스트 (GROMO-1381).
//
// 여기서 잠그는 건 "값이 조용히 바뀌지 않는 것"이다. 애니메이션의 중간 프레임·타이밍·이징
// 곡선은 단언하지 않는다 — jest에서 워클릿은 목이라 실제로 실행되지 않으므로 전부 거짓
// 안정감이다(정책 D14).
import {
  M,
  enterUp,
  fadeIn,
  growUp,
  ms,
  pop,
  pulse,
  staggerDelay,
  transition,
  type SpringParams,
} from './motion';

describe('M.dur', () => {
  it('6단 사다리 값이 고정돼 있다', () => {
    expect(M.dur).toEqual({
      press: 110,
      quick: 220,
      base: 350,
      slow: 600,
      entrance: 800,
      celebrate: 1200,
    });
  });

  // 사다리가 뒤섞이면 "quick이 base보다 느린" 상태가 조용히 성립한다.
  // 값 하나를 고치는 순간 이 가드가 먼저 깨지게 둔다.
  it('오름차순이다', () => {
    const ladder = [
      M.dur.press,
      M.dur.quick,
      M.dur.base,
      M.dur.slow,
      M.dur.entrance,
      M.dur.celebrate,
    ];
    const sorted = [...ladder].sort((a, b) => a - b);
    expect(ladder).toEqual(sorted);
    expect(new Set(ladder).size).toBe(ladder.length);
  });
});

describe('M.curve', () => {
  // 쌍 계약이 이 토큰 체계의 핵심이다. .css만 있고 .fn이 없으면 withTiming에서 조용히
  // 무시되고, 반대면 CSS prop이 무시된다.
  it('모든 커브가 .css / .fn 을 쌍으로 갖는다', () => {
    const names = Object.keys(M.curve) as (keyof typeof M.curve)[];
    expect(names).toEqual(['standard', 'out', 'linear', 'glide', 'overshoot']);
    names.forEach((name) => {
      expect(M.curve[name].css).toBeDefined();
      // ⚠️ .fn 은 두 형태가 섞인다 — Easing.bezier()는 EasingFunctionFactory **객체**를,
      //    Easing.out()/Easing.linear는 함수를 돌려준다. withTiming은 둘 다 받는다.
      const fn = M.curve[name].fn as unknown;
      const isFactory =
        typeof fn === 'object' &&
        fn !== null &&
        typeof (fn as { factory?: unknown }).factory === 'function';
      expect(typeof fn === 'function' || isFactory).toBe(true);
    });
  });

  it('베지어 제어점이 고정돼 있다', () => {
    expect(String(M.curve.standard.css)).toContain('0.2');
    expect(String(M.curve.overshoot.css)).toContain('1.56');
    expect(String(M.curve.glide.css)).toContain('1.15');
    // ⚠️ CSS 키워드 'ease-out'(=0,0,0.58,1)이 아니라 easeOutQuad 근사여야 한다.
    //    키워드를 쓰면 .fn(Easing.out(Easing.quad))과 다른 커브가 되어 쌍 계약이 깨진다.
    expect(String(M.curve.out.css)).toContain('0.46');
    expect(M.curve.linear.css).toBe('linear');
  });
});

describe('M.spring', () => {
  it('4종 파라미터가 고정돼 있다', () => {
    expect(M.spring).toMatchObject({
      press: { damping: 14, stiffness: 300, mass: 0.65 },
      snappy: { damping: 20, stiffness: 260, mass: 0.9 },
      bouncy: { damping: 13, stiffness: 180, mass: 0.9 },
      gentle: { damping: 16, stiffness: 120, mass: 1.0 },
    });
  });

  // ⚠️ 내장 게이트(ReduceMotion.System)는 모듈 로드 시 1회 계산하는 **정적** 플래그다.
  //    프리셋에 Never가 박혀 있지 않으면, '동작 줄이기'를 켠 채 앱을 켰다가 끈 사용자가
  //    앱 재시작 전까지 모션이 죽은 화면을 본다. 켜고 끄는 판단은 useMotion만 한다(정책 D6).
  it('모든 스프링이 내장 reduce-motion 게이트를 끈다', () => {
    Object.values(M.spring).forEach((s) => {
      expect(s.reduceMotion).toBe(M.never);
    });
  });

  // ζ = c / (2√(km)). press는 얕은 오버슛 1회(과소감쇠), snappy는 거의 튀지 않아야 한다.
  it('press는 과소감쇠, snappy는 press보다 덜 튄다', () => {
    // ⚠️ `(typeof M.spring)['press']`로 쓰면 안 된다 — M이 as const라 damping이 리터럴 14로
    //    좁혀져서 snappy를 넘길 수 없다. 네 프리셋의 합집합인 SpringParams를 써야 한다.
    const zeta = ({ damping: c, stiffness: k, mass: m }: SpringParams) =>
      c / (2 * Math.sqrt(k * m));
    expect(zeta(M.spring.press)).toBeLessThan(1);
    expect(zeta(M.spring.press)).toBeGreaterThan(0.4);
    expect(zeta(M.spring.snappy)).toBeGreaterThan(zeta(M.spring.press));
  });
});

describe('stagger', () => {
  it('값이 고정돼 있다', () => {
    expect(M.stagger).toEqual({ tight: 40, base: 60, loose: 90 });
    expect(M.staggerMaxSteps).toBe(6);
  });

  it('staggerMaxSteps를 넘는 항목은 마지막 칸에 묶인다', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(3)).toBe(180);
    expect(staggerDelay(6)).toBe(360);
    // 20개짜리 리스트의 끝이 1.2초 뒤에 뜨는 참사 방지
    expect(staggerDelay(19)).toBe(360);
    expect(staggerDelay(-1)).toBe(0);
  });

  it('step을 바꿔도 상한은 유지된다', () => {
    expect(staggerDelay(2, M.stagger.tight)).toBe(80);
    expect(staggerDelay(50, M.stagger.loose)).toBe(540);
  });
});

describe('ms', () => {
  it('CSS 시간 단위 문자열을 만든다', () => {
    expect(ms(350)).toBe('350ms');
    expect(ms(0)).toBe('0ms');
  });
});

describe('프리셋 참조 동등성', () => {
  // ⚠️ Reanimated CSS의 animationName은 참조 동등성으로 재시작 여부를 판단한다.
  //    같은 인자에 매번 새 객체를 돌려주면 애니메이션이 매 렌더 리셋된다.
  it('같은 인자면 같은 참조를 돌려준다', () => {
    expect(enterUp(2)).toBe(enterUp(2));
    expect(growUp(0)).toBe(growUp(0));
    expect(pop(400)).toBe(pop(400));
    expect(fadeIn(0)).toBe(fadeIn(0));
    expect(transition({ property: 'transform' })).toBe(transition({ property: 'transform' }));
  });

  it('다른 인자면 다른 참조다', () => {
    expect(enterUp(1)).not.toBe(enterUp(2));
    expect(pop(0)).not.toBe(pop(400));
  });

  it('상한을 넘는 index는 마지막 칸과 같은 참조로 수렴한다', () => {
    expect(enterUp(19)).toBe(enterUp(M.staggerMaxSteps));
    expect(growUp(19)).toBe(growUp(M.staggerMaxSteps));
  });
});

describe('프리셋 내용', () => {
  it('enterUp은 아래에서 12pt 올라오며 페이드인한다', () => {
    expect(enterUp(0)).toMatchObject({
      animationName: { from: { opacity: 0, transform: [{ translateY: 12 }] } },
      animationDuration: '350ms',
      animationDelay: '0ms',
      animationFillMode: 'backwards',
    });
    expect(enterUp(2).animationDelay).toBe('120ms');
  });

  // 차트에 enterUp을 쓰면 duration이 350으로 고정돼 버린다 — 축·길이·커브가 모두 달라야 한다.
  it('growUp은 enterUp과 축·길이가 다르다', () => {
    expect(growUp(0)).toMatchObject({
      animationName: { from: { transform: [{ scaleY: 0 }] } },
      animationDuration: '800ms',
      animationFillMode: 'backwards',
    });
    expect(growUp(0).animationDuration).not.toBe(enterUp(0).animationDuration);
  });

  it('pop은 1.25까지 튀었다가 안착한다', () => {
    expect(pop(400)).toMatchObject({
      animationName: {
        from: { transform: [{ scale: 0 }] },
        '70%': { transform: [{ scale: 1.25 }] },
        to: { transform: [{ scale: 1 }] },
      },
      animationDuration: '600ms',
      animationDelay: '400ms',
    });
  });

  it('pulse는 무한 왕복한다', () => {
    expect(pulse).toMatchObject({
      animationIterationCount: 'infinite',
      animationDirection: 'alternate',
      animationDuration: '1200ms',
    });
  });

  it('transition은 delay가 0이면 키를 넣지 않는다', () => {
    expect(transition({ property: 'transform' })).not.toHaveProperty('transitionDelay');
    expect(transition({ property: 'transform', delay: 120 })).toMatchObject({
      transitionDelay: '120ms',
    });
  });

  it('transition은 배열 property를 그대로 받는다', () => {
    expect(transition({ property: ['transform', 'opacity'], curve: 'glide' })).toMatchObject({
      transitionProperty: ['transform', 'opacity'],
      transitionDuration: '350ms',
    });
  });
});

// ⚠️ 프리셋은 "인자가 유한하다"는 전제로 참조를 캐싱한다(CSS animationName은 참조 동등성으로
//    재시작을 판단하므로 캐시가 필수다). 동적 delay를 넘기는 호출부가 생기면 캐시가 무한히
//    자라는데, 눈에 띄는 증상이 없어 조용히 샌다. 그 조기 경보가 사라지지 않게 잠근다.
describe('프리셋 캐시 누수 경보', () => {
  it('임계치를 넘으면 경고하되 프리셋당 한 번만 찍는다', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 32개 임계치를 확실히 넘긴다 — delay 값마다 캐시 항목이 하나씩 생긴다
      for (let i = 0; i < 50; i += 1) fadeIn(1000 + i);
      const calls = warn.mock.calls.filter((c) => String(c[0]).includes('fadeIn'));
      expect(calls).toHaveLength(1);
      expect(String(calls[0][0])).toContain('[motion]');
    } finally {
      warn.mockRestore();
    }
  });
});
