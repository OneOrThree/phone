import React from 'react';
import { render } from '@testing-library/react-native';
import { MailboxGuide, ShopGuide } from './NpcGuide';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    compact: false,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));

const expectBlocked = (overlay: any) => {
  expect(overlay.props.pointerEvents).toBe('none');
  expect(overlay.props.accessibilityElementsHidden).toBe(true);
  expect(overlay.props.importantForAccessibility).toBe('no-hide-descendants');
};

const expectUnblocked = (overlay: any) => {
  expect(overlay.props.pointerEvents).toBe('auto');
  expect(overlay.props.accessibilityElementsHidden).toBe(false);
  expect(overlay.props.importantForAccessibility).toBe('auto');
};

test('우체통 안내 모달은 전환 차단 중 입력과 접근성 트리에서 숨는다', async () => {
  const screen = await render(<MailboxGuide blocked onDone={jest.fn()} />);
  expectBlocked(screen.getByTestId('mailbox-guide-overlay', { includeHiddenElements: true }));
});

test('상점 안내 모달은 전환 차단 중 입력과 접근성 트리에서 숨는다', async () => {
  const screen = await render(<ShopGuide blocked onDone={jest.fn()} onCancel={jest.fn()} />);
  expectBlocked(screen.getByTestId('shop-guide-overlay', { includeHiddenElements: true }));
});

test('우체통 안내 모달은 차단이 풀리면 입력과 접근성을 복구한다', async () => {
  const screen = await render(<MailboxGuide onDone={jest.fn()} />);
  expectUnblocked(screen.getByTestId('mailbox-guide-overlay'));
});

test('상점 안내 모달은 차단이 풀리면 입력과 접근성을 복구한다', async () => {
  const screen = await render(<ShopGuide onDone={jest.fn()} onCancel={jest.fn()} />);
  expectUnblocked(screen.getByTestId('shop-guide-overlay'));
});
