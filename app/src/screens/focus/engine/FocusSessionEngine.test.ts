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
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { createFocusSessionEngine, type FocusEngineDeps } from './FocusSessionEngine';
import { readPersistedSessionV1, reconstructSessionFromV1 } from './persistence';
import { readJournal } from './journal';
import { ensureFocusTagId } from '../tagSync';
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

// 정산은 태그 해석 → 저널 intent 기록(AsyncStorage RMW) → 업로드로 이어지는 여러 단계의
// await라, 마이크로태스크를 넉넉히 흘려야 업로드 목까지 도달한다(얕게 흘리면 「호출 0회」로
// 보인다 — 저널 도입 때 실제로 물렸다).
const flush = async () => {
  for (let i = 0; i < 300; i++) await Promise.resolve();
};

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

test('영속 v1 이중 기록: legacy와 대칭으로 쓰이고, 콜드 스타트 재구성 왕복이 성립한다', async () => {
  const engine = createFocusSessionEngine(pomodoroConfig, makeDeps());
  engine.startLiveSession(engine.sessionStartedAt());
  engine.startTicking();
  await advance(60_000); // 집중 60초 완주 tick — 5의 배수라 저장, 페이즈는 휴식으로 전환됨
  const v1 = await readPersistedSessionV1();
  expect(v1).toMatchObject({
    version: 1,
    userId: 'user-1',
    subjectId: 's1',
    mode: 'pomodoro',
    phase: 'break', // 60초 tick이 페이즈를 옮긴 뒤의 상태 — legacy에는 없는 정보
    setIndex: 1,
    isPaused: false,
    elapsedSeconds: 60,
    displaySeconds: 60, // 휴식 잔여
    unsettledSeconds: 60,
    settledSeconds: 0,
    shielded: false,
    serverSessionId: 'marker-1',
  });
  expect(v1!.sessionKey).not.toBe('');
  // 재구성 — 죽었다 살아나도 상태 머신 입력이 복원된다(§4.1-①). 재개 정책은 페이즈 1.
  const rebuilt = reconstructSessionFromV1(v1!);
  expect(rebuilt.config).toEqual(pomodoroConfig);
  expect(rebuilt.session).toEqual({
    elapsed: 60,
    display: 60,
    phase: 'break',
    setIndex: 1,
    done: false,
  });
  // finish — 두 표현 모두 제거(대칭)
  await engine.finish(true);
  await flush();
  expect(await readPersistedSessionV1()).toBeNull();
  expect(await readLiveRecord()).toBeNull();
  engine.stopTicking();
});

test('원자적 시작(§4.3): 저널이 starting→active로 전이하고 v1 커밋 흔적이 함께 남는다', async () => {
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  await engine.start('수학');
  await flush();
  const journal = await readJournal();
  expect(journal.session).toMatchObject({
    state: 'active', // starting은 실드 적용 전 중간 상태 — 커밋 후 같은 레코드가 원자 갱신된다
    shieldRequested: true,
  });
  expect(journal.session!.sessionKey).not.toBe('');
  // 커밋 흔적(v1) — 복구가 「실드만 남은 크래시」와 「커밋된 시작」을 구별하는 근거
  const v1 = await readPersistedSessionV1();
  expect(v1!.sessionKey).toBe(journal.session!.sessionKey);
  // 마커도 이 시작에서 열린다
  expect(mockedStartMarker).toHaveBeenCalledTimes(1);
  // finish — 저널 세션 항목은 소거된다
  engine.startTicking();
  await advance(3000);
  await engine.finish(true);
  await flush();
  expect((await readJournal()).session).toBeNull();
  engine.stopTicking();
});

test('D1: 업로드 failed면 settle intent가 보존되고, saved면 소멸한다', async () => {
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  await engine.start('수학');
  engine.startTicking();
  await advance(5000);

  // ① 대기열 저장까지 실패 — 이 intent가 유일한 재시도 근거다(종전엔 영구 유실)
  mockedUpload.mockResolvedValueOnce({ status: 'failed' });
  await engine.finish(true);
  await flush();
  const afterFailed = await readJournal();
  expect(afterFailed.settles).toHaveLength(1);
  expect(afterFailed.settles[0].body).toMatchObject({ subject: '수학' });
  expect(afterFailed.settles[0].userId).toBe('user-1');
  engine.stopTicking();

  // ② 새 세션에서 정상 저장 — 그 세션의 intent는 남지 않는다
  const engine2 = createFocusSessionEngine(countupConfig, makeDeps());
  await engine2.start('수학');
  engine2.startTicking();
  await advance(5000);
  await engine2.finish(true);
  await flush();
  const afterSaved = await readJournal();
  expect(afterSaved.settles).toHaveLength(1); // ①의 failed 분만 남아 있다
  expect(afterSaved.settles[0].intentId).toBe(afterFailed.settles[0].intentId);
  engine2.stopTicking();
});

