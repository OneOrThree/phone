import type {
  IslandSummary,
  JoinRequestStatus,
  MyIslands,
  MyJoinRequest,
  VisitScreen,
} from '@/services/api/islands';

export type Color = 'black' | 'ginger' | 'cream' | 'gray' | 'white' | 'calico';
export type Building = 'hall' | 'board' | 'tower' | 'mail' | 'gram' | 'shop' | 'library';
export type Route =
  | 'login'
  | 'character'
  | 'chooseIsland'
  | 'createIsland'
  | 'joinIsland'
  | 'approval'
  | 'arrival'
  | 'home'
  | 'guide'
  | 'focusSetup'
  | 'focus'
  | 'rest'
  | 'focusResult'
  | 'hall'
  | 'stats'
  | 'manage'
  | 'members'
  | 'ledger'
  | 'construction'
  | 'board'
  | 'notice'
  | 'noticeEdit'
  | 'quest'
  | 'questEdit'
  | 'tower'
  | 'explore'
  | 'visit'
  | 'visitIsland'
  | 'visitIslandFocus'
  | 'travel'
  | 'mail'
  | 'shop'
  | 'product'
  | 'orders'
  | 'boat'
  | 'mainIsland'
  | 'profile'
  | 'settings'
  | 'wardrobe'
  | 'sound'
  | 'library'
  | 'diary'
  | 'friends'
  | 'friendSearch'
  | 'friendMail'
  | 'chat'
  | 'fishingArrival'
  | 'focusVisit'
  | 'focusTravel'
  | 'returnTravel'
  | 'permission'
  | 'screenTimeApps'
  | 'demo';
export type Member = {
  id: string;
  name: string;
  color: Color;
  subject: string;
  seconds: number;
  focusing: boolean;
  restStartedAt?: number;
  role: 'host' | 'member';
  records?: RecordItem[];
  screenDays?: Record<string, number | null>;
};
export type Quest = {
  id: string;
  title: string;
  type: 'focus' | 'screen';
  target: number;
  windowStart?: string;
  windowEnd?: string;
  claimed: boolean;
  /** KST date on which this quest became eligible for daily rounds. */
  createdDay?: string;
  rounds?: Record<string, QuestRound>;
};
export type QuestRound = {
  targets: string[];
  achieved: string[];
  claimed: string[];
  bonus: boolean;
  target: number;
  kind: 'focus' | 'screen';
  windowStart?: string;
  windowEnd?: string;
};
export type Friend = {
  id: string;
  name: string;
  color: Color;
  island: string;
  status: 'friend' | 'received' | 'sent' | 'none';
  messages: Message[];
};
export type Reward = {
  id: string;
  islandId: string;
  questId: string;
  day: string;
  amount: number;
  kind: 'personal' | 'bonus';
  acknowledged: boolean;
};
export type Notice = {
  id: string;
  title: string;
  body: string;
  // 작성자·작성 시각. 예전 저장본에는 없을 수 있다
  author?: string;
  authorId?: string;
  at?: number;
  comments: { id: string; name: string; memberId?: string; text: string; at?: number }[];
};
export type Message = {
  id: string;
  memberId: string;
  name: string;
  color: Color;
  text: string;
  at: number;
  status: 'sent' | 'failed';
  // 받은 편지를 읽고 닫은 시각. 있으면 받은 편지함에서 사라진다
  readAt?: number;
};
export type Island = {
  visibility?: 'public' | 'private';
  // 이 사용자가 강퇴된 섬. 일반 탐색·가입 경로에서는 다시 노출하거나 가입시키지 않는다.
  kicked?: boolean;
  // 마지막 주민이 떠나 종료된 섬. 기록 참조는 남기되 탐색·검색·재가입 대상에서는 제외한다.
  closed?: boolean;
  id: string;
  name: string;
  intro: string;
  approval: boolean;
  // 정원(1~15명). 예전 저장본에는 없어서 capacityOf로 읽는다
  capacity?: number;
  requestResolved?: boolean;
  // 승인 대기 중인 가입 신청. 예전 저장본은 LOAD에서 빈 목록으로 채운다
  requests?: { id: string; name: string; color: Color }[];
  joined: boolean;
  /** KST date on which the current user joined this island. */
  joinedDay?: string;
  /** KST date on which the board first became available for daily screen-time quests. */
  boardCompletedDay?: string;
  buildings: Building[];
  /** Legacy aliases kept only for importing old fixtures. UI uses fish. */
  fish?: number;
  earned?: Record<string, number>;
  buildingQuest?: {
    building: Building;
    targets: string[];
    selectedAt: number;
    // 목표 선택 시점의 주민별 earned 스냅숏. 모은 양 = earnedBy − base. 없으면(예전 저장본) 0으로 본다
    base?: Record<string, number>;
  };
  construction?: {
    building: Building;
    startedAt: number;
    endsAt: number;
    cost: number;
  };
  points: number;
  contribution: number;
  nextBuilding?: Building;
  members: Member[];
  // 강퇴·탈퇴한 주민의 완료 기록은 주민 목록과 분리해 보존한다.
  formerMembers?: Member[];
  quests: Quest[];
  notices: Notice[];
  messages: Message[];
  sharedOwned: string[];
  theme: string;
  buildingTheme: string;
  buildingThemes?: Record<string, string>;
  track: string;
  playing: boolean;
  ledger: { id: string; text: string; at: number; memberId?: string }[];
  // 우리 섬 채팅방을 마지막으로 연 시각. 이후 다른 주민 글이 새 글이다
  chatReadAt?: number;
  // 방금 완공한 건물. 게시판 청사진이 완공 안내를 보여 주고, 다음 건물을 고르면 지운다
  completed?: { building: Building; at: number };
};
export type Session = {
  id: string;
  islandId: string;
  subject: string;
  startedAt: number;
  restStartedAt?: number;
  seconds: number;
  status: 'active' | 'paused';
  // 서버 세션의 version — pause/resume/finish 의 expectedVersion(GROMO-2009). 로컬 목업 세션에는 없다
  version?: number;
  // 예전 저장 세션에서 집중 중 이미 섬에 적립한 물고기 수(지금은 종료 때 한 번에 적립)
  creditedFish?: number;
  intervals?: { start: number; end: number }[];
};
export type RecordItem = {
  id: string;
  islandId: string;
  subject: string;
  seconds: number;
  at: number;
  fish: number;
  contributed: boolean;
  intervals?: { start: number; end: number }[];
  // 서버가 자동 종료한 세션의 미확인 결과(pending-result) — 결과창을 닫을 때 acknowledge 대상
  // 세션 id다. 확인이 끝나면 지운다(GROMO-2009).
  ackId?: string;
};
export type Product = {
  id: string;
  title: string;
  kind: 'clothes' | 'island' | 'building' | 'audio';
  price: number;
  currency: 'fish' | 'points';
  description: string;
  building?: Building;
};
export type State = {
  version: 1;
  schema?: 2;
  friends?: Friend[];
  rewards?: Reward[];
  screenDays?: Record<string, number | null>;
  screenTimeUnconfirmedDays?: string[];
  focusSpot?: { x: number; y: number };
  resultFromRest?: boolean;
  loggedIn: boolean;
  onboarded: boolean;
  name: string;
  profileNames?: string[];
  color: Color;
  // 친구 목록·프로필에 표시하는 대표 섬. 현재 접속 섬(islandId)과 독립적으로 바뀐다.
  mainIslandId: string | null;
  islandId: string;
  fish: number;
  owned: string[];
  equipped: { clothes: string; decor: string; hull: string; position: string };
  settings: {
    notifications: boolean;
    sound: boolean;
    volume?: number;
    reduceMotion: boolean;
    publicRecords: boolean;
    permission: boolean;
    haptics: boolean;
    screenTimeBoardPromptSeen?: boolean;
    screenTimeMeasurementReady?: boolean;
    screenTimeHistoryReady?: boolean;
  };
  islands: Island[];
  session: Session | null;
  records: RecordItem[];
  orders: {
    id: string;
    product: string;
    islandId: string;
    currency: string;
    price: number;
    at: number;
    // 공동 구매를 누른 주민 이름
    buyer?: string;
  }[];
  screenMinutes: number;
  lastResult: RecordItem | null;
  pendingIsland: string | null;
  pendingIslands?: string[];
  // GROMO-2006 서버 온보딩 스냅샷 — /me/islands 정본과 탐색·신청만 담는다.
  // 서버 DTO에 없는 자료(건물·주민·원장)를 만들지 않고, 초대 token·멱등 키도 저장하지 않는다
  // (전체 State가 AsyncStorage에 저장되므로 비밀·진행 중 의도는 App ref에 둔다).
  serverIslands?: {
    memberships: IslandSummary[];
    currentIslandId: string | null;
    lossReason: 'LEFT' | 'KICKED' | null;
    candidates: IslandSummary[];
    nextCursor: string | null;
    visit: VisitScreen | null;
    joinRequests: MyJoinRequest[];
    // 단건 상태 조회(/me/join-requests/{id})는 islandName·memberCount 같은 표시 필드가 없다.
    // 서버가 안 준 값을 합성하지 않고 상태만 별도로 보관한다 — 화면은 목록 항목에 이 상태를 얹어 쓴다.
    // 취소 응답처럼 version이 없는 결과도 있으므로 version은 선택이다.
    requestStatus: RequestStatusEntry[];
  } | null;
  travelOrigin?: string;
  // 다른 섬을 방문자로 구경 중이면 그 섬 ID(GROMO-1904). 내 현재 섬(islandId)은 그대로 둔다
  visitingIslandId?: string | null;
  // 첫 집중 후 마을회관 안내(20b). 없으면(예전 저장본 포함) 띄우지 않는다
  hallGuide?: 'pending' | 'done';
  // 최초 우체통 안내를 마친 계정. 섬을 옮겨도 반복하지 않고 계정 간에는 분리한다.
  mailboxGuideSeenBy?: string[];
  // 현재 화면을 잃은 강퇴를 앱 셸이 소비해 안전한 화면으로 reset하기 위한 일회성 신호
  membershipRecovery?: { reason: 'kicked'; islandId: string };
  // 이 시각까지 받은 편지는 읽은 것으로 본다. 받은 편지 읽음(readAt)이 생기기 전 저장본을 불러온 시각이 들어간다
  lettersReadAt?: number;
};
export const colors: Color[] = ['black', 'ginger', 'cream', 'gray', 'white', 'calico'];
export const colorNames = ['검정', '치즈', '크림', '회색', '흰색', '삼색'];
export const buildingNames: Record<Building, string> = {
  hall: '마을회관',
  board: '게시판',
  tower: '전망대',
  mail: '우체통',
  gram: '축음기',
  library: '도서관',
  shop: '상점',
};
// 유효 집중 이 초만큼마다 물고기 1마리 (GROMO-1830, 2026-09-15)
export const SECONDS_PER_FISH = 60;
// 건물 가격은 섬 인원과 무관한 고정 총액이다 (GROMO-1829, 2026-09-15)
export const costs: Record<Building, number> = {
  hall: 60,
  board: 240,
  gram: 1360,
  library: 2720,
  mail: 4080,
  tower: 5440,
  shop: 6800,
};
export const buildMinutes: Record<Building, number> = {
  hall: 1,
  board: 15,
  gram: 30,
  library: 60,
  mail: 90,
  tower: 150,
  shop: 240,
};
export const buildingOrder: Building[] = [
  'hall',
  'board',
  'gram',
  'library',
  'mail',
  'tower',
  'shop',
];
function completeAllBuildings(i: Island, now = Date.now()) {
  i.buildings = [...buildingOrder];
  i.boardCompletedDay ??= dayKey(now);
  delete i.buildingQuest;
  delete i.construction;
  delete i.nextBuilding;
  delete i.completed;
}
export const balance = (i: Island) => i.fish ?? i.contribution + i.points;
export const isHost = (i: Island) => i.joined && !i.members.some((m) => m.role === 'host');
export const targetIds = (i: Island) => [
  ...(i.joined ? ['me'] : []),
  ...i.members.map((m) => m.id),
];
export const earnedBy = (i: Island, id: string) => i.earned?.[id] ?? 0;
// 건물 총액은 섬 인원과 무관한 고정값
export const buildingCost = (i: Island, b: Building) => costs[b];
// 대상 1인당 몫 = 총액 ÷ 대상 인원(올림). 현재 목표가 b면 스냅숏된 대상 수, 아니면(미리보기) 지금 주민 수
export const buildingShare = (i: Island, b: Building) =>
  Math.ceil(
    costs[b] /
      (i.buildingQuest?.building === b ? i.buildingQuest.targets.length : targetIds(i).length),
  );
