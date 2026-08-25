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
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { OrphanFocusSettler } from './OrphanFocusSettler';
import { uploadFocusBlock } from './uploadFocusBlock';
import { cancelMarker } from './pendingMarkerCancels';
import { notifyShieldInterrupted } from './shieldInterruptedNotification';

const OWNER = 'user-a';

jest.mock('./uploadFocusBlock', () => ({ uploadFocusBlock: jest.fn() }));
jest.mock('./shieldInterruptedNotification', () => ({
  notifyShieldInterrupted: jest.fn(() => Promise.resolve()),
}));
jest.mock('./pendingMarkerCancels', () => ({ cancelMarker: jest.fn(() => Promise.resolve()) }));
jest.mock('./tagSync', () => ({ ensureFocusTagId: jest.fn(() => Promise.resolve('tag-1')) }));
jest.mock('./completionNotification', () => ({
  cancelStaleCompletionNotifications: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    stopFocusShield: jest.fn(() => Promise.resolve()),
    // 지난 실드가 정상 만료로 끝났는가 — 기본은 '아니오'(중단 알림 케이스가 기본값).
    didFocusShieldComplete: jest.fn(() => false),
  },
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
const mockNotify = notifyShieldInterrupted as jest.MockedFunction<typeof notifyShieldInterrupted>;

/** 라이브 레코드를 부분 덮어쓴다 — 실드 관련 필드만 바꿔 케이스를 만든다. */
async function patchRecord(patch: Record<string, unknown>) {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusLiveSession,
    JSON.stringify({ ...JSON.parse(raw!), ...patch }),
  );
}

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

// "앱이 종료되면서 다른 앱 차단도 함께 풀렸어요" — 이 알림이 **언제 나가면 안 되는지**.
// GROMO-1604 코드리뷰. 두 번 다 '레코드가 남아 있다'만으로 강제 종료를 단정한 게 원인이었다.
describe('실드 중단 알림은 조건이 둘 다 맞을 때만', () => {
  test('실드가 걸렸고 정상 해제 표식이 없으면 알린다', async () => {
    await patchRecord({ shieldActive: true });

    await renderSettler();

    expect(mockNotify).toHaveBeenCalled();
  });

  // 시스템 Back 이탈은 레코드를 **일부러** 남긴다(시간 적립을 여기에 맡긴다). 실드는 화면을
  // 떠날 때 정상 해제됐으므로 "함께 풀렸다"는 거짓이다.
  test('정상 해제 표식이 있으면 알리지 않는다', async () => {
    await patchRecord({ shieldActive: true, shieldReleasedCleanly: true });

    await renderSettler();

    expect(mockNotify).not.toHaveBeenCalled();
  });

  test('네이티브가 정상 만료로 끝냈으면 알리지 않는다', async () => {
    // 백그라운드에서 일정이 다 끝나 네이티브가 차단을 정상 종료한 뒤, JS 가 복귀하기 전에
    // 프로세스가 죽은 경우 — 표식을 남길 코드가 돌 기회가 없었을 뿐 차단이 끊긴 적은 없다.
    (ScreenTimeModule.didFocusShieldComplete as jest.Mock).mockReturnValue(true);
    await patchRecord({ shieldActive: true });

    await renderSettler();

    expect(mockNotify).not.toHaveBeenCalled();
  });

  test('완료 표식은 stopFocusShield 보다 먼저 읽는다', async () => {
    // ⚠️ stopFocusShield() 가 표식을 지운다(ScreenTimeModule.kt) — 뒤에서 읽으면 정상 만료가
    //    늘 false 라 위 테스트가 통과해도 실기기에선 알림이 나간다.
    const order: string[] = [];
    (ScreenTimeModule.didFocusShieldComplete as jest.Mock).mockImplementation(() => {
      order.push('read');
      return false;
    });
    (ScreenTimeModule.stopFocusShield as jest.Mock).mockImplementation(() => {
      order.push('stop');
      return Promise.resolve();
    });
    await patchRecord({ shieldActive: true });

    await renderSettler();

    expect(order).toEqual(['read', 'stop']);
  });

  // 권한이 없어 처음부터 실드가 안 걸린 세션 — 풀릴 차단 자체가 없었다.
  // 업로드·인계가 모두 실패하면 레코드가 남는다. 표식이 없으면 앱을 다시 켤 때마다 같은
  // 알림이 또 나간다 — `ran` 은 컴포넌트 수명에서만 막아서 프로세스가 죽으면 초기화된다.
  test('이미 알린 세션은 다시 알리지 않는다', async () => {
    await patchRecord({ shieldActive: true, shieldInterruptNotified: true });

    await renderSettler();

    expect(mockNotify).not.toHaveBeenCalled();
  });

  test('알린 뒤에는 레코드에 표식이 남는다', async () => {
    await patchRecord({ shieldActive: true });

    await renderSettler();

    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
    // 업로드가 성공해 레코드가 지워졌다면 그것대로 재발행 위험이 없다.
    if (raw) expect(JSON.parse(raw).shieldInterruptNotified).toBe(true);
    expect(mockNotify).toHaveBeenCalled();
  });

  test('실드가 걸린 적 없으면 알리지 않는다', async () => {
    await patchRecord({ shieldActive: false });

    await renderSettler();

    expect(mockNotify).not.toHaveBeenCalled();
  });
});

// 정산 도중 새 세션이 같은 키를 갱신하는 경쟁 — GROMO-1604 코드리뷰 6차.
// 확인 없이 쓰면 새 세션의 복구 레코드를 옛 고아 레코드로 덮고, 뒤에서 지워 버려
// 그 세션이 강제 종료될 때 집중 기록을 잃는다.
describe('새 세션이 레코드를 가져갔으면 건드리지 않는다', () => {
  test('덮어쓰지도, 지우지도 않는다', async () => {
    await patchRecord({ shieldActive: true });
    const newSession = JSON.stringify({
      userId: OWNER,
      subjectId: 's2',
      subjectName: '새 세션',
      startedAt: '2026-08-09T10:00:00+09:00',
      updatedAt: '2026-08-09T10:00:05+09:00',
      elapsed: 5,
    });

    // 첫 읽기 뒤에 새 세션이 자기 레코드를 쓴 상황을 만든다.
    const original = AsyncStorage.getItem as jest.Mock;
    let reads = 0;
    (AsyncStorage.getItem as jest.Mock) = jest.fn(async (key: string) => {
      const value = await original(key);
      if (key === STORAGE_KEYS.focusLiveSession && ++reads === 1) {
        await AsyncStorage.setItem(STORAGE_KEYS.focusLiveSession, newSession);
      }
      return value;
    });

    await renderSettler();
    (AsyncStorage.getItem as jest.Mock) = original;

    // 새 세션의 레코드가 그대로 남아 있어야 한다.
    expect(await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession)).toBe(newSession);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
