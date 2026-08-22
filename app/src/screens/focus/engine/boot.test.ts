// 부팅 복구 테스트 (GROMO-1600) — **render 없음**. 저장소에 「죽은 순간」을 시드해 두고
// recoverFocusEngine이 회수하는지 본다. 크래시 창은 실제로 프로세스를 죽일 수 없으므로,
// 저널·v1 레코드를 그 순간의 조합으로 직접 심어 재현한다.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { uploadFocusBlock } from '../uploadFocusBlock';
import { recoverFocusEngine } from './boot';
import { readJournal } from './journal';
import { drainWatchCommands, ackWatchCommands } from './watchInbox';

jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: { stopFocusShield: jest.fn(() => Promise.resolve()) },
}));
jest.mock('../uploadFocusBlock', () => ({
  uploadFocusBlock: jest.fn(() => Promise.resolve({ status: 'saved', response: {} })),
}));
jest.mock('../pendingMarkerCancels', () => ({
  cancelMarker: jest.fn(() => Promise.resolve()),
}));
jest.mock('./watchInbox', () => ({
  drainWatchCommands: jest.fn(() => Promise.resolve([])),
  ackWatchCommands: jest.fn(() => Promise.resolve()),
}));

const mockedUpload = uploadFocusBlock as jest.Mock;
const mockedStopShield = ScreenTimeModule.stopFocusShield as jest.Mock;

const SESSION_KEY = 'fs-test-key';
const OWNER = 'user-1';

const journalWith = (session: unknown, settles: unknown[] = []) =>
  AsyncStorage.setItem(
    STORAGE_KEYS.focusJournalV1,
    JSON.stringify({ version: 1, session, settles }),
  );

const startingSession = {
  sessionKey: SESSION_KEY,
  state: 'starting',
  shieldRequested: true,
  serverSessionId: null,
  createdAt: '2026-08-22T10:00:00.000Z',
  updatedAt: '2026-08-22T10:00:00.000Z',
};

// 커밋 흔적 — 시작이 성공했다는 유일한 증거(v1 레코드의 sessionKey가 저널과 일치)
const commitTrace = {
  version: 1,
  sessionKey: SESSION_KEY,
  userId: OWNER,
  subjectId: 's1',
  subjectName: '수학',
  mode: 'countup',
  goalSeconds: null,
  pomodoro: null,
  phase: 'focus',
  setIndex: 1,
  isPaused: false,
  done: false,
  displaySeconds: 0,
  elapsedSeconds: 0,
  startedAt: '2026-08-22T10:00:00.000Z',
  blockStartedAt: '2026-08-22T10:00:00.000Z',
  unsettledSeconds: 0,
  settledSeconds: 0,
  blockPause: { pausedMs: 0, count: 0, startedAt: null },
  focusDays: { local: {}, server: {}, kst: {} },
  awayCreditedSeconds: 0,
  shielded: true,
  serverSessionId: null,
  revision: 1,
  updatedAt: '2026-08-22T10:00:00.000Z',
};

const staleIntent = (over: Record<string, unknown> = {}) => ({
  intentId: 'intent-1',
  sessionKey: SESSION_KEY,
  serverSessionId: 'marker-1',
  body: { subject: '수학', startedAt: 'a', endedAt: 'b' },
  userId: OWNER,
  // 나이 기준(60초)을 넘긴 시각 — 진행 중 업로드와 겹치지 않는 「확실히 죽은」 intent
  createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  ...over,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockedUpload.mockResolvedValue({ status: 'saved', response: {} });
});

describe('원자적 시작 복구(§4.3-ⓑ)', () => {
  test('미완 starting + 커밋 흔적 없음: 실드를 해제하고 저널을 소거한다', async () => {
    // 실드는 걸렸는데 커밋 전에 죽은 창 — 그대로 두면 사용자가 이유 없이 차단된 채 남는다.
    await journalWith(startingSession);
    await recoverFocusEngine();

    expect(mockedStopShield).toHaveBeenCalledTimes(1);
    expect((await readJournal()).session).toBeNull();
  });

  test('미완 starting + 커밋 흔적 있음: 실드를 유지하고 저널만 소급 완결한다', async () => {
    // 커밋 직후·저널 완결 직전에 죽은 창 — 살아 있는 세션의 차단을 풀면 안 된다.
    await journalWith(startingSession);
    await AsyncStorage.setItem(STORAGE_KEYS.focusSessionV1, JSON.stringify(commitTrace));
    await recoverFocusEngine();

    expect(mockedStopShield).not.toHaveBeenCalled();
    expect((await readJournal()).session).toMatchObject({ state: 'active' });
  });

  test('다른 세션의 v1 레코드는 커밋 흔적이 아니다 — 실드를 해제한다', async () => {
    // sessionKey가 다르면 이전 세션의 잔재다. 흔적으로 인정하면 실드가 영영 남는다.
    await journalWith(startingSession);
    await AsyncStorage.setItem(
      STORAGE_KEYS.focusSessionV1,
      JSON.stringify({ ...commitTrace, sessionKey: 'fs-other' }),
    );
    await recoverFocusEngine();

    expect(mockedStopShield).toHaveBeenCalledTimes(1);
    expect((await readJournal()).session).toBeNull();
  });

  test('방금 쓴 starting은 크래시가 아니다 — 실드를 풀지 않는다(경합 방어)', async () => {
    // 시작은 write-ahead라 저널이 v1 커밋 흔적보다 먼저 커밋된다(§4.3-ⓐ가 요구하는 순서).
    // 그 사이에 복구가 돌면(사일런트 푸시·포그라운드 복귀) 흔적이 없어 크래시로 보이는데,
    // 그대로 처리하면 **막 시작한 정상 세션의 실드를 푼다**(자체 점검에서 발견).
    await journalWith({ ...startingSession, createdAt: new Date().toISOString() });
    await recoverFocusEngine();

    expect(mockedStopShield).not.toHaveBeenCalled();
    expect((await readJournal()).session).toMatchObject({ state: 'starting' }); // 그대로 둔다
  });

  test('유예를 넘긴 starting은 크래시로 처리한다 — 시각이 깨졌으면 오래된 것으로 본다', async () => {
    await journalWith({ ...startingSession, createdAt: 'not-a-date' });
    await recoverFocusEngine();

    expect(mockedStopShield).toHaveBeenCalledTimes(1);
    expect((await readJournal()).session).toBeNull();
  });

  test('active 세션은 건드리지 않는다 — 실드·저널 유지', async () => {
    // 정상 진행 중 죽은 세션의 정산은 OrphanFocusSettler 몫이다(이 복구의 관심사가 아니다).
    await journalWith({ ...startingSession, state: 'active' });
    await recoverFocusEngine();

    expect(mockedStopShield).not.toHaveBeenCalled();
    expect((await readJournal()).session).toMatchObject({ state: 'active' });
  });
});