// 목표를 고른 뒤부터 모은 양 = 현재 누적 earned − 목표 선택 시점 스냅숏(base)
export const collectedBy = (i: Island, id: string) =>
  earnedBy(i, id) - (i.buildingQuest?.base?.[id] ?? 0);
export const buildingReady = (i: Island) =>
  !!i.buildingQuest &&
  i.buildingQuest.targets.length > 0 &&
  i.buildingQuest.targets.every(
    (id) => collectedBy(i, id) >= buildingShare(i, i.buildingQuest!.building),
  ) &&
  balance(i) >= buildingCost(i, i.buildingQuest.building);
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const kstDate = (at: number) => new Date(at + KST_OFFSET_MS);
export const dayKey = (at = Date.now()) => {
  const d = kstDate(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
// 날짜 "M/D"와 시각 "HH:MM"(Asia/Seoul, 기기 시간대와 무관)
export const kstMonthDay = (at: number) => {
  const d = kstDate(at);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
export const kstHourMinute = (at: number) => {
  const d = kstDate(at);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
export const kstDayStart = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date) - KST_OFFSET_MS;
};
export const trackNames: Record<string, string> = {
  waves: '잔잔한 파도',
  campfire: '모닥불 소리',
  'forest-wind': '숲바람',
  rain: '빗방울 소리',
};
export const products: Product[] = [
  {
    id: 'scarf',
    title: '바다 스카프',
    kind: 'clothes',
    price: 100,
    currency: 'fish',
    description: '고양이의 목에 두르는 가벼운 스카프',
  },
  // v2 시안 상점(내 꾸미기)의 두 번째 장신구. 가격은 스카프와 같은 5배 환산(시안 15마리)
  {
    id: 'straw-hat',
    title: '밀짚모자',
    kind: 'clothes',
    price: 75,
    currency: 'fish',
    description: '햇볕을 가려 주는 챙 넓은 밀짚모자',
  },
  {
    id: 'soda-theme',
    title: '소다 섬 테마',
    kind: 'island',
    price: 1000,
    currency: 'fish',
    description: '섬 주변을 밝은 소다색으로 꾸며요.',
  },
  {
    id: 'strawberry-roof',
    title: '마을회관 딸기 테마',
    building: 'hall',
    kind: 'building',
    price: 300,
    currency: 'fish',
    description: '마을회관 한 곳에만 적용하는 외양이에요.',
  },
  {
    id: 'rain',
    title: '빗방울 소리',
    kind: 'audio',
    price: 30,
    currency: 'fish',
    description: '창가에 톡톡 떨어지는 빗방울 소리예요.',
  },
];
for (const building of ['board', 'tower', 'mail', 'shop'] as Building[])
  products.push({
    id: 'strawberry-' + building,
    title: buildingNames[building] + ' 딸기 테마',
    building,
    kind: 'building',
    price: 300,
    currency: 'fish',
    description: buildingNames[building] + ' 한 곳에만 적용하는 외양이에요.',
  });
const uuid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
    name: '수빈',
    profileNames: ['수빈'],
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
export const currentIsland = (s: State) => s.islands.find((i) => i.id === s.islandId)!;
export const mainIsland = (s: State) =>
  s.islands.find((i) => i.id === s.mainIslandId && i.joined && !i.closed) ??
  s.islands.find((i) => i.joined && !i.closed);
// 화면이 그릴 섬: 구경 중이면 구경하는 섬, 아니면 내 현재 섬
export const viewIsland = (s: State) =>
  (s.visitingIslandId && s.islands.find((i) => i.id === s.visitingIslandId)) || currentIsland(s);
// 방문자로 내릴 수 있는지: 섬에 자리 잡은 뒤, 지금 섬 전망대에서, 집중 중이 아닐 때 미가입 섬만
export const canVisit = (s: State, id: string) => {
  const target = s.islands.find((i) => i.id === id);
  return (
    s.onboarded &&
    !s.session &&
    currentIsland(s).joined &&
    currentIsland(s).buildings.includes('tower') &&
    !!target &&
    !target.joined &&
    !target.kicked &&
    !target.closed
  );
};
// "HH:MM" → 자정부터 분. 형식이 틀리면 null
// 시간대 종료는 24:00까지 쓸 수 있고, 네이티브 입력의 '9:00' 같은 한 자리 시도 받는다
export const clockMinutes = (v?: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? '');
  if (!m || +m[2] >= 60 || +m[1] > 24 || (+m[1] === 24 && +m[2] > 0)) return null;
  return +m[1] * 60 + +m[2];
};
// 회관에서 다음 건물로 고를 수 있는 건물. 이 건물이 완공될 때만 게시판 청사진에 완공 안내를 남긴다
export const nextBuildings: Building[] = ['gram', 'library', 'mail', 'tower', 'shop'];
// 친구 편지를 보낼 수 있는지: 지금 친구이고 내 섬에 우체통이 있어야 한다 (받는 섬은 상관없다)
export const canSendLetter = (s: State, friendId: string) =>
  s.friends?.find((f) => f.id === friendId)?.status === 'friend' &&
  currentIsland(s).buildings.includes('mail');
// 친구가 보내고 아직 읽고 닫지 않은 편지 (최신순)
export const unreadLetters = (s: State) =>
  (s.friends ?? [])
    .filter((f) => f.status === 'friend')
    .flatMap((f) =>
      f.messages
        .filter((m) => m.memberId !== 'me' && !m.readAt && m.at > (s.lettersReadAt ?? 0))
        .map((m) => ({ friend: f, letter: m })),
    )
    .sort((a, b) => b.letter.at - a.letter.at);
// 친구 편지의 기존 읽음 정본을 따른다. 방문 중에는 내 편지 상태를 남의 섬에 표시하지 않는다.
export const hasMailboxLetters = (s: State, islandId = s.islandId) =>
  !s.visitingIslandId &&
  islandId === s.islandId &&
  currentIsland(s).joined &&
  currentIsland(s).buildings.includes('mail') &&
  unreadLetters(s).length > 0;

export const shouldShowMailboxGuide = (s: State, userId: string) =>
  !s.visitingIslandId &&
  !s.session &&
  currentIsland(s).joined &&
  currentIsland(s).buildings.includes('mail') &&
  !s.mailboxGuideSeenBy?.includes(userId);

// 채팅방을 마지막으로 연 뒤 다른 주민이 남긴 글 수
// 내 댓글인지: memberId가 없던 예전 저장본은 작성자 이름을 내 이름(바꾼 이름 포함)과 비교한다
// 주민 찾기: 지금 주민이 아니면 떠난 주민(기록 보존)에서 찾는다. 달성률·보상 판정이 같은 기록을 본다
export const memberOf = (i: Island, id: string) =>
  i.members.find((m) => m.id === id) ?? i.formerMembers?.find((m) => m.id === id);
// "9:00" 같은 입력을 "09:00"으로 맞춘다 (형식이 틀리면 입력 그대로)
export const clockText = (value: string) => {
  const m = clockMinutes(value);
  return m == null
    ? value
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const isOwnComment = (s: State, c: { memberId?: string; name: string }) =>
  c.memberId != null ? c.memberId === 'me' : [s.name, ...(s.profileNames ?? [])].includes(c.name);
export const newChatCount = (i: Island) =>
  i.messages.filter((m) => m.memberId !== 'me' && m.at > (i.chatReadAt ?? 0)).length;
export const CAPACITY_MIN = 1,
  CAPACITY_MAX = 15;
// 주민 수 = 다른 주민 + (내가 가입했으면) 나
export const residentCount = (i: Island) => i.members.length + (i.joined ? 1 : 0);
export const capacityOf = (i: Island) => i.capacity ?? CAPACITY_MAX;
export const isFull = (i: Island) => residentCount(i) >= capacityOf(i);
// 방문자 등록증의 가입 버튼 상태. 집중 중에는 배 이동부터 막혀 방문 화면에 올 수 없으므로 집중 상태는 없다
export type VisitorJoin = 'join' | 'apply' | 'cancel' | 'full' | 'blocked';
export const visitorJoinState = (s: State, i: Island): VisitorJoin =>
  i.kicked
    ? 'blocked'
    : (s.pendingIslands ?? []).includes(i.id) || s.pendingIsland === i.id
      ? 'cancel'
      : isFull(i)
        ? 'full'
        : i.approval
          ? 'apply'
          : 'join';
export const visitorJoinLabel: Record<VisitorJoin, string> = {
  join: '이 섬에 가입',
  apply: '가입 신청',
  cancel: '신청 취소',
  full: '정원이 가득 찼어요',
  blocked: '다시 가입할 수 없어요',
};
export const inviteCodeOf = (i: Island) => i.id.toUpperCase();
export const findIslandByInviteCode = (islands: Island[], code: string) =>
  islands.find((i) => !i.closed && !i.kicked && inviteCodeOf(i) === code.trim().toUpperCase());
// /me/islands 응답 정합(GROMO-2006) — current가 있으면 items 안에 있어야 한다.
// current null+소속 존재는 유효하다: 첫 pending 승인이 소속을 만들어도 current는 안 옮기고,
// current 섬에서 나가도 남은 소속은 유지된다. 모순(items 밖 current)만 걸러낸다.
export const myIslandsConsistent = (my: MyIslands) =>
  my.currentIslandId == null || my.items.some((x) => x.id === my.currentIslandId);
// 쓰기 의도 멱등 키 풀(GROMO-2006) — 같은 의도(name+exactBody)의 재시도는 같은 키를 돌려주고,
// release 후에는 새 키를 만든다. 응답 유실·재조회 실패 동안만 키를 유지하고, 확정 성공·종결
// 뒤에는 release해서 취소 후 같은 섬 재신청 같은 새 사용자 행동이 옛 결과를 replay 받지 않게 한다.
// 키는 호출부 ref에만 두고 State·AsyncStorage에는 저장하지 않는다.
// requestStatus 항목 — 취소 응답({id,status:'cancelled'})처럼 version이 없는 서버 결과도
// 그대로 담는다. 없는 version은 합성하지 않는다.
export type RequestStatusEntry = Omit<JoinRequestStatus, 'version'> & { version?: number };
export const intentKeyPool = (gen: () => string) => {
  const keys: Record<string, string> = {};
  const slot = (name: string, exactBody: string) => `${name}:${exactBody}`;
  return {
    key: (name: string, exactBody: string) => (keys[slot(name, exactBody)] ??= gen()),
    release: (name: string, exactBody: string) => {
      delete keys[slot(name, exactBody)];
    },
  };
};
// 서버 온보딩 스냅샷 접근 — null 이면 빈 껍데기를 만든다(리듀서 내부 전용).
// 구 저장본은 requestStatus가 없을 수 있어 읽기 전에 채운다.
const serverSnap = (s: State) => {
  const snap = (s.serverIslands ??= {
    memberships: [],
    currentIslandId: null,
    lossReason: null,
    candidates: [],
    nextCursor: null,
    visit: null,
    joinRequests: [],
    requestStatus: [],
  });
  snap.requestStatus ??= [];
  return snap;
};
export const recordSecondsBetween = (record: RecordItem, from: number, until: number) =>
  (record.intervals ?? [{ start: record.at - record.seconds * 1000, end: record.at }]).reduce(
    (seconds, interval) =>
      seconds + Math.max(0, Math.min(interval.end, until) - Math.max(interval.start, from)) / 1000,
    0,
  );
// 이번 주 시작 = Asia/Seoul 기준 일요일 00:00 (정책: 주간 랭킹은 매주 일요일 00시에 초기화)
export function weekStart(now = Date.now()) {
  const d = kstDate(now);
  return (
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay()) - KST_OFFSET_MS
  );
}
// 섬 평균 집중(초) = 이번 주 그 섬에서 집중한 시간 합계 ÷ 그 섬 주민 수
// 모든 주민의 기록을 같은 섬·같은 주간 구간으로 필터링한다.
export function islandWeeklyAverage(s: State, i: Island, now = Date.now()) {
  const residents = residentCount(i);
  if (!residents) return 0;
  const from = weekStart(now);
  const mine = s.records
    .filter((r) => r.islandId === i.id)
    .reduce((a, r) => a + recordSecondsBetween(r, from, now), 0);
  return (
    (mine +
      [...i.members, ...(i.formerMembers ?? [])].reduce(
        (a, m) =>
          a +
          (m.records ?? [])
            .filter((r) => r.islandId === i.id)
            .reduce((n, r) => n + recordSecondsBetween(r, from, now), 0),
        0,
      )) /
    residents
  );
}
// "N시간 M분", 1시간 미만은 "M분", 딱 떨어지는 시간은 "N시간"
export function hoursMinutes(seconds: number) {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}분` : m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m / 60}시간`;
}
export const sessionSeconds = (session: Session | null, now = Date.now()) =>
  !session
    ? 0
    : session.seconds +
      (session.status === 'active' ? Math.max(0, (now - session.startedAt) / 1000) : 0);
