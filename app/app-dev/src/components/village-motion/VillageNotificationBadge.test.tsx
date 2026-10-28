import React from 'react';
import { cleanup, render } from '@testing-library/react-native';
import { Pressable, View } from 'react-native';
import { VillageNotificationBadge } from './VillageNotificationBadge';

afterEach(cleanup);

test('장식 배지와 !는 접근성 트리에서 숨기고 건물의 상태 라벨만 노출한다', async () => {
  const view = await render(
    <View>
      <VillageNotificationBadge accessibilityLabel="읽지 않은 새 소식이 있습니다" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="게시판, 읽지 않은 새 소식이 있어요"
      />
    </View>,
  );
  expect(view.queryByLabelText('읽지 않은 새 소식이 있습니다')).toBeNull();
  expect(view.queryByText('!')).toBeNull();
  const badge = view.getByTestId('village-notification-badge', { includeHiddenElements: true });
  expect(badge.props.accessible).toBe(false);
  expect(badge.props.accessibilityElementsHidden).toBe(true);
  expect(badge.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(badge.props['aria-hidden']).toBe(true);
  expect(view.getByRole('button', { name: '게시판, 읽지 않은 새 소식이 있어요' })).toBeTruthy();
});
