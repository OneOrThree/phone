import React from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { fireEvent, isHiddenFromAccessibility, render } from '@testing-library/react-native';
import { IslandPopup, IslandSheet, SheetRow } from '@/screens/island/IslandSheet';

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
  ['가로 패널', true, false, true],
  ['가로 패널', true, false, false],
  ['태블릿 카드', false, true, true],
  ['태블릿 카드', false, true, false],
  ['세로 시트', false, false, true],
  ['세로 시트', false, false, false],
] as const)(
  '%s에서 footer 유무와 관계없이 마지막 항목 접근 및 클립을 유지한다',
  async (_name, compact, tablet, hasFooter) => {
    mockLayout = { ...mockLayout, compact, tablet };
    const { getByLabelText, getByText, getByTestId } = await render(
      <IslandSheet
        bg="hall"
        sign="boat/raft"
        title="설정"
        onClose={() => {}}
        footer={hasFooter ? <Text>저장</Text> : undefined}
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
    if (hasFooter) expect(getByText('저장')).toBeTruthy();
  },
);

test('SheetRow는 selected를 accessibilityState.selected로 반영한다(언어 선택 화면 등)', async () => {
  const { getByLabelText } = await render(
    <>
      <SheetRow title="한국어" selected onPress={() => {}} />
      <SheetRow title="English" selected={false} onPress={() => {}} />
      <SheetRow title="기기 언어 따름" onPress={() => {}} />
    </>,
  );

  expect(getByLabelText('한국어').props.accessibilityState.selected).toBe(true);
  expect(getByLabelText('English').props.accessibilityState.selected).toBe(false);
  expect(getByLabelText('기기 언어 따름').props.accessibilityState.selected).toBeUndefined();
});

describe('IslandPopup 은 모달 표시만 한다(GROMO-2263)', () => {
  test('형제 장면은 스크린리더에서 빠지고 팝업 안은 그대로 읽힌다', async () => {
    const screen = await render(
      <>
        <View>
          <Pressable accessibilityLabel="뒤 버튼" />
        </View>
        <IslandPopup onClose={() => {}}>
          <Text>안내</Text>
        </IslandPopup>
      </>,
    );
    // iOS: 팝업이 accessibilityViewIsModal — 형제 View 안은 VoiceOver 가 무시한다
    let node: any = screen.getByText('안내');
    while (node && !node.props.accessibilityViewIsModal) node = node.parent;
    expect(node?.props.accessibilityViewIsModal).toBe(true);
    expect(
      isHiddenFromAccessibility(screen.getByLabelText('뒤 버튼', { includeHiddenElements: true })),
    ).toBe(true);
    expect(isHiddenFromAccessibility(screen.getByLabelText('닫기'))).toBe(false);
    expect(isHiddenFromAccessibility(screen.getByText('안내'))).toBe(false);
  });

  test('안드로이드 뒤로 가기 리스너를 직접 달지 않는다 — 호출자가 e.backOverride 로 닫기를 건다', async () => {
    const backSpy = jest.spyOn(BackHandler, 'addEventListener');
    try {
      await render(
        <IslandPopup onClose={() => {}}>
          <Text>안내</Text>
        </IslandPopup>,
      );
      expect(backSpy).not.toHaveBeenCalled();
    } finally {
      backSpy.mockRestore();
    }
  });
});

test('fit 시트는 내용·버튼 줄을 잰 뒤 내용 높이까지만 올라오고, 길면 tall 높이에서 멈춘다(GROMO-2412)', async () => {
  const before = mockLayout;
  mockLayout = { ...mockLayout, width: 402, height: 874, compact: false, tablet: false };
  const screen = await render(
    <IslandSheet
      bg="shop"
      sign="dog"
      title="상품 상세"
      fit
      onClose={() => {}}
      footer={<Text>구매</Text>}
    >
      <Text>설명</Text>
    </IslandSheet>,
  );
  const box = () => StyleSheet.flatten(screen.getByTestId('island-sheet-box').props.style);
  // 재기 전에는 높은 시트가 번쩍이지 않게 숨긴다
  expect(box()).toMatchObject({ top: 100, opacity: 0 });
  await fireEvent(screen.getByTestId('island-sheet-scroll'), 'contentSizeChange', 402, 300);
  await fireEvent(screen.getByTestId('island-sheet-footer'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 120 } },
  });
  // 위 여백 72 + 위 테두리 2 + 내용 300 + 버튼 줄 120
  expect(box()).toMatchObject({ top: 874 - (72 + 2 + 300 + 120), opacity: 1 });
  await fireEvent(screen.getByTestId('island-sheet-scroll'), 'contentSizeChange', 402, 900);
  expect(box().top).toBe(100);
  mockLayout = before;
});
