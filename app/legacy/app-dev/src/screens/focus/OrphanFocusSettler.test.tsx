// 고아 정산의 마커 뒤처리(GROMO-1214 코드리뷰 3차 ④).
//
// 여기서 잠그는 것: PATCH가 마커를 못 닫은 채 실패하면 **취소를 영속화**해야 한다.
// 종전엔 이 경로에 onMarkerStillOpen 콜백이 없어(세션 화면과 달리) POST만 큐에 넣고 라이브
// 레코드를 지웠다 — 재시도 전에 계정이 바뀌면 flushPendingFocusUploads가 옛 계정 업로드를
// 폐기하므로 업로드도 취소도 남지 않고, 친구 화면엔 서버 스윕(12h)까지 '집중 중'이 남았다.
// 취소 큐는 계정 스코프라, 콜백이 레코드 소유 계정으로 불려야 나중에 실제로 재시도된다.
import { render, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { OrphanFocusSettler } from './OrphanFocusSettler';
import { uploadFocusBlock } from './uploadFocusBlock';
import { cancelMarker } from './pendingMarkerCancels';
import { markSessionLive, clearSessionLive } from './engine/liveSessionRegistry';

const OWNER = 'user-a';

jest.mock('./uploadFocusBlock', () => ({ uploadFocusBlock: jest.fn() }));
jest.mock('./pendingMarkerCancels', () => ({ cancelMarker: jest.fn(() => Promise.resolve()) }));
jest.mock('./tagSync', () => ({ ensureFocusTagId: jest.fn(() => Promise.resolve('tag-1')) }));
jest.mock('./completionNotification', () => ({
  cancelStaleCompletionNotifications: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: { stopFocusShield: jest.fn(() => Promise.resolve()) },
}));
jest.mock('@/store/FocusContext', () => ({
  useFocus: () => ({ addFocusSeconds: jest.fn(), ready: true }),
}));
const mockRefreshCoins = jest.fn();
jest.mock('@/store/CoinContext', () => ({ useCoins: () => ({ refresh: mockRefreshCoins }) }));
jest.mock('@/store/SubjectContext', () => ({
  useSubjects: () => ({ addFocusToSubject: jest.fn(), ready: true }),
}));
jest.mock('@/store/UserContext', () => ({ useUser: () => ({ userId: OWNER }) }));

const mockUpload = uploadFocusBlock as jest.MockedFunction<typeof uploadFocusBlock>;
const mockCancel = cancelMarker as jest.MockedFunction<typeof cancelMarker>;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockUpload.mockResolvedValue({ status: 'queued' });
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusLiveSession,
    JSON.stringify({
      userId: OWNER,
      subjectId: 's1',
      subjectName: '수학',
      serverSessionId: 'marker-1',
      startedAt: '2026-08-08T10:00:00+09:00',
      updatedAt: '2026-08-08T10:25:00+09:00',
      elapsed: 1500,
    }),
  );
});

// 정산은 AsyncStorage 읽기 → 태그 해석 → 업로드로 이어지는 여러 단계의 await라
// 마이크로태스크를 여러 번 흘려야 uploadFocusBlock까지 도달한다.
async function renderSettler() {
  await render(<OrphanFocusSettler />);
  for (let i = 0; i < 10; i++) {
    await act(async () => {});
  }
}

test('열린 마커가 남은 고아 정산은 취소 콜백을 넘긴다 — 소유 계정 스코프', async () => {
  await renderSettler();

  expect(mockUpload).toHaveBeenCalledTimes(1);
  const opts = mockUpload.mock.calls[0][0];
  expect(opts.sessionId).toBe('marker-1');
  expect(typeof opts.onMarkerStillOpen).toBe('function');

  // uploadFocusBlock이 '마커가 열린 채'라고 알려오면 취소가 큐에 영속화돼야 한다.
  opts.onMarkerStillOpen?.('marker-1');
  expect(mockCancel).toHaveBeenCalledWith('marker-1', OWNER);
});

