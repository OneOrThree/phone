import type { InternalAxiosRequestConfig } from 'axios';
import type {
  GroupAnnouncementResponse,
  GroupChallengeResponse,
  GroupChallengeHistorySliceResponse,
  GroupDetailMemberResponse,
  GroupDetailResponse,
  GroupOverviewResponse,
  GroupSearchResponse,
  GroupSummaryResponse,
} from '@/types/dto/group';

// 그룹 카드 덱과 방 상세를 실서버 없이 함께 확인하기 위한 읽기 전용 목 데이터.
// 첫 그룹은 디자인 기준 화면(7/10, 방장, 공개방)에 맞추고 나머지는 가로 덱·순서·peek 검증용이다.
const GROUPS: readonly GroupSummaryResponse[] = [
  {
    groupId: '10000000-0000-0000-0000-000000000001',
    name: '새벽 6시 기상 집중단',
    description: '매일 아침 인증하고 첫 집중을 함께 시작해요.',
    code: null,
    currentMembers: 7,
    maxMembers: 10,
    role: 'OWNER',
    status: 'ACTIVE',
    isPrivate: false,
  },
  {
    groupId: '10000000-0000-0000-0000-000000000002',
    name: '취준 루틴 메이트',
    description: '평일 오전에는 이력서, 오후에는 면접 준비를 해요.',
    code: null,
    currentMembers: 5,
    maxMembers: 8,
    role: 'MEMBER',
    status: 'ACTIVE',
    isPrivate: true,
  },
  {
    groupId: '10000000-0000-0000-0000-000000000003',
    name: '공시생 10시간',
    description: '긴 호흡으로 매일 공부 시간을 쌓는 방입니다.',
    code: null,
    currentMembers: 9,
    maxMembers: 10,
    role: 'MEMBER',
    status: 'ACTIVE',
    isPrivate: false,
  },
  {
    groupId: '10000000-0000-0000-0000-000000000004',
    name: '퇴근 후 한 시간',
    description: '짧더라도 매일 한 번 집중하는 직장인 모임이에요.',
    code: null,
    currentMembers: 4,
    maxMembers: 6,
    role: 'MEMBER',
    status: 'ACTIVE',
    isPrivate: false,
  },
  {
    groupId: '10000000-0000-0000-0000-000000000005',
    name: '주말 자격증반',
    description: '토요일과 일요일에 몰입해서 진도를 나가요.',
    code: null,
    currentMembers: 6,
    maxMembers: 10,
    role: 'MEMBER',
    status: 'WAITING',
    isPrivate: true,
  },
  {
    groupId: '10000000-0000-0000-0000-000000000006',
    name: '영어 원서 한 챕터',
    description: '매일 한 챕터를 읽고 집중 기록을 남겨요.',
    code: null,
    currentMembers: 3,
    maxMembers: 7,
    role: 'MEMBER',
    status: 'ACTIVE',
    isPrivate: false,
  },
];

const MEMBER_POOL: readonly Omit<GroupDetailMemberResponse, 'role'>[] = [
  {
    userId: '00000000-0000-0000-0000-000000000101',
    nickname: '아침루틴',
    focusTimeMinutes: 180,
    totalFocusMinutes: 12_600,
  },
  {
    userId: '00000000-0000-0000-0000-000000000103',
    nickname: '꾸준한사람',
    focusTimeMinutes: 120,
    totalFocusMinutes: 9_480,
  },
  {
    userId: '00000000-0000-0000-0000-000000000104',
    nickname: '수학러',
    focusTimeMinutes: 200,
    totalFocusMinutes: 8_920,
  },
  {
    userId: '00000000-0000-0000-0000-000000000105',
    nickname: '쉬는중',
    focusTimeMinutes: 0,
    totalFocusMinutes: 7_310,
  },
  {
    userId: '00000000-0000-0000-0000-000000000106',
    nickname: '민트초코',
    focusTimeMinutes: 75,
    totalFocusMinutes: 5_740,
  },
  {
    userId: '00000000-0000-0000-0000-000000000107',
    nickname: '한걸음씩',
    focusTimeMinutes: 55,
    totalFocusMinutes: 4_260,
  },
  {
    userId: '00000000-0000-0000-0000-000000000108',
    nickname: '오늘도집중',
    focusTimeMinutes: 35,
    totalFocusMinutes: 3_180,
  },
  {
    userId: '00000000-0000-0000-0000-000000000109',
    nickname: '마지막한명',
    focusTimeMinutes: 20,
    totalFocusMinutes: 2_010,
  },
];

function userIdFromAuthHeader(config: InternalAxiosRequestConfig): string {
  const auth = config.headers?.Authorization;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '') : null;
  if (!token) return '00000000-0000-0000-0000-0000000000aa';
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload)) as { sub?: string };
    return decoded.sub ?? '00000000-0000-0000-0000-0000000000aa';
  } catch {
    return '00000000-0000-0000-0000-0000000000aa';
  }
}

function groupById(groupId: string): GroupSummaryResponse {
  return GROUPS.find((group) => group.groupId === groupId) ?? GROUPS[0];
}

export function mockMyGroups(): GroupSummaryResponse[] {
  return GROUPS.map((group) => ({ ...group }));
}

export function mockGroupSearch(query: unknown): GroupSearchResponse[] {
  const normalized = typeof query === 'string' ? query.trim().toLocaleLowerCase('ko-KR') : '';
  return GROUPS.filter(
    (group) =>
      group.isPrivate !== true &&
      (normalized.length === 0 || group.name.toLocaleLowerCase('ko-KR').includes(normalized)),
  ).map((group) => ({
    groupId: group.groupId,
    name: group.name,
    description: group.description,
    currentMembers: group.currentMembers,
    maxMembers: group.maxMembers,
    status: group.status,
    hasPassword: false,
  }));
}

