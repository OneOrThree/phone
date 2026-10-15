// 엔진 단독 구동 테스트 (GROMO-1600 완료 조건) — **render 없음**이 곧 증거다.
// 화면 없이(useState·이펙트·AppState 목 없이) 엔진을 직접 만들어 틱·정산·마커·이탈을
// 구동한다. 목 경계는 특성화 스위트와 동일(모듈 경로) — 엔진이 같은 경로를 import하는
// 것이 특성화 green 유지의 전제이고, 여기서도 같은 경계로 관찰한다.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { startFocusSession } from '@/services/focusApi';
import { uploadFocusBlock } from '../uploadFocusBlock';
import { cancelMarker } from '../pendingMarkerCancels';
import type { LiveFocusSession } from '../types';
import { createFocusSessionEngine, type FocusEngineDeps } from './FocusSessionEngine';
import type { SessionMachineConfig } from './machine';

jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    startFocusShield: jest.fn(() => Promise.resolve(true)),
    stopFocusShield: jest.fn(() => Promise.resolve()),
    startFocusActivity: jest.fn(() => Promise.resolve()),
    updateFocusActivity: jest.fn(() => Promise.resolve()),
    endFocusActivity: jest.fn(() => Promise.resolve()),
    saveCharacterSnapshot: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock('@/services/focusApi', () => ({
  startFocusSession: jest.fn(() => Promise.resolve({ sessionId: 'marker-1', startedAt: 'x' })),
}));
jest.mock('../uploadFocusBlock', () => ({
  uploadFocusBlock: jest.fn(() => Promise.resolve({ status: 'saved', response: {} })),
}));
jest.mock('../pendingMarkerCancels', () => ({
  cancelMarker: jest.fn(() => Promise.resolve()),
  flushPendingMarkerCancels: jest.fn(() => Promise.resolve()),
}));
jest.mock('../tagSync', () => ({
  ensureFocusTagId: jest.fn(() => Promise.resolve('tag-1')),
}));
jest.mock('../sessionSaveVerdict', () => ({
  isTodayVerdict: jest.fn(() => true),
  publishSessionSaveVerdict: jest.fn(),
}));
jest.mock('../leaveNotifications', () => ({
  scheduleLeaveNotifications: jest.fn(() => Promise.resolve()),
  cancelLeaveNotifications: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/services/analyticsEvents', () => ({
  logFocusDistractionDetected: jest.fn(),
  logFocusMarkerStartFailed: jest.fn(),
  logFocusSessionAbandoned: jest.fn(),
  logFocusSessionCompleted: jest.fn(),
  logFocusSessionPaused: jest.fn(),
  logFocusSessionResumed: jest.fn(),
}));

const mockedUpload = uploadFocusBlock as jest.Mock;
const mockedStartMarker = startFocusSession as jest.Mock;

const pomodoroConfig: SessionMachineConfig = {
  mode: 'pomodoro',
  goalSeconds: 25 * 60,
  pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
};
const countupConfig: SessionMachineConfig = {
  mode: 'countup',
  goalSeconds: 25 * 60,
  pomodoro: { focusMin: 25, breakMin: 5, sets: 4 },
};

const delegates = {
  addFocusSeconds: jest.fn(),
  addFocusToSubject: jest.fn(),
  refreshCoins: jest.fn(),
};
const makeDeps = (): FocusEngineDeps => ({
  identity: () => ({ subjectId: 's1', subjectName: '수학', userId: 'user-1' }),
  settleDelegates: () => delegates,
  preSessionTodaySeconds: 0,
});

const flush = () => Promise.resolve().then(() => Promise.resolve());

async function advance(ms: number) {
  for (let i = 0; i < ms; i += 1000) {
    jest.advanceTimersByTime(Math.min(1000, ms - i));
    await flush();
  }
}

async function readLiveRecord(): Promise<LiveFocusSession | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
  return raw ? (JSON.parse(raw) as LiveFocusSession) : null;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