// ── 엔진 영속 v1 우선 경로(GROMO-1600) ─────────────────────────────────────────
const V1_RECORD = {
  version: 1,
  sessionKey: 'fs-test-1',
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
  displaySeconds: 1500,
  elapsedSeconds: 1500,
  startedAt: '2026-08-08T10:00:00+09:00',
  blockStartedAt: '2026-08-08T10:05:00+09:00',
  unsettledSeconds: 1200,
  settledSeconds: 300,
  // 실측 방해초 — 닫힌 정지 60초 + 열린 정지 없음. legacy 역산이면 span(1200s)−elapsed로
  // 어긋났을 값이다.
  blockPause: { pausedMs: 60_000, count: 2, startedAt: null },
  focusDays: {
    local: { '2026-08-08': 1200 },
    server: { '2026-08-08': 1200 },
    kst: { '2026-08-08': 1200 },
  },
  awayCreditedSeconds: 0,
  shielded: true,
  serverSessionId: 'marker-9',
  revision: 5,
  updatedAt: '2026-08-08T10:25:00+09:00',
};

test('v1 레코드가 있으면 legacy 대신 v1로 정산한다 — 방해초 실측·미정산 블록 구간·양쪽 제거', async () => {
  await AsyncStorage.setItem(STORAGE_KEYS.focusSessionV1, JSON.stringify(V1_RECORD));
  mockUpload.mockResolvedValue({ status: 'saved', response: {} as never });
  await renderSettler();

  expect(mockUpload).toHaveBeenCalledTimes(1);
  const opts = mockUpload.mock.calls[0][0];
  expect(opts.sessionId).toBe('marker-9'); // legacy의 marker-1이 아니라 v1의 마커
  expect(opts.body).toMatchObject({
    subject: '수학',
    startedAt: '2026-08-08T10:05:00+09:00', // 미정산 블록 시작 — 세션 시작이 아니다
    endedAt: '2026-08-08T10:25:00+09:00',
    distractionCount: 2,
    totalDistractionSeconds: 60, // 실측(blockPause) — (span − elapsed) 역산이 아니다
    focusSecondsByDate: { '2026-08-08': 1200 },
  });
  // 완료 후 두 표현 모두 제거 — legacy가 남으면 다음 부팅 폴백이 같은 꼬리를 또 정산한다
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1)).toBeNull();
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession)).toBeNull();
});

test('v1 고아 정산도 원래 focusType을 싣는다 — 미지정이면 서버 기본값(INFINITE)으로 오염된다', async () => {
  // 마커가 없거나 종료 시각이 4분을 넘겨 POST 폴백을 타면, focusType 미지정 세션이 전부
  // INFINITE로 저장돼 유형별 통계가 오염된다(codex 리뷰 #694). v1엔 mode가 있으니 실을 수 있다.
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusSessionV1,
    JSON.stringify({ ...V1_RECORD, mode: 'pomodoro' }),
  );
  mockUpload.mockResolvedValue({ status: 'saved', response: {} as never });
  await renderSettler();

  expect(mockUpload.mock.calls[0][0].body).toMatchObject({ focusType: 'POMODORO' });
});

test('legacy가 v1보다 최신이면 legacy로 정산한다 — 존재만으로 v1을 고르지 않는다', async () => {
  // 두 표현은 별도의 비동기 setItem이라, legacy만 착지하거나 v1 쓰기만 실패하면 v1이
  // 있으면서도 더 오래된 상태가 된다. 그때 v1을 고르면 마지막 저장 이후 시간이 유실된다
  // (codex 리뷰 #694). beforeEach의 legacy(10:25)보다 v1을 더 오래되게(10:10) 만든다.
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusSessionV1,
    JSON.stringify({ ...V1_RECORD, updatedAt: '2026-08-08T10:10:00+09:00' }),
  );
  mockUpload.mockResolvedValue({ status: 'saved', response: {} as never });
  await renderSettler();

  // legacy 경로의 표식: 마커가 v1의 marker-9가 아니라 legacy의 marker-1
  expect(mockUpload.mock.calls[0][0].sessionId).toBe('marker-1');
  // 끝나면 두 표현을 함께 지운다 — v1이 남으면 다음 부팅이 같은 세션을 또 정산한다
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1)).toBeNull();
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession)).toBeNull();
});

test('v1 소유자 불일치: 정산 없이 v1·legacy 둘 다 폐기한다', async () => {
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusSessionV1,
    JSON.stringify({ ...V1_RECORD, userId: 'someone-else' }),
  );
  await renderSettler();
  expect(mockUpload).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1)).toBeNull();
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession)).toBeNull();
});

test('v1 업로드 failed: 레코드를 보존해 다음 부팅이 재시도한다', async () => {
  await AsyncStorage.setItem(STORAGE_KEYS.focusSessionV1, JSON.stringify(V1_RECORD));
  mockUpload.mockResolvedValue({ status: 'failed' });
  await renderSettler();
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1)).not.toBeNull();
});

