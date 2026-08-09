// LineChart 렌더 스모크(GROMO-1381) — 진입 연출을 붙이면서 플롯 캔버스를 `Svg`에서
// `Animated.createAnimatedComponent(Svg)`로 바꿨다. 그 교체가 렌더 자체를 깨지 않는지,
// 그리고 라벨·빈 상태 같은 기존 계약이 그대로인지만 잠근다.
//
// ⚠️ 캔버스는 `plotW > 0`일 때만 그려진다 — jest에는 레이아웃 패스가 없어 onLayout이 저절로
//    오지 않으므로 직접 발생시켜야 애니메이션 경로가 실제로 렌더된다.
// ⚠️ 애니메이션 중간 프레임·타이밍·이징은 단언하지 않는다(워클릿이 목이라 거짓 안정감).
import { fireEvent, render, screen } from '@testing-library/react-native';
import { LineChart } from './charts';
import type { StatBar } from './format';

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
