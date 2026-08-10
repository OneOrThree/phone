import { fireEvent, render, screen } from '@testing-library/react-native';
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
  expect(screen.getByText('진행 중인 활동 0개')).toBeOnTheScreen();
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

test('그룹 활동 수는 ACTIVE 상태만 센다', async () => {
  await render(
    <GroupCardBack
      {...baseProps}
      snapshot={{
        detail: { status: 'loading' },
        announcements: { status: 'loading' },
        challenges: {
          status: 'ready',
          data: [
            { id: 'active', status: 'ACTIVE' },
            { id: 'inactive', status: 'INACTIVE' },
          ] as never,
        },
        focus: { status: 'loading' },
      }}
    />,
  );

  expect(screen.getByText('진행 중인 활동 1개')).toBeOnTheScreen();
});