test('v1 로컬 적립 시 legacy 레코드에도 settledLocally를 찍는다 — 롤백 이중 적립 방어', async () => {
  // 업로드 failed면 두 레코드가 모두 보존되는데, 그 상태로 OTA 롤백이 나면 구버전 Settler가
  // legacy만 읽고 같은 시간을 다시 적립한다(codex 리뷰 #694).
  await AsyncStorage.setItem(STORAGE_KEYS.focusSessionV1, JSON.stringify(V1_RECORD));
  mockUpload.mockResolvedValue({ status: 'failed' });
  await renderSettler();

  const legacyRaw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
  expect(JSON.parse(legacyRaw!).settledLocally).toBe(true);
});

test('legacy 소유자가 다르면 마커를 찍지 않는다 — 남의 기록을 건드리지 않는다', async () => {
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusLiveSession,
    JSON.stringify({ userId: 'someone-else', subjectId: 's9', elapsed: 10 }),
  );
  await AsyncStorage.setItem(STORAGE_KEYS.focusSessionV1, JSON.stringify(V1_RECORD));
  mockUpload.mockResolvedValue({ status: 'failed' });
  await renderSettler();

  const legacyRaw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
  expect(JSON.parse(legacyRaw!).settledLocally).toBeUndefined();
});

test('legacy 정산이 도중에 생긴 새 v1을 지우지 않는다 — 새 세션의 유일한 기록이다', async () => {
  // legacy 경로를 고른 뒤 업로드를 기다리는 사이 사용자가 새 집중을 시작할 수 있다. 새 엔진은
  // 곧바로 v1을 쓰지만 legacy는 첫 5초 전까지 쓰지 않으므로, legacy 문자열 비교만으로는 이
  // 창을 못 막는다. 무조건 지우면 새 세션의 기록이 사라지고 저널은 이미 active라 시작 복구도
  // 손대지 않아 그 시간이 통째로 유실된다(codex 리뷰 #694 5차).
  mockUpload.mockImplementation(async () => {
    // 업로드가 도는 사이 새 세션이 v1을 쓴다
    await AsyncStorage.setItem(STORAGE_KEYS.focusSessionV1, JSON.stringify(V1_RECORD));
    return { status: 'saved', response: {} as never };
  });
  await renderSettler();

  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockUpload.mock.calls[0][0].sessionId).toBe('marker-1'); // legacy 경로였다
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1)).not.toBeNull();
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession)).toBeNull(); // legacy는 지운다
});

test('남의 v1을 폐기하는 분기도 새 v1은 건드리지 않는다 — 조기 종료에도 대조가 필요하다', async () => {
  // 최신 판정(isV1FresherThanLegacy)이 비동기라, 그 사이에 현재 계정이 새 집중을 시작하면
  // 새 엔진의 커밋 흔적이 같은 키에 들어온다. 무조건 지우면 그 세션의 유일한 기록이 사라지고,
  // 저널은 이미 active라 시작 복구도 손대지 않는다(codex 리뷰 #694 6차).
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusSessionV1,
    JSON.stringify({ ...V1_RECORD, userId: 'someone-else' }),
  );
  const realGet = AsyncStorage.getItem as unknown as jest.Mock;
  const orig = realGet.getMockImplementation();
  let swapped = false;
  realGet.mockImplementation(async (key: string) => {
    const value = await (orig?.(key) ?? Promise.resolve(null));
    // legacy를 읽는 순간 = 최신 판정 중. 이때 현재 계정의 새 세션이 v1을 쓴다.
    if (key === STORAGE_KEYS.focusLiveSession && !swapped) {
      swapped = true;
      await AsyncStorage.setItem(
        STORAGE_KEYS.focusSessionV1,
        JSON.stringify({ ...V1_RECORD, sessionKey: 'fs-new' }),
      );
    }
    return value;
  });
  await renderSettler();
  realGet.mockImplementation(orig ?? (() => Promise.resolve(null)));

  const left = await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1);
  expect(left).not.toBeNull();
  expect(JSON.parse(left!).sessionKey).toBe('fs-new'); // 새 세션의 기록이 살아 있다
});

test('이 프로세스가 돌리고 있는 세션의 v1은 고아로 정산하지 않는다', async () => {
  // 이 컴포넌트는 마운트 즉시가 아니라 Focus·Subject 복원이 끝난 뒤에 돈다. 그 사이 사용자가
  // 집중 화면에 들어갈 수 있는데, 그 세션의 v1을 고아로 보면 진행 중인 블록을 조기 적립·
  // 업로드하거나(5초 이후) 커밋 흔적을 지운다(5초 이전).
  await AsyncStorage.setItem(STORAGE_KEYS.focusSessionV1, JSON.stringify(V1_RECORD));
  markSessionLive(V1_RECORD.sessionKey);
  try {
    await renderSettler();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1)).not.toBeNull();
  } finally {
    clearSessionLive(V1_RECORD.sessionKey);
  }
});

