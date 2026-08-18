// FocusSessionScreen 특성화 테스트(GROMO-1599) — 헤드리스화(GROMO-1600) 전에 **현행 동작을
// 그대로 고정**한다. 여기서 단언하는 것은 "옳은 동작"이 아니라 "지금의 동작"이다 — 리팩토링
// PR은 이 스위트를 건드리지 않고 green을 유지해야 한다.
//
// 고정하는 계약(에픽 1595 · docs/prd/apple-watch/ D2):
//   1. 3모드 틱·완료 전이(카운트업/카운트다운 완료 게이트/뽀모도로 경계 정산·마커 회전)
//   2. 일시정지 의미론 — 경과 정지 + 방해초(totalDistractionSeconds)로 업로드에 차감 반영
//   3. finish 경로 — 정산 업로드·마커 취소·라이브 레코드 제거·FocusResult replace
//   4. 백그라운드 복귀 — 실드 세션은 자리 비운 시간 전진(집중 인정), 폴백 세션은 15초 정책
//   5. 라이브 레코드 5초 주기 저장(강제종료 대비) — '미정산 구간'만 담는 것
//   6. 마커 시작 실패 — 세션은 계속, 종료는 POST 폴백(sessionId null)
//
// ⚠️ jest의 fake timer는 "백그라운드에서도 인터벌이 돈다"는 점이 실기기와 다르다. 실드 복귀
//    리플레이가 이탈 시점 스냅샷(leftSessionRef)에서 다시 계산해 덮어쓰므로 결과는 결정적이다
//    — 그 덮어쓰기 자체가 여기서 고정하는 동작이다.
import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState, Vibration, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FocusSessionScreen from './FocusSessionScreen';
import { STORAGE_KEYS } from '@/types/storage';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { startFocusSession } from '@/services/focusApi';
import { uploadFocusBlock } from './uploadFocusBlock';
import { cancelMarker } from './pendingMarkerCancels';
import { scheduleLeaveNotifications, cancelLeaveNotifications } from './leaveNotifications';
import {
  logFocusSessionAbandoned,
  logFocusSessionCompleted,
  logFocusSessionPaused,
  logFocusSessionResumed,
  logFocusDistractionDetected,
  logFocusMarkerStartFailed,
} from '@/services/analyticsEvents';
import type { LiveFocusSession } from './types';

// ── 네이티브·외부 경계 목 ──────────────────────────────────────────────────────
jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    startFocusShield: jest.fn(() => Promise.resolve(true)),
    stopFocusShield: jest.fn(() => Promise.resolve()),
    startFocusActivity: jest.fn(() => Promise.resolve()),
    endFocusActivity: jest.fn(() => Promise.resolve()),
    saveCharacterSnapshot: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(() => Promise.resolve('b64')),
}));
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(() => Promise.resolve()),
  OrientationLock: { DEFAULT: 0, PORTRAIT_UP: 1 },
}));
jest.mock('expo-linear-gradient', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { LinearGradient: View };
});

// ── 서버·저장 경계 목 — 특성화 대상은 "화면이 이들을 언제·무엇으로 부르는가"다 ──
jest.mock('@/services/focusApi', () => ({
  startFocusSession: jest.fn(() => Promise.resolve({ sessionId: 'marker-1' })),
}));
jest.mock('./tagSync', () => ({
  ensureFocusTagId: jest.fn(() => Promise.resolve('tag-1')),
}));
jest.mock('./uploadFocusBlock', () => ({
  uploadFocusBlock: jest.fn(() => Promise.resolve({ status: 'saved', response: {} })),
}));
jest.mock('./pendingMarkerCancels', () => ({
  cancelMarker: jest.fn(() => Promise.resolve()),
  flushPendingMarkerCancels: jest.fn(() => Promise.resolve()),
}));
jest.mock('./sessionSaveVerdict', () => ({
  isTodayVerdict: jest.fn(() => true),
  publishSessionSaveVerdict: jest.fn(),
}));
jest.mock('./leaveNotifications', () => ({
  scheduleLeaveNotifications: jest.fn(() => Promise.resolve()),
  cancelLeaveNotifications: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/services/analyticsEvents', () => ({
  logFocusSessionStarted: jest.fn(),
  logFocusSessionPaused: jest.fn(),
  logFocusSessionResumed: jest.fn(),
  logFocusSessionCompleted: jest.fn(),
  logFocusSessionAbandoned: jest.fn(),
  logFocusDistractionDetected: jest.fn(),
  logFocusMenuOpened: jest.fn(),
  logFocusViewChanged: jest.fn(),
  logFocusOrientationChanged: jest.fn(),
  logFocusMarkerStartFailed: jest.fn(),
  subjectKeyOf: (id?: string) => id,
}));
jest.mock('@/services/cardInteraction', () => ({
  consumeCardInteraction: jest.fn(() => undefined),
  invalidateCardInteraction: jest.fn(),
  normalizeFocusEntrySource: (v: unknown) => v ?? 'direct',
  FOCUS_ATTRIBUTION_TTL_MS: 60_000,
}));

