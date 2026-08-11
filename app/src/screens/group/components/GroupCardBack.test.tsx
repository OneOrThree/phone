import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GroupCardBack } from './GroupCardBack';
import type { GroupSummaryResponse } from '@/types/dto/group';

const group: GroupSummaryResponse = {
  groupId: 'g1',
  name: '아침 집중방',
  code: null,
  currentMembers: 2,
  maxMembers: 5,
  role: 'MEMBER',
  status: 'ACTIVE',
};

const baseProps = {
  group,
  onFlipFront: jest.fn(),
  onStartFocus: jest.fn(),
  onOpenRoom: jest.fn(),
  onOpenSettings: jest.fn(),
  onRetry: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

test('완전한 focus 응답에서만 확인된 0명을 표시한다', async () => {
  await render(
    <GroupCardBack
      {...baseProps}
      snapshot={{
        detail: {
          status: 'ready',
          data: {
            id: 'g1',
            name: group.name,
            description: null,
            missionCategory: null,
            missionType: null,
            durationMinutes: null,
            windowStart: null,
            windowEnd: null,
            maxMembers: 5,
            status: 'ACTIVE',
            members: [
              {
                userId: 'u1',
                nickname: '나',
                role: 'MEMBER',
                focusTimeMinutes: 0,
                totalFocusMinutes: 0,
              },
            ],
            code: null,
            codeExpiresAt: null,
            noticeGrantedUserIds: [],
          },
        },
        announcements: { status: 'ready', data: [] },
        challenges: { status: 'ready', data: [] },
        focus: { status: 'ready', data: [] },
      }}
    />,
  );

  expect(screen.getByText('현재 집중 0명')).toBeOnTheScreen();
  expect(screen.getByText('새 공지가 없어요')).toBeOnTheScreen();
  expect(screen.getByText('진행 중인 활동이 없어요')).toBeOnTheScreen();
});

test('영역 실패는 다른 CTA를 숨기지 않고 그 영역만 재시도한다', async () => {
  await render(
    <GroupCardBack
      {...baseProps}
      snapshot={{
        detail: { status: 'error', error: new Error('detail') },
        announcements: { status: 'ready', data: [] },
        challenges: { status: 'loading' },
        focus: { status: 'coverage-unknown' },
      }}
    />,
  );

  fireEvent.press(screen.getByText(/멤버 정보를 확인하지 못했어요/));
  expect(baseProps.onRetry).toHaveBeenCalledWith('detail');
  expect(screen.getByTestId('group.card.focus.g1')).toBeOnTheScreen();
  expect(screen.getByTestId('group.card.room.g1')).toBeOnTheScreen();
  expect(screen.queryByText('현재 집중 0명')).toBeNull();
});

test('멤버를 받아도 focus가 조회 중이면 오류 대신 로딩을 표시한다', async () => {
  await render(
    <GroupCardBack
      {...baseProps}
      snapshot={{
        detail: {
          status: 'ready',
          data: {
            id: 'g1',
            name: group.name,
            description: null,
            missionCategory: null,
            missionType: null,
            durationMinutes: null,
            windowStart: null,
            windowEnd: null,
            maxMembers: 5,
            status: 'ACTIVE',
            members: [],
            code: null,
            codeExpiresAt: null,
            noticeGrantedUserIds: [],
          },
        },
        announcements: { status: 'ready', data: [] },
        challenges: { status: 'ready', data: [] },
        focus: { status: 'loading' },
      }}
    />,
  );

  expect(screen.getByText('집중 인원 불러오는 중…')).toBeOnTheScreen();
  expect(screen.queryByText('현재 집중 인원 확인 불가')).toBeNull();
});

test('설정 버튼의 접근성 이름에 대상 그룹을 포함한다', async () => {
  await render(<GroupCardBack {...baseProps} snapshot={undefined} />);

  expect(screen.getByLabelText('아침 집중방 그룹 옵션')).toBeOnTheScreen();
});

test('시각 전환 CTA 없이 카드 빈 영역 탭과 접근성 액션으로 앞면을 연다', async () => {
  const onAccessibilityFlipFront = jest.fn();
  await render(
    <GroupCardBack
      {...baseProps}
      onAccessibilityFlipFront={onAccessibilityFlipFront}
      snapshot={undefined}
    />,
  );

  expect(screen.queryByText('앞면으로')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.card.back.g1'));
  });
  expect(baseProps.onFlipFront).toHaveBeenCalledTimes(1);

  await act(async () => {
    fireEvent(screen.getByRole('header'), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });
  });
  expect(onAccessibilityFlipFront).toHaveBeenCalledTimes(1);
});

