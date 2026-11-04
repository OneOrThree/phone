import type { SoundPlayer } from '@/hooks/useSoundPlayer';
import type { useBuildingIndicators } from '@/screens/island/useBuildingIndicators';
import type { useFriendsScreen } from '@/screens/island/useFriendsScreen';
import type { createIslandCommands } from '@/services/islandCommands';
import type { Route, State } from '@/services/model';
import type { createSessionCommands } from '@/services/sessionCommands';
import type React from 'react';

/** 앱 루트가 화면에 제공하는 데이터와 명령. 서버 명령이 없으면 목업 경로를 쓴다. */
export type ScreenEnvironment = {
  state: State;
  savedSettings: State['settings'];
  route: Route;
  fromSea: boolean;
  termsVersion: string;
  routeTransitionShielded: boolean;
  letterOpen: boolean;
  setSceneGuideOpen: React.Dispatch<React.SetStateAction<boolean>>;
  accountDataReady: boolean;
  dispatch: React.ActionDispatch<[a: import('@/services/model').Action]>;
  go: (
    r: import('@/services/model').Route,
    id?: string,
    onTransitionCancel?: (() => void) | undefined,
  ) => boolean | void;
  replace: (r: import('@/services/model').Route, id?: string) => void;
  reset: (r: import('@/services/model').Route, id?: string) => void;
  home: () => void;
  back: () => void;
  backOverride: React.RefObject<(() => boolean) | null>;
  notify: (s: string) => void;
  confirm: (
    title: string,
    txt: string,
    action: () => void,
    opts?: {
      ok?: string | undefined;
      destructive?: boolean | undefined;
      cancel?: string | undefined;
      onCancel?: (() => void) | undefined;
    },
  ) => void;
  build: (b: import('@/services/model').Building) => void;
  signOut: () => Promise<boolean>;
  text: string;
  setText: React.Dispatch<React.SetStateAction<string>>;
  body: string;
  setBody: React.Dispatch<React.SetStateAction<string>>;
  tab: string;
  setTab: React.Dispatch<React.SetStateAction<string>>;
  detail: string;
  now: number;
  terms: boolean;
  setTerms: React.Dispatch<React.SetStateAction<boolean>>;
  loginProviders: import('@/services/api/auth').Provider[];
  startSocial: ((provider: import('@/services/api/auth').Provider) => Promise<void>) | undefined;
  socialBusy: import('@/services/api/auth').Provider | null;
  socialError: string;
  startGuest: (() => Promise<void>) | undefined;
  guestBusy: boolean;
  guestError: string;
  approval: boolean;
  setApproval: React.Dispatch<React.SetStateAction<boolean>>;
  visited: string;
  setVisited: React.Dispatch<React.SetStateAction<string>>;
  guideStep: number;
  setGuideStep: (step: number, expected?: { step: number; revision: number } | undefined) => void;
  player: SoundPlayer;
  previewAudio: boolean;
  setPreviewAudio: React.Dispatch<React.SetStateAction<boolean>>;
  walkTo: (r: import('@/services/model').Route) => void;
  newQuest: () => void;
  walkRequest: import('@/services/model').Route | null;
  windowStart: string;
  setWindowStart: React.Dispatch<React.SetStateAction<string>>;
  windowEnd: string;
  setWindowEnd: React.Dispatch<React.SetStateAction<string>>;
  failNext: boolean;
  setFailNext: React.Dispatch<React.SetStateAction<boolean>>;
  islands: ReturnType<typeof createIslandCommands>['commands'] | undefined;
  focus: ReturnType<typeof createSessionCommands>['commands'] | undefined;
  recoverExpiredRestConflict: (
    error: unknown,
    session: import('@/services/model').Session | null,
  ) => Promise<boolean>;
  onPresenceCounts: (
    sessionId: string,
    islandId: string,
    counts: { focus: number; rest: number } | null,
  ) => void;
  islandBootError: boolean;
  homeError: boolean;
  retryHome: () => void;
  buildingIndicators: ReturnType<typeof useBuildingIndicators> | undefined;
  conversion: import('@/services/memberConversion').MemberConversion | undefined;
  playback: import('@/screens/island/useIslandPlayback').IslandPlayback | undefined;
  localePref: import('@/i18n/index').LocalePref;
  setLocalePref: React.Dispatch<React.SetStateAction<import('@/i18n/index').LocalePref>>;
  beforeSeaVoyage: (onContinue: () => void) => void;
  focusBlockingIntroPreview: boolean;
  boardStatus?: ReturnType<
    typeof import('@/screens/island/useBoardHomeIndicator').useBoardHomeIndicator
  >;
  magazineToday?: import('@/services/api/magazine').MagazineToday | null;
  islandChat?: import('@/screens/island/useIslandChat').IslandChat;
  onBoardCommentRead?: () => void;
  onFirstVoyageArrival?: (
    destination: import('@/services/firstVoyage').FirstVoyageIntent['destination'],
  ) => void;
  friendsScreen?: ReturnType<typeof useFriendsScreen>;
};
export type ScreenProps<K extends keyof ScreenEnvironment = keyof ScreenEnvironment> = {
  e: Pick<ScreenEnvironment, K>;
};