// ── 스토어·훅 목 — 세션 로직이 읽기만 하는 주변 상태 ──────────────────────────
const mockAddFocusSeconds = jest.fn();
const mockAddFocusToSubject = jest.fn();
jest.mock('@/store/UserContext', () => ({
  useUser: () => ({ userId: 'user-1', nickname: 'nick' }),
}));
jest.mock('@/store/FocusContext', () => ({
  useFocus: () => ({ addFocusSeconds: mockAddFocusSeconds, todayFocusSeconds: 0 }),
}));
jest.mock('@/store/CoinContext', () => ({ useCoins: () => ({ refresh: jest.fn() }) }));
jest.mock('@/store/SubjectContext', () => ({
  useSubjects: () => ({
    subjects: [{ id: 's1', name: '수학', accumulatedSeconds: 0, color: '#FFB4A2' }],
    addFocusToSubject: mockAddFocusToSubject,
  }),
}));
jest.mock('@/store/CharacterContext', () => ({ useCharacter: () => ({ activeSource: null }) }));
jest.mock('@/screens/league/useFocusFriends', () => ({
  useFocusFriends: () => ({ friends: [], pinnedIds: new Set() }),
}));
jest.mock('./useSessionLeagueMembers', () => ({
  useSessionLeagueMembers: () => ({ members: [] }),
}));
jest.mock('./useSessionGroups', () => ({
  useSessionGroups: () => ({ groups: [], myFocus: 0 }),
}));
jest.mock('@/hooks/useFocusCategory', () => ({ useFocusCategory: () => null }));
// '동작 줄이기' 확정 true — 실제 useMotion이 reanimated 호출 없이 즉시값 경로로 돈다.
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => true,
  useReduceMotionReady: () => true,
  whenReduceMotionReady: () => Promise.resolve(),
}));

// ── 렌더 전용 무거운 자식은 껍데기로 — 세션 로직과 무관 ───────────────────────
jest.mock('./components/LiveFocusGrid', () => ({ LiveFocusGrid: () => null }));
jest.mock('./components/FocusMenuDrawer', () => ({ FocusMenuDrawer: () => null }));
jest.mock('./FocusLandscape', () => ({ FocusLandscape: () => null }));
jest.mock('@/components/TabGuideOverlay', () => ({ TabGuideOverlay: () => null }));
jest.mock('@/components/character/AnimatedCharacter', () => ({ AnimatedCharacter: () => null }));
jest.mock('@/components/character/CharacterImage', () => ({ CharacterImage: () => null }));
jest.mock('@/components/PressableScale', () => {
  const mockReact = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    PressableScale: ({
      children,
      onPress,
      testID,
    }: {
      children?: unknown;
      onPress?: () => void;
      testID?: string;
    }) => mockReact.createElement(Text, { testID, onPress }, children as never),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
    SafeAreaView: View,
  };
});

let mockRouteParams: Record<string, unknown> = {};
const mockNavigation = { replace: jest.fn(), navigate: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockRouteParams }),
}));

// ── 하네스 ─────────────────────────────────────────────────────────────────────
const mockedUpload = uploadFocusBlock as jest.Mock;
const mockedStartMarker = startFocusSession as jest.Mock;
const mockedShieldStart = ScreenTimeModule.startFocusShield as jest.Mock;

// AppState 핸들러를 등록 순서대로 붙잡는다 — 구독 순서(선언 순서)가 동작의 일부다.
let appStateHandlers: ((s: AppStateStatus) => void)[] = [];