test('뒷면의 실제 조작 요소는 빈 영역 뒤집기로 버블링하지 않는다', async () => {
  await render(
    <GroupCardBack
      {...baseProps}
      snapshot={{
        detail: { status: 'error', error: new Error('detail') },
        announcements: { status: 'ready', data: [] },
        challenges: { status: 'ready', data: [] },
        focus: { status: 'ready', data: [] },
      }}
    />,
  );

  await act(async () => {
    fireEvent.press(screen.getByLabelText('아침 집중방 그룹 옵션'));
    fireEvent.press(screen.getByText(/멤버 정보를 확인하지 못했어요/));
    fireEvent.press(screen.getByTestId('group.card.focus.g1'));
    fireEvent.press(screen.getByTestId('group.card.room.g1'));
  });

  expect(baseProps.onOpenSettings).toHaveBeenCalledTimes(1);
  expect(baseProps.onRetry).toHaveBeenCalledWith('detail');
  expect(baseProps.onStartFocus).toHaveBeenCalledTimes(1);
  expect(baseProps.onOpenRoom).toHaveBeenCalledTimes(1);
  expect(baseProps.onFlipFront).not.toHaveBeenCalled();
});

test('현재 사용자가 상위 5명 밖이어도 선두에 두고 나머지 서버 순서를 보존한다', async () => {
  const members = ['첫째', '둘째', '셋째', '넷째', '다섯째', '나'].map((nickname, index) => ({
    userId: `u${index + 1}`,
    nickname,
    role: 'MEMBER' as const,
    focusTimeMinutes: 60 - index,
    totalFocusMinutes: 60 - index,
  }));
  await render(
    <GroupCardBack
      {...baseProps}
      userId="u6"
      snapshot={{
        detail: {
          status: 'ready',
          data: {
            id: 'g1',
            name: group.name,
            description: null,
            missionCategory: null,
            missionType: null,
            durationMinutes: null,
            windowStart: null,
            windowEnd: null,
            maxMembers: 10,
            status: 'ACTIVE',
            members,
            code: null,
            codeExpiresAt: null,
            noticeGrantedUserIds: [],
          },
        },
        announcements: { status: 'ready', data: [] },
        challenges: { status: 'ready', data: [] },
        focus: { status: 'ready', data: [] },
      }}
    />,
  );

  expect(screen.getByText('나 · 첫째 · 둘째 · 셋째 · 넷째')).toBeOnTheScreen();
  expect(screen.queryByText(/다섯째/)).toBeNull();
});

test('최신 공지의 제목과 본문을 원문 순서로 표시하고 본문은 두 줄로 제한한다', async () => {
  await render(
    <GroupCardBack
      {...baseProps}
      snapshot={{
        detail: { status: 'loading' },
        announcements: {
          status: 'ready',
          data: [
            {
              id: 'notice-1',
              title: '오늘 일정',
              content: '오늘은 오전 9시에 함께 시작합니다.',
              createdAt: '2026-08-11T00:00:00Z',
            },
          ],
        },
        challenges: { status: 'ready', data: [] },
        focus: { status: 'loading' },
      }}
    />,
  );

  expect(screen.getByText('오늘 일정')).toBeOnTheScreen();
  expect(screen.getByText('오늘은 오전 9시에 함께 시작합니다.')).toBeOnTheScreen();
  expect(screen.getByTestId('group.card.announcement.content').props.numberOfLines).toBe(2);
});

