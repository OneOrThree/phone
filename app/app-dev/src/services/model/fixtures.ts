import { SECONDS_PER_FISH, buildingOrder } from './catalog';
import { dayKey } from './time';
import { Island, Member, State } from './types';

export const uuid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const peers = (): Member[] => [
  {
    id: 'minji',
    name: '민지',
    color: 'ginger',
    subject: '영어 단어',
    seconds: 1320,
    focusing: true,
    role: 'member',
  },
  {
    id: 'dubu',
    name: '두부',
    color: 'cream',
    subject: '국어 독해',
    seconds: 960,
    focusing: true,
    role: 'member',
  },
  {
    id: 'sua',
    name: '수아',
    color: 'gray',
    subject: '과학 복습',
    seconds: 600,
    focusing: false,
    restStartedAt: Date.now() - 180000,
    role: 'member',
  },
];

export function makeIsland(id: string, name: string, full = false, solo = false): Island {
  const joined = full && id === 'soda';
  return {
    id,
    name,
    intro: '각자의 공부를 함께해요.',
    approval: false,
    capacity: 15,
    joined,
    visibility: 'public',
    buildings: full ? [...buildingOrder] : [],
    points: 0,
    contribution: 0,
    fish: full ? 1200 : 0,
    earned: full ? { ...(joined ? { me: 320 } : {}), minji: 260, dubu: 200, sua: 165 } : {},
    members: (solo ? [] : peers()).map((m, index) => ({
      ...m,
      role: full && !joined && index === 0 ? 'host' : m.role,
      records: [
        {
          id: id + '/' + m.id,
          islandId: id,
          subject: m.subject,
          seconds: m.seconds,
          at: Date.now(),
          fish: Math.floor(m.seconds / SECONDS_PER_FISH),
          contributed: true,
        },
      ],
      screenDays: m.id === 'dubu' ? undefined : { [dayKey()]: 84 },
    })),
    formerMembers: [],
    requests: full && !solo ? [{ id: 'saebom', name: '새봄', color: 'white' }] : [],
    joinedDay: joined ? '1970-01-01' : undefined,
    boardCompletedDay: full ? '1970-01-01' : undefined,
    quests: [
      {
        id: 'q-focus',
        title: '오늘 30분 집중하기',
        type: 'focus',
        target: 30,
        claimed: false,
        createdDay: '1970-01-01',
      },
      {
        id: 'q-screen',
        title: '오늘 폰 사용 2시간 이내',
        type: 'screen',
        target: 120,
        claimed: false,
        createdDay: '1970-01-01',
      },
    ],
    notices: solo
      ? []
      : [
          {
            id: 'welcome',
            title: '우리 섬에 온 걸 환영해요',
            body: '혼자 집중해도, 함께 집중해도 좋아요. 각자 할 일을 정하고 낚시하러 나가요.',
            author: '민지',
            authorId: 'minji',
            at: Date.now() - 86400000,
            comments: [
              {
                id: 'c1',
                name: '민지',
                memberId: 'minji',
                text: '오늘도 같이 힘내요!',
                at: Date.now() - 3600000,
              },
            ],
          },
          // v2 목업과 같은 두 번째 공지 (게시판 공지 탭에 종이 두 장)
          {
            id: 'weekly-goal',
            title: '이번 주 목표는 20시간',
            body: '이번 주에는 우리 섬 합계 20시간을 목표로 해요. 각자 할 수 있는 만큼만 보태요.',
            author: '민지',
            authorId: 'minji',
            at: Date.now() - 6 * 86400000,
            comments: [
              {
                id: 'c2',
                name: '민지',
                memberId: 'minji',
                text: '좋아요, 저는 하루 한 시간!',
                at: Date.now() - 5 * 86400000,
              },
              {
                id: 'c3',
                name: '두부',
                memberId: 'dubu',
                text: '주말에 몰아서 채울게요.',
                at: Date.now() - 5 * 86400000,
              },
              {
                id: 'c4',
                name: '수아',
                memberId: 'sua',
                text: '같이 해요!',
                at: Date.now() - 4 * 86400000,
              },
            ],
          },
        ],
    messages: solo
      ? []
      : [
          {
            id: 'm1',
            memberId: 'minji',
            name: '민지',
            color: 'ginger',
            text: '오늘 할 일 끝냈어! 같이 집중하니까 덜 미뤘다.',
            at: Date.now() - 600000,
            status: 'sent',
          },
          {
            id: 'm2',
            memberId: 'dubu',
            name: '두부',
            color: 'cream',
            text: '수고했어! 나는 한 번 더 하고 쉴게.',
            at: Date.now() - 540000,
            status: 'sent',
          },
        ],
    sharedOwned: ['waves', 'campfire', 'forest-wind'],
    theme: 'default',
    buildingTheme: 'default',
    track: 'waves',
    playing: false,
    ledger: [],
    chatReadAt: 0,
  };
}

export function initialState(full = false): State {
  return {
    version: 1,
    schema: 2,
    rewards: [],
    screenDays: {},
    friends: full
      ? [
          {
            id: 'saebom',
            name: '새봄',
            color: 'white',
            island: '딸기 섬',
            status: 'friend',
            messages: [],
          },
          {
            id: 'minji',
            name: '민지',
            color: 'ginger',
            island: '소다 섬',
            status: 'friend',
            messages: [],
          },
          {
            id: 'haneul',
            name: '하늘',
            color: 'calico',
            island: '구름 섬',
            status: 'received',
            messages: [],
          },
          {
            id: 'bori',
            name: '보리',
            color: 'cream',
            island: '구름 섬',
            status: 'sent',
            messages: [],
          },
        ]
      : [],
    loggedIn: full,
    onboarded: full,
    name: '',
    profileNames: [],
    color: 'black',
    mainIslandId: full ? 'soda' : null,
    islandId: 'soda',
    fish: 0,
    owned: [],
    equipped: {
      clothes: 'default',
      decor: 'none',
      hull: 'raft',
      position: 'front',
    },
    settings: {
      notifications: true,
      sound: true,
      volume: 0.55,
      reduceMotion: false,
      reduceMotionUserOnly: true,
      publicRecords: true,
      permission: full,
      haptics: true,
      screenTimeBoardPromptSeen: false,
      screenTimeMeasurementReady: full,
      screenTimeHistoryReady: full,
    },
    islands: [
      makeIsland('soda', '소다 섬', full, !full),
      { ...makeIsland('strawberry', '딸기 섬', true), joined: false },
      {
        ...makeIsland('cloud', '구름 섬', true),
        approval: true,
        joined: false,
      },
    ],
    session: null,
    records: [],
    orders: [],
    screenMinutes: 90,
    screenTimeUnconfirmedDays: [],
    lastResult: null,
    pendingIsland: null,
    pendingIslands: [],
    lettersReadAt: 0,
  };
}

// Expo 웹 모션 검수용 상태. 제품의 최초 안내 동작은 유지하고 데모에서만 월드맵을 바로 연다.
export function demoState(): State {
  const state = initialState(true);
  return {
    ...state,
    friends: (state.friends ?? []).map((friend, index) =>
      index === 0
        ? {
            ...friend,
            messages: [
              ...friend.messages,
              {
                id: 'demo-unread-letter',
                memberId: friend.id,
                name: friend.name,
                color: friend.color,
                text: '오늘도 같이 집중해요!',
                at: Date.now(),
                status: 'sent' as const,
              },
            ],
          }
        : friend,
    ),
    mailboxGuideSeenBy: ['local'],
    shopGuideSeenBy: ['local'],
  };
}