// ⚠️ 1초 단위로 act를 쪼개서 전진한다 — 한 번에 advanceTimersByTime(N초)를 하면 N개의 틱
// 콜백이 같은 콜스택에서 돌아 React가 배칭하고, sessionRef(렌더 시 갱신)가 낡은 채 모든 틱이
// 같은 prev에서 계산돼 경과가 1초만 오른다. 실기기는 틱마다 태스크가 갈려 렌더가 끼어든다.
const advance = async (ms: number) => {
  const wholeSeconds = Math.floor(ms / 1000);
  for (let i = 0; i < wholeSeconds; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
  const remainder = ms - wholeSeconds * 1000;
  if (remainder > 0) {
    await act(async () => {
      jest.advanceTimersByTime(remainder);
    });
  }
};
const flush = () => act(async () => {});
const fireAppState = (s: AppStateStatus) =>
  act(async () => {
    appStateHandlers.forEach((h) => h(s));
  });
// 벽시계만 전진 — 인터벌은 돌리지 않는다. 실기기의 백그라운드(JS suspend) 재현용:
// 폴백(실드 없음) 복귀 경로는 실드 경로와 달리 상태를 되감지 않으므로, advance로 흉내내면
// 백그라운드에서도 틱이 쌓여 이탈 시간이 집중으로 계상돼도 못 잡는다(codex 리뷰 PR #676).
const jumpWallClock = (ms: number) =>
  act(async () => {
    jest.setSystemTime(Date.now() + ms);
  });
// focusLiveSession 키에 대한 쓰기 호출만 추린다 — 저장 '주기' 검증용
const liveRecordWrites = () =>
  (AsyncStorage.setItem as unknown as jest.Mock).mock.calls.filter(
    (c) => c[0] === STORAGE_KEYS.focusLiveSession,
  );

let view: Awaited<ReturnType<typeof render>>;
async function renderSession(params: Record<string, unknown>) {
  mockRouteParams = { subjectId: 's1', subjectName: '수학', ...params };
  view = await render(<FocusSessionScreen />);
  await flush(); // 마커 시작·실드 적용 등 마운트 비동기 확정
}

async function readLiveRecord(): Promise<LiveFocusSession | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
  return raw ? (JSON.parse(raw) as LiveFocusSession) : null;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.useFakeTimers();
  appStateHandlers = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandlers.push(handler as (s: AppStateStatus) => void);
    return { remove: jest.fn() } as never;
  });
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
  mockedShieldStart.mockResolvedValue(true);
  mockedStartMarker.mockResolvedValue({ sessionId: 'marker-1' });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('카운트업 — 틱·라이브 레코드·finish', () => {
  test('1초 틱이 경과를 쌓고, 5초마다 미정산 구간을 라이브 레코드로 남긴다', async () => {
    await renderSession({ mode: 'countup' });
    // 저장 '주기' 자체를 고정한다 — 4초까지는 쓰기 0, 5초에 정확히 1회(codex 리뷰: 매초
    // 저장으로 바뀌는 회귀는 마지막 값만 봐서는 못 잡는다).
    await advance(4000);
    expect(liveRecordWrites()).toHaveLength(0);
    await advance(1000);
    expect(liveRecordWrites()).toHaveLength(1);
    const record = await readLiveRecord();
    expect(record).not.toBeNull();
    expect(record!.elapsed).toBe(5); // 미정산 구간 = 아직 서버에 안 올린 집중초
    expect(record!.subjectId).toBe('s1');
    expect(record!.userId).toBe('user-1');
    expect(record!.serverSessionId).toBe('marker-1'); // 강제종료 시 서버 스윕 대상
  });

  test('정지 버튼 finish — 블록 정산 업로드·마커 취소·레코드 제거·FocusResult(completed=true) replace', async () => {
    await renderSession({ mode: 'countup' });
    await advance(7000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    // 정산 업로드 1회 — 마커 id를 실어 PATCH 경로를 태운다
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    const { sessionId, body } = mockedUpload.mock.calls[0][0];
    expect(sessionId).toBe('marker-1');
    expect(body.focusType).toBe('INFINITE');
    expect(body.subject).toBe('수학');
    expect(Date.parse(body.endedAt) - Date.parse(body.startedAt)).toBe(7000);
    // 로컬 적립도 같은 델타로 — 정확히 1회(중복 적립 회귀 방지, codex 리뷰)
    expect(mockAddFocusSeconds).toHaveBeenCalledTimes(1);
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(7);
    expect(mockAddFocusToSubject).toHaveBeenCalledTimes(1);
    expect(mockAddFocusToSubject).toHaveBeenCalledWith('s1', 7);
    // 카운트업 정지는 유일한 정상 종료 경로 — completed로 결과 화면 진입
    expect(mockedNavigationReplace()).toEqual([
      'FocusResult',
      { focusSeconds: 7, subjectId: 's1', subjectName: '수학', completed: true },
    ]);
    expect(logFocusSessionCompleted).toHaveBeenCalledTimes(1);
    // 실드·Live Activity 해제 + 라이브 레코드 제거
    expect(ScreenTimeModule.stopFocusShield).toHaveBeenCalled();
    expect(ScreenTimeModule.endFocusActivity).toHaveBeenCalled();
    expect(await readLiveRecord()).toBeNull();
  });

  test('마커 시작 실패 — 계측만 남기고 세션은 진행, 종료 업로드는 POST 폴백(sessionId null)', async () => {
    mockedStartMarker.mockRejectedValueOnce(new Error('offline'));
    await renderSession({ mode: 'countup' });
    expect(logFocusMarkerStartFailed).toHaveBeenCalledWith({ reason: 'unknown' });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload.mock.calls[0][0].sessionId).toBeNull();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 3 });
  });
});

