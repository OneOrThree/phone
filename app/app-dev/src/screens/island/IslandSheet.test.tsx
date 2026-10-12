import React from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { isHiddenFromAccessibility, render } from '@testing-library/react-native';
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

// 안드로이드 하드웨어 뒤로 가기 흉내 — RN 처럼 나중에 등록한 리스너가 먼저 불리고, true 를 돌려주면 거기서 멈춘다.
describe('IslandPopup 은 모달이다(GROMO-2263)', () => {
  const backListeners: (() => boolean | null | undefined)[] = [];
  const pressBack = () => {
    for (const listener of [...backListeners].reverse()) if (listener()) return true;
    return false;
  };
  let backSpy: jest.SpyInstance;
  beforeEach(() => {
    backListeners.length = 0;
    backSpy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      backListeners.push(handler as () => boolean);
      return {
        remove: () => {
          const index = backListeners.indexOf(handler as () => boolean);
          if (index >= 0) backListeners.splice(index, 1);
        },
      };
    });
  });
  afterEach(() => backSpy.mockRestore());

  test('열려 있는 동안 안드로이드 뒤로 가기는 App 리스너 앞에서 팝업을 닫고, 닫히면 리스너를 걷는다', async () => {
    // App 전역 리스너(방문 화면의 뒤로 가기 = 방문 종료)가 먼저 등록돼 있다
    const appBack = jest.fn(() => true);
    BackHandler.addEventListener('hardwareBackPress', appBack);
    const onClose = jest.fn();
    const screen = await render(
      <IslandPopup onClose={onClose}>
        <Text>안내</Text>
      </IslandPopup>,
    );
    expect(backListeners).toHaveLength(2);

    expect(pressBack()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(appBack).not.toHaveBeenCalled();

    await screen.unmount();
    expect(backListeners).toHaveLength(1);
    pressBack();
    expect(appBack).toHaveBeenCalledTimes(1); // 팝업이 없으면 App 이 그대로 받는다
  });

  test('onClose 가 바뀌면 최신 onClose 로 닫는다', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const screen = await render(<IslandPopup onClose={first} />);
    await screen.rerender(<IslandPopup onClose={second} />);
    expect(backListeners).toHaveLength(1);
    pressBack();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

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
});
