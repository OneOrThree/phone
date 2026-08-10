import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { LeagueMemberResponse } from '@/types/api';
import type { GroupChallengeResponse, GroupSummaryResponse } from '@/types/dto/group';
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

function challenge(over: Partial<GroupChallengeResponse> = {}): GroupChallengeResponse {
  return {
    id: 'active',
    missionType: 'DURATION',
    missionCategory: 'FOCUS',
    durationMinutes: 60,
    windowStart: null,
    windowEnd: null,
    status: 'ACTIVE',
    createdAt: '2026-08-01T06:00:00Z',
    canParticipate: true,
    memberProgress: [{ userId: MEMBER_ID, nickname: '나', progressMinutes: 30, achieved: false }],
    ...over,
  };
}

const snapshot = {
  detail: { status: 'ready', data: { members: [{ userId: MEMBER_ID }] } },
  announcements: {
    status: 'ready',
    data: [{ id: 'notice', title: '내일은 7시에 시작해요', content: '', createdAt: '' }],
  },
  challenges: {
    status: 'ready',
    data: [challenge(), challenge({ id: 'inactive', status: 'INACTIVE' })],
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
        userId={MEMBER_ID}
        snapshot={snapshot}
        onStartFocus={onStartFocus}
        onOpenRoom={onOpenRoom}
        onRetry={jest.fn()}
        onFlipFront={onFlipFront}
      />,
    );

    expect(screen.getByText('1명 참여')).toBeOnTheScreen();
    expect(screen.getByText('내일은 7시에 시작해요')).toBeOnTheScreen();
    expect(screen.getByText('하루 60분 집중')).toBeOnTheScreen();
    expect(screen.getByText('내 진행 30/60분')).toBeOnTheScreen();
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
    const onRetry = jest.fn();
    await render(
      <GroupCardBackSummary
        group={group}
        userId={MEMBER_ID}
        snapshot={{
          ...snapshot,
          announcements: { status: 'error', error: new Error('network') },
          focus: { status: 'coverage-unknown' },
        }}
        onStartFocus={jest.fn()}
        onOpenRoom={jest.fn()}
        onRetry={onRetry}
        onFlipFront={jest.fn()}
      />,
    );

    expect(screen.getByText('공지를 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.getByText('집중 인원을 확인할 수 없어요')).toBeOnTheScreen();
    expect(screen.getByText('하루 60분 집중')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`group.card.back.focus.${GROUP_ID}.retry`));
    });
    expect(onRetry).toHaveBeenCalledWith('focus');
  });

  test('실패한 각 영역은 adapter dependency에 대응하는 명시 재시도를 제공한다', async () => {
    const onRetry = jest.fn();
    await render(
      <GroupCardBackSummary
        group={group}
        userId={MEMBER_ID}
        snapshot={{
          detail: { status: 'error', error: new Error('detail') },
          announcements: { status: 'error', error: new Error('announcements') },
          challenges: { status: 'error', error: new Error('challenges') },
          focus: { status: 'error', error: new Error('focus') },
        }}
        onStartFocus={jest.fn()}
        onOpenRoom={jest.fn()}
        onRetry={onRetry}
        onFlipFront={jest.fn()}
      />,
    );

    for (const dependency of ['members', 'notice', 'challenge', 'focus']) {
      await act(async () => {
        fireEvent.press(screen.getByTestId(`group.card.back.${dependency}.${GROUP_ID}.retry`));
      });
    }
    expect(onRetry.mock.calls).toEqual([['detail'], ['announcements'], ['challenges'], ['focus']]);
  });

  test('앞면 전환의 접근성 activate는 전용 콜백으로 구분한다', async () => {
    const onFlipFront = jest.fn();
    const onAccessibilityFlipFront = jest.fn();
    await render(
      <GroupCardBackSummary
        group={group}
        userId={MEMBER_ID}
        snapshot={snapshot}
        onStartFocus={jest.fn()}
        onOpenRoom={jest.fn()}
        onRetry={jest.fn()}
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

  test('뒷면이 커밋된 layout 신호와 제목 ref를 guide 측정·포커스 경로에 제공한다', async () => {
    const onLayout = jest.fn();
    const titleRef = jest.fn();
    await render(
      <GroupCardBackSummary
        group={group}
        userId={MEMBER_ID}
        snapshot={snapshot}
        onStartFocus={jest.fn()}
        onOpenRoom={jest.fn()}
        onRetry={jest.fn()}
        onFlipFront={jest.fn()}
        onLayout={onLayout}
        titleRef={titleRef}
      />,
    );

    fireEvent(screen.getByTestId(`group.card.back.${GROUP_ID}`), 'layout', {
      nativeEvent: { layout: { width: 300, height: 420 } },
    });
    expect(onLayout).toHaveBeenCalledTimes(1);
    expect(titleRef).toHaveBeenCalledWith(expect.anything());
  });

  test('활성 챌린지의 서버 순서·identity·미션·내 진행을 compact row로 보존한다', async () => {
    await render(
      <GroupCardBackSummary
        group={group}
        userId={MEMBER_ID}
        snapshot={{
          ...snapshot,
          challenges: {
            status: 'ready',
            data: [
              challenge({ id: 'first', durationMinutes: 40 }),
              challenge({
                id: 'second',
                missionCategory: 'SCREEN_TIME',
                durationMinutes: 90,
                memberProgress: [
                  {
                    userId: MEMBER_ID,
                    nickname: '나',
                    progressMinutes: 55,
                    achieved: true,
                  },
                ],
              }),
              challenge({ id: 'hidden', status: 'INACTIVE' }),
            ],
          },
        }}
        onStartFocus={jest.fn()}
        onOpenRoom={jest.fn()}
        onRetry={jest.fn()}
        onFlipFront={jest.fn()}
      />,
    );

    const first = screen.getByTestId(`group.card.back.challenge.${GROUP_ID}.first`);
    const second = screen.getByTestId(`group.card.back.challenge.${GROUP_ID}.second`);
    expect(first).toBeOnTheScreen();
    expect(second).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.card.back.challenge.${GROUP_ID}.hidden`)).toBeNull();
    expect(screen.getByText('하루 40분 집중')).toBeOnTheScreen();
    expect(screen.getByText('하루 90분 이하 스크린타임')).toBeOnTheScreen();
    expect(screen.getByText('내 진행 55/90분 · 달성')).toBeOnTheScreen();
  });

  test('고정 높이 shell 안에서 요약만 스크롤하고 주요 행동은 바깥에 유지한다', async () => {
    await render(
      <GroupCardBackSummary
        group={group}
        userId={MEMBER_ID}
        snapshot={snapshot}
        onStartFocus={jest.fn()}
        onOpenRoom={jest.fn()}
        onRetry={jest.fn()}
        onFlipFront={jest.fn()}
      />,
    );

    expect(screen.getByTestId(`group.card.back.${GROUP_ID}`)).toHaveStyle({ height: '100%' });
    expect(screen.getByTestId(`group.card.back.summaryScroll.${GROUP_ID}`).props).toMatchObject({
      nestedScrollEnabled: true,
    });
    expect(screen.getByTestId(`group.card.focus.${GROUP_ID}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`group.card.room.${GROUP_ID}`)).toBeOnTheScreen();
  });
});
