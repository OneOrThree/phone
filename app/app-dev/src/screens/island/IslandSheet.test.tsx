import React from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { act, fireEvent, isHiddenFromAccessibility, render } from '@testing-library/react-native';
import { semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { seaAssets } from '@/screens/sea/seaAssets';
import {
  FIT_REVEAL_FALLBACK_MS,
  IslandPopup,
  IslandSheet,
  SheetGroup,
  SheetRow,
} from '@/screens/island/IslandSheet';

let mockLayout = {
  landscape: true,
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
    // 스타일 계약 검증(실제 레이아웃 아님)
    expect(clipStyle).toMatchObject({
      overflow: 'hidden',
      borderBottomLeftRadius: compact || tablet ? 28 : 0,
    });
    expect(clipStyle.borderBottomRightRadius).toBe(tablet ? 28 : 0);
    if (hasFooter) expect(getByText('저장')).toBeTruthy();
  },
);

// 머리 줄의 뒤로·액션·닫기는 눈에 보이는 크기와 무관하게 누르는 자리가 양 축 44pt 이상이어야 한다(GROMO-2283)
test.each([
  ['⚙ 아이콘 액션', '⚙', t('common.manageIsland')],
  ['글자 액션', '완료', '완료'],
] as const)('시트 머리 줄의 뒤로·%s 는 터치 영역이 44pt 이상이다', async (_name, action, label) => {
  const { getByLabelText } = await render(
    <IslandSheet
      bg="hall"
      sign="boat/raft"
      title="설정"
      onClose={() => {}}
      onBack={() => {}}
      action={action}
      actionPress={() => {}}
    >
      <Text>내용</Text>
    </IslandSheet>,
  );
  const back = StyleSheet.flatten(getByLabelText('뒤로').props.style);
  expect(back.width).toBeGreaterThanOrEqual(semanticTokens.size.tapMin);
  expect(back.height).toBeGreaterThanOrEqual(semanticTokens.size.tapMin);
  const actionBox = StyleSheet.flatten(getByLabelText(label).props.style);
  expect(actionBox.minWidth).toBeGreaterThanOrEqual(semanticTokens.size.tapMin);
  expect(actionBox.minHeight).toBeGreaterThanOrEqual(semanticTokens.size.tapMin);
});

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

test('fit 시트는 내용 높이 측정이 끝내 안 와도 잠깐 뒤 tall 높이로 보인다(GROMO-2412)', async () => {
  const before = mockLayout;
  mockLayout = { ...mockLayout, width: 402, height: 874, compact: false, tablet: false };
  jest.useFakeTimers();
  try {
    const screen = await render(
      <IslandSheet bg="shop" sign="dog" title="상품 상세" fit onClose={() => {}}>
        <Text>설명</Text>
      </IslandSheet>,
    );
    const box = () => StyleSheet.flatten(screen.getByTestId('island-sheet-box').props.style);
    expect(box().opacity).toBe(0);
    await act(async () => {
      jest.advanceTimersByTime(FIT_REVEAL_FALLBACK_MS);
    });
    expect(box()).toMatchObject({ top: 100, opacity: 1 });
  } finally {
    jest.useRealTimers();
    mockLayout = before;
  }
});