describe('failed 정산 intent 재업로드(D1)', () => {
  test('저널에 남은 intent를 같은 바디로 재업로드하고, 성공하면 지운다', async () => {
    await journalWith(null, [staleIntent()]);
    await recoverFocusEngine();

    expect(mockedUpload).toHaveBeenCalledTimes(1);
    const opts = mockedUpload.mock.calls[0][0];
    expect(opts.body).toMatchObject({ subject: '수학' });
    expect(opts.sessionId).toBe('marker-1');
    expect(opts.userId).toBe(OWNER); // 기록 당시 소유자 — focusApi가 전송 직전 재검증한다
    expect((await readJournal()).settles).toHaveLength(0);
  });

  test('재업로드도 failed면 intent를 보존한다 — 다음 부팅이 또 시도한다', async () => {
    mockedUpload.mockResolvedValue({ status: 'failed' });
    await journalWith(null, [staleIntent()]);
    await recoverFocusEngine();

    expect((await readJournal()).settles).toHaveLength(1);
  });

  test('대기열 인계(queued)면 intent를 지운다 — 이후는 내구 큐 책임', async () => {
    mockedUpload.mockResolvedValue({ status: 'queued' });
    await journalWith(null, [staleIntent()]);
    await recoverFocusEngine();

    expect((await readJournal()).settles).toHaveLength(0);
  });

  test('갓 기록된 intent는 건너뛴다 — 진행 중 업로드와의 중복 전송 방지', async () => {
    await journalWith(null, [staleIntent({ createdAt: new Date().toISOString() })]);
    await recoverFocusEngine();

    expect(mockedUpload).not.toHaveBeenCalled();
    expect((await readJournal()).settles).toHaveLength(1);
  });
});

test('멱등: 콜드 스타트와 사일런트 flush가 겹쳐 불러도 한 번만 돈다', async () => {
  await journalWith(null, [staleIntent()]);
  await Promise.all([recoverFocusEngine(), recoverFocusEngine(), recoverFocusEngine()]);

  expect(mockedUpload).toHaveBeenCalledTimes(1);
});

describe('워치 인박스 드레인(D2-④)', () => {
  test('네트워크 재시도보다 **먼저** 드레인한다 — 백그라운드 실행 시간이 명령보다 먼저 끝나지 않게', async () => {
    // 뒤에 두면 저널이 찬 경우 intent마다 업로드 타임아웃을 소비하다가, 종료 상태 기동의
    // 제한된 실행 시간이 먼저 끝나 시간 민감한 명령(start·pause·resume은 expiresAt도 지난다)이
    // 이번 기동에서 처리되지 못한다(codex 리뷰 #695).
    const order: string[] = [];
    (drainWatchCommands as jest.Mock).mockImplementation(() => {
      order.push('drain');
      return Promise.resolve([]);
    });
    (uploadFocusBlock as jest.Mock).mockImplementation(() => {
      order.push('upload');
      return Promise.resolve({ status: 'saved', response: {} });
    });
    await journalWith(null, [staleIntent()]);
    await recoverFocusEngine();

    expect(order).toEqual(['drain', 'upload']);
  });

  test('드레인한 명령을 ack로 확정한다 — 이 티켓에선 「처리 = 폐기」', async () => {
    // 네이티브가 claim만 하므로 ack가 없으면 같은 명령이 매 부팅 재배달된다.
    (drainWatchCommands as jest.Mock).mockResolvedValue([
      { commandId: 'c1', type: 'end', protocolVersion: 1 },
      { commandId: 'c2', type: 'start', protocolVersion: 1 },
    ]);
    await journalWith(null);
    await recoverFocusEngine();

    expect(ackWatchCommands).toHaveBeenCalledWith(['c1', 'c2']);
  });

  test('드레인 결과가 없으면 ack도 부르지 않는다', async () => {
    (drainWatchCommands as jest.Mock).mockResolvedValue([]);
    await journalWith(null);
    await recoverFocusEngine();

    expect(ackWatchCommands).not.toHaveBeenCalled();
  });
});
