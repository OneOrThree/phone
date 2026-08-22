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
jest.mock('@/store/CoinContext', () => ({ useCoins: () => ({ refresh: jest.fn() }) }));
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