describe('일시정지 의미론', () => {
  test('정지 중 경과는 멈추고, 정지 구간은 방해초로 업로드 바디에 실린다', async () => {
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.pause'));
    expect(logFocusSessionPaused).toHaveBeenCalledWith({ elapsed_seconds: 3 });
    await advance(10_000); // 정지 10초 — 경과는 3초에 머문다
    await fireEvent.press(view.getByTestId('focus.pause'));
    expect(logFocusSessionResumed).toHaveBeenCalledTimes(1);
    await advance(2000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    const { body } = mockedUpload.mock.calls[0][0];
    expect(body.totalDistractionSeconds).toBe(10);
    expect(body.distractionCount).toBe(1);
    // 블록 구간은 벽시계 15초, 집중 델타는 5초 — 서버가 방해초로 차감한다
    expect(Date.parse(body.endedAt) - Date.parse(body.startedAt)).toBe(15_000);
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5 });
  });
});

describe('중도 정지의 completed 판정 — 카운트업만 완료 취급', () => {
  test('카운트다운 목표 전 정지: completed=false로 결과 화면 진입', async () => {
    await renderSession({ mode: 'countdown', goalSeconds: 10 });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 3, completed: false });
  });

  test('뽀모도로 세트 도중 정지: completed=false로 결과 화면 진입', async () => {
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
    });
    await advance(10_000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 10, completed: false });
  });
});

describe('카운트다운 — 완료 게이트', () => {
  test('목표 도달 시 결과 직행 대신 게이트: 즉시 정산·실드 해제·진동, 마커는 PATCH가 닫음, 확인 후 replace', async () => {
    await renderSession({ mode: 'countdown', goalSeconds: 3 });
    await advance(3000);

    // 게이트가 화면을 덮고, 정산·해제는 게이트 시점에 이미 끝났다
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload.mock.calls[0][0].body.focusType).toBe('RANGE');
    expect(ScreenTimeModule.stopFocusShield).toHaveBeenCalled();
    // 마커는 취소가 아니라 정산 업로드(PATCH, sessionId 동봉)가 '종료'로 닫는다 — 정산이 참조를
    // 회전시켜 게이트의 cancelLiveSession은 no-op(GROMO-1214의 지급 경로 보존).
    expect(mockedUpload.mock.calls[0][0].sessionId).toBe('marker-1');
    expect(cancelMarker).not.toHaveBeenCalled();
    expect(Vibration.vibrate).toHaveBeenCalled();
    expect(logFocusSessionCompleted).toHaveBeenCalledTimes(1);
    expect(mockNavigation.replace).not.toHaveBeenCalled();

    // 게이트에 머문 시간은 집중으로 계상되지 않는다 — 재정산 없음, 경과 동결
    await advance(10_000);
    expect(mockedUpload).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByText('확인'));
    await flush();
    expect(mockedNavigationReplace()).toEqual([
      'FocusResult',
      { focusSeconds: 3, subjectId: 's1', subjectName: '수학', completed: true },
    ]);
    expect(logFocusSessionCompleted).toHaveBeenCalledTimes(1); // 게이트·finish 이중 발행 없음
  });
});