test('ACTIVE 활동의 서버 순서·식별자·미션·내 진행 정보를 compact row로 유지한다', async () => {
  await render(
    <GroupCardBack
      {...baseProps}
      userId="me"
      snapshot={{
        detail: { status: 'loading' },
        announcements: { status: 'loading' },
        challenges: {
          status: 'ready',
          data: [
            {
              id: 'first',
              status: 'ACTIVE',
              missionType: 'DURATION',
              missionCategory: 'FOCUS',
              durationMinutes: 60,
              windowStart: null,
              windowEnd: null,
              createdAt: '2026-08-11T00:00:00Z',
              canParticipate: true,
              memberProgress: [
                { userId: 'me', nickname: '나', progressMinutes: 25, achieved: false },
              ],
            },
            {
              id: 'inactive',
              status: 'INACTIVE',
              missionType: 'DURATION',
              missionCategory: 'FOCUS',
              durationMinutes: 10,
              windowStart: null,
              windowEnd: null,
              createdAt: '2026-08-10T00:00:00Z',
              canParticipate: false,
              memberProgress: null,
            },
            {
              id: 'second',
              status: 'ACTIVE',
              missionType: 'TIME_WINDOW',
              missionCategory: 'SCREEN_TIME',
              durationMinutes: 30,
              windowStart: '09:00:00',
              windowEnd: '12:00:00',
              createdAt: '2026-08-09T00:00:00Z',
              canParticipate: true,
              memberProgress: [
                { userId: 'me', nickname: '나', progressMinutes: 30, achieved: true },
              ],
            },
          ],
        },
        focus: { status: 'loading' },
      }}
    />,
  );

  const rows = screen.getAllByTestId(/^group\.card\.activity\./);
  expect(rows.map((row) => row.props.testID)).toEqual([
    'group.card.activity.first',
    'group.card.activity.second',
  ]);
  expect(screen.getByText('하루 60분 집중')).toBeOnTheScreen();
  expect(screen.getByText('내 진행 25/60분')).toBeOnTheScreen();
  expect(screen.getByText('09:00~12:00 30분 이하 스크린타임')).toBeOnTheScreen();
  expect(screen.getByText('내 진행 30/30분 · 달성')).toBeOnTheScreen();
});

test('memberProgress null은 쉬는 날과 진행률 미제공 상태를 구분해 표시한다', async () => {
  const challenge = {
    status: 'ACTIVE' as const,
    missionType: 'TIME_WINDOW' as const,
    missionCategory: 'FOCUS' as const,
    durationMinutes: 30,
    windowStart: '09:00:00',
    windowEnd: '12:00:00',
    createdAt: '2026-08-11T00:00:00Z',
    canParticipate: true,
    memberProgress: null,
  };
  await render(
    <GroupCardBack
      {...baseProps}
      snapshot={{
        detail: { status: 'loading' },
        announcements: { status: 'loading' },
        challenges: {
          status: 'ready',
          data: [
            { ...challenge, id: 'resting', repeatDays: ['MON'], activeToday: false },
            { ...challenge, id: 'legacy' },
          ],
        },
        focus: { status: 'loading' },
      }}
    />,
  );

  expect(screen.getByText('오늘은 쉬는 날이에요')).toBeOnTheScreen();
  expect(screen.getByText('이 챌린지는 진행률을 표시하지 않아요')).toBeOnTheScreen();
});

test('활동 4개와 확대 가능한 본문은 bounded summary scroll 안에 두고 CTA는 고정한다', async () => {
  const activities = Array.from({ length: 4 }, (_, index) => ({
    id: `activity-${index}`,
    status: 'ACTIVE' as const,
    missionType: 'DURATION' as const,
    missionCategory: 'FOCUS' as const,
    durationMinutes: 30 + index,
    windowStart: null,
    windowEnd: null,
    createdAt: '2026-08-11T00:00:00Z',
    canParticipate: true,
    memberProgress: [{ userId: 'me', nickname: '나', progressMinutes: index, achieved: false }],
  }));
  await render(
    <GroupCardBack
      {...baseProps}
      userId="me"
      snapshot={{
        detail: { status: 'loading' },
        announcements: {
          status: 'ready',
          data: [
            {
              id: 'notice',
              title: '긴 공지',
              content: '두 줄까지 표시되는 긴 공지 본문입니다.',
              createdAt: '2026-08-11T00:00:00Z',
            },
          ],
        },
        challenges: { status: 'ready', data: activities },
        focus: { status: 'loading' },
      }}
    />,
  );

  expect(screen.getAllByTestId(/^group\.card\.activity\./)).toHaveLength(4);
  expect(screen.getByTestId('group.card.summaryScroll').props.nestedScrollEnabled).toBe(true);
  expect(screen.getByTestId('group.card.summaryScroll')).toHaveStyle({ flex: 1 });
  expect(screen.getByTestId('group.card.focus.g1')).toBeOnTheScreen();
  expect(screen.getByTestId('group.card.room.g1')).toBeOnTheScreen();
});
