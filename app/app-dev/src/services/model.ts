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
  | 'travel'
  | 'mail'
  | 'shop'
  | 'product'
  | 'orders'
  | 'boat'
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
  | 'focusTravel'
  | 'returnTravel'
  | 'permission'
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
  at?: number;
  comments: { id: string; name: string; text: string; at?: number }[];
};
export type Message = {
  id: string;
  memberId: string;
  name: string;
  color: Color;
  text: string;
  at: number;
  status: 'sent' | 'failed';
};
export type Island = {
  visibility?: 'public' | 'private';
  id: string;
  name: string;
  intro: string;
  approval: boolean;
  // 정원(1~15명). 예전 저장본에는 없어서 capacityOf로 읽는다
  capacity?: number;
  requestResolved?: boolean;
  joined: boolean;
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
  quests: Quest[];
  notices: Notice[];
  messages: Message[];
  sharedOwned: string[];
  theme: string;
  buildingTheme: string;
  buildingThemes?: Record<string, string>;
  track: string;
  playing: boolean;
  ledger: { id: string; text: string; at: number }[];
};
export type Session = {
  id: string;
  islandId: string;
  subject: string;
  startedAt: number;
  restStartedAt?: number;
  seconds: number;
  status: 'active' | 'paused';
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
  focusSpot?: { x: number; y: number };
  resultFromRest?: boolean;
  loggedIn: boolean;
  onboarded: boolean;
  name: string;
  color: Color;
  islandId: string;
  fish: number;
  owned: string[];
  equipped: { clothes: string; decor: string; hull: string; position: string };
  settings: {
    notifications: boolean;
    sound: boolean;
    reduceMotion: boolean;
    publicRecords: boolean;
    permission: boolean;
    haptics: boolean;
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
  travelOrigin?: string;
  // 첫 집중 후 마을회관 안내(20b). 없으면(예전 저장본 포함) 띄우지 않는다
  hallGuide?: 'pending' | 'done';
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
export const dayKey = (at = Date.now()) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    title: '오두막의 빗소리',
    kind: 'audio',
    price: 150,
    currency: 'fish',
    description:
      '창가에 톡톡 떨어지는 빗방울을 함께 들어요. 축음기에서 섬 전체가 같이 들을 수 있어요.',
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
  return {
    id,
    name,
    intro: '각자의 공부를 함께해요.',
    approval: false,
    capacity: 15,
    joined: full && id === 'soda',
    visibility: 'public',
    buildings: full ? [...buildingOrder] : [],
    points: 0,
    contribution: 0,
    fish: full ? 1200 : 0,
    earned: full ? { me: 320, minji: 260, dubu: 200, sua: 165 } : {},
    members: (solo ? [] : peers()).map((m) => ({
      ...m,
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
    quests: [
      {
        id: 'q-focus',
        title: '오늘 30분 집중하기',
        type: 'focus',
        target: 30,
        claimed: false,
      },
      {
        id: 'q-screen',
        title: '오늘 폰 사용 2시간 이내',
        type: 'screen',
        target: 120,
        claimed: false,
      },
    ],
    notices: [
      {
        id: 'welcome',
        title: '우리 섬에 온 걸 환영해요',
        body: '혼자 집중해도, 함께 집중해도 좋아요. 각자 할 일을 정하고 낚시하러 나가요.',
        at: Date.now() - 86400000,
        comments: [
          {
            id: 'c1',
            name: '민지',
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
        at: Date.now() - 6 * 86400000,
        comments: [
          {
            id: 'c2',
            name: '민지',
            text: '좋아요, 저는 하루 한 시간!',
            at: Date.now() - 5 * 86400000,
          },
          {
            id: 'c3',
            name: '두부',
            text: '주말에 몰아서 채울게요.',
            at: Date.now() - 5 * 86400000,
          },
          {
            id: 'c4',
            name: '수아',
            text: '같이 해요!',
            at: Date.now() - 4 * 86400000,
          },
        ],
      },
    ],
    messages: [
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
    color: 'black',
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
      reduceMotion: false,
      publicRecords: true,
      permission: true,
      haptics: true,
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
    lastResult: null,
    pendingIsland: null,
  };
}
export const currentIsland = (s: State) => s.islands.find((i) => i.id === s.islandId)!;
export const CAPACITY_MIN = 1,
  CAPACITY_MAX = 15;
// 주민 수 = 다른 주민 + (내가 가입했으면) 나
export const residentCount = (i: Island) => i.members.length + (i.joined ? 1 : 0);
export const capacityOf = (i: Island) => i.capacity ?? CAPACITY_MAX;
export const isFull = (i: Island) => residentCount(i) >= capacityOf(i);
export const inviteCodeOf = (i: Island) => i.id.toUpperCase();
export const findIslandByInviteCode = (islands: Island[], code: string) =>
  islands.find((i) => inviteCodeOf(i) === code.trim().toUpperCase());
// 이번 주 시작 = 로컬 기준 일요일 00:00
export function weekStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}
// 섬 평균 집중(초) = 이번 주 그 섬에서 집중한 시간 합계 ÷ 그 섬 주민 수
// 모든 주민의 기록을 같은 섬·같은 주간 구간으로 필터링한다.
export function islandWeeklyAverage(s: State, i: Island, now = Date.now()) {
  const residents = residentCount(i);
  if (!residents) return 0;
  const from = weekStart(now);
  const secondsWithinWeek = (record: RecordItem) =>
    (record.intervals ?? [{ start: record.at - record.seconds * 1000, end: record.at }]).reduce(
      (seconds, interval) =>
        seconds + Math.max(0, Math.min(interval.end, now) - Math.max(interval.start, from)) / 1000,
      0,
    );
  const mine = i.joined
    ? s.records.filter((r) => r.islandId === i.id).reduce((a, r) => a + secondsWithinWeek(r), 0)
    : 0;
  return (
    (mine +
      i.members.reduce(
        (a, m) =>
          a +
          (m.records ?? [])
            .filter((r) => r.islandId === i.id)
            .reduce((n, r) => n + secondsWithinWeek(r), 0),
        0,
      )) /
    residents
  );
}
// "N시간 M분", 1시간 미만은 "M분"
export function hoursMinutes(seconds: number) {
  const m = Math.floor(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
}
export const sessionSeconds = (session: Session | null, now = Date.now()) =>
  !session
    ? 0
    : session.seconds +
      (session.status === 'active' ? Math.max(0, (now - session.startedAt) / 1000) : 0);
export function questRate(s: State, q: Quest, islandId = s.islandId): number | null {
  if (q.type === 'screen')
    return !s.settings.permission
      ? null
      : s.screenMinutes <= q.target
        ? 100
        : Math.max(0, Math.round((q.target / s.screenMinutes) * 100));
  const now = new Date().toDateString();
  const seconds = s.records
    .filter((r) => r.islandId === islandId && new Date(r.at).toDateString() === now)
    .reduce((a, r) => {
      if (!q.windowStart || !q.windowEnd) return a + r.seconds;
      const day = new Date(r.at);
      day.setHours(0, 0, 0, 0);
      const toMs = (v: string) => {
        const [h, m] = v.split(':').map(Number);
        return day.getTime() + (h * 60 + m) * 60000;
      };
      const from = toMs(q.windowStart),
        until = toMs(q.windowEnd);
      return (
        a + Math.max(0, Math.min(r.at, until) - Math.max(r.at - r.seconds * 1000, from)) / 1000
      );
    }, 0);
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
    if (b === 'shop' && buildingOrder.some((x) => x !== 'shop' && !i.buildings.includes(x)))
      return '상점은 다른 모든 시설 완공 후 지을 수 있어요.';
  }
  return balance(i) < buildingCost(i, b) ? '섬 물고기 잔액이 부족해요.' : null;
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
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  if (period === '일') d.setDate(d.getDate() + offset);
  if (period === '주') {
    d.setDate(d.getDate() - d.getDay() + offset * 7);
  }
  if (period === '월') {
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
  }
  const from = d.getTime();
  if (period === '일') d.setDate(d.getDate() + 1);
  if (period === '주') d.setDate(d.getDate() + 7);
  if (period === '월') d.setMonth(d.getMonth() + 1);
  return { from, until: d.getTime() };
}
function focusTotal(records: RecordItem[], islandId: string, day: string, q: QuestRound) {
  const d = new Date(day + 'T00:00:00');
  const from = d.getTime();
  d.setDate(d.getDate() + 1);
  const until = d.getTime();
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
  const member = i.members.find((m) => m.id === id);
  if (q.type === 'screen') {
    const v =
      id === 'me'
        ? s.settings.permission
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
function evaluateQuests(s: State, now: number) {
  s.rewards ??= [];
  for (const i of s.islands.filter((i) => i.joined && i.buildings.includes('board')))
    for (const q of i.quests) {
      q.rounds ??= {};
      const today = dayKey(now);
      q.rounds[today] ??= {
        targets: targetIds(i),
        achieved: [],
        claimed: [],
        bonus: false,
        target: q.target,
        kind: q.type,
        windowStart: q.windowStart,
        windowEnd: q.windowEnd,
      };
      for (const [day, round] of Object.entries(q.rounds)) {
        if (day > today) continue;
        for (const id of round.targets) {
          const member = i.members.find((m) => m.id === id);
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
      q.claimed = q.rounds[today].claimed.includes('me');
    }
}
export type Action = { type: string; [key: string]: any };
export function reducer(state: State, a: Action): State {
  if (a.type === 'RESET') return initialState(!!a.full);
  if (a.type === 'LOAD') {
    const loaded = JSON.parse(JSON.stringify(a.state)) as State;
    const retired = ['flag', 'sailboat', 'cabinboat'];
    loaded.islands.forEach((i) => {
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
    return {
      ...loaded,
      schema: 2,
      fish: 0,
      friends: loaded.friends ?? [],
      rewards: loaded.rewards ?? [],
      screenDays: loaded.screenDays ?? {},
      settings: { ...loaded.settings, publicRecords: true },
      equipped: {
        ...loaded.equipped,
        hull: 'raft',
        decor: 'none',
        position: 'front',
      },
      owned: loaded.owned.filter((id) => !retired.includes(id)),
      orders: loaded.orders.filter((o) => !retired.includes(o.product)),
    };
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
  const s = JSON.parse(JSON.stringify(state)) as State,
    i = currentIsland(s),
    now = a.now ?? Date.now();
  const log = (text: string) => i.ledger.unshift({ id: uuid(), text, at: now });
  switch (a.type) {
    case 'LOGIN':
      s.loggedIn = true;
      break;
    case 'PROFILE':
      s.name = a.name?.trim() || s.name;
      s.color = a.color || s.color;
      break;
    case 'CREATE_ISLAND': {
      const n = makeIsland(uuid(), a.name.trim() || '나의 섬', false, true);
      n.joined = true;
      n.intro = a.intro || '';
      n.approval = !!a.approval;
      n.capacity = Math.min(
        CAPACITY_MAX,
        Math.max(CAPACITY_MIN, Math.round(a.capacity) || CAPACITY_MAX),
      );
      s.islands.push(n);
      s.islandId = n.id;
      s.onboarded = true;
      break;
    }
    case 'CANCEL_JOIN':
      return { ...s, pendingIsland: null };
    case 'JOIN': {
      if (s.session) return state;
      const island = s.islands.find((x) => x.id === a.id);
      if (!island || (!island.joined && isFull(island))) return state;
      if (!island.joined && island.approval && !a.approved) {
        s.pendingIsland = island.id;
        break;
      }
      s.travelOrigin = s.onboarded ? i.name : '나의 뗏목';
      island.joined = true;
      s.islandId = island.id;
      s.pendingIsland = null;
      s.onboarded = true;
      break;
    }
    case 'TRAVEL_FROM':
      s.travelOrigin = a.name;
      break;
    case 'VISIT':
      if (!i.buildings.includes('tower') || s.session) return state;
      break;
    case 'SWITCH_ISLAND': {
      if (s.session) return state;
      const target = s.islands.find((x) => x.id === a.id);
      if (!target?.joined || (!i.buildings.includes('tower') && s.onboarded && target.id !== i.id))
        return state;
      s.islandId = target.id;
      break;
    }
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
        creditedFish: 0,
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
      island.ledger.unshift({
        id: uuid(),
        text: `${s.name} · 집중 +${uncredited}마리`,
        at: now,
      });
      s.resultFromRest = s.session.status === 'paused';
      s.session = null;
      break;
    }
    case 'SELECT_BUILDING': {
      const b = a.building as Building;
      if (
        i.construction ||
        !i.buildings.includes('board') ||
        i.buildings.includes(b) ||
        !['gram', 'library', 'mail', 'tower', 'shop'].includes(b)
      )
        return state;
      if (b === 'shop' && buildingOrder.some((x) => x !== 'shop' && !i.buildings.includes(x)))
        return state;
      if (i.buildingQuest?.building === b) return state;
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
      if (s.session) {
        const total = Math.floor(sessionSeconds(s.session, now) / SECONDS_PER_FISH),
          diff = total - (s.session.creditedFish ?? 0);
        if (diff > 0) {
          const owner = s.islands.find((i) => i.id === s.session!.islandId)!;
          owner.fish = balance(owner) + diff;
          owner.earned ??= {};
          owner.earned.me = earnedBy(owner, 'me') + diff;
          s.session.creditedFish = total;
          owner.ledger.unshift({
            id: uuid(),
            text: `${s.name} · 집중 +${diff}마리`,
            at: now,
          });
        }
      }
      for (const island of s.islands)
        if (island.construction && now >= island.construction.endsAt) {
          const b = island.construction.building;
          if (!island.buildings.includes(b)) island.buildings.push(b);
          delete island.construction;
          delete island.buildingQuest;
          delete island.nextBuilding;
          island.ledger.unshift({
            id: uuid(),
            text: `${buildingNames[b]} 완공`,
            at: now,
          });
        }
      if (s.settings.permission) {
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
      if (reward.kind === 'personal') {
        owner.fish = balance(owner) + reward.amount;
        owner.earned ??= {};
        owner.earned.me = earnedBy(owner, 'me') + reward.amount;
        owner.quests.find((q) => q.id === reward.questId)?.rounds?.[reward.day]?.claimed.push('me');
        owner.ledger.unshift({
          id: uuid(),
          text: `퀘스트 달성 보상 +${reward.amount}마리`,
          at: now,
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
      log('주민 퀘스트 달성 보상 +10마리');
      break;
    }
    case 'QUEST_SAVE': {
      if (!Number.isFinite(a.target) || a.target < 1 || !a.title.trim()) return state;
      const q = i.quests.find((q) => q.id === a.id);
      if (q) {
        q.title = a.title;
        q.type = a.kind;
        q.target = a.target;
        q.windowStart = a.windowStart;
        q.windowEnd = a.windowEnd;
      } else
        i.quests.push({
          id: uuid(),
          title: a.title,
          type: a.kind,
          target: a.target,
          windowStart: a.windowStart,
          windowEnd: a.windowEnd,
          claimed: false,
        });
      break;
    }
    case 'NOTICE_SAVE': {
      const n = i.notices.find((x) => x.id === a.id);
      if (n) {
        n.title = a.title;
        n.body = a.body;
      } else
        i.notices.unshift({
          id: uuid(),
          title: a.title,
          body: a.body,
          author: s.name,
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
          text: a.text.trim(),
          at: now,
        });
      break;
    }
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
    case 'TRACK':
      if (i.buildings.includes('gram') && i.sharedOwned.includes(a.value)) {
        i.track = a.value;
        i.playing = true;
      }
      break;
    case 'PLAY':
      if (i.buildings.includes('gram')) i.playing = !!a.value;
      break;
    case 'SETTING':
      (s.settings as any)[a.key] = a.value;
      break;
    case 'MANAGE':
      i.name = a.name?.trim() || i.name;
      i.intro = a.intro ?? i.intro;
      i.approval = a.approval ?? i.approval;
      break;
    case 'KICK':
      i.members = i.members.filter((m) => m.id !== a.id);
      if (i.buildingQuest)
        i.buildingQuest.targets = i.buildingQuest.targets.filter((id) => id !== a.id);
      break;
    case 'REJECT_MEMBER':
      i.requestResolved = true;
      break;
    case 'CAPACITY': {
      const v = Math.round(a.value);
      if (!(v <= CAPACITY_MAX) || v < Math.max(CAPACITY_MIN, residentCount(i))) return state;
      i.capacity = v;
      break;
    }
    case 'HALL_GUIDE_DONE':
      s.hallGuide = 'done';
      break;
    case 'ADD_MEMBER':
      if (i.requestResolved || isFull(i)) return state;
      i.requestResolved = true;
      i.members.push({
        id: uuid(),
        name: '새봄',
        color: 'white',
        subject: '독서 과제',
        seconds: 0,
        focusing: false,
        role: 'member',
      });
      break;
    case 'TRANSFER':
      if (!i.members.some((m) => m.id === a.id)) return state;
      i.members.forEach((m) => (m.role = m.id === a.id ? 'host' : 'member'));
      break;
    case 'LEAVE':
      if (s.session || (isHost(i) && i.members.length > 0)) return state;
      i.joined = false;
      if (i.buildingQuest)
        i.buildingQuest.targets = i.buildingQuest.targets.filter((id) => id !== 'me');
      const nextIsland = s.islands.find((j) => j.joined && j.id !== i.id);
      s.onboarded = !!nextIsland;
      if (nextIsland) s.islandId = nextIsland.id;
      break;
    case 'SCREEN_TIME':
      s.screenMinutes = Math.max(0, a.value);
      break;
    case 'LOGOUT':
      s.loggedIn = false;
      break;
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
      )
        f.status = 'none';
      else return state;
      break;
    }
    case 'FRIEND_MESSAGE': {
      const f = s.friends?.find((f) => f.id === a.id);
      if (f?.status !== 'friend' || !i.buildings.includes('mail') || !a.text.trim()) return state;
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
    case 'FRIEND_RETRY': {
      const f = s.friends?.find((f) => f.id === a.friend);
      const m = f?.messages.find((m) => m.id === a.id);
      if (!m || f?.status !== 'friend') return state;
      m.status = 'sent';
      break;
    }
    case 'DELETE_ACCOUNT': {
      const clean = initialState();
      clean.islands = s.islands.map((i) => ({
        ...i,
        joined: false,
        earned: Object.fromEntries(Object.entries(i.earned ?? {}).filter(([id]) => id !== 'me')),
        ledger: i.ledger.filter((entry) => !entry.text.includes(s.name)),
        notices: i.notices
          .filter((notice) => notice.author !== s.name)
          .map((notice) => ({
            ...notice,
            comments: notice.comments.filter((comment) => comment.name !== s.name),
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
      return clean;
    }
    case 'DEMO_CREDIT':
      i.fish = balance(i) + (a.fish || 0) + (a.points || 0) + (a.contribution || 0);
      i.earned ??= {};
      i.earned.me = earnedBy(i, 'me') + (a.earned || a.fish || 0);
      break;
    default:
      return state;
  }
  if (['FINISH', 'QUEST_SAVE', 'SCREEN_TIME'].includes(a.type)) evaluateQuests(s, now);
  return s;
}
