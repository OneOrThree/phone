import { demoState } from '@/services/model';
import type { ScreenEnvironment } from './ScreenEnvironment';

type Islands = NonNullable<ScreenEnvironment['islands']>;
type Focus = NonNullable<ScreenEnvironment['focus']>;
type Friends = NonNullable<ScreenEnvironment['friendsScreen']>;
export type PreviewEnvironmentInput = Partial<
  Omit<ScreenEnvironment, 'islands' | 'focus' | 'friendsScreen' | 'conversion' | 'player'>
> & {
  player?: Partial<ScreenEnvironment['player']>;
  conversion?: Partial<NonNullable<ScreenEnvironment['conversion']>>;
  islands?: Partial<Islands>;
  focus?: Partial<Focus>;
  friendsScreen?: Partial<Friends>;
};
const islandsCache = new WeakMap<object, Islands>();
const focusCache = new WeakMap<object, Focus>();
const friendsScreenCache = new WeakMap<object, Friends>();
const conversionCache = new WeakMap<object, NonNullable<ScreenEnvironment['conversion']>>();
// 같은 입력 객체의 문맥은 같은 참조를 유지해 검토실에서 명령 의존 effect가 반복되지 않게 한다.
function completePreview<T extends object>(input: object, value: T, cache: WeakMap<object, T>): T {
  const existing = cache.get(input);
  if (existing) return Object.assign(existing, value);
  cache.set(input, value);
  return value;
}

const idle = () => {};
const unavailable = (): never => {
  throw new Error('이 검토실에는 해당 서버 명령이 연결되어 있지 않습니다.');
};
/** 검토실과 테스트의 로컬 화면 문맥. 실제 앱 루트는 모든 값을 직접 제공한다. */
export function createPreviewEnvironment(input: PreviewEnvironmentInput = {}): ScreenEnvironment {
  const state = input.state ?? demoState();
  const environment: ScreenEnvironment = {
    state: state,
    savedSettings: state.settings,
    route: 'home',
    fromSea: false,
    termsVersion: '',
    routeTransitionShielded: false,
    letterOpen: false,
    setSceneGuideOpen: idle,
    accountDataReady: true,
    dispatch: idle,
    go: idle,
    replace: idle,
    reset: idle,
    home: idle,
    back: idle,
    backOverride: { current: null },
    notify: idle,
    confirm: idle,
    build: idle,
    signOut: async () => true,
    text: '',
    setText: idle,
    body: '',
    setBody: idle,
    tab: '',
    setTab: idle,
    detail: '',
    now: Date.now(),
    terms: false,
    setTerms: idle,
    loginProviders: [],
    startSocial: undefined,
    socialBusy: null,
    socialError: '',
    startGuest: undefined,
    guestBusy: false,
    guestError: '',
    approval: false,
    setApproval: idle,
    visited: '',
    setVisited: idle,
    guideStep: 0,
    setGuideStep: idle,
    player: {
      playbackAllowed: true,
      replace: idle,
      play: () => true,
      pause: idle,
      seekTo: async () => {},
      volume: 1,
      loop: false,
      addListener: () => ({ remove: idle }),
    },
    previewAudio: false,
    setPreviewAudio: idle,
    walkTo: idle,
    newQuest: idle,
    walkRequest: null,
    windowStart: '',
    setWindowStart: idle,
    windowEnd: '',
    setWindowEnd: idle,
    failNext: false,
    setFailNext: idle,
    islands: undefined,
    focus: undefined,
    recoverExpiredRestConflict: async () => false,
    onPresenceCounts: idle,
    islandBootError: false,
    homeError: false,
    retryHome: idle,
    buildingIndicators: undefined,
    conversion: undefined,
    playback: undefined,
    localePref: 'system',
    setLocalePref: idle,
    beforeSeaVoyage: (continueVoyage) => continueVoyage(),
    focusBlockingIntroPreview: false,
  };
  const { islands, focus, friendsScreen, conversion, player, ...rest } = input;
  return {
    ...environment,
    ...rest,
    player: { ...environment.player, ...player },
    conversion:
      conversion === undefined
        ? undefined
        : completePreview<NonNullable<ScreenEnvironment['conversion']>>(
            conversion,
            {
              offer: () => false,
              convert: unavailable,
              hasPendingAdoption: () => false,
              clearPending: idle,
              ...conversion,
            },
            conversionCache,
          ),
    islands:
      islands === undefined
        ? undefined
        : completePreview<Islands>(
            islands,
            {
              sync: unavailable,
              switchCurrent: unavailable,
              setMain: unavailable,
              create: unavailable,
              explore: unavailable,
              discover: unavailable,
              visit: unavailable,
              resolveInvite: unavailable,
              join: unavailable,
              status: unavailable,
              requests: unavailable,
              cancel: unavailable,
              leave: unavailable,
              ...islands,
            },
            islandsCache,
          ),
    focus:
      focus === undefined
        ? undefined
        : completePreview<Focus>(
            focus,
            {
              tutorialExperienceReward: unavailable,
              tutorialReward: unavailable,
              start: unavailable,
              startSea: unavailable,
              pause: unavailable,
              resume: unavailable,
              finish: unavailable,
              acknowledge: unavailable,
              recover: unavailable,
              beginRecover: unavailable,
              ...focus,
            },
            focusCache,
          ),
    friendsScreen:
      friendsScreen === undefined
        ? undefined
        : completePreview<Friends>(
            friendsScreen,
            {
              status: 'ready',
              error: null,
              data: null,
              busy: false,
              refresh: idle,
              retry: idle,
              command: unavailable,
              query: '',
              setQuery: idle,
              searchStatus: 'idle',
              searchError: null,
              searchItems: [],
              unfilteredSentFriendRequests: [],
              ...friendsScreen,
            },
            friendsScreenCache,
          ),
  };
}
