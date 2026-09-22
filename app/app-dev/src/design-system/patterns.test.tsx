import React from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { Page, Badge, Field, Wheel, Seg } from './patterns';
import { componentTokens, semanticTokens } from './tokens';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
    tablet: false,
    landscape: false,
    compact: false,
    contentWidth: 402,
    gutter: 20,
    floatingWidth: 362,
    modalWidth: 362,
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 52, bottom: 32, left: 0, right: 0 }),
}));

// Wheel의 useEffect RAF를 동기 실행 — 비동기 콜백이 teardown 뒤에 남아 터지는 것을 막는다
let rafSpy: jest.SpyInstance;
beforeEach(() => {
  rafSpy = jest
    .spyOn(global, 'requestAnimationFrame')
    .mockImplementation((cb: (time: number) => void) => {
      cb(0);
      return 0;
    });
});
afterEach(() => rafSpy.mockRestore());

test('inset 탭은 테두리와 패딩을 제외해도 터치 높이 44pt를 유지한다', async () => {
  const onChange = jest.fn();
  const { getByLabelText } = await render(
    <Seg items={['일', '주', '월']} value="주" onChange={onChange} inset />,
  );
  const tab = getByLabelText('일');
  const container = StyleSheet.flatten(tab.parent?.props.style);
  expect(container.height - 2 * (container.padding + container.borderWidth)).toBeGreaterThanOrEqual(
    semanticTokens.size.tapMin,
  );
  await fireEvent.press(tab);
  expect(onChange).toHaveBeenCalledWith('일');
});

test('Page 뒤로가기는 양 축 최소 터치 영역 44pt를 지킨다', async () => {
  const { getByLabelText } = await render(<Page title="화면" back={jest.fn()} />);
  const s = StyleSheet.flatten(getByLabelText('뒤로').props.style);
  expect(s.width).toBeGreaterThanOrEqual(semanticTokens.size.tapMin);
  expect(s.height).toBeGreaterThanOrEqual(semanticTokens.size.tapMin);
});

test('Badge는 componentTokens.badge의 default/soft를 그대로 쓴다', async () => {
  const { getByText } = await render(
    <>
      <Badge>기본</Badge>
      <Badge soft>소프트</Badge>
    </>,
  );
  const dflt = StyleSheet.flatten(getByText('기본').parent?.props.style);
  const soft = StyleSheet.flatten(getByText('소프트').parent?.props.style);
  expect(dflt.backgroundColor).toBe(componentTokens.badge.default.background);
  expect(dflt.borderColor).toBe(componentTokens.badge.default.border);
  expect(soft.backgroundColor).toBe(componentTokens.badge.soft.background);
  expect(soft.borderColor).toBe(componentTokens.badge.soft.border);
});

test('Field placeholder는 대비 기준을 넘는 input.placeholder 토큰을 쓴다', async () => {
  const { getByLabelText } = await render(
    <Field label="이름" value="" onChange={() => {}} placeholder="입력" />,
  );
  expect(getByLabelText('이름').props.placeholderTextColor).toBe(componentTokens.input.placeholder);
});

test.each([24, 33, 44])(
  'Wheel row=%i 요청도 실제 행·snap 간격·패딩은 tapMin 이상의 같은 값이다',
  async (row) => {
    const { getByLabelText } = await render(
      <Wheel
        label="시간"
        items={['1', '2', '3', '4', '5']}
        value="1"
        row={row}
        onChange={() => {}}
      />,
    );
    let scroll: any = getByLabelText('시간 1');
    while (scroll && scroll.props.snapToInterval === undefined) scroll = scroll.parent;
    const h = scroll?.props.snapToInterval;
    expect(h).toBeGreaterThanOrEqual(semanticTokens.size.tapMin);
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingVertical).toBe(h);
    for (const x of ['1', '2', '3']) {
      expect(StyleSheet.flatten(getByLabelText(`시간 ${x}`).props.style).height).toBe(h);
    }
  },
);

test.each([24, 33])(
  'Wheel row=%i에서 momentumScrollEnd offset 88은 effective 행 기준 세 번째 항목을 고른다',
  async (row) => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <Wheel
        label="시간"
        items={['1', '2', '3', '4', '5', '6']}
        value="1"
        row={row}
        onChange={onChange}
      />,
    );
    let scroll: any = getByLabelText('시간 1');
    while (scroll && scroll.props.snapToInterval === undefined) scroll = scroll.parent;
    fireEvent(scroll, 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: 88 } } });
    expect(onChange).toHaveBeenCalledWith('3');
  },
);

test('Wheel 행을 누르면 그 행의 값과 effective 행 간격 scrollTo가 호출된다', async () => {
  const spy = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  const onChange = jest.fn();
  const { getByLabelText } = await render(
    <Wheel label="시간" items={['1', '2', '3']} value="2" row={24} onChange={onChange} />,
  );
  // 마운트 시 선택 행 위치로 한 번 스크롤한다(동기 RAF)
  expect(spy).toHaveBeenCalledWith({ y: semanticTokens.size.tapMin, animated: false });
  spy.mockClear();
  fireEvent.press(getByLabelText('시간 3'));
  expect(onChange).toHaveBeenCalledWith('3');
  expect(spy).toHaveBeenCalledWith({ y: 2 * semanticTokens.size.tapMin, animated: true });
  spy.mockRestore();
});