export function questRate(s: State, q: Quest, islandId = s.islandId): number | null {
  if (q.type === 'screen')
    return !s.settings.permission ||
      !s.settings.screenTimeMeasurementReady ||
      s.screenTimeUnconfirmedDays?.includes(dayKey())
      ? null
      : s.screenMinutes <= q.target
        ? 100
        : Math.max(0, Math.round((q.target / s.screenMinutes) * 100));
  const seconds = focusTotal(s.records, islandId, dayKey(), {
    targets: [],
    achieved: [],
    claimed: [],
    bonus: false,
    target: q.target,
    kind: q.type,
    windowStart: q.windowStart,
    windowEnd: q.windowEnd,
  });
  return Math.min(100, Math.floor((seconds / (q.target * 60)) * 100));
}
export function canBuild(s: State, b: Building): string | null {
  const i = currentIsland(s);
  if (!isHost(i)) return '방장만 건설할 수 있어요.';
  if (i.construction) return '공사가 끝난 뒤 다음 건물을 지을 수 있어요.';
  if (i.buildings.includes(b)) return '이미 완성한 시설이에요.';
  if (b === 'board' && !i.buildings.includes('hall')) return '마을회관을 먼저 지어요.';
  if (b !== 'hall' && b !== 'board') {
    if (!i.buildings.includes('board')) return '게시판 완공 후 선택할 수 있어요.';
    if (i.buildingQuest?.building !== b) return '회관에서 다음 건물을 먼저 선택해 주세요.';
    if (
      !i.buildingQuest.targets.length ||
      !i.buildingQuest.targets.every((id) => collectedBy(i, id) >= buildingShare(i, b))
    )
      return '대상 주민 모두가 물고기 목표를 달성해야 해요.';
    if (b === 'shop' && !shopPrerequisitesMet(i))
      return '상점은 다른 모든 건물을 완공한 뒤 지을 수 있어요.';
  }
  return balance(i) < buildingCost(i, b) ? '섬 물고기 잔액이 부족해요.' : null;
}
// 상점은 도서관·전망대·우체통·축음기를 모두 완공한 뒤 고른다 (정책-결정-2026-09-14)
export const shopPrerequisitesMet = (i: Island) =>
  (['library', 'tower', 'mail', 'gram'] as Building[]).every((building) =>
    i.buildings.includes(building),
  );
export const joinRequests = (i: Island) => i.requests ?? [];
// 원장 한 줄 = 내용 + 금액(+적립, −사용). 금액은 문구 끝 "+N마리"/"−N마리"에만 있다
export const ledgerParts = (entry: { text: string }) => {
  const m = entry.text.match(/^(.*?)\s*([+−-])([\d,]+)마리\s*$/);
  return m
    ? { title: m[1], amount: (m[2] === '+' ? 1 : -1) * Number(m[3].replace(/,/g, '')) }
    : { title: entry.text, amount: 0 };
};
// 다음 건물 목표로 고를 수 없는 이유. 없으면 null (방장 여부는 reducer의 hostOnly가 따로 막는다)
export function canSelectBuilding(i: Island, b: Building): string | null {
  if (!['gram', 'library', 'mail', 'tower', 'shop'].includes(b)) return '고를 수 없는 건물이에요.';
  if (i.buildings.includes(b)) return '이미 완공한 건물이에요.';
  if (!i.buildings.includes('board')) return '게시판을 완공한 뒤 목표를 정할 수 있어요.';
  if (i.construction) return '공사가 끝난 뒤 다음 목표를 정할 수 있어요.';
  if (b === 'shop' && !shopPrerequisitesMet(i))
    return '상점은 다른 네 건물을 모두 완공한 뒤 목표로 정할 수 있어요.';
  if (i.buildingQuest?.building === b) return '이미 목표로 정한 건물이에요.';
  return null;
}
// 마지막 주민이 떠난 섬을 닫는다: 탐색·재가입에서 빼고 섬 공동 데이터와 그 섬 보상을 지운다.
// 개인 기록·보유품은 State 쪽에 남는다 (정책 GROMO-1843)
function closeIsland(s: State, i: Island) {
  Object.assign(i, {
    closed: true,
    visibility: 'private',
    // 이름·id는 기록 참조용으로 남기고 소개 글은 공동 데이터라 지운다
    intro: '',
    fish: 0,
    earned: {},
    ledger: [],
    // 강퇴·탈퇴 주민의 이름·색·기록도 섬 공동 데이터라 같이 지운다
    formerMembers: [],
    buildings: [],
    quests: [],
    notices: [],
    messages: [],
    sharedOwned: [],
    requests: [],
    theme: 'default',
    buildingTheme: 'default',
    buildingThemes: {},
    playing: false,
    // 구매한 공동 음원 선택도 공동 데이터라 기본 음원으로 되돌린다
    track: 'waves',
  });
  delete i.buildingQuest;
  delete i.construction;
  delete i.nextBuilding;
  s.rewards = (s.rewards ?? []).filter((r) => r.islandId !== i.id);
  // 그 섬의 공동 구매(섬·건물 테마·음원) 내역도 지운다. 옷·장신구는 개인 보유품이라 남긴다
  s.orders = s.orders.filter(
    (o) =>
      o.islandId !== i.id ||
      !['island', 'building', 'audio'].includes(
        products.find((p) => p.id === o.product)?.kind ?? '',
      ),
  );
  s.pendingIslands = (s.pendingIslands ?? []).filter((id) => id !== i.id);
  if (s.pendingIsland === i.id) s.pendingIsland = s.pendingIslands.at(-1) ?? null;
}