test('헤드리스 구동: 뽀모도로 1분 블록 — 틱·5초 레코드·경계 정산 바디·마커 회전이 화면 없이 돈다', async () => {
  const engine = createFocusSessionEngine(pomodoroConfig, makeDeps());
  engine.startLiveSession(engine.sessionStartedAt());
  engine.startTicking();
  await flush();
  expect(mockedStartMarker).toHaveBeenCalledTimes(1);

  await advance(5000);
  const record = await readLiveRecord();
  expect(record).toMatchObject({ subjectId: 's1', elapsed: 5, userId: 'user-1' });
  expect(record!.serverSessionId).toBe('marker-1');

  // 집중 1분 완주 — 페이즈 경계는 화면 이펙트 대응인 handlePhaseTransition이 처리한다
  await advance(55_000);
  expect(engine.getSession()).toMatchObject({ phase: 'break', setIndex: 1, elapsed: 60 });
  engine.handlePhaseTransition();
  await flush();
  expect(mockedUpload).toHaveBeenCalledTimes(1);
  const { body } = mockedUpload.mock.calls[0][0];
  expect(body).toMatchObject({
    subject: '수학',
    focusType: 'POMODORO',
    distractionCount: 0,
    totalDistractionSeconds: 0,
  });
  expect(delegates.addFocusSeconds).toHaveBeenCalledWith(60);
  expect(delegates.addFocusToSubject).toHaveBeenCalledWith('s1', 60);
  // 정산 완료분은 레코드에서 제거 — 고아 이중 정산 방지
  expect(await readLiveRecord()).toBeNull();

  // 휴식 소진 → 다음 집중 블록: 새 마커가 열린다(회전)
  await advance(60_000);
  engine.handlePhaseTransition();
  await flush();
  expect(mockedStartMarker).toHaveBeenCalledTimes(2);
  engine.stopTicking();
});

test('일시정지: elapsed·레코드가 멈추고 재개 후 이어진다 — 방해초가 정산 바디에 실린다', async () => {
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  engine.startLiveSession(engine.sessionStartedAt());
  engine.startTicking();
  await advance(5000);
  engine.togglePause();
  expect(engine.isPausedState()).toBe(true);
  await advance(10_000); // 정지 10초 — 틱 없음
  expect(engine.getSession().elapsed).toBe(5);
  engine.togglePause();
  await advance(5000);
  expect(engine.getSession().elapsed).toBe(10);
  const result = await engine.finish(true);
  expect(result).toEqual({ focusSeconds: 10, completed: true });
  await flush();
  expect(mockedUpload).toHaveBeenCalledTimes(1);
  expect(mockedUpload.mock.calls[0][0].body).toMatchObject({
    distractionCount: 1,
    totalDistractionSeconds: 10,
  });
  // finish 멱등 — 재진입은 null(화면은 이동하지 않는다)
  expect(await engine.finish(true)).toBeNull();
  engine.stopTicking();
});

test('이탈 관측 직접 주입: 실드 세션의 백그라운드 왕복 — 자리 비운 시간이 집중으로 전진한다', async () => {
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  engine.applyShield('수학');
  await flush(); // 실드 적용(shielded=true)
  engine.startLiveSession(engine.sessionStartedAt());
  engine.startTicking();
  await advance(3000);
  engine.onAppStateChange('background', { onLeaveTimeout: () => {} });
  // 백그라운드 60초 — JS suspend 재현: 틱 없이 벽시계만 전진
  jest.setSystemTime(Date.now() + 60_000);
  engine.onAppStateChange('active', { onLeaveTimeout: () => {} });
  await flush();
  expect(engine.getSession().elapsed).toBe(63); // 3초 + 크레딧 60초
  engine.stopTicking();
});

test('무실드 세션의 15초 초과 이탈: onLeaveTimeout 훅이 불린다(자동 종료 위임)', async () => {
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  engine.startLiveSession(engine.sessionStartedAt());
  engine.startTicking();
  await advance(3000);
  const onLeaveTimeout = jest.fn();
  engine.onAppStateChange('background', { onLeaveTimeout });
  jest.setSystemTime(Date.now() + 20_000);
  engine.onAppStateChange('active', { onLeaveTimeout });
  expect(onLeaveTimeout).toHaveBeenCalledTimes(1);
  engine.stopTicking();
});

test('경과 0의 finish: 정산 없이 마커 취소로 닫는다', async () => {
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  engine.startLiveSession(engine.sessionStartedAt());
  engine.startTicking();
  const result = await engine.finish(true);
  expect(result).toEqual({ focusSeconds: 0, completed: true });
  await flush();
  expect(mockedUpload).not.toHaveBeenCalled(); // 정산할 델타가 없다
  expect(cancelMarker).toHaveBeenCalledWith('marker-1', 'user-1');
  engine.stopTicking();
});
