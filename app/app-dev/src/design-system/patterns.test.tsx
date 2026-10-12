import React from 'react';
import { applyLocalePref } from '@/i18n';
import { StyleSheet, ScrollView } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { Page, Badge, Btn, CharCount, Field, Wheel, Seg } from './patterns';
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
afterEach(() => {
  rafSpy.mockRestore();
  applyLocalePref('system');
});

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

test('작은 버튼은 시각 높이와 별개로 부모 터치 경계 44pt를 확보한다', async () => {
  const { getByLabelText } = await render(<Btn small title="수락" onPress={() => {}} />);
  const button = getByLabelText('수락');
  const wrapper = StyleSheet.flatten(button.parent?.props.style);
  expect(wrapper.minHeight).toBeGreaterThanOrEqual(semanticTokens.size.tapMin);
  expect(wrapper.justifyContent).toBe('center');
});

test('Btn 의 읽는 이름은 기본이 title 이고, accessibilityLabel 을 주면 그것으로 바뀐다(보이는 글자는 그대로)', async () => {
  const { getByText, getByLabelText, queryByLabelText } = await render(
    <>
      <Btn title="지우기" onPress={() => {}} />
      <Btn title="신고" accessibilityLabel="신고: 수아" onPress={() => {}} />
    </>,
  );
  expect(getByLabelText('지우기')).toBeTruthy();
  expect(getByLabelText('신고: 수아')).toBeTruthy();
  expect(queryByLabelText('신고')).toBeNull();
  expect(getByText('신고')).toBeTruthy();
});

test('Btn 은 accessibilityHint 를 안 주면 비워 두고, 주면 그대로 읽게 한다(비활성 상태는 따로 켜지 않는다)', async () => {
  const { getByLabelText } = await render(
    <>
      <Btn title="평범" onPress={() => {}} />
      <Btn title="흐림" accessibilityHint="왜 흐린지" onPress={() => {}} />
    </>,
  );
  expect(getByLabelText('평범').props.accessibilityHint).toBeUndefined();
  const hinted = getByLabelText('흐림');
  expect(hinted.props.accessibilityHint).toBe('왜 흐린지');
  expect(hinted.props.accessibilityState.disabled).toBe(false);
});

test('작은 배지는 글자 크기 확대 시 늘어날 수 있도록 최소 높이와 세로 패딩을 쓴다', async () => {
  const { getByText } = await render(<Badge small>1</Badge>);
  const badge = StyleSheet.flatten(getByText('1').parent?.props.style);
  expect(badge.height).toBeUndefined();
  expect(badge.minHeight).toBe(22);
  expect(badge.paddingVertical).toBeGreaterThan(0);
});

test('Badge 는 numberOfLines·style 을 안 넘기면 예전 그대로이고, 넘기면 줄 수와 배치만 바뀐다', async () => {
  const { getByText } = await render(
    <>
      <Badge soft>평범</Badge>
      <Badge soft numberOfLines={2} style={{ alignSelf: 'center', maxWidth: 128 }}>
        긴 이름
      </Badge>
    </>,
  );
  const plain = getByText('평범');
  // 안 넘기면: 줄 수 제한 없음 · 바깥 스타일은 배열이 아닌 단일 객체 · 왼쪽 정렬
  expect(plain.props.numberOfLines).toBeUndefined();
  expect(Array.isArray(plain.parent?.props.style)).toBe(false);
  const base = StyleSheet.flatten(plain.parent?.props.style);
  expect(base.alignSelf).toBe('flex-start');
  expect(base.maxWidth).toBeUndefined();
  // 넘기면: 글자가 그 줄 수에서 잘리고, style 이 배치를 덮어쓰되 색·테두리 토큰은 그대로다
  const capped = getByText('긴 이름');
  expect(capped.props.numberOfLines).toBe(2);
  const over = StyleSheet.flatten(capped.parent?.props.style);
  expect(over.alignSelf).toBe('center');
  expect(over.maxWidth).toBe(128);
  expect(over.backgroundColor).toBe(componentTokens.badge.soft.background);
  expect(over.borderColor).toBe(componentTokens.badge.soft.border);
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

test.each([50, 200])('영어 Field는 %i자 한도 도달 안내도 영어로 표시한다', async (max) => {
  applyLocalePref('en');
  const screen = await render(
    <Field label="Name" value={'a'.repeat(max - 1)} maxLength={max} onChange={jest.fn()} />,
  );
  screen.getByText(`${max - 1}/${max}`);
  await screen.rerender(
    <Field label="Name" value={'a'.repeat(max)} maxLength={max} onChange={jest.fn()} />,
  );
  const limit = screen.getByText(`Up to ${max} characters · ${max}/${max}`);
  expect(limit.props.accessibilityLiveRegion).toBe('polite');
  expect(screen.queryByText(/자까지 쓸 수 있어요/)).toBeNull();
});

test('CharCount codePoints 는 🐟 를 1글자로 세고 기본은 UTF-16 길이 그대로다', async () => {
  const screen = await render(
    <>
      <CharCount value={'🐟'.repeat(3)} max={40} codePoints />
      <CharCount value={'🐟'.repeat(3)} max={40} />
    </>,
  );
  screen.getByText('3/40');
  screen.getByText('6/40');
  await screen.rerender(<CharCount value={'🐟'.repeat(40)} max={40} codePoints />);
  screen.getByText('40자까지 쓸 수 있어요 · 40/40');
});