export function mockGroupOverview(groupId: string): GroupOverviewResponse {
  const group = groupById(groupId);
  return {
    id: group.groupId,
    name: group.name,
    description: group.description ?? null,
    missionCategory: null,
    missionType: null,
    durationMinutes: null,
    windowStart: null,
    windowEnd: null,
    maxMembers: group.maxMembers,
    memberCount: group.currentMembers,
    status: group.status,
    hasPassword: false,
    isMember: true,
  };
}

export function mockGroupDetail(
  groupId: string,
  config: InternalAxiosRequestConfig,
): GroupDetailResponse {
  const group = groupById(groupId);
  const me: GroupDetailMemberResponse = {
    userId: userIdFromAuthHeader(config),
    nickname: '나',
    role: group.role,
    focusTimeMinutes: 45,
    totalFocusMinutes: 10_200,
  };
  const members = [
    me,
    ...MEMBER_POOL.slice(0, Math.max(0, group.currentMembers - 1)).map((member) => ({
      ...member,
      role: 'MEMBER' as const,
    })),
  ];
  return {
    id: group.groupId,
    name: group.name,
    description: group.description ?? null,
    missionCategory: null,
    missionType: null,
    durationMinutes: null,
    windowStart: null,
    windowEnd: null,
    maxMembers: group.maxMembers,
    status: group.status,
    members,
    code: null,
    codeExpiresAt: null,
    noticeGrantedUserIds: group.role === 'OWNER' ? [me.userId] : [],
    isPrivate: group.isPrivate,
  };
}

export function mockGroupAnnouncements(groupId: string): GroupAnnouncementResponse[] {
  const group = groupById(groupId);
  return [
    {
      id: `${group.groupId}-notice-1`,
      title: '이번 주 집중 안내',
      content:
        group.groupId === GROUPS[0].groupId
          ? '이번 주 인증은 일요일 자정까지예요.'
          : `${group.name}의 이번 주 목표를 확인하고 오늘 집중 기록을 남겨 주세요.`,
      createdAt: '2026-08-11T00:00:00.000Z',
    },
  ];
}

export function mockGroupChallenges(
  groupId: string,
  config: InternalAxiosRequestConfig,
): GroupChallengeResponse[] {
  const me = userIdFromAuthHeader(config);
  return [
    {
      id: `${groupId}-focus-60`,
      missionType: 'DURATION',
      missionCategory: 'FOCUS',
      durationMinutes: 60,
      windowStart: null,
      windowEnd: null,
      status: 'ACTIVE',
      createdAt: '2026-08-10T00:00:00.000Z',
      canParticipate: true,
      memberProgress: [
        { userId: me, nickname: '나', progressMinutes: 42, achieved: false },
        {
          userId: '00000000-0000-0000-0000-000000000101',
          nickname: '아침루틴',
          progressMinutes: 80,
          achieved: true,
        },
      ],
      repeatDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      activeToday: true,
      nextSessionAt: '2026-08-12T21:00:00.000Z',
      nextSessionJoined: false,
      dormant: false,
      betConfig: { enabled: false, stake: 0 },
      bet: null,
      lastSettledBet: null,
      lastSettledSession: null,
    },
    {
      id: `${groupId}-morning-window`,
      missionType: 'TIME_WINDOW',
      missionCategory: 'FOCUS',
      durationMinutes: 30,
      windowStart: '06:00:00',
      windowEnd: '08:00:00',
      status: 'ACTIVE',
      createdAt: '2026-08-10T00:00:00.000Z',
      canParticipate: true,
      memberProgress: [{ userId: me, nickname: '나', progressMinutes: 18, achieved: false }],
      repeatDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      activeToday: true,
      nextSessionAt: '2026-08-12T21:00:00.000Z',
      nextSessionJoined: false,
      dormant: false,
      betConfig: { enabled: false, stake: 0 },
      bet: null,
      lastSettledBet: null,
      lastSettledSession: null,
    },
  ];
}

export function mockGroupChallengeHistory(groupId: string): GroupChallengeHistorySliceResponse {
  return {
    content: [
      {
        sessionId: '30000000-0000-0000-0000-000000000201',
        sessionDate: '2026-08-11',
        challengeId: `${groupId}-focus-60`,
        challengeDeleted: false,
        missionCategory: 'FOCUS',
        missionType: 'DURATION',
        goalMinutes: 60,
        windowStart: null,
        windowEnd: null,
        stake: 10,
        pot: 50,
        status: 'SETTLED',
        voidReason: null,
        myPayout: 20,
        myAchieved: true,
        myProgressMinutes: 75,
        achievedCount: 3,
        participantCount: 5,
      },
      {
        sessionId: '30000000-0000-0000-0000-000000000202',
        sessionDate: '2026-08-10',
        challengeId: `${groupId}-focus-60`,
        challengeDeleted: false,
        missionCategory: 'FOCUS',
        missionType: 'DURATION',
        goalMinutes: 60,
        windowStart: null,
        windowEnd: null,
        stake: 10,
        pot: 40,
        status: 'SETTLED',
        voidReason: null,
        myPayout: 0,
        myAchieved: false,
        myProgressMinutes: 45,
        achievedCount: 2,
        participantCount: 4,
      },
    ],
    size: 20,
    hasNext: false,
    nextCursor: null,
  };
}