test('시작 도중 이탈: 남은 단계를 중단하고 켠 실드를 회수한다', async () => {
  // 화면은 start를 기다리지 않는다(fire-and-forget). 진입 직후 뒤로가기가 나면 정리가 먼저
  // 끝나고 **그 뒤에** 남은 단계가 실행돼, 실드가 다시 켜지고 마커가 새로 열린다(codex #694).
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  const startPromise = engine.start('수학');
  engine.detachViewExit(); // 아직 start의 await들이 끝나기 전
  await startPromise;
  await flush();

  // 마커를 새로 열지 않는다 — 떠난 세션이 친구 화면에 '집중 중'으로 살아나지 않게
  expect(mockedStartMarker).not.toHaveBeenCalled();
  // 실드도 켜지 않는다 — 이탈이 확인되면 그 단계 자체를 건너뛴다(이미 켠 뒤에 확인되면
  // abortStart가 회수한다). 떠난 화면의 차단이 남지 않는 게 계약이다.
  expect(ScreenTimeModule.startFocusShield).not.toHaveBeenCalled();
  // 시작 의도도 저널에 남기지 않는다 — 다음 부팅 복구가 헛돌지 않게
  expect((await readJournal()).session).toBeNull();
});

test('정산 intent를 네트워크 대기 **전에** 남긴다 — 태그·마커 응답을 기다리다 죽어도 복구된다', async () => {
  // 이 시점엔 이미 레코드를 지우고 로컬 적립까지 끝났다. 태그 해석·마커 응답을 기다리는 동안
  // OS가 프로세스를 종료하면 업로드·대기열·저널 어디에도 바디가 없어 영구 유실된다(codex #694).
  let resolveTag: (v: string) => void = () => {};
  (ensureFocusTagId as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<string>((r) => {
        resolveTag = r;
      }),
  );
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  await engine.start('수학');
  engine.startTicking();
  await advance(5000);
  await engine.finish(true);
  await flush();

  // 태그가 아직 안 풀렸는데도 intent는 이미 저널에 있다 — 바디에 모드·구간·방해·날짜가 실렸다
  const pending = await readJournal();
  expect(pending.settles).toHaveLength(1);
  expect(pending.settles[0].body).toMatchObject({
    subject: '수학',
    focusType: 'INFINITE',
    focusTagId: null, // 아직 미해석 — 완성본으로 교체된다
  });
  expect(mockedUpload).not.toHaveBeenCalled(); // 아직 네트워크 대기 중

  resolveTag('tag-1');
  await flush();
  // 완성본으로 교체(upsert) — 같은 intentId라 늘어나지 않는다
  const after = await readJournal();
  expect(after.settles.length).toBeLessThanOrEqual(1);
  expect(mockedUpload).toHaveBeenCalledTimes(1);
  engine.stopTicking();
});

test('정산: intent가 영속되기 **전에는** 레코드를 지우지 않는다 — 순서가 계약', async () => {
  // 지우기가 먼저 반영되고 저널 쓰기가 아직이면 그 창에서 업로드·대기열·저널·레코드가
  // 전부 없어져 블록이 영구 유실된다(codex 리뷰 #694 4차). 정산 경로(뽀모도로 경계)로 본다 —
  // finish는 자체적으로 레코드를 먼저 지우는 별도 계약이라 이 순서를 관찰할 수 없다.
  const engine = createFocusSessionEngine(pomodoroConfig, makeDeps());
  await engine.start('수학');
  engine.startTicking();
  await advance(60_000); // 집중 1분 완주 — 경계에서 정산이 돈다
  expect(await readLiveRecord()).not.toBeNull(); // 주기 저장이 남긴 레코드

  // 저널 쓰기를 붙잡아 둔다 — 이 상태에서 레코드가 지워지면 계약 위반이다
  const setItem = AsyncStorage.setItem as unknown as jest.Mock;
  const real = setItem.getMockImplementation();
  let releaseJournal: () => void = () => {};
  setItem.mockImplementation((key: string, value: string) => {
    if (key === STORAGE_KEYS.focusJournalV1) {
      return new Promise<void>((r) => {
        releaseJournal = () => r();
      });
    }
    return real?.(key, value) ?? Promise.resolve();
  });
  engine.handlePhaseTransition();
  await flush();
  expect(await readLiveRecord()).not.toBeNull(); // 아직 지우지 않았다

  setItem.mockImplementation(real ?? (() => Promise.resolve()));
  releaseJournal();
  await flush();
  expect(await readLiveRecord()).toBeNull(); // 영속된 뒤에야 지운다
  engine.stopTicking();
});

test('커밋 흔적 쓰기가 실패하면 시작을 성립시키지 않는다 — 실드 회수', async () => {
  // 삼키고 active로 넘어가면 첫 5초 저장 전에 죽었을 때 기록이 어디에도 없는데 저널만
  // active라, 부팅 복구가 손대지 않아 세션 시간이 통째로 유실된다(codex #694).
  const setItem = AsyncStorage.setItem as unknown as jest.Mock;
  const real = setItem.getMockImplementation();
  // **v1 키만** 실패시킨다 — 첫 setItem은 저널 write-ahead라 그걸 잡으면 다른 경로를 본다.
  setItem.mockImplementation((key: string, value: string) =>
    key === STORAGE_KEYS.focusSessionV1
      ? Promise.reject(new Error('disk full'))
      : (real?.(key, value) ?? Promise.resolve()),
  );
  const engine = createFocusSessionEngine(countupConfig, makeDeps());
  await engine.start('수학');
  await flush();
  setItem.mockImplementation(real ?? (() => Promise.resolve()));

  expect(mockedStartMarker).not.toHaveBeenCalled(); // 마커를 열지 않는다
  expect(ScreenTimeModule.stopFocusShield).toHaveBeenCalled(); // 켠 실드는 회수
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
