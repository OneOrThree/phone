import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { Page, Badge, Field } from './patterns';
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