// 내 소속이 사라졌을 때의 공통 정리. 자진 탈퇴는 마지막 주민이면 섬도 닫지만,
// 강퇴는 방장이 남아 있으므로 내 소속과 개인 화면 컨텍스트만 정리한다.
function removeOwnMembership(s: State, island: Island, closeWhenEmpty: boolean) {
  const wasCurrent = s.islandId === island.id;
  island.joined = false;
  s.rewards = (s.rewards ?? []).filter((reward) => reward.islandId !== island.id);
  if (island.buildingQuest)
    island.buildingQuest.targets = island.buildingQuest.targets.filter((id) => id !== 'me');
  if (closeWhenEmpty && island.members.length === 0) closeIsland(s, island);

  const nextIsland = s.islands.find((candidate) => candidate.joined && !candidate.closed);
  s.onboarded = !!nextIsland;
  if (wasCurrent && nextIsland) s.islandId = nextIsland.id;
  if (s.mainIslandId === island.id) s.mainIslandId = nextIsland?.id ?? null;
  if (wasCurrent || s.visitingIslandId === island.id || !nextIsland) s.visitingIslandId = null;
  // 소속을 잃은 섬의 진행 중 집중은 서버에서도 강제 종료된다. 로컬 상태에 좀비 세션을 남기지 않는다.
  if (s.session?.islandId === island.id) s.session = null;
}
export function canBuy(s: State, p: Product): string | null {
  const i = currentIsland(s);
  if (!i.joined) return '이 섬 주민만 구매할 수 있어요.';
  if (p.kind === 'audio' ? !i.buildings.includes('gram') : !i.buildings.includes('shop'))
    return p.kind === 'audio' ? '축음기 완공 후 구매할 수 있어요.' : '상점이 아직 열리지 않았어요.';
  if ((p.kind === 'clothes' ? s.owned : i.sharedOwned).includes(p.id))
    return '이미 보유하고 있어요.';
  return balance(i) < p.price ? '섬 물고기 잔액이 부족해요.' : null;
}
// Period filtering is shared by the diary and ranking; no fabricated record values.
export function periodBounds(period: '일' | '주' | '월', offset: number, at = Date.now()) {
  const d = kstDate(at);
  d.setUTCHours(0, 0, 0, 0);
  if (period === '일') d.setUTCDate(d.getUTCDate() + offset);
  if (period === '주') {
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + offset * 7);
  }
  if (period === '월') {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + offset);
  }
  const from = d.getTime() - KST_OFFSET_MS;
  if (period === '일') d.setUTCDate(d.getUTCDate() + 1);
  if (period === '주') d.setUTCDate(d.getUTCDate() + 7);
  if (period === '월') d.setUTCMonth(d.getUTCMonth() + 1);
  return { from, until: d.getTime() - KST_OFFSET_MS };
}
function focusTotal(records: RecordItem[], islandId: string, day: string, q: QuestRound) {
  const from = kstDayStart(day),
    until = from + 86400000;
  const clock = (v: string) => {
    const [h, m] = v.split(':').map(Number);
    return from + (h * 60 + m) * 60000;
  };
  return records
    .filter((r) => r.islandId === islandId)
    .reduce(
      (n, r) =>
        n +
        (r.intervals ?? [{ start: r.at - r.seconds * 1000, end: r.at }]).reduce(
          (sum, t) =>
            sum +
            Math.max(
              0,
              Math.min(t.end, until, q.windowEnd ? clock(q.windowEnd) : until) -
                Math.max(t.start, from, q.windowStart ? clock(q.windowStart) : from),
            ) /
              1000,
          0,
        ),
      0,
    );
}
export function questMemberRate(
  s: State,
  q: Quest,
  id: string,
  islandId = s.islandId,
  now = Date.now(),
): number | null {
  const i = s.islands.find((i) => i.id === islandId)!;
  const member = memberOf(i, id);
  if (q.type === 'screen') {
    const v =
      id === 'me'
        ? s.settings.permission &&
          s.settings.screenTimeMeasurementReady &&
          !s.screenTimeUnconfirmedDays?.includes(dayKey(now))
          ? s.screenMinutes
          : null
        : member?.screenDays?.[dayKey(now)];
    return v == null ? null : v <= q.target ? 100 : Math.max(0, Math.floor((q.target / v) * 100));
  }
  const session = s.session?.islandId === islandId ? s.session : null;
  const live = session
    ? [
        {
          id: session.id,
          islandId,
          subject: session.subject,
          seconds: sessionSeconds(session, now),
          at: now,
          fish: 0,
          contributed: true,
          intervals: session.intervals
            ? [
                ...session.intervals,
                ...(session.status === 'active' ? [{ start: session.startedAt, end: now }] : []),
              ]
            : undefined,
        },
      ]
    : [];
  const records = id === 'me' ? [...s.records, ...live] : (member?.records ?? []);
  const round: QuestRound = {
    targets: [],
    achieved: [],
    claimed: [],
    bonus: false,
    target: q.target,
    kind: q.type,
    windowStart: q.windowStart,
    windowEnd: q.windowEnd,
  };
  return Math.min(
    100,
    Math.floor((focusTotal(records, islandId, dayKey(now), round) / (q.target * 60)) * 100),
  );
}
function ensureQuestRound(i: Island, q: Quest, day: string) {
  q.rounds ??= {};
  if (q.rounds[day]) return;
  if (
    (q.createdDay && day < q.createdDay) ||
    (i.joinedDay && day < i.joinedDay) ||
    (i.boardCompletedDay && day < i.boardCompletedDay)
  )
    return;
  q.rounds[day] ??= {
    targets: targetIds(i),
    achieved: [],
    claimed: [],
    bonus: false,
    target: q.target,
    kind: q.type,
    windowStart: q.windowStart,
    windowEnd: q.windowEnd,
  };
}

