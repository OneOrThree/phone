// LineChart 렌더 스모크(GROMO-1381) — 진입 연출을 붙이면서 선·점을 Animated 컴포넌트로
// 바꿨다(`AnimatedPolyline`·`AnimatedCircle`). 캔버스(`Svg`) 자체는 다시 정적이다 —
// 좌→우 draw-on 은 캔버스가 아니라 선이 움직이는 연출이라서다(정책 D16).
// 그 교체가 렌더 자체를 깨지 않는지, 라벨·빈 상태 같은 기존 계약이 그대로인지만 잠근다.
//
// ⚠️ 캔버스는 `plotW > 0`일 때만 그려진다 — jest에는 레이아웃 패스가 없어 onLayout이 저절로
//    오지 않으므로 직접 발생시켜야 애니메이션 경로가 실제로 렌더된다.
// ⚠️ 애니메이션 중간 프레임·타이밍·이징은 단언하지 않는다(워클릿이 목이라 거짓 안정감).
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { FirstStartChart, LineChart, dotWindow, drawOnRatios } from './charts';
import { CHART_BLOCK_H, FIRST_START_BODY_H } from './constants';
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
  test('기록이 없으면 빈 상태 문구를 그리되 **조회 중과 같은 높이**를 지킨다', async () => {
    // 빈 상태가 한 줄로 줄면 예약이 무의미해진다 — 신규 사용자에게만 아래 카드가 올라온다
    await render(<LineChart bars={[]} color="#000000" />);
    const node = screen.getByText('아직 기록이 없어요');
    expect(node).toBeTruthy();
    let box: typeof node | null = node;
    while (box && StyleSheet.flatten(box.props.style)?.minHeight == null) box = box.parent;
    expect(StyleSheet.flatten(box?.props.style).minHeight).toBe(CHART_BLOCK_H);
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

// 꺾은선 진입은 좌→우 draw-on 이고(정책 D16), 점은 선이 **그 자리를 지나가는 순간** 뜬다.
// 워클릿은 jest에서 목이라 화면 프레임은 단언하지 않는다(D14) — 대신 점 등장 시점을 정하는
// **비율 계산**을 잠근다. 여기가 틀리면 점이 선보다 먼저 뜨거나 뒤늦게 따라온다.
describe('drawOnRatios — 점 등장 시점은 누적 길이 비율이다', () => {
  test('등간격·같은 높이면 점이 균등하게 뜬다', () => {
    const { total, at } = drawOnRatios([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
    expect(total).toBe(30);
    expect(at).toEqual([0, 1 / 3, 2 / 3, 1]);
  });

  test('⚠️ 꺾임이 큰 구간은 더 오래 걸린다 — 상수 시차로는 못 맞춘다', () => {
    // 두 번째 구간만 세로로 크게 꺾인다: 길이 3-4-5 삼각형의 빗변(5)
    const { at } = drawOnRatios([
      { x: 0, y: 0 },
      { x: 3, y: 0 }, // 길이 3
      { x: 6, y: 4 }, // 길이 5  ← 더 길다
      { x: 9, y: 4 }, // 길이 3
    ]);
    expect(at).toEqual([0, 3 / 11, 8 / 11, 1]);
    // 균등 시차(i/3)와 실제로 다르다는 것이 이 테스트의 요지다
    expect(at[1]).not.toBeCloseTo(1 / 3, 3);
    expect(at[2]).not.toBeCloseTo(2 / 3, 3);
  });

  test('항상 0에서 시작해 1로 끝나고, 사이는 단조 증가한다', () => {
    const { at } = drawOnRatios([
      { x: 0, y: 5 },
      { x: 4, y: 1 },
      { x: 8, y: 9 },
      { x: 12, y: 2 },
      { x: 16, y: 6 },
    ]);
    expect(at[0]).toBe(0);
    expect(at[at.length - 1]).toBe(1);
    at.forEach((v, i) => i > 0 && expect(v).toBeGreaterThan(at[i - 1]));
  });

  test('점이 1개 이하면 0으로 나누지 않는다', () => {
    expect(drawOnRatios([])).toEqual({ total: 0, at: [] });
    expect(drawOnRatios([{ x: 3, y: 4 }])).toEqual({ total: 0, at: [0] });
  });

  test('모든 점이 같은 자리여도(총 길이 0) NaN이 나오지 않는다', () => {
    const { total, at } = drawOnRatios([
      { x: 2, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(total).toBe(0);
    expect(at.every((v) => Number.isFinite(v))).toBe(true);
  });
});

// 점의 팝은 선 그리기가 끝난 **뒤에도** 이어질 자리가 있어야 한다. 누적 길이 비율이 1인
// 마지막 점은 여유가 0이면 반지름 0에 머문 채 끝나 영영 보이지 않는다(codex 리뷰, PR #580).
describe('dotWindow — 마지막 점도 팝할 시간이 있다', () => {
  test('마지막 점(at=1)은 선이 끝나는 순간 시작해 진행률 1에서 정확히 끝난다', () => {
    const { start, end } = dotWindow(1);
    expect(end).toBeCloseTo(1, 10);
    expect(end - start).toBeGreaterThan(0);
  });

  test('어떤 점도 진행률 1을 넘겨서 끝나지 않는다', () => {
    [0, 0.15, 0.32, 0.51, 0.67, 0.83, 1].forEach((at) => {
      expect(dotWindow(at).end).toBeLessThanOrEqual(1 + 1e-9);
    });
  });

  test('점은 선보다 먼저 뜨지 않는다 — 시작 시점이 누적 비율 순서를 지킨다', () => {
    const ats = [0, 0.3, 0.7, 1];
    const starts = ats.map((a) => dotWindow(a).start);
    starts.forEach((v, i) => i > 0 && expect(v).toBeGreaterThan(starts[i - 1]));
    expect(starts[0]).toBe(0);
  });
});