test('강제 종료로 남은 active 세션은 고아로 정산한다 — 판정은 저널이 아니라 메모리다', async () => {
  // 저널의 active를 게이트로 쓰면 강제 종료된 세션이 영원히 건너뛰어진다(복구는 starting만
  // 손댄다). 그 상태로 새 집중을 시작하면 이전 v1이 덮여 시간이 통째로 사라진다(리뷰 10차).
  await AsyncStorage.setItem(STORAGE_KEYS.focusSessionV1, JSON.stringify(V1_RECORD));
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusJournalV1,
    JSON.stringify({
      version: 1,
      session: {
        sessionKey: V1_RECORD.sessionKey,
        state: 'active', // 죽기 전 상태 그대로 남아 있다
        shieldRequested: true,
        serverSessionId: 'marker-9',
        markerBlockStartedAt: null,
        createdAt: 'x',
        updatedAt: 'x',
      },
      settles: [],
    }),
  );
  mockUpload.mockResolvedValue({ status: 'saved', response: {} as never });
  await renderSettler();

  expect(mockUpload).toHaveBeenCalledTimes(1); // 회수됐다
});

test('legacy가 없는 조기 종료도 v1을 대조한다 — 새 세션의 흔적을 지우지 않는다', async () => {
  // 처음엔 v1이 없다고 읽었어도 그 뒤 시작한 새 세션이 커밋 흔적을 쓴다(legacy는 첫 5초 전까지
  // 안 쓴다). 무조건 지우면 저널만 active로 남고 새 세션 시간이 통째로 유실된다(리뷰 #694 9차).
  await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession); // legacy 없음
  const realGet = AsyncStorage.getItem as unknown as jest.Mock;
  const orig = realGet.getMockImplementation();
  let swapped = false;
  realGet.mockImplementation(async (key: string) => {
    const value = await (orig?.(key) ?? Promise.resolve(null));
    if (key === STORAGE_KEYS.focusLiveSession && !swapped) {
      swapped = true;
      await AsyncStorage.setItem(
        STORAGE_KEYS.focusSessionV1,
        JSON.stringify({ ...V1_RECORD, sessionKey: 'fs-brand-new' }),
      );
    }
    return value;
  });
  await renderSettler();
  realGet.mockImplementation(orig ?? (() => Promise.resolve(null)));

  const left = await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1);
  expect(left).not.toBeNull();
  expect(JSON.parse(left!).sessionKey).toBe('fs-brand-new');
});

test('legacy 경로의 로컬 적립은 v1에도 표식을 남긴다 — 두 정리 사이의 크래시 방어', async () => {
  // legacy에만 찍으면, 업로드 성공 뒤 legacy 삭제가 착지하고 v1 제거 전에 죽는 창에서 다음
  // 부팅이 남은 (더 오래된) v1을 미정산으로 골라 그 시간을 다시 적립한다(리뷰 #694 10차).
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusSessionV1,
    JSON.stringify({ ...V1_RECORD, updatedAt: '2026-08-08T10:10:00+09:00' }), // legacy가 더 최신
  );
  mockUpload.mockResolvedValue({ status: 'failed' }); // 실패시켜 두 레코드를 남긴다
  await renderSettler();

  const legacyRaw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
  const v1Raw = await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1);
  expect(JSON.parse(legacyRaw!).settledLocally).toBe(true);
  expect(JSON.parse(v1Raw!).settledLocally).toBe(true); // 짝이 맞는다
});

