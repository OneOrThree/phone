import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { LeagueMemberResponse } from '@/types/api';
import type { GroupSummaryResponse } from '@/types/dto/group';
import type { GroupCardSummarySnapshot } from '../groupCardSummary';
import { GroupCardBackSummary } from './GroupCardBackSummary';

const GROUP_ID = '00000000-0000-0000-0000-000000000001';
const MEMBER_ID = '00000000-0000-0000-0000-000000000002';

const group: GroupSummaryResponse = {
  groupId: GROUP_ID,
  name: '아침 집중방',
  code: null,
  currentMembers: 1,
  maxMembers: 5,
  role: 'MEMBER',
  status: 'WAITING',
};

const snapshot = {
  detail: { status: 'ready', data: { members: [{ userId: MEMBER_ID }] } },
  announcements: {
    status: 'ready',
    data: [{ id: 'notice', title: '내일은 7시에 시작해요', content: '', createdAt: '' }],
  },
  challenges: {
    status: 'ready',
    data: [
      { id: 'active', status: 'ACTIVE' },
      { id: 'inactive', status: 'INACTIVE' },
    ],
  },
  focus: {
    status: 'ready',
    data: [{ userId: MEMBER_ID, isFocusing: true }],
  },
} as GroupCardSummarySnapshot<LeagueMemberResponse[]>;

describe('GroupCardBackSummary', () => {
  test('기존 read API의 독립 결과를 실제 뒷면 요약에 표시한다', async () => {
    const onOpenRoom = jest.fn();
    const onStartFocus = jest.fn();
    const onFlipFront = jest.fn();
    await render(
      <GroupCardBackSummary
        group={group}
        snapshot={snapshot}
        onStartFocus={onStartFocus}
        onOpenRoom={onOpenRoom}
        onFlipFront={onFlipFront}
      />,
    );

    expect(screen.getByText('1명 참여')).toBeOnTheScreen();
    expect(screen.getByText('내일은 7시에 시작해요')).toBeOnTheScreen();
    expect(screen.getByText('1개 진행 중')).toBeOnTheScreen();
    expect(screen.getByText('1명 집중 중')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.card.focus.${GROUP_ID}`));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.card.room.${GROUP_ID}`));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.card.frontAction.${GROUP_ID}`));
    });
    expect(onStartFocus).toHaveBeenCalledTimes(1);
    expect(onOpenRoom).toHaveBeenCalledTimes(1);
    expect(onFlipFront).toHaveBeenCalledTimes(1);
  });

  test('영역별 실패를 0으로 오인하지 않고 다른 성공 영역은 유지한다', async () => {
    await render(
      <GroupCardBackSummary
        group={group}
        snapshot={{
          ...snapshot,
          announcements: { status: 'error', error: new Error('network') },
          focus: { status: 'coverage-unknown' },
        }}
        onStartFocus={jest.fn()}
        onOpenRoom={jest.fn()}
        onFlipFront={jest.fn()}
      />,
    );

    expect(screen.getByText('공지를 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.getByText('집중 인원을 확인할 수 없어요')).toBeOnTheScreen();
    expect(screen.getByText('1개 진행 중')).toBeOnTheScreen();
  });

  test('앞면 전환의 접근성 activate는 전용 콜백으로 구분한다', async () => {
    const onFlipFront = jest.fn();
    const onAccessibilityFlipFront = jest.fn();
    await render(
      <GroupCardBackSummary
        group={group}
        snapshot={snapshot}
        onStartFocus={jest.fn()}
        onOpenRoom={jest.fn()}
        onFlipFront={onFlipFront}
        onAccessibilityFlipFront={onAccessibilityFlipFront}
      />,
    );

    await act(async () => {
      fireEvent(screen.getByTestId(`group.card.frontAction.${GROUP_ID}`), 'accessibilityAction', {
        nativeEvent: { actionName: 'activate' },
      });
    });

    expect(onAccessibilityFlipFront).toHaveBeenCalledTimes(1);
    expect(onFlipFront).not.toHaveBeenCalled();
  });
});
