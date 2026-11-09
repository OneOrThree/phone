import type {
  IslandSummary,
  JoinRequestStatus,
  MyJoinRequest,
  VisitScreen,
} from '@/services/api/islands';
import type { PlaybackState } from '@/services/api/playback';
import type { HomeWorldFacts } from '@/services/homeSnapshot';

export type Color = 'black' | 'ginger' | 'cream' | 'gray' | 'white' | 'calico';

export type Building = 'hall' | 'board' | 'tower' | 'mail' | 'gram' | 'shop' | 'library';

export type Route =
  | 'login'
  | 'character'
  | 'webIsland'
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
  | 'raft'
  | 'telescope'
  // 바다 항해 집중(GROMO-2310) — 항해·정박·표류. seaArrival 은 섬에 내린 뒤 결과창(내용은 GROMO-2311)
  | 'sea'
  | 'seaArrival'
  // 바다에서 펼친 오늘 호(GROMO-2314) — 인자 = 호 id. 소속 섬이 없어도 머무른다(seaRouteHeld)
  | 'seaMagazine'
  | 'promotionEditor'
  | 'magazine'
  | 'mainIsland'
  | 'currentIsland'
  | 'profile'
  | 'settings'
  | 'language'
  | 'blockedUsers'
  | 'developerNotices'
  | 'developerNotice'
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
  /** 서버 표시용 읽기 모델. 미조회 역할은 null이며 방장으로 추론하지 않는다. */
  serverRole?: 'host' | 'member' | null;
  serverMemberCount?: number;
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
  /** 서버 섬 공동 지갑 정본을 적용한 버전. 느진 스냅숏의 역전을 막는다. */
  villagePointsVersion?: number;
  earned?: Record<string, number>;
  buildingQuest?: {
    building: Building;
    targets: string[];
    selectedAt: number;
    // 예전 저장본 호환 필드. 건설 가능 여부는 섬 통장 잔액만 사용한다.
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
  track: string | null;
  playing: boolean;
  /** 서버 공용 재생 전체 상태. null trackId도 명시적인 미선택 상태로 보존한다. */
  serverPlayback?: PlaybackState;
  /** 사용자가 정지 버튼을 누른 횟수. 플레이어가 일시정지와 구분해 재생 위치를 초기화한다. */
  playbackReset?: number;
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
  // 로컬 체험의 최초 보상. 서버 세션에는 클라이언트가 보상을 만들지 않는다.
  tutorialFish?: boolean;
  intervals?: { start: number; end: number }[];
  // 서버 세션 종류(GROMO-2310). 없으면 섬 집중. sea 면 islandId = 목적지, targetMinutes = 항해 분이고 pause/resume 이 없다
  kind?: 'island' | 'sea';
  targetMinutes?: number;
  destinationIslandName?: string;
  // 서버 뷰를 받은 기기 시각(ms). 바다 항해 화면이 기기·서버 시계 차이 없이 경과를 센다(sessionSeconds 는 쓰지 않는다)
  syncedAt?: number;
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
  // 바다 항해 기록(GROMO-2310)은 'sea' — 섬 집중 집계에서 뺀다. 없으면 섬 집중(옛 기록 호환)
  kind?: 'island' | 'sea';
  // 이 세션에 받은 꾸미기 상품 id(finish 의 seaReward.grantedProductIds, GROMO-2382) — 없으면 키째 없다
  rewards?: string[];
  // 그중 처음 받은 것(seaReward.newProductIds) — NEW! 배지. 없으면 키째 없다
  newRewards?: string[];
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
  /** 계정 귀속 로컬 연출 체크포인트. 서버 프로필 완료·섬 소속과는 독립이다. */
  onboardingStory?: 'intro' | 'scope' | 'done';
  // 세션과 같은 저장본에 보관해 앱 종료·서버 복구 후에도 안내를 이어간다.
  tutorial?: { step: number; sessionId?: string };
  tutorialRevision?: number;
  // 첫 집중은 화면 체험이다. 실제 session·records·통계에 합산하지 않는다.
  tutorialExperience?: { session: Session | null; result: RecordItem | null; fromRest?: boolean };
  // 서버에서 소속 없음이 확인된 신규 흐름만 첫 소속 확정 후 안내를 시작한다.
  tutorialEnrollment?: 'awaiting-first-island' | 'existing';
  focusGuideDone?: boolean;
  /** 계정 귀속: 튜토리얼 집중 정상 완료 후 예약하고 다음 집중 안내를 열 때 소비한다. */
  focusBlockingIntro?: 'pending' | 'seen';
  version: 1;
  schema?: 2;
  friends?: Friend[];
  lastRaftDestination?: string;
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
  // 서버 /me 의 계정 연결 제공자. 선택 필드로 두어 구버전 저장본도 그대로 복구한다.
  linkedProviders?: string[];
  islandId: string;
  fish: number;
  owned: string[];
  equipped: {
    clothes: string;
    decor: string;
    hull: string;
    position: string;
    /** 머리·목·신발 슬롯(GROMO-2331) — 옛 서버면 없다. 카탈로그 그림으로 겹쳐 그린다. */
    head?: string | null;
    neck?: string | null;
    shoes?: string | null;
  };
  settings: {
    notifications: boolean;
    sound: boolean;
    volume?: number;
    // 사용자가 설정 화면에서 직접 켠 값만 담는다. OS 의 모션 줄이기는 저장하지 않고 App 이 실행 중에 합친다(GROMO-2159).
    reduceMotion: boolean;
    // 위 의미로 저장하는 형식이면 true. 없으면 OS 가 쓴 값이 섞인 예전 저장본이라 LOAD 가 한 번 끈다.
    reduceMotionUserOnly?: boolean;
    publicRecords: boolean;
    permission: boolean;
    haptics: boolean;
    screenTimeBoardPromptSeen?: boolean;
    screenTimeSyncError?: boolean;
    screenTimeMeasurementReady?: boolean;
    screenTimeMeasurementDay?: string;
    screenTimeHistoryReady?: boolean;
    screenTimeHistoryDay?: string;
    studyVerification?: boolean; // 집중 인증(카메라 손 판정) 개인 토글 — 스파이크
    studyVerificationCamera?: 'front' | 'back'; // 미리보기에서 확인한 카메라를 판정에도 사용한다.
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
    // 강퇴로 잃은 섬(GROMO-2366) — /me/islands 에는 잃은 섬이 없어 강퇴 안내의 문구·「봤음」 표시가 쓴다
    kickedIsland?: { id: string; name: string | null } | null;
    candidates: IslandSummary[];
    nextCursor: string | null;
    visit: VisitScreen | null;
    joinRequests: MyJoinRequest[];
    // 단건 상태 조회(/me/join-requests/{id})는 islandName·memberCount 같은 표시 필드가 없다.
    // 서버가 안 준 값을 합성하지 않고 상태만 별도로 보관한다 — 화면은 목록 항목에 이 상태를 얹어 쓴다.
    // 취소 응답처럼 version이 없는 결과도 있으므로 version은 선택이다.
    requestStatus: RequestStatusEntry[];
    // 서버 모드 홈이 직접 그리는 스냅샷(GROMO-2138). 읽을 때는 serverHome() 으로 current 와 대조한다
    home?: HomeWorldFacts | null;
    playback?: PlaybackState | null;
    /** 착공 POST 응답을 클라이언트가 보관하는 공사 구간. 서버 GET 계약에는 포함하지 않는다. */
    clientConstruction?: {
      islandId: string;
      building: Building;
      startedAt: number;
      endsAt: number;
    } | null;
  } | null;
  travelOrigin?: string;
  // 다른 섬을 방문자로 구경 중이면 그 섬 ID(GROMO-1904). 내 현재 섬(islandId)은 그대로 둔다
  visitingIslandId?: string | null;
  // 이번 방문에서 「가입하지 않고 떠날까요?」를 이미 물었는지(GROMO-2259). 새 방문(VISIT·SERVER_VISITING)·구경 끝(END_VISIT)에서 지운다
  visitLeaveAsked?: boolean;
  // 이번 방문에서 섬장 인사말 말풍선을 이미 띄웠는지(GROMO-2263). visitLeaveAsked 와 같은 시점에 지운다
  visitGreeted?: boolean;
  // 무인도 항해로 새로 세운 섬의 id(GROMO-2649). 그 섬 홈에 들어오면 강제 이름 짓기 모달을 띄우고,
  // 이름을 저장하면 지운다. 없으면 모달을 띄우지 않는다.
  pendingIslandNaming?: string | null;
  // 최초 우체통 안내를 마친 계정. 섬을 옮겨도 반복하지 않고 계정 간에는 분리한다.
  mailboxGuideSeenBy?: string[];
  // 최초 상점 안내를 마친 계정. 마지막 건물인 상점에 처음 들어갈 때 한 번만 보여 준다.
  shopGuideSeenBy?: string[];
  // 현재 화면을 잃은 강퇴를 앱 셸이 소비해 안전한 화면으로 reset하기 위한 일회성 신호
  membershipRecovery?: { reason: 'kicked'; islandId: string };
  // 이 시각까지 받은 편지는 읽은 것으로 본다. 받은 편지 읽음(readAt)이 생기기 전 저장본을 불러온 시각이 들어간다
  lettersReadAt?: number;
};

// 방문자 등록증의 가입 버튼 상태. 집중 중에는 배 이동부터 막혀 방문 화면에 올 수 없으므로 집중 상태는 없다
export type VisitorJoin = 'join' | 'apply' | 'cancel' | 'full' | 'blocked';

// 쓰기 의도 멱등 키 풀(GROMO-2006) — 같은 의도(name+exactBody)의 재시도는 같은 키를 돌려주고,
// release 후에는 새 키를 만든다. 응답 유실·재조회 실패 동안만 키를 유지하고, 확정 성공·종결
// 뒤에는 release해서 취소 후 같은 섬 재신청 같은 새 사용자 행동이 옛 결과를 replay 받지 않게 한다.
// 키는 호출부 ref에만 두고 State·AsyncStorage에는 저장하지 않는다.
// requestStatus 항목 — 취소 응답({id,status:'cancelled'})처럼 version이 없는 서버 결과도
// 그대로 담는다. 없는 version은 합성하지 않는다.
export type RequestStatusEntry = Omit<JoinRequestStatus, 'version'> & { version?: number };

export type Action = { type: string; [key: string]: any };