describe('뽀모도로 — 블록 경계 정산·마커 회전', () => {
  test('집중→휴식 경계마다 블록을 정산하고, 휴식→집중 경계에서 새 마커를 연다', async () => {
    // 시작 호출마다 다른 마커 id — "회전된 새 id가 두 번째 업로드에 실리는가"까지 고정한다
    // (같은 id를 돌려주면 이전 id 재사용 회귀를 못 잡는다 — codex 리뷰).
    mockedStartMarker
      .mockResolvedValueOnce({ sessionId: 'marker-1' })
      .mockResolvedValueOnce({ sessionId: 'marker-2' });
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
    });
    expect(mockedStartMarker).toHaveBeenCalledTimes(1);

    await advance(60_000); // 집중 1분 → 휴식 진입: 블록 #1 정산
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload.mock.calls[0][0].sessionId).toBe('marker-1');
    expect(mockedUpload.mock.calls[0][0].body.focusType).toBe('POMODORO');

    await advance(60_000); // 휴식 1분 → 세트 2 집중: 마커 회전(새 마커)
    await flush();
    expect(mockedStartMarker).toHaveBeenCalledTimes(2);

    await advance(60_000); // 마지막 세트 완료 — 트레일링 휴식 없이 done + 블록 #2 정산
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
    expect(mockedUpload).toHaveBeenCalledTimes(2);
    expect(mockedUpload.mock.calls[1][0].sessionId).toBe('marker-2'); // 회전된 새 id로 종료
    // 두 블록 모두 집중 60초 구간 — 휴식은 어느 블록에도 안 들어간다
    for (const call of mockedUpload.mock.calls) {
      expect(Date.parse(call[0].body.endedAt) - Date.parse(call[0].body.startedAt)).toBe(60_000);
    }
    // 로컬·과목 적립도 블록마다 60초씩 — 업로드만 되고 로컬 누적이 빠지는 회귀 방지(codex 리뷰)
    expect(mockAddFocusSeconds.mock.calls).toEqual([[60], [60]]);
    expect(mockAddFocusToSubject.mock.calls).toEqual([
      ['s1', 60],
      ['s1', 60],
    ]);
    await fireEvent.press(view.getByText('확인'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 120, completed: true });
  });

  test('블록 1의 일시정지 방해초는 블록 2 업로드에 다시 실리지 않는다', async () => {
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
    });
    await advance(10_000);
    await fireEvent.press(view.getByTestId('focus.pause'));
    await advance(5000); // 블록 1에서 5초 정지
    await fireEvent.press(view.getByTestId('focus.pause'));
    await advance(50_000); // 블록 1 잔여 집중 완주 → 휴식 진입 정산

    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload.mock.calls[0][0].body).toMatchObject({
      totalDistractionSeconds: 5,
      distractionCount: 1,
    });

    await advance(60_000); // 휴식
    await advance(60_000); // 블록 2 — 중단 없음
    await flush();
    expect(mockedUpload).toHaveBeenCalledTimes(2);
    // 방해 카운터가 블록 경계에서 리셋 — 안 되면 서버가 블록 2에서도 5초를 또 차감한다
    expect(mockedUpload.mock.calls[1][0].body).toMatchObject({
      totalDistractionSeconds: 0,
      distractionCount: 0,
    });
  });
});