function evaluateQuests(s: State, now: number) {
  s.rewards ??= [];
  for (const i of s.islands.filter((i) => i.joined && i.buildings.includes('board')))
    for (const q of i.quests) {
      q.rounds ??= {};
      const today = dayKey(now);
      ensureQuestRound(i, q, today);
      for (const [day, round] of Object.entries(q.rounds)) {
        if (day > today) continue;
        if (round.kind === 'screen' && day < today && !s.settings.screenTimeHistoryReady) continue;
        if (round.kind === 'screen' && s.screenTimeUnconfirmedDays?.includes(day)) continue;
        for (const id of round.targets) {
          const member = memberOf(i, id);
          let achieved = round.achieved.includes(id);
          if (!achieved) {
            const live =
              s.session?.islandId === i.id
                ? [
                    {
                      id: s.session.id,
                      islandId: i.id,
                      subject: s.session.subject,
                      seconds: sessionSeconds(s.session, now),
                      at: now,
                      fish: 0,
                      contributed: true,
                      intervals: s.session.intervals
                        ? [
                            ...s.session.intervals,
                            ...(s.session.status === 'active'
                              ? [{ start: s.session.startedAt, end: now }]
                              : []),
                          ]
                        : undefined,
                    },
                  ]
                : [];
            const records = id === 'me' ? [...s.records, ...live] : (member?.records ?? []);
            const screen = id === 'me' ? s.screenDays?.[day] : member?.screenDays?.[day];
            achieved =
              round.kind === 'focus'
                ? focusTotal(records, i.id, day, round) >= round.target * 60
                : day < today && screen != null && screen <= round.target;
          }
          if (!achieved) continue;
          if (!round.achieved.includes(id)) round.achieved.push(id);
          if (id === 'me') {
            const rewardId = `${i.id}/${q.id}/${day}/me`;
            if (!round.claimed.includes(id) && !s.rewards.some((reward) => reward.id === rewardId))
              s.rewards.push({
                id: rewardId,
                islandId: i.id,
                questId: q.id,
                day,
                amount: 10,
                kind: 'personal',
                acknowledged: false,
              });
          } else {
            if (round.claimed.includes(id)) continue;
            round.claimed.push(id);
            i.fish = balance(i) + 10;
            i.earned ??= {};
            i.earned[id] = earnedBy(i, id) + 10;
            i.ledger.unshift({
              id: uuid(),
              text: `${member?.name ?? '주민'} 퀘스트 달성 보상 +10마리`,
              at: now,
              memberId: id,
            });
          }
        }
        if (
          !round.bonus &&
          round.targets.length &&
          round.targets.every((id) => round.achieved.includes(id))
        ) {
          round.bonus = true;
          i.fish = balance(i) + round.targets.length * 5;
          i.ledger.unshift({
            id: uuid(),
            text: `${q.title} · 모두 달성 보너스 +${round.targets.length * 5}마리`,
            at: now,
          });
          if (round.targets.includes('me'))
            s.rewards.push({
              id: `${i.id}/${q.id}/${day}/bonus`,
              islandId: i.id,
              questId: q.id,
              day,
              amount: round.targets.length * 5,
              kind: 'bonus',
              acknowledged: false,
            });
        }
      }
      q.claimed = q.rounds[today]?.claimed.includes('me') ?? false;
    }
}
export type Action = { type: string; [key: string]: any };
export function reducer(state: State, a: Action): State {
  if (a.type === 'RESET') return initialState(!!a.full);
  if (a.type === 'LOAD') {
    const loaded = JSON.parse(JSON.stringify(a.state)) as State;
    // 앱을 다시 켜면 구경을 끝내고 내 섬에서 시작한다
    delete loaded.visitingIslandId;
    const retired = ['flag', 'sailboat', 'cabinboat'];
    const loadedAt = a.now ?? Date.now();
    loaded.islands.forEach((i) => {
      i.formerMembers ??= [];
      // 채팅 읽음 기준이 없던 저장본은 지금까지의 글을 모두 읽은 것으로 본다
      i.chatReadAt ??= Math.max(loadedAt, ...i.messages.map((m) => m.at));
      // 예전 저장본: 가입 신청 목록이 없으면 빈 목록(가짜 새봄 신청을 띄우지 않는다)
      i.requests ??= [];
      const earliestRound = i.quests.flatMap((quest) => Object.keys(quest.rounds ?? {})).sort()[0];
      if (i.joined) i.joinedDay ??= earliestRound ?? dayKey(loadedAt);
      if (i.buildings.includes('board')) i.boardCompletedDay ??= earliestRound ?? dayKey(loadedAt);
      i.quests.forEach((quest) => {
        quest.createdDay ??= Object.keys(quest.rounds ?? {}).sort()[0] ?? dayKey(loadedAt);
      });
      // 예전 규칙(전망대·우체통만 선행)으로 고른 상점 목표는 지금 규칙에 안 맞으면 해제한다
      if (i.buildingQuest?.building === 'shop' && !i.construction && !shopPrerequisitesMet(i)) {
        delete i.buildingQuest;
        delete i.nextBuilding;
      }
      i.fish ??= i.points + i.contribution + (i.id === loaded.islandId ? loaded.fish : 0);
      i.earned ??= Object.fromEntries(
        targetIds(i).map((id) => [
          id,
          id === 'me'
            ? loaded.records.filter((r) => r.islandId === i.id).reduce((n, r) => n + r.fish, 0)
            : 0,
        ]),
      );
    });
    const pendingIslands =
      loaded.pendingIslands ?? (loaded.pendingIsland ? [loaded.pendingIsland] : []);
    const loadedMainIsland = loaded.islands.find(
      (island) => island.id === loaded.mainIslandId && island.joined && !island.closed,
    );
    const next: State = {
      ...loaded,
      schema: 2,
      fish: 0,
      friends: loaded.friends ?? [],
      rewards: loaded.rewards ?? [],
      screenDays: loaded.screenDays ?? {},
      screenTimeUnconfirmedDays: loaded.screenTimeUnconfirmedDays ?? [],
      profileNames: loaded.profileNames ?? [loaded.name],
      mainIslandId:
        loadedMainIsland?.id ??
        loaded.islands.find((island) => island.joined && !island.closed)?.id ??
        null,
      // 받은 편지 읽음 기준이 없던 저장본은 이미 받은 편지를 모두 읽은 것으로 본다
      lettersReadAt:
        loaded.lettersReadAt ??
        Math.max(loadedAt, ...(loaded.friends ?? []).flatMap((f) => f.messages.map((m) => m.at))),
      pendingIslands,
      pendingIsland: loaded.pendingIsland ?? pendingIslands.at(-1) ?? null,
      // 재실행 복구용 서버 온보딩 스냅샷 — 공개 요약·신청만 담겨 있어 저장해도 안전하다
      serverIslands: loaded.serverIslands ?? null,
      settings: {
        ...loaded.settings,
        publicRecords: true,
        screenTimeHistoryReady: loaded.settings.screenTimeHistoryReady ?? false,
      },
      equipped: {
        ...loaded.equipped,
        hull: 'raft',
        decor: 'none',
        position: 'front',
      },
      owned: loaded.owned.filter((id) => !retired.includes(id)),
      orders: loaded.orders.filter((o) => !retired.includes(o.product)),
    };
    // 예전 버전에서 닫힌 섬에 남아 있던 공동 데이터도 지금 규칙대로 정리한다(여러 번 해도 같다)
    next.islands.forEach((i) => i.closed && closeIsland(next, i));
    // 저장본·서버 동기화 결과가 onboarded 플래그보다 우선한다.
    const joined = next.islands.filter((island) => island.joined && !island.closed);
    next.onboarded = joined.length > 0;
    if (!joined.some((island) => island.id === next.islandId) && joined[0])
      next.islandId = joined[0].id;
    if (next.session && !joined.some((island) => island.id === next.session!.islandId))
      next.session = null;
    if (!next.onboarded) next.visitingIslandId = null;
    return next;
  }
  const hostOnly = [
    'MANAGE',
    'KICK',
    'TRANSFER',
    'ADD_MEMBER',
    'REJECT_MEMBER',
    'CAPACITY',
    'QUEST_SAVE',
    'NOTICE_SAVE',
    'NOTICE_DELETE',
    'SELECT_BUILDING',
    'BUILD',
  ];
  if (hostOnly.includes(a.type) && !isHost(currentIsland(state))) return state;
  const joinedOnly = [
    'FOCUS_SPOT',
    'START',
    'COMMENT',
    'MESSAGE',
    'RETRY_MESSAGE',
    'BUY',
    'TRACK',
    'THEME',
    'CLAIM_MEMBER',
    'COMMENT_DELETE',
    'CHAT_READ',
  ];
  if (joinedOnly.includes(a.type) && !currentIsland(state).joined) return state;
  // 구경 중에는 쓰기를 모두 막는다. 이 동작들은 내 현재 섬을 대상으로 하므로 구경하는 섬 화면에서 섞이면 안 된다
  if (state.visitingIslandId && (hostOnly.includes(a.type) || joinedOnly.includes(a.type)))
    return state;
  if (
    a.type === 'DELETE_ACCOUNT' &&
    state.islands.some((island) => isHost(island) && island.members.length > 0)
  )
    return state;
  const s = JSON.parse(JSON.stringify(state)) as State,
    i = currentIsland(s),
    now = a.now ?? Date.now();
  const log = (text: string, memberId = 'me') =>
    i.ledger.unshift({ id: uuid(), text, at: now, memberId });
  // 도메인별 구분선(GROMO-2004). 이 리듀서 하나에 여러 티켓이 동시에 붙는다 — 자기 도메인 구간
  // 안에만 case 를 더하면 서로의 머지 충돌이 줄어든다. 구간 순서는 바꾸지 않는다.
  switch (a.type) {
    // ── 인증·계정 ──
    case 'LOGIN':
      s.loggedIn = true;
      break;
    case 'PROFILE':
      if (a.name?.trim() && a.name.trim() !== s.name)
        s.profileNames = [...new Set([...(s.profileNames ?? [s.name]), s.name, a.name.trim()])];
      s.name = a.name?.trim() || s.name;
      s.color = a.color || s.color;
      break;
    // ── 섬 — 만들기·가입·이동 ──
    case 'CREATE_ISLAND': {
      const n = makeIsland(uuid(), a.name.trim() || '나의 섬', false, true);
      n.joined = true;
      n.joinedDay = dayKey(now);
      n.intro = a.intro || '';
      n.approval = !!a.approval;
      n.capacity = Math.min(
        CAPACITY_MAX,
        Math.max(CAPACITY_MIN, Math.round(a.capacity) || CAPACITY_MAX),
      );
      s.islands.push(n);
      s.islandId = n.id;
      s.mainIslandId ??= n.id;
      s.visitingIslandId = null;
      s.onboarded = true;
      break;
    }
    case 'CANCEL_JOIN': {
      const target = a.id ?? s.pendingIsland;
      s.pendingIslands = (s.pendingIslands ?? []).filter((id) => id !== target);
      s.pendingIsland = s.pendingIslands.at(-1) ?? null;
      break;
    }
    case 'JOIN': {
      if (s.session) return state;
      const island = s.islands.find((x) => x.id === a.id);
      if (!island || island.closed || island.kicked || (!island.joined && isFull(island)))
        return state;
      const wasJoined = island.joined;
      if (!island.joined && island.approval && !a.approved) {
        s.pendingIslands = [...new Set([...(s.pendingIslands ?? []), island.id])];
        s.pendingIsland = island.id;
        break;
      }
      s.travelOrigin = s.onboarded ? i.name : '나의 뗏목';
      island.joined = true;
      if (!wasJoined) island.joinedDay = dayKey(now);
      s.islandId = island.id;
      s.mainIslandId ??= island.id;
      // 구경하던 섬에 바로 가입하면 그 섬 주민이 되어 구경이 끝난다
      s.visitingIslandId = null;
      s.pendingIslands = (s.pendingIslands ?? []).filter((id) => id !== island.id);
      s.pendingIsland = s.pendingIslands.at(-1) ?? null;
      s.onboarded = true;
      break;
    }
    case 'TRAVEL_FROM':
      s.travelOrigin = a.name;
      break;
    case 'VISIT':
      if (!canVisit(state, a.id)) return state;
      s.visitingIslandId = a.id;
      break;
    case 'END_VISIT':
      s.visitingIslandId = null;
      break;
    case 'SWITCH_ISLAND': {
      if (s.session) return state;
      const target = s.islands.find((x) => x.id === a.id);
      if (!target?.joined || (!i.buildings.includes('tower') && s.onboarded && target.id !== i.id))
        return state;
      s.islandId = target.id;
      s.visitingIslandId = null;
      break;
    }
    case 'MAIN_ISLAND': {
      const target = s.islands.find((island) => island.id === a.id);
      if (!target?.joined || target.closed || target.id === state.mainIslandId) return state;
      s.mainIslandId = target.id;
      break;
    }
    // ── 섬 — 서버 동기화(GROMO-2006) ──
    // 서버 응답만 serverIslands 스냅샷에 반영한다. CREATE_ISLAND·JOIN·CANCEL_JOIN 의
    // 로컬 성공 경로는 REVIEW·DEMO fixture 용이며 일반 실행의 성공 경로에서 부르지 않는다.
    case 'ISLAND_SYNC': {
      // /me/islands 정본 — 소속·current·상실 사유를 갈아 끼우고 로컬 joined 표시를 맞춘다
      const my = a.memberships as MyIslands,
        snap = serverSnap(s);
      snap.memberships = my.items;
      snap.currentIslandId = my.currentIslandId;
      snap.lossReason = my.lossReason;
      if (a.requests) {
        const terminalIds = new Set(
          snap.requestStatus
            .filter((request) => request.status !== 'pending')
            .map((request) => request.id),
        );
        snap.joinRequests = (a.requests as MyJoinRequest[]).filter(
          (request) => !terminalIds.has(request.id),
        );
      }
      const ids = new Set(my.items.map((x) => x.id));
      for (const island of s.islands)
        if (island.joined && !ids.has(island.id)) island.joined = false;
      if (s.session && !ids.has(s.session.islandId)) s.session = null;
      if (s.visitingIslandId && !ids.has(s.visitingIslandId)) s.visitingIslandId = null;
      // current가 null인데 items만 있으면 소속을 단정하지 않는다 — fail closed
      s.onboarded = my.currentIslandId != null;
      break;
    }
    case 'ISLAND_CANDIDATES': {
      // 발견 페이지 반영 — reset이면 새 filter의 첫 페이지로 갈아 끼운다
      const snap = serverSnap(s),
        items = a.items as IslandSummary[];
      snap.candidates = a.reset
        ? items
        : [...snap.candidates, ...items.filter((x) => !snap.candidates.some((c) => c.id === x.id))];
      snap.nextCursor = a.nextCursor ?? null;
      break;
    }
    case 'ISLAND_VISIT':
      serverSnap(s).visit = a.visit as VisitScreen;
      break;
    case 'ISLAND_REQUEST': {
      // 단건 상태는 표시 필드가 없다 — requestStatus에만 두고, 목록에 있는 항목은 status/version만 갱신한다.
      // 종결돼도 /me/join-requests 재조회 전까지는 상태가 남아 approval 화면이 결과를 보여줄 수 있다.
      const r = a.request as RequestStatusEntry,
        snap = serverSnap(s),
        prev =
          snap.requestStatus.find((x) => x.id === r.id) ??
          snap.joinRequests.find((x) => x.id === r.id);
      if (
        prev &&
        ((prev.status !== 'pending' && r.status === 'pending') ||
          (prev.version != null && r.version != null && r.version < prev.version))
      )
        break;
      // 서버가 안 준 필드(version 등)는 기존 값을 유지한다 — 합성하지 않는다
      snap.requestStatus = [...snap.requestStatus.filter((x) => x.id !== r.id), { ...prev, ...r }];
      snap.joinRequests = snap.joinRequests.map((x) =>
        x.id === r.id
          ? { ...x, status: r.status, ...(r.version != null ? { version: r.version } : {}) }
          : x,
      );
      break;
    }
    case 'ISLAND_SYNC_REQUESTS': {
      // 신청 목록 재조회 — pending만 오는 서버 목록으로 통째로 갈아 끼운다
      const snap = serverSnap(s);
      const terminalIds = new Set(
        snap.requestStatus
          .filter((request) => request.status !== 'pending')
          .map((request) => request.id),
      );
      snap.joinRequests = (a.requests as MyJoinRequest[]).filter(
        (request) => !terminalIds.has(request.id),
      );
      break;
    }
    // ── 집중 세션 ──
    case 'FOCUS_SPOT':
      if (s.session) return state;
      s.focusSpot = a.spot;
      break;
    case 'START':
      if (s.session || !i.joined) return state;
      s.session = {
        id: uuid(),
        islandId: s.islandId,
        subject: a.subject.trim() || '집중',
        startedAt: now,
        seconds: 0,
        status: 'active',
        intervals: [],
      };
      break;
    case 'PAUSE':
      if (s.session?.status === 'active') {
        s.session.intervals ??= [];
        s.session.intervals.push({ start: s.session.startedAt, end: now });
        s.session.seconds = sessionSeconds(s.session, now);
        s.session.status = 'paused';
        s.session.restStartedAt = now;
      }
      break;
    case 'RESUME':
      if (s.session?.status === 'paused') {
        s.session.startedAt = now;
        s.session.status = 'active';
        delete s.session.restStartedAt;
      }
      break;
    case 'ADVANCE':
      if (s.session?.status === 'active') s.session.seconds += a.seconds;
      break;
    case 'FINISH': {
      if (!s.session) return state;
      const seconds = Math.floor(sessionSeconds(s.session, now)),
        fish = Math.floor(seconds / SECONDS_PER_FISH),
        island = s.islands.find((x) => x.id === s.session!.islandId)!;
      const contributed = true;
      const record = {
        id: s.session.id,
        islandId: island.id,
        subject: s.session.subject,
        seconds,
        at: now,
        fish,
        contributed,
        intervals: s.session.intervals
          ? [
              ...s.session.intervals,
              ...(s.session.status === 'active' ? [{ start: s.session.startedAt, end: now }] : []),
            ]
          : undefined,
      };
      if (s.records.some((r) => r.id === record.id)) return state;
      // 첫 집중을 마쳤는데 회관이 없으면, 홈으로 돌아왔을 때 회관 안내를 한 번 띄운다
      if (!s.records.length && !s.hallGuide && !island.buildings.includes('hall'))
        s.hallGuide = 'pending';
      s.records.unshift(record);
      s.lastResult = record;
      const uncredited = fish - (s.session.creditedFish ?? 0);
      island.fish = balance(island) + uncredited;
      island.earned ??= {};
      island.earned.me = earnedBy(island, 'me') + uncredited;
      // 1분 미만 집중(적립 0마리)은 가계부에 남기지 않는다
      if (uncredited > 0)
        island.ledger.unshift({
          id: uuid(),
          text: `${s.name} · 집중 +${uncredited}마리`,
          at: now,
          memberId: 'me',
        });
      s.resultFromRest = s.session.status === 'paused';
      s.session = null;
      break;
    }
    case 'SESSION_SYNC':
      // 서버 current 정본으로 진행 세션을 갈아 끼운다(GROMO-2009). null 이면 지운다 —
      // 서버에 없는 진행 세션은 이미 끝난 것이다.
      s.session = (a.session as Session | null) ?? null;
      break;
    case 'SESSION_RESULT': {
      // 서버 finish·pending-result 의 정산 뷰를 기록+결과창으로 반영하고 진행 세션을 닫는다.
      // earnedFish 는 서버가 이미 섬 통장에 적립한 확정값 — 로컬 잔액 표시만 맞춘다.
      const record = a.record as RecordItem;
      if (!s.records.some((r) => r.id === record.id)) s.records.unshift(record);
      s.lastResult = record;
      const owner = s.islands.find((x) => x.id === record.islandId);
      if (!s.records.slice(1).length && !s.hallGuide && owner && !owner.buildings.includes('hall'))
        s.hallGuide = 'pending';
      if (owner && record.fish > 0) {
        owner.fish = balance(owner) + record.fish;
        owner.earned ??= {};
        owner.earned.me = earnedBy(owner, 'me') + record.fish;
        owner.ledger.unshift({
          id: uuid(),
          text: `${s.name} · 집중 +${record.fish}마리`,
          at: record.at,
          memberId: 'me',
        });
      }
      s.resultFromRest = a.fromRest === true;
      s.session = null;
      break;
    }
    case 'RESULT_ACK':
      // 결과 확인(acknowledge) 성공 — 같은 결과를 다시 확인하지 않게 표시를 지운다.
      if (s.lastResult && s.lastResult.ackId === a.id) delete s.lastResult.ackId;
      break;
    // ── 건물 공사·퀘스트 ──
    case 'SELECT_BUILDING': {
      const b = a.building as Building;
      if (canSelectBuilding(i, b)) return state;
      const targets = targetIds(i);
      const prevQuest = i.buildingQuest;
      const base: Record<string, number> = {};
      // 목표 변경 시 이어서 셈 — 추가 결정 필요: 계속 대상인 주민은 이전 스냅숏을 유지하고,
      // 새로 대상에 들어온 주민만 지금 시점 earned로 새로 스냅숏한다
      for (const id of targets)
        base[id] =
          prevQuest && prevQuest.targets.includes(id)
            ? (prevQuest.base?.[id] ?? 0)
            : earnedBy(i, id);
      i.buildingQuest = { building: b, targets, selectedAt: now, base };
      i.nextBuilding = b;
      delete i.completed;
      break;
    }
    case 'BUILD': {
      const b = a.building as Building;
      if (!buildingOrder.includes(b) || canBuild(s, b)) return state;
      const cost = buildingCost(i, b);
      i.fish = balance(i) - cost;
      i.construction = {
        building: b,
        startedAt: now,
        endsAt: now + buildMinutes[b] * 60000,
        cost,
      };
      log(`${buildingNames[b]} 공사 시작 −${cost}마리`);
      break;
    }
    case 'TICK': {
      // 섬 잔액은 집중이 끝날 때(FINISH) 한 번에 오른다 — 낚시하는 동안에는 오르지 않는다(FOCUS-ISLAND.md 2026-09-17)
      for (const island of s.islands)
        if (island.construction && now >= island.construction.endsAt) {
          const b = island.construction.building;
          if (!island.buildings.includes(b)) island.buildings.push(b);
          if (b === 'board') island.boardCompletedDay ??= dayKey(island.construction.endsAt);
          delete island.construction;
          delete island.buildingQuest;
          delete island.nextBuilding;
          if (nextBuildings.includes(b)) island.completed = { building: b, at: now };
          island.ledger.unshift({
            id: uuid(),
            text: `${buildingNames[b]} 완공`,
            at: now,
          });
        }
      if (
        s.settings.permission &&
        s.settings.screenTimeMeasurementReady &&
        !s.screenTimeUnconfirmedDays?.includes(dayKey(now))
      ) {
        s.screenDays ??= {};
        s.screenDays[dayKey(now)] = s.screenMinutes;
      } else {
        s.screenDays ??= {};
        s.screenDays[dayKey(now)] = null;
      }
      evaluateQuests(s, now);
      return JSON.stringify(s) === JSON.stringify(state) ? state : s;
    }
    case 'CLAIM': {
      const reward = s.rewards?.find(
        (r) => r.id === a.id || (r.questId === a.id && r.kind === 'personal' && !r.acknowledged),
      );
      if (!reward || reward.acknowledged) return state;
      const owner = s.islands.find((x) => x.id === reward.islandId)!;
      // 닫힌(삭제된) 섬의 보상은 잔액·원장에 쓰지 않고 받은 것으로만 처리해 보상 창을 닫는다
      if (reward.kind === 'personal' && !owner.closed) {
        owner.fish = balance(owner) + reward.amount;
        owner.earned ??= {};
        owner.earned.me = earnedBy(owner, 'me') + reward.amount;
        owner.quests.find((q) => q.id === reward.questId)?.rounds?.[reward.day]?.claimed.push('me');
        owner.ledger.unshift({
          id: uuid(),
          text: `퀘스트 달성 보상 +${reward.amount}마리`,
          at: now,
          memberId: 'me',
        });
      }
      reward.acknowledged = true;
      break;
    }
    case 'CLAIM_MEMBER': {
      const q = i.quests.find((q) => q.id === a.id),
        round = q?.rounds?.[a.day];
      if (!round || !round.achieved.includes(a.memberId) || round.claimed.includes(a.memberId))
        return state;
      round.claimed.push(a.memberId);
      i.fish = balance(i) + 10;
      i.earned ??= {};
      i.earned[a.memberId] = earnedBy(i, a.memberId) + 10;
      log('주민 퀘스트 달성 보상 +10마리', a.memberId);
      break;
    }
    case 'QUEST_SAVE': {
      // 일일 퀘스트: 방장이 만들고 수정한다(주민은 hostOnly에서 막힌다). 매일 새 회차로 평가한다
      if (!Number.isInteger(a.target) || a.target < 1 || !a.title?.trim()) return state;
      if (a.kind === 'focus') {
        const start = clockMinutes(a.windowStart),
          end = clockMinutes(a.windowEnd);
        // 시간대 집중은 시작 < 종료이고 목표 분이 그 시간 안이어야 한다
        if (start == null || end == null || end <= start || a.target > end - start) return state;
      }
      const title = a.title.trim(),
        // 시간대는 언제나 HH:MM으로 저장한다 (웹 time 입력이 "9:00"을 못 읽는다)
        windowStart = a.kind === 'focus' ? clockText(a.windowStart) : undefined,
        windowEnd = a.kind === 'focus' ? clockText(a.windowEnd) : undefined;
      const q = a.id ? i.quests.find((x) => x.id === a.id) : undefined;
      if (a.id && !q) return state;
      if (q) {
        q.title = title;
        q.type = a.kind;
        q.target = a.target;
        q.windowStart = windowStart;
        q.windowEnd = windowEnd;
        // 오늘 회차는 대상(targets) 스냅숏을 그대로 두고 기준만 바꿔 바로 다시 평가한다
        const round = q.rounds?.[dayKey(now)];
        if (round) {
          round.kind = a.kind;
          round.target = a.target;
          round.windowStart = windowStart;
          round.windowEnd = windowEnd;
          // 이미 지급된 보상은 보존하되, 미수령 달성은 새 기준으로 다시 판정한다.
          const claimed = new Set(round.claimed);
          round.achieved = round.achieved.filter((id) => claimed.has(id));
          s.rewards = (s.rewards ?? []).filter(
            (reward) =>
              reward.acknowledged ||
              reward.kind !== 'personal' ||
              reward.islandId !== i.id ||
              reward.questId !== q.id ||
              reward.day !== dayKey(now),
          );
        }
      } else
        i.quests.push({
          id: uuid(),
          title,
          type: a.kind,
          target: a.target,
          windowStart,
          windowEnd,
          claimed: false,
          createdDay: dayKey(now),
        });
      break;
    }
    // ── 게시판·공지·댓글 ──
    case 'NOTICE_SAVE': {
      // 제목·본문은 공백만 있으면 저장하지 않는다
      if (!a.title?.trim() || !a.body?.trim()) return state;
      const title = a.title.trim(),
        body = a.body.trim();
      const n = i.notices.find((x) => x.id === a.id);
      if (n) {
        n.title = title;
        n.body = body;
      } else
        i.notices.unshift({
          id: uuid(),
          title,
          body,
          author: s.name,
          authorId: 'me',
          at: now,
          comments: [],
        });
      break;
    }
    case 'NOTICE_DELETE':
      i.notices = i.notices.filter((n) => n.id !== a.id);
      break;
    case 'COMMENT': {
      const n = i.notices.find((x) => x.id === a.id);
      if (n && a.text.trim())
        n.comments.push({
          id: uuid(),
          name: s.name,
          memberId: 'me',
          text: a.text.trim(),
          at: now,
        });
      break;
    }
    case 'COMMENT_DELETE': {
      const n = i.notices.find((x) => x.id === a.id),
        c = n?.comments.find((x) => x.id === a.commentId);
      // 방장은 모든 댓글을, 주민은 자기 댓글만 지운다
      if (!n || !c || (!isHost(i) && !isOwnComment(s, c))) return state;
      n.comments = n.comments.filter((x) => x !== c);
      break;
    }
    // ── 채팅 ──
    case 'CHAT_READ':
      // 읽음 기준은 뒤로 가지 않는다 — LOAD가 미래 시각 메시지까지 읽은 것으로 올려 둔 값을 지키기 위해.
      // 방을 연 채 도착한 시계 오차(미래 시각) 메시지도 이미 본 것이므로 기준에 넣는다
      i.chatReadAt = Math.max(
        i.chatReadAt ?? 0,
        now,
        ...i.messages.filter((m) => m.memberId !== 'me').map((m) => m.at),
      );
      break;
    case 'MESSAGE':
      if (a.text.trim())
        i.messages.push({
          id: uuid(),
          memberId: 'me',
          name: s.name,
          color: s.color,
          text: a.text.trim(),
          at: now,
          status: a.fail ? 'failed' : 'sent',
        });
      break;
    case 'RETRY_MESSAGE': {
      const m = i.messages.find((m) => m.id === a.id);
      if (m) m.status = 'sent';
      break;
    }
    // ── 상점·꾸미기 ──
    case 'BUY': {
      const p = products.find((x) => x.id === a.id);
      if (!p || canBuy(s, p)) return state;
      i.fish = balance(i) - p.price;
      if (p.kind === 'clothes') s.owned.push(p.id);
      else i.sharedOwned.push(p.id);
      log(`${p.title} 구매 −${p.price}마리`);
      s.orders.unshift({
        id: uuid(),
        product: p.id,
        islandId: i.id,
        currency: 'fish',
        price: p.price,
        at: now,
        buyer: s.name,
      });
      break;
    }
    case 'EQUIP': {
      if (a.key !== 'clothes') return state;
      const value = a.value;
      if (!['default', 'none', 'raft'].includes(value) && !s.owned.includes(value)) return state;
      s.equipped[a.key as keyof State['equipped']] = value;
      break;
    }
    case 'DECOR_POSITION':
      return state;
    case 'THEME':
      if (a.value === 'default' || i.sharedOwned.includes(a.value)) {
        if (a.kind === 'building') {
          i.buildingThemes ??= {};
          i.buildingThemes[a.building || 'hall'] = a.value;
          i.buildingTheme = Object.values(i.buildingThemes).some((v) => v !== 'default')
            ? 'custom'
            : 'default';
        } else i.theme = a.value;
      }
      break;
    // ── 설정·화면시간 ──
    case 'TRACK':
      if (i.buildings.includes('gram') && i.sharedOwned.includes(a.value)) {
        i.track = a.value;
        i.playing = true;
      }
      break;
    case 'PLAY':
      if (i.buildings.includes('gram') && (!a.value || i.sharedOwned.includes(i.track)))
        i.playing = !!a.value;
      break;
    case 'SETTING':
      (s.settings as any)[a.key] = a.value;
      break;
    // ── 섬 관리 (방장) ──
    case 'MANAGE':
      i.name = a.name?.trim() || i.name;
      i.intro = a.intro ?? i.intro;
      i.approval = a.approval ?? i.approval;
      break;
    case 'KICK': {
      const kicked = i.members.find((m) => m.id === a.id);
      if (!kicked) return state;
      i.formerMembers ??= [];
      i.formerMembers = [
        ...i.formerMembers.filter((member) => member.id !== kicked.id),
        { ...kicked, focusing: false, restStartedAt: undefined, role: 'member' },
      ];
      i.members = i.members.filter((m) => m.id !== a.id);
      if (i.buildingQuest)
        i.buildingQuest.targets = i.buildingQuest.targets.filter((id) => id !== a.id);
      break;
    }
    case 'REJECT_MEMBER':
      // id가 없으면(예전 화면) 남은 신청을 모두 거절한다
      i.requests = a.id ? joinRequests(i).filter((r) => r.id !== a.id) : [];
      i.requestResolved = !i.requests.length;
      break;
    case 'CAPACITY': {
      const v = Math.round(a.value);
      if (!(v <= CAPACITY_MAX) || v < Math.max(CAPACITY_MIN, residentCount(i))) return state;
      i.capacity = v;
      break;
    }
    case 'MAILBOX_GUIDE_DONE':
      if (typeof a.userId !== 'string' || !shouldShowMailboxGuide(s, a.userId)) return state;
      s.mailboxGuideSeenBy = [...(s.mailboxGuideSeenBy ?? []), a.userId];
      break;
    case 'HALL_GUIDE_DONE':
      s.hallGuide = 'done';
      break;
    case 'ADD_MEMBER': {
      const request = joinRequests(i).find((r) => !a.id || r.id === a.id);
      if (!request || isFull(i)) return state;
      i.requests = joinRequests(i).filter((r) => r.id !== request.id);
      i.requestResolved = !i.requests.length;
      // 강퇴·탈퇴로 떠났던 주민이 다시 들어오면 그때 기록을 이어받고 떠난 주민 목록에서 뺀다
      i.formerMembers ??= [];
      const former = i.formerMembers.find((m) => m.id === request.id);
      i.formerMembers = i.formerMembers.filter((m) => m.id !== request.id);
      i.members.push({
        ...(former ?? {}),
        id: i.members.some((m) => m.id === request.id) ? uuid() : request.id,
        name: request.name,
        color: request.color,
        subject: former?.subject ?? '독서 과제',
        seconds: former?.seconds ?? 0,
        focusing: false,
        restStartedAt: undefined,
        role: 'member',
      });
      break;
    }
    case 'TRANSFER':
      if (!i.members.some((m) => m.id === a.id)) return state;
      i.members.forEach((m) => (m.role = m.id === a.id ? 'host' : 'member'));
      break;
    case 'LEAVE':
      if (s.session || (isHost(i) && i.members.length > 0)) return state;
      removeOwnMembership(s, i, true);
      break;
    case 'KICKED_FROM_ISLAND': {
      const kickedIsland = s.islands.find((island) => island.id === a.id);
      if (!kickedIsland?.joined) return state;
      const shouldResetScreen =
        s.islandId === kickedIsland.id ||
        s.session?.islandId === kickedIsland.id ||
        s.visitingIslandId === kickedIsland.id;
      kickedIsland.kicked = true;
      removeOwnMembership(s, kickedIsland, false);
      if (shouldResetScreen) s.membershipRecovery = { reason: 'kicked', islandId: kickedIsland.id };
      break;
    }
    case 'MEMBERSHIP_RECOVERY_HANDLED': {
      delete s.membershipRecovery;
      break;
    }
    case 'SCREEN_TIME':
      s.screenMinutes = Math.max(0, a.value);
      break;
    case 'SCREEN_TIME_DAY':
      s.screenDays ??= {};
      if (s.screenTimeUnconfirmedDays?.includes(a.day)) break;
      s.screenDays[a.day] = Math.max(0, a.value);
      for (const island of s.islands.filter(
        (candidate) => candidate.joined && candidate.buildings.includes('board'),
      ))
        for (const quest of island.quests) ensureQuestRound(island, quest, a.day);
      evaluateQuests(s, now);
      break;
    case 'SCREEN_TIME_HISTORY':
      s.screenDays ??= {};
      for (const bucket of a.buckets ?? []) {
        if (s.screenTimeUnconfirmedDays?.includes(bucket.date)) continue;
        s.screenDays[bucket.date] = Math.max(0, bucket.minutes);
        for (const island of s.islands.filter(
          (candidate) => candidate.joined && candidate.buildings.includes('board'),
        ))
          for (const quest of island.quests) ensureQuestRound(island, quest, bucket.date);
      }
      s.settings.screenTimeHistoryReady = true;
      evaluateQuests(s, now);
      break;
    case 'SCREEN_TIME_UNCONFIRMED':
      s.screenDays ??= {};
      s.screenTimeUnconfirmedDays = [
        ...new Set([...(s.screenTimeUnconfirmedDays ?? []), ...(a.days ?? [])]),
      ].sort();
      s.screenTimeUnconfirmedDays.forEach((day) => {
        s.screenDays![day] = null;
      });
      break;
    // ── 인증 — 로그아웃 ──
    case 'LOGOUT':
      s.loggedIn = false;
      // 서버 온보딩 스냅샷도 계정과 함께 버린다 — A 계정의 orphan 신청이 B 계정에 섞이지 않게
      s.serverIslands = null;
      break;
    // ── 친구·편지 ──
    case 'FRIEND_REQUEST': {
      s.friends ??= [];
      const f = s.friends.find((f) => f.id === a.id);
      if (f && f.status !== 'none') return state;
      if (f) f.status = 'sent';
      else if (a.friend && a.friend.id !== 'me')
        s.friends.push({ ...a.friend, status: 'sent', messages: [] });
      break;
    }
    case 'FRIEND_ACCEPT':
    case 'FRIEND_REJECT':
    case 'FRIEND_CANCEL':
    case 'FRIEND_DELETE': {
      const f = s.friends?.find((f) => f.id === a.id);
      if (!f) return state;
      if (a.type === 'FRIEND_ACCEPT' && f.status === 'received') f.status = 'friend';
      else if (
        (a.type === 'FRIEND_REJECT' && f.status === 'received') ||
        (a.type === 'FRIEND_CANCEL' && f.status === 'sent') ||
        (a.type === 'FRIEND_DELETE' && f.status === 'friend')
      ) {
        f.status = 'none';
        // 친구를 삭제하면 아직 확인하지 않은 편지도 지운다(정책)
        if (a.type === 'FRIEND_DELETE') f.messages = [];
      } else return state;
      break;
    }
    case 'FRIEND_MESSAGE': {
      const f = s.friends?.find((f) => f.id === a.id);
      if (!f || !canSendLetter(state, a.id) || !a.text.trim()) return state;
      f.messages.push({
        id: uuid(),
        memberId: 'me',
        name: s.name,
        color: s.color,
        text: a.text.trim(),
        at: now,
        status: a.fail ? 'failed' : 'sent',
      });
      break;
    }
    case 'LETTER_READ': {
      const m = s.friends
        ?.find((f) => f.id === a.friend)
        ?.messages.find((x) => x.id === a.id && x.memberId !== 'me');
      if (!m || m.readAt) return state;
      m.readAt = now;
      break;
    }
    case 'FRIEND_RETRY': {
      const f = s.friends?.find((f) => f.id === a.friend);
      const m = f?.messages.find((m) => m.id === a.id);
      if (!m || f?.status !== 'friend') return state;
      m.status = 'sent';
      break;
    }
    // ── 계정 — 탈퇴 ──
    case 'DELETE_ACCOUNT': {
      const clean = initialState();
      const profileNames = new Set([s.name, ...(s.profileNames ?? [])]);
      const isOwnLegacyLedger = (text: string) =>
        [...profileNames].some((name) =>
          [`${name} · 집중 `, `${name} 집중 보상`].some((prefix) => text.startsWith(prefix)),
        );
      clean.islands = s.islands.map((i) => ({
        ...i,
        kicked: undefined,
        joined: false,
        earned: Object.fromEntries(Object.entries(i.earned ?? {}).filter(([id]) => id !== 'me')),
        ledger: i.ledger.filter(
          (entry) =>
            entry.memberId !== 'me' && (entry.memberId != null || !isOwnLegacyLedger(entry.text)),
        ),
        notices: i.notices
          .filter(
            (notice) =>
              notice.authorId !== 'me' &&
              (notice.authorId != null || !notice.author || !profileNames.has(notice.author)),
          )
          .map((notice) => ({
            ...notice,
            comments: notice.comments.filter(
              (comment) =>
                comment.memberId !== 'me' &&
                (comment.memberId != null || !profileNames.has(comment.name)),
            ),
          })),
        messages: i.messages.filter((m) => m.memberId !== 'me'),
        quests: i.quests.map((quest) => ({
          ...quest,
          rounds: quest.rounds
            ? Object.fromEntries(
                Object.entries(quest.rounds).map(([day, round]) => [
                  day,
                  {
                    ...round,
                    targets: round.targets.filter((id) => id !== 'me'),
                    achieved: round.achieved.filter((id) => id !== 'me'),
                    claimed: round.claimed.filter((id) => id !== 'me'),
                  },
                ]),
              )
            : undefined,
        })),
        buildingQuest: i.buildingQuest
          ? {
              ...i.buildingQuest,
              targets: i.buildingQuest.targets.filter((id) => id !== 'me'),
              base: i.buildingQuest.base
                ? Object.fromEntries(
                    Object.entries(i.buildingQuest.base).filter(([id]) => id !== 'me'),
                  )
                : undefined,
            }
          : undefined,
      }));
      // 내가 마지막 주민이던 섬은 탈퇴(LEAVE)와 똑같이 닫는다
      s.islands.forEach((i, n) => {
        if (i.joined && i.members.length === 0) closeIsland(clean, clean.islands[n]);
      });
      return clean;
    }
    // ── QA·데모 전용 ──
    case 'QA_COMPLETE_ALL_BUILDINGS':
      if (!s.onboarded) return state;
      completeAllBuildings(i, now);
      break;
    case 'DEMO_CREDIT':
      i.fish = balance(i) + (a.fish || 0) + (a.points || 0) + (a.contribution || 0);
      i.earned ??= {};
      i.earned.me = earnedBy(i, 'me') + (a.earned || a.fish || 0);
      break;
    default:
      return state;
  }
  if (['FINISH', 'QUEST_SAVE', 'SCREEN_TIME', 'SCREEN_TIME_DAY'].includes(a.type))
    evaluateQuests(s, now);
  return s;
}
