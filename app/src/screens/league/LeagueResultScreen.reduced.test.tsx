// 리그 결과 화면 — '동작 줄이기'가 **화면 진입 전부터 켜져 있던** 경우의 게이트 테스트.
//
// 회귀 배경(codex 리뷰): m.delay()는 대기 시간만 0으로 만든다. 뒤이어 걸리는 원시 애니메이션 —
// LayoutAnimation.create(500) · Animated.spring(nameAnim) · Animated.delay(200) · 420ms 타이틀
// timing · Animated.spring(line3) — 은 게이트 밖이라 그대로 재생됐다. 이때 '재생 도중 켜짐'
// effect는 꺼짐→켜짐 전이가 아니라 돌지 않으므로, 사용자는 티어명·타이틀·하단 안내의 확대와
// 페이드를 전부 보게 됐다.
//
// 잠그는 규칙 둘:
//   ① reduce면 이 원시 애니메이션들이 **하나도 시작되지 않는다**
//   ② 그래도 **시퀀스는 완주한다** — 결과 티어명이 화면에 뜬다(중간 단계에서 멈추지 않는다)
//
// ⚠️ 중간 프레임·타이밍·이징 곡선은 단언하지 않는다(정책 D14). 보는 것은 "애니메이션을
//    시작했는가"와 "최종 화면에 도달했는가"뿐이다.
import { Animated, LayoutAnimation } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import LeagueResultScreen from './LeagueResultScreen';

let mockReduce = true;
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => true,
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: () => ({
    params: {
      type: 'promote',
      fromLevel: 2,
      toLevel: 3,
      weekHours: 20,
      weekStartAt: '2026-08-03T00:00:00+09:00',
      promotionBonusCoins: 0,
    },
  }),
}));

jest.mock('@/services/leagueApi', () => ({ ackLastResult: jest.fn(() => Promise.resolve()) }));
jest.mock('@/utils/haptics', () => ({ hapticSuccess: jest.fn() }));
// 파티클은 이 테스트의 관심사가 아니다(reduce에서 ConfettiBurst가 스스로 생략한다 — 정책 D7).
jest.mock('@/components/ConfettiBurst', () => ({ ConfettiBurst: () => null }));

jest.mock('react-native-safe-area-context', () => {
  const { View: RNView } = require('react-native');
  return { SafeAreaView: RNView };
});
jest.mock('react-native-svg', () => {
  const { View: RNView } = require('react-native');
  return {
    __esModule: true,
    default: RNView,
    Defs: RNView,
    RadialGradient: RNView,
    Rect: RNView,
    Stop: RNView,
  };
});

// 화면이 실제로 애니메이션을 걸었는지만 본다 — 원본 구현을 그대로 통과시키는 spy.
let configureNext: jest.SpyInstance;
let spring: jest.SpyInstance;
let sequence: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  configureNext = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
  spring = jest.spyOn(Animated, 'spring');
  sequence = jest.spyOn(Animated, 'sequence');
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** 시퀀스가 끝까지 돌 만큼 시간을 흘린다(강등 3단계 2000ms + 여유) */
async function playOut() {
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
}

describe("결과 화면 — '동작 줄이기'가 처음부터 켜져 있을 때", () => {
  test('레이아웃 페이드·스프링·타이틀 시퀀스를 하나도 시작하지 않는다', async () => {
    mockReduce = true;
    await render(<LeagueResultScreen />);
    await playOut();

    expect(configureNext).not.toHaveBeenCalled();
    expect(spring).not.toHaveBeenCalled();
    expect(sequence).not.toHaveBeenCalled();
  });

  test('그래도 시퀀스는 완주한다 — 결과 티어명이 화면에 뜬다', async () => {
    mockReduce = true;
    await render(<LeagueResultScreen />);
    await playOut();

    // 승격이라 '이전 → 결과' 두 티어명이 모두 보인다(결과 티어명은 showTo로만 등장한다)
    expect(screen.getByText('예열 모드')).toBeTruthy();
    expect(screen.getByText('초집중 모드')).toBeTruthy();
  });
});

describe('대조군 — 설정이 꺼져 있으면 그대로 재생한다', () => {
  test('레이아웃 페이드와 스프링이 실제로 걸린다', async () => {
    mockReduce = false;
    await render(<LeagueResultScreen />);
    await playOut();

    expect(configureNext).toHaveBeenCalled();
    expect(spring).toHaveBeenCalled();
    expect(sequence).toHaveBeenCalled();
    expect(screen.getByText('초집중 모드')).toBeTruthy();
  });
});
