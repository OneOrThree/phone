import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { IslandSheet } from '@/screens/island/IslandSheet';

let mockLayout = {
  width: 874,
  height: 402,
  insets: { top: 0, bottom: 21, left: 0, right: 0 },
  compact: true,
  tablet: false,
  modalWidth: 560,
};
jest.mock('@/utils/layout', () => ({ useAppLayout: () => mockLayout }));

test.each([
  ['가로 패널', true, false],
  ['태블릿 카드', false, true],
  ['세로 시트', false, false],
] as const)(
  '%s에서 클립을 유지하면서 스크롤 끝 항목과 footer를 렌더링한다',
  async (_name, compact, tablet) => {
    mockLayout = { ...mockLayout, compact, tablet };
    const { getByLabelText, getByText, getByTestId } = await render(
      <IslandSheet
        bg="hall"
        sign="boat/raft"
        title="설정"
        onClose={() => {}}
        footer={<Text>저장</Text>}
      >
        <Pressable accessibilityLabel="마지막 항목">
          <Text>마지막 항목</Text>
        </Pressable>
      </IslandSheet>,
    );

    expect(getByLabelText('마지막 항목')).toBeTruthy();
    const clipStyle = StyleSheet.flatten(getByTestId('island-sheet-content-clip').props.style);
    expect(clipStyle).toMatchObject({
      overflow: 'hidden',
      borderBottomLeftRadius: compact || tablet ? 28 : 0,
    });
    expect(clipStyle.borderBottomRightRadius).toBe(tablet ? 28 : 0);
    expect(getByText('저장')).toBeTruthy();
  },
);