describe('fit 시트 측정 주기(GROMO-2412)', () => {
  const sheet = (body: string, footer?: string) => (
    <IslandSheet
      bg="shop"
      sign="dog"
      title="상품 상세"
      fit
      onClose={() => {}}
      footer={footer ? <Text>{footer}</Text> : undefined}
    >
      <Text>{body}</Text>
    </IslandSheet>
  );
  let before = mockLayout;
  let setSpy: jest.SpyInstance;
  let clearSpy: jest.SpyInstance;
  // 안전장치(FIT_REVEAL_FALLBACK_MS) 타이머가 걸렸고 모두 clearTimeout 으로 꺼졌는가
  const fallbackCleared = () => {
    const ids = setSpy.mock.calls.flatMap((call, i) =>
      call[1] === FIT_REVEAL_FALLBACK_MS ? [setSpy.mock.results[i].value] : [],
    );
    return ids.length > 0 && ids.every((id) => clearSpy.mock.calls.some((c) => c[0] === id));
  };
  beforeEach(() => {
    before = mockLayout;
    mockLayout = { ...mockLayout, width: 402, height: 874, compact: false, tablet: false };
    jest.useFakeTimers();
    setSpy = jest.spyOn(global, 'setTimeout');
    clearSpy = jest.spyOn(global, 'clearTimeout');
  });
  afterEach(() => {
    setSpy.mockRestore();
    clearSpy.mockRestore();
    jest.useRealTimers();
    mockLayout = before;
  });

  test('다 재면 안전장치 타이머를 끈다 — 300ms 가 지나도 잰 자리 그대로다', async () => {
    const screen = await render(sheet('불러오는 중…'));
    const box = () => StyleSheet.flatten(screen.getByTestId('island-sheet-box').props.style);
    await fireEvent(screen.getByTestId('island-sheet-scroll'), 'contentSizeChange', 402, 70);
    expect(box()).toMatchObject({ top: 874 - (72 + 2 + 70), opacity: 1 });
    expect(fallbackCleared()).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(FIT_REVEAL_FALLBACK_MS * 2);
    });
    expect(box()).toMatchObject({ top: 874 - (72 + 2 + 70), opacity: 1 });
  });

  test('상세가 300ms 뒤 늦게 와도 tall 로 번쩍이거나 숨지 않고 로딩 자리에서 새 높이로만 옮긴다', async () => {
    const screen = await render(sheet('불러오는 중…'));
    const box = () => StyleSheet.flatten(screen.getByTestId('island-sheet-box').props.style);
    await fireEvent(screen.getByTestId('island-sheet-scroll'), 'contentSizeChange', 402, 70);
    const loadingTop = 874 - (72 + 2 + 70);
    await act(async () => {
      jest.advanceTimersByTime(FIT_REVEAL_FALLBACK_MS + 200);
    });
    // 상세 + 구매 버튼 줄이 붙은 첫 렌더 — 버튼 줄을 아직 못 쟀다
    await screen.rerender(sheet('상품 설명', '구매'));
    expect(box()).toMatchObject({ top: loadingTop, opacity: 1 });
    await fireEvent(screen.getByTestId('island-sheet-scroll'), 'contentSizeChange', 402, 450);
    await fireEvent(screen.getByTestId('island-sheet-footer'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 130 } },
    });
    expect(box()).toMatchObject({ top: 874 - (72 + 2 + 450 + 130), opacity: 1 });
    expect(fallbackCleared()).toBe(true);
  });

  test('다시 재는 주기에도 안전장치가 걸린다 — 버튼 줄을 300ms 안에 못 재면 tall 높이로 보인다', async () => {
    const screen = await render(sheet('불러오는 중…'));
    const box = () => StyleSheet.flatten(screen.getByTestId('island-sheet-box').props.style);
    await fireEvent(screen.getByTestId('island-sheet-scroll'), 'contentSizeChange', 402, 70);
    await screen.rerender(sheet('상품 설명', '구매'));
    await act(async () => {
      jest.advanceTimersByTime(FIT_REVEAL_FALLBACK_MS - 1);
    });
    expect(box().top).toBe(874 - (72 + 2 + 70));
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(box()).toMatchObject({ top: 100, opacity: 1 });
  });
});

test('SheetGroup 은 행이 없으면 아무것도 그리지 않는다 — 빈 안내 아래 갈색 막대가 남지 않는다(GROMO-2409)', async () => {
  const empty = await render(<SheetGroup>{[]}</SheetGroup>);
  expect(empty.toJSON()).toBeNull();
  const filled = await render(
    <SheetGroup>
      {[1, 2].map((n) => (
        <SheetRow key={n} title={`${n}위`} />
      ))}
    </SheetGroup>,
  );
  expect(filled.getByText('1위')).toBeTruthy();
  expect(filled.getByText('2위')).toBeTruthy();
});

test.each([false, true])(
  '바다 배경은 가로 여부(%s)와 관계없이 바다 그림을 쓴다',
  async (landscape) => {
    mockLayout = { ...mockLayout, landscape };
    const screen = await render(
      <IslandSheet bg="sea" sign="avatar/black" title="내 정보" onClose={() => {}}>
        <Text>프로필</Text>
      </IslandSheet>,
    );
    expect(screen.getByTestId('island-sheet-backdrop').props.source).toBe(seaAssets.background);
  },
);
