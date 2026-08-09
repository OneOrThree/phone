// LineChart 렌더 스모크(GROMO-1381) — 진입 연출을 붙이면서 플롯 캔버스를 `Svg`에서
// `Animated.createAnimatedComponent(Svg)`로 바꿨다. 그 교체가 렌더 자체를 깨지 않는지,
// 그리고 라벨·빈 상태 같은 기존 계약이 그대로인지만 잠근다.
//
// ⚠️ 캔버스는 `plotW > 0`일 때만 그려진다 — jest에는 레이아웃 패스가 없어 onLayout이 저절로
//    오지 않으므로 직접 발생시켜야 애니메이션 경로가 실제로 렌더된다.
// ⚠️ 애니메이션 중간 프레임·타이밍·이징은 단언하지 않는다(워클릿이 목이라 거짓 안정감).
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { FirstStartChart, LineChart } from './charts';
import { FIRST_START_BODY_H } from './constants';
import type { StatBar } from './format';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => cb(), [cb]);
  },
}));
// 영영 끝나지 않는 조회 — '조회 중' 상태에 붙잡아 두고 높이만 본다
jest.mock('@/services/focusApi', () => ({
  getAllFocusSessions: jest.fn(() => new Promise(() => {})),
}));

const bars: StatBar[] = [
  { label: '월', value: 30, current: false, future: false },
  { label: '화', value: 60, current: true, future: false },
  { label: '수', value: 0, current: false, future: true },
];

// 플롯 폭을 알려 준다 — 이게 있어야 SVG 캔버스가 마운트된다.
// RTL v14엔 UNSAFE_* 탐색기가 없어, 가로 라벨에서 위로 올라가며 onLayout을 가진 조상을 찾는다.
function layoutPlot() {
  type Node = ReturnType<typeof screen.getByText>;
  let node: Node | null = screen.getByText('월');
  while (node && typeof node.props.onLayout !== 'function') node = node.parent;
  if (!node) throw new Error('onLayout을 가진 플롯을 찾지 못했다');
  fireEvent(node, 'layout', { nativeEvent: { layout: { width: 300, height: 120 } } });
}

describe('LineChart', () => {
  test('기록이 없으면 빈 상태 문구만 그린다', async () => {
    await render(<LineChart bars={[]} color="#000000" />);
    expect(screen.getByText('아직 기록이 없어요')).toBeTruthy();
  });

  test('레이아웃이 잡히면 애니메이션 캔버스까지 렌더되고 라벨은 그대로다', async () => {
    await render(<LineChart bars={bars} color="#000000" />);
    expect(screen.getByText('월')).toBeTruthy();
    layoutPlot();
    // 캔버스가 붙은 뒤에도 축 라벨·가로 라벨이 그대로 있어야 한다(격자·라벨은 애니메이션 밖)
    expect(screen.getByText('화')).toBeTruthy();
    expect(screen.getByText('수')).toBeTruthy();
  });
});

describe('FirstStartChart 자체 조회 중', () => {
  // 화면 스켈레톤이 완성 높이로 자리를 잡아 놨는데 카드가 마운트되며 작은 스피너만 그리면
  // 카드가 수축했다 다시 확장한다 — 조회 중에도 완성 본문 높이를 예약해 점프를 없앤다(codex 리뷰).
  test('완성 본문과 같은 높이를 예약한다', async () => {
    await render(<FirstStartChart period="MONTH" />);
    const style = StyleSheet.flatten(screen.getByTestId('stats.firstStart.loading').props.style);
    expect(style.height).toBe(FIRST_START_BODY_H);
  });
});