describe('백그라운드 이탈 정책 — 실드 여부가 가른다', () => {
  test('실드 세션: 자리 비운 시간을 집중 인정(전진)·날짜별 적립하고, 정산까지 그대로 흐른다', async () => {
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireAppState('background');
    // 벽시계만 전진 — 리플레이가 유일한 적립 경로임을 강제한다. advance(틱 동반)로 흉내내면
    // creditFocusTicks·focusDays 누락 회귀를 못 잡는다(codex 리뷰: 정산·고아 정산이 5초로 축소).
    await jumpWallClock(120_000);
    await fireAppState('active');

    const record = await readLiveRecord();
    expect(record!.elapsed).toBe(125); // 5 + away 120 전진, 복귀 즉시 저장
    // 리플레이 tick이 날짜 맵에도 적립됐는가 — 고아 정산·서버 분포의 근거
    const localSum = Object.values(record!.focusDays!.local).reduce((a, b) => a + b, 0);
    expect(localSum).toBe(125);
    expect(mockNavigation.replace).not.toHaveBeenCalled(); // 세션은 계속
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();

    // 종료 정산 — 인정분 전체가 로컬 적립·업로드 구간에 실린다
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(125);
    const { body } = mockedUpload.mock.calls[0][0];
    expect(Date.parse(body.endedAt) - Date.parse(body.startedAt)).toBe(125_000);
  });

  test('실드 실패(폴백) 세션: 15초 초과 이탈은 abandoned(leave_timeout)로 자동 종료 — 이탈 시간은 미적립', async () => {
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireAppState('background');
    expect(scheduleLeaveNotifications).toHaveBeenCalled();
    // 벽시계만 20초 전진(틱 없음 = 실기기의 JS suspend). 폴백 경로는 되감기가 없으므로
    // 여기서 advance를 쓰면 이탈 20초가 집중으로 적립되는 회귀를 못 잡는다(codex 리뷰).
    await jumpWallClock(20_000);
    await fireAppState('active');
    await flush();

    expect(cancelLeaveNotifications).toHaveBeenCalled();
    expect(logFocusDistractionDetected).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'leave_timeout', returned_to_focus: false }),
    );
    expect(logFocusSessionAbandoned).toHaveBeenCalledWith(
      expect.objectContaining({ elapsed_seconds: 5, reason: 'leave_timeout' }),
    );
    // 이탈 전 5초만 적립·결과에 반영 — 자리 비운 20초는 집중이 아니다
    expect(mockAddFocusSeconds).toHaveBeenCalledTimes(1);
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(5);
    // 중도 이탈 종료 — completed=false로 결과 화면, 완료 계측은 없다(상호배타)
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5, completed: false });
    expect(logFocusSessionCompleted).not.toHaveBeenCalled();
  });

  test('실드 실패 세션의 15초 이내 복귀: 이탈 계측·알림 취소만 하고 세션은 이어간다', async () => {
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireAppState('background');
    await jumpWallClock(10_000); // 벽시계만 — 실기기의 JS suspend 재현
    await fireAppState('active');

    expect(cancelLeaveNotifications).toHaveBeenCalled(); // 복귀했으면 예약 알림을 거둔다(codex 리뷰)
    expect(logFocusDistractionDetected).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'app_backgrounded', returned_to_focus: true }),
    );
    expect(mockNavigation.replace).not.toHaveBeenCalled();
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();

    // "이어간다" = 복귀 후 타이머가 실제로 다시 전진한다(codex 리뷰 — 동결 회귀 방지)
    await advance(2000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 7 }); // 5 + 복귀 후 2
  });

  test('뽀모도로 휴식 중 이탈: 휴식만 소진하고, 남은 휴식을 넘겨 복귀하면 다음 블록을 일시정지 대기시킨다', async () => {
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
    });
    await advance(60_000); // 블록 1 완료 → 휴식 진입
    expect(mockedStartMarker).toHaveBeenCalledTimes(1);
    await advance(10_000); // 휴식 10초 소진(남은 50초)
    await fireAppState('background');
    await jumpWallClock(80_000); // 남은 휴식(50초)을 넘겨서 복귀
    await fireAppState('active');
    await flush();

    // 집중 경과는 동결(60), 자동 종료 없음, 다음 집중 블록은 일시정지 대기 — 마커도 안 연다
    expect(mockNavigation.replace).not.toHaveBeenCalled();
    expect(mockedStartMarker).toHaveBeenCalledTimes(1); // 사용자가 없는 동안 새 마커 금지
    await advance(10_000); // 대기 중 시간이 흘러도
    await fireEvent.press(view.getByTestId('focus.pause')); // 재개
    await flush();
    expect(mockedStartMarker).toHaveBeenCalledTimes(2); // 재개 시점에야 다음 블록 마커
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    // 60(블록1) + 재개 후 3 — 휴식·대기·이탈은 한 초도 집중으로 안 들어간다
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 63 });
  });
});

// navigation.replace의 마지막 호출 인자 — 단언을 읽기 쉽게 하는 헬퍼
function mockedNavigationReplace(): [string, Record<string, unknown>] | undefined {
  return mockNavigation.replace.mock.calls.at(-1) as [string, Record<string, unknown>] | undefined;
}
