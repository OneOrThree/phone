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
