// 엔진 단독 구동 테스트 (GROMO-1600 완료 조건) — **render 없음**이 곧 증거다.
// 화면 없이(useState·이펙트·AppState 목 없이) 엔진을 직접 만들어 틱·정산·마커·이탈을
// 구동한다. 목 경계는 특성화 스위트와 동일(모듈 경로) — 엔진이 같은 경로를 import하는
// 것이 특성화 green 유지의 전제이고, 여기서도 같은 경계로 관찰한다.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { startFocusSession } from '@/services/focusApi';
import ScreenTimeModule from '@/services/ScreenTimeModule';
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
    // 동기 판정 2종(GROMO-1604) — 기본은 '살아 있음'. 실드가 죽은 경우를 보는 테스트가
    // 개별로 덮어쓴다. iOS 실제 구현도 항상 true 라 기본값이 같다.
    isFocusShieldAlive: jest.fn(() => true),
    didFocusShieldComplete: jest.fn(() => false),
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

test('실드 해제: 레코드에 「우리가 내렸다」 표식을 남긴다', async () => {
  // 시스템 Back 이탈은 레코드를 일부러 남긴다 — 표식이 없으면 다음 실행의 고아 정산이
  // 정상 종료까지 '강제 종료로 차단이 풀렸다'고 알린다(markShieldReleasedCleanly 주석).
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  engine.applyShield('수학');
  await flush();
  engine.startTicking();
  await advance(3000);
  engine.persistLiveRecord(engine.getSession().elapsed);
  await flush();
  expect((await readLiveRecord())!.shieldReleasedCleanly).toBeUndefined();

  engine.releaseShield();
  await flush();
  expect((await readLiveRecord())!.shieldReleasedCleanly).toBe(true);
  engine.stopTicking();
});

test('8시간 상한에 걸린 실드 세션: 네이티브가 끝나도 남은 세션을 다시 보호한다', async () => {
  // ⚠️ 페이즈로 가르면 이 경우를 놓친다(코드리뷰 12차). 전체 일정이 8시간을 넘으면 **집중 중**
  //    이탈이어도 리플레이가 AWAY_CREDIT_CAP_S 에서 멈춰 JS 세션에 시간이 남는다. 네이티브
  //    서비스는 이미 만료로 끝났으므로, 실드를 살아 있다고 보면 이후 이탈이 차단 없이 집중으로
  //    적립된다.
  const twelveHours: SessionMachineConfig = {
    mode: 'countdown',
    goalSeconds: 12 * 3600,
    pomodoro: { focusMin: 25, breakMin: 5, sets: 4 },
  };
  const engine = createFocusSessionEngine(twelveHours, makeDeps());
  engine.applyShield('수학');
  await flush();
  engine.startTicking();
  await advance(3000);

  const mockedShield = ScreenTimeModule.startFocusShield as jest.Mock;
  mockedShield.mockClear();
  (ScreenTimeModule.isFocusShieldAlive as jest.Mock).mockReturnValue(false);
  (ScreenTimeModule.didFocusShieldComplete as jest.Mock).mockReturnValue(true);

  engine.onAppStateChange('background', { onLeaveTimeout: () => {} });
  jest.setSystemTime(Date.now() + 9 * 3600_000); // 9시간 — 상한(8h)을 넘는다
  engine.onAppStateChange('active', { onLeaveTimeout: () => {} });
  await flush();

  expect(engine.getSession().done).toBe(false); // 12시간 중 8시간만 전진 — 아직 남았다
  expect(mockedShield).toHaveBeenCalledTimes(1); // 남은 세션을 다시 건다
  engine.stopTicking();
});

test('실드 세션 복귀의 LA 푸시: 크레딧 전진이 **반영된 뒤** 값이다', async () => {
  // 리플레이 앞에서 밀면 크레딧 전진 전 값이 나간다. 그 복귀가 페이즈 경계를 넘지 않으면
  // 화면 이펙트도 안 돌아(phase·setIndex 그대로) 낡은 값이 그대로 남는다.
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  engine.applyShield('수학');
  await flush();
  engine.startTicking();
  await advance(3000);
  const mockedUpdate = ScreenTimeModule.updateFocusActivity as jest.Mock;
  mockedUpdate.mockClear();

  engine.onAppStateChange('background', { onLeaveTimeout: () => {} });
  jest.setSystemTime(Date.now() + 60_000);
  engine.onAppStateChange('active', { onLeaveTimeout: () => {} });
  await flush();

  expect(engine.getSession().elapsed).toBe(63);
  expect(mockedUpdate).toHaveBeenCalledTimes(1);
  expect(mockedUpdate.mock.calls[0][0]).toMatchObject({ elapsedSeconds: 63 });
  engine.stopTicking();
});

test('과목 변경의 실드 재적용이 실패하면: 실드 세션 대우를 거둔다', async () => {
  // ⚠️ 첫 적용이 **성공한 뒤**가 진짜 구멍이다. 재적용 실패를 그냥 삼키면 shielded 가 true 로
  //    남아, 차단이 없는데도 자리 비운 시간이 집중으로 적립된다. (첫 적용부터 실패하는
  //    경우는 shielded 초기값이 false 라 삼켜도 티가 안 난다 — 이 순서로만 드러난다.)
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  engine.applyShield('수학');
  await flush();
  expect(engine.isShielded()).toBe(true);

  (ScreenTimeModule.startFocusShield as jest.Mock).mockRejectedValueOnce(new Error('권한 없음'));
  engine.applyShield('영어'); // 과목 변경 — stop 없이 start 만 다시 부른다
  await flush();
  expect(engine.isShielded()).toBe(false);

  engine.startTicking();
  await advance(3000);
  const onLeaveTimeout = jest.fn();
  engine.onAppStateChange('background', { onLeaveTimeout });
  jest.setSystemTime(Date.now() + 20_000);
  engine.onAppStateChange('active', { onLeaveTimeout });
  expect(onLeaveTimeout).toHaveBeenCalledTimes(1);
  engine.stopTicking();
});

test('짧은 이탈 복귀: 페이즈가 그대로여도 Live Activity 잔여를 다시 민다', async () => {
  // 화면의 갱신 이펙트는 paused·phase·setIndex 가 바뀔 때만 돈다. 15초 이내 이탈은 그 셋이
  // 그대로라 안 도는데, 네이티브 만료 시계는 계속 흐른다 — 짧은 이탈을 반복하면 알림만
  // 먼저 00:00 에 닿아 세션보다 먼저 완료 표식을 만든다(코드리뷰 10차).
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  engine.startTicking();
  await advance(3000);
  const mockedUpdate = ScreenTimeModule.updateFocusActivity as jest.Mock;
  mockedUpdate.mockClear();

  engine.onAppStateChange('background', { onLeaveTimeout: () => {} });
  jest.setSystemTime(Date.now() + 5000); // 15초 이내 — 페이즈 변화 없음
  engine.onAppStateChange('active', { onLeaveTimeout: () => {} });
  await flush();
  expect(mockedUpdate).toHaveBeenCalledTimes(1);
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