test('정산 중 새 세션이 v1을 교체하면 표식도 제거도 하지 않는다', async () => {
  // 소유자만 보고 찍으면 새 세션의 흔적에 표식이 찍히고, 그 값이 기준값이 돼 뒤이은 제거가
  // 새 세션의 유일한 기록까지 지운다(codex 리뷰 #694 11차).
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusSessionV1,
    JSON.stringify({ ...V1_RECORD, updatedAt: '2026-08-08T10:10:00+09:00' }), // legacy가 더 최신
  );
  const realGet = AsyncStorage.getItem as unknown as jest.Mock;
  const orig = realGet.getMockImplementation();
  let swapped = false;
  realGet.mockImplementation(async (key: string) => {
    const value = await (orig?.(key) ?? Promise.resolve(null));
    // legacy를 읽는 순간 = 새 세션이 v1을 갈아끼우는 창
    if (key === STORAGE_KEYS.focusLiveSession && !swapped) {
      swapped = true;
      await AsyncStorage.setItem(
        STORAGE_KEYS.focusSessionV1,
        JSON.stringify({ ...V1_RECORD, sessionKey: 'fs-brand-new' }),
      );
    }
    return value;
  });
  mockUpload.mockResolvedValue({ status: 'saved', response: {} as never });
  await renderSettler();
  realGet.mockImplementation(orig ?? (() => Promise.resolve(null)));

  const left = await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1);
  expect(left).not.toBeNull();
  const parsed = JSON.parse(left!);
  expect(parsed.sessionKey).toBe('fs-brand-new'); // 새 세션의 기록이 살아 있다
  expect(parsed.settledLocally).toBeUndefined(); // 표식도 안 찍혔다
});

test('v1 표식 쓰기가 실패하면 기준값을 갱신하지 않는다 — 미표식 v1이 남는 걸 막는다', async () => {
  // 실패를 성공으로 보면 기준값만 바뀌어 제거 대조가 어긋나고, 미표식 v1이 남아 다음 부팅이
  // 같은 시간을 다시 적립한다(codex 리뷰 #694 11차).
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusSessionV1,
    JSON.stringify({ ...V1_RECORD, updatedAt: '2026-08-08T10:10:00+09:00' }),
  );
  const setItem = AsyncStorage.setItem as unknown as jest.Mock;
  const real = setItem.getMockImplementation();
  setItem.mockImplementation((key: string, value: string) => {
    if (key === STORAGE_KEYS.focusSessionV1) return Promise.reject(new Error('디스크 꽉참'));
    return real?.(key, value) ?? Promise.resolve();
  });
  mockUpload.mockResolvedValue({ status: 'saved', response: {} as never });
  await renderSettler();
  setItem.mockImplementation(real ?? (() => Promise.resolve()));

  // 표식이 안 찍혔으니 기준값도 그대로 → 원래 v1이 제거된다(대조가 통과한다)
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1)).toBeNull();
});

test('v1 정산 중 새 세션이 legacy를 갱신하면 옛 스냅샷을 되쓰지 않는다', async () => {
  // 소유자만 보고 되쓰면 새 레코드에 표식이 붙거나 최신 초가 덮인다. 그 뒤 죽거나 OTA 롤백으로
  // legacy가 선택되면 새 블록의 로컬 적립이 통째로 건너뛰어진다(codex 리뷰 #694 12차).
  await AsyncStorage.setItem(STORAGE_KEYS.focusSessionV1, JSON.stringify(V1_RECORD));
  const realGet = AsyncStorage.getItem as unknown as jest.Mock;
  const orig = realGet.getMockImplementation();
  let swapped = false;
  realGet.mockImplementation(async (key: string) => {
    const value = await (orig?.(key) ?? Promise.resolve(null));
    // v1이 표식을 찍기 직전 legacy를 읽는 순간 = 새 세션이 legacy를 갱신하는 창
    if (key === STORAGE_KEYS.focusLiveSession && !swapped) {
      swapped = true;
      await AsyncStorage.setItem(
        STORAGE_KEYS.focusLiveSession,
        JSON.stringify({ userId: OWNER, subjectId: 's9', startedAt: 'new-block', elapsed: 7 }),
      );
    }
    return value;
  });
  mockUpload.mockResolvedValue({ status: 'failed' }); // 레코드를 남겨 관찰한다
  await renderSettler();
  realGet.mockImplementation(orig ?? (() => Promise.resolve(null)));

  const legacy = JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession))!);
  expect(legacy.startedAt).toBe('new-block'); // 새 레코드가 그대로다
  expect(legacy.elapsed).toBe(7); // 최신 초가 안 덮였다
  expect(legacy.settledLocally).toBeUndefined(); // 표식도 안 붙었다
});

test('alreadyEnded 고아 정산도 잔액을 갱신한다 — 서버는 이미 지급했다', async () => {
  await AsyncStorage.setItem(STORAGE_KEYS.focusSessionV1, JSON.stringify(V1_RECORD));
  mockUpload.mockResolvedValue({ status: 'alreadyEnded' });
  await renderSettler();

  expect(mockRefreshCoins).toHaveBeenCalled();
});
