/**
 * 실드 없는 집중의 앱 이탈 폴백(GROMO-2635) — 나가면 pause·알림 예약, 15초 안 복귀는 resume, 넘기면 finish,
 * 나간 채 꺼졌으면 다음 실행에서 같은 판정.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';
import {
  duringSystemPrompt,
  LEAVE_END_MS,
  leaveSettlement,
  leaveTarget,
  useFocusLeaveFallback,
  type LeaveHandlers,
} from '@/screens/focus/focusLeave';
import { initialState, type Session, type State } from '@/services/model';

const mockShieldApplied = jest.fn(async () => false);
jest.mock('@/services/focusShield', () => ({ focusShieldApplied: () => mockShieldApplied() }));
const mockInteractive = jest.fn(async () => true);
jest.mock('@/services/ScreenTimeModule', () => ({
  screenTimeNative: { isScreenInteractive: () => mockInteractive() },
}));
const mockSchedule = jest.fn(async () => 'id');
const mockCancel = jest.fn(async () => {});
jest.mock('@/services/push', () => ({
  bridgedNotifications: () => ({
    SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
    scheduleNotificationAsync: mockSchedule,
    cancelScheduledNotificationAsync: mockCancel,
  }),
}));

const session = (patch: Partial<Session> = {}): Session => ({
  id: 's1',
  islandId: 'i1',
  subject: '수학',
  startedAt: 0,
  seconds: 0,
  status: 'active',
  version: 1,
  ...patch,
});

describe('leaveSettlement', () => {
  const mark = { sessionId: 's1', leftAt: 100_000 };
  it('15초 안에 돌아오면 휴식 중인 세션만 이어 간다', () => {
    expect(leaveSettlement(mark, session({ status: 'paused' }), 100_000 + LEAVE_END_MS)).toBe(
      'resume',
    );
    // pause 가 실패해 아직 진행 중이면 할 일이 없다
    expect(leaveSettlement(mark, session(), 105_000)).toBeNull();
    // 시계가 뒤로 가도 끝내지 않는다
    expect(leaveSettlement(mark, session({ status: 'paused' }), 0)).toBe('resume');
  });
  it('15초를 넘기면 끝낸다', () => {
    expect(leaveSettlement(mark, session({ status: 'paused' }), 100_000 + LEAVE_END_MS + 1)).toBe(
      'finish',
    );
    expect(leaveSettlement(mark, session(), 200_000)).toBe('finish');
  });
  it('표시한 세션이 아니거나 세션이 없으면 아무것도 하지 않는다', () => {
    expect(leaveSettlement(mark, session({ id: 's2' }), 200_000)).toBeNull();
    expect(leaveSettlement(mark, null, 200_000)).toBeNull();
  });
});

it('leaveTarget — 진행 중인 서버 섬 집중만', () => {
  expect(leaveTarget(session())).toBe(true);
  expect(leaveTarget(session({ status: 'paused' }))).toBe(false);
  expect(leaveTarget(session({ kind: 'sea' }))).toBe(false);
  expect(leaveTarget(session({ version: undefined }))).toBe(false);
  expect(leaveTarget(session(), { step: 8, sessionId: 's1' })).toBe(false);
  expect(leaveTarget(null)).toBe(false);
});

describe('useFocusLeaveFallback', () => {
  let appListener: ((state: string) => void) | null;
  let now: number;
  let state: State;
  const handlers: LeaveHandlers = { resume: jest.fn(), finish: jest.fn(), checkEnded: jest.fn() };
  const pause = jest.fn(async () => {});
  let busy = false;
  // pause 가 바꾼 세션을 훅이 보게 같은 ref 를 고친다
  const mount = (slowPause?: Promise<void>) => {
    const ref = { current: state };
    pause.mockImplementation(async () => {
      await slowPause;
      ref.current = { ...ref.current, session: session({ status: 'paused', version: 2 }) };
    });
    return renderHook(() =>
      useFocusLeaveFallback({
        enabled: true,
        stateRef: ref,
        pause,
        busy: () => busy,
        handlers: { current: handlers },
      }),
    );
  };
  const flush = () => act(async () => {});

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    appListener = null;
    busy = false;
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    state = { ...initialState(), session: session() };
    (AppState as any).addEventListener = jest.fn((_t: string, cb: (s: string) => void) => {
      appListener = cb;
      return { remove: jest.fn() };
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('나가면 pause 와 알림 2개, 15초 안에 돌아오면 알림을 지우고 이어 간다', async () => {
    await mount();
    await flush();
    const leftAt = now;
    await act(async () => appListener!('background'));
    await flush();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    expect(JSON.parse((await AsyncStorage.getItem('catus:focus-leave:v1'))!)).toEqual({
      sessionId: 's1',
      leftAt,
    });
    now += 10_000;
    await act(async () => appListener!('active'));
    await flush();
    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(handlers.resume).toHaveBeenCalledTimes(1);
    expect(handlers.finish).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('catus:focus-leave:v1')).toBeNull();
  });

  it('15초를 넘겨 돌아오면 끝낸다', async () => {
    await mount();
    await flush();
    await act(async () => appListener!('background'));
    await flush();
    now += LEAVE_END_MS + 1;
    await act(async () => appListener!('active'));
    await flush();
    expect(handlers.finish).toHaveBeenCalledTimes(1);
    expect(handlers.resume).not.toHaveBeenCalled();
  });

  it('실드가 걸린 집중은 건드리지 않는다', async () => {
    mockShieldApplied.mockResolvedValueOnce(true);
    await mount();
    await flush();
    await act(async () => appListener!('background'));
    await flush();
    now += 60_000;
    await act(async () => appListener!('active'));
    await flush();
    expect(pause).not.toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(handlers.finish).not.toHaveBeenCalled();
  });

  it('나간 채 꺼졌던 집중은 다음 실행에서 끝낸다', async () => {
    await AsyncStorage.setItem(
      'catus:focus-leave:v1',
      JSON.stringify({ sessionId: 's1', leftAt: now - 60_000 }),
    );
    state = { ...state, session: session({ status: 'paused', version: 2 }) };
    await mount();
    await flush();
    expect(handlers.finish).toHaveBeenCalledTimes(1);
    // 꺼지기 전에 예약한 알림도 고정 id 로 지운다
    expect(mockCancel).toHaveBeenCalledWith('catus-focus-leave-end');
    expect(await AsyncStorage.getItem('catus:focus-leave:v1')).toBeNull();
  });

  it('나간 시간은 돌아온 순간까지로 잰다 — pause 응답이 늦어도 제때 돌아왔으면 이어 간다', async () => {
    let release!: () => void;
    await mount(new Promise<void>((resolve) => (release = resolve)));
    await flush();
    await act(async () => appListener!('background'));
    now += 3_000;
    await act(async () => appListener!('active'));
    // 알림은 pause 응답을 기다리지 않고 지운다
    expect(mockCancel).toHaveBeenCalledTimes(2);
    now += 30_000;
    await act(async () => release());
    await flush();
    expect(handlers.resume).toHaveBeenCalledTimes(1);
    expect(handlers.finish).not.toHaveBeenCalled();
  });

  it('Android 는 화면을 끈(잠근) 것은 나간 것으로 보지 않는다', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockInteractive.mockResolvedValueOnce(false);
    await mount();
    await flush();
    await act(async () => appListener!('background'));
    await flush();
    now += 60_000;
    await act(async () => appListener!('active'));
    await flush();
    expect(pause).not.toHaveBeenCalled();
    expect(handlers.finish).not.toHaveBeenCalled();
    // 화면이 켜진 채 나가면 그대로 폴백한다
    await act(async () => appListener!('background'));
    await flush();
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('사용자가 누른 명령이 진행 중이거나 시스템 권한 창이 떠 있으면 나간 것으로 보지 않는다', async () => {
    await mount();
    await flush();
    busy = true;
    await act(async () => appListener!('background'));
    await act(async () => appListener!('active'));
    busy = false;
    let answer!: () => void;
    const prompt = duringSystemPrompt(() => new Promise<void>((resolve) => (answer = resolve)));
    await act(async () => appListener!('background'));
    await act(async () => appListener!('active'));
    await act(async () => answer());
    await prompt;
    await flush();
    expect(pause).not.toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('오래 나가 있다 오면 표시가 없어도 서버가 닫았는지 본다', async () => {
    state = { ...state, session: session({ kind: 'sea' }) };
    await mount();
    await flush();
    await act(async () => appListener!('background'));
    await flush();
    now += 3 * 60 * 60 * 1000;
    await act(async () => appListener!('active'));
    await flush();
    expect(pause).not.toHaveBeenCalled();
    expect(handlers.checkEnded).toHaveBeenCalledTimes(1);
  });
});
