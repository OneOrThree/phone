// 백그라운드 커밋 → 포그라운드 복귀 시 잔액 재조회 (codex 리뷰 P2).
//
// 여기서 잠그는 것: 사일런트 푸시로 깨어난 백그라운드 flush가 대기열을 **이미 비운** 뒤에
// 앱으로 돌아오면, 이 컴포넌트의 flush는 빈 큐를 돌려 committed=false를 받는다. 그 신호만
// 보면 서버에서 늘어난 잔액을 영영 다시 받지 않아(CoinContext는 마운트 때만 자동 조회)
// 사용자는 낡은 잔액을 계속 보고, 상점의 선행 검사에서 방금 번 코인을 못 쓴다.
// 백그라운드가 남긴 커밋 마커(AsyncStorage)를 여기서 소비해 그 구멍을 막는다.
//
// 마커 읽기·삭제는 **실물**(pendingFocusUploads의 mark/consume)로 돌린다 — 목으로 대체하면
// 정작 이 배선의 본체인 '남긴 값을 복귀 시점에 소비한다'가 검증되지 않는다.
import { render, act } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PendingFocusUploader } from './PendingFocusUploader';
import { flushPendingFocusUploads, markBackgroundFocusCommit } from './pendingFocusUploads';
import { STORAGE_KEYS } from '@/types/storage';

const USER = 'user-a';

// 대기열 flush(네트워크)만 목으로 대체하고, 커밋 마커 함수는 실물을 쓴다.
jest.mock('./pendingFocusUploads', () => ({
  ...jest.requireActual('./pendingFocusUploads'),
  flushPendingFocusUploads: jest.fn(async () => false),
}));
jest.mock('./pendingMarkerCancels', () => ({
  flushPendingMarkerCancels: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/store/UserContext', () => ({ useUser: () => ({ userId: USER }) }));

const mockRefreshCoins = jest.fn(async () => true);
jest.mock('@/store/CoinContext', () => ({ useCoins: () => ({ refresh: mockRefreshCoins }) }));

const mockFlush = flushPendingFocusUploads as jest.MockedFunction<typeof flushPendingFocusUploads>;

let appStateHandler: ((state: AppStateStatus) => void) | null = null;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockFlush.mockResolvedValue(false);
  mockRefreshCoins.mockResolvedValue(true);
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

// flush는 마이크로태스크 몇 겹(스토리지 읽기 → Promise.all)을 지나야 잔액 재조회에 닿는다.
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => {});
}

async function renderUploader() {
  await render(<PendingFocusUploader />);
  await settle();
}

test('앱이 백그라운드에 있는 동안 커밋됐으면 복귀 시 잔액을 다시 받는다', async () => {
  await renderUploader();
  expect(mockRefreshCoins).not.toHaveBeenCalled(); // 시작 시점엔 커밋 이력이 없다

  // 사일런트 푸시로 깨어난 백그라운드 flush가 저장을 커밋했다 — 큐는 이미 비었다.
  await markBackgroundFocusCommit();

  await act(async () => {
    appStateHandler?.('active');
  });
  await settle();

  expect(mockRefreshCoins).toHaveBeenCalledTimes(1);
});

test('마커는 1회만 소비된다 — 다음 복귀에서 다시 조회하지 않는다', async () => {
  await markBackgroundFocusCommit();
  await renderUploader();
  expect(mockRefreshCoins).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusBackgroundCommit)).toBeNull();

  await act(async () => {
    appStateHandler?.('active');
  });
  await settle();

  expect(mockRefreshCoins).toHaveBeenCalledTimes(1);
});

test('커밋이 전혀 없었으면 잔액을 다시 받지 않는다(불필요한 조회 금지)', async () => {
  await renderUploader();

  await act(async () => {
    appStateHandler?.('active');
  });
  await settle();

  expect(mockRefreshCoins).not.toHaveBeenCalled();
});

test('이 자리의 flush가 커밋하면 마커 없이도 종전대로 잔액을 다시 받는다(GROMO-1049 유지)', async () => {
  mockFlush.mockResolvedValue(true);
  await renderUploader();

  expect(mockFlush).toHaveBeenCalledWith(USER);
  expect(mockRefreshCoins).toHaveBeenCalledTimes(1);
});

// 조회 성공을 확인하기 전에 마커를 지우면, 그 조회가 실패했을 때 큐도 마커도 비어
// 지급 전 잔액이 영영 남는다(codex 후속 리뷰 P2 — coinRefreshSignal의 보류 규칙과 같은 원칙).
test('잔액 조회가 실패하면 마커를 남긴다 — 다음 복귀에서 다시 시도한다', async () => {
  mockRefreshCoins.mockResolvedValue(false); // 네트워크 실패·시퀀스 가드 미반영 둘 다 false다
  await markBackgroundFocusCommit();
  await renderUploader();
  expect(mockRefreshCoins).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusBackgroundCommit)).toBe('1');

  // 회복된 다음 복귀에서 다시 조회하고, 그때 성공하면 마커가 내려간다.
  mockRefreshCoins.mockResolvedValue(true);
  await act(async () => {
    appStateHandler?.('active');
  });
  await settle();

  expect(mockRefreshCoins).toHaveBeenCalledTimes(2);
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusBackgroundCommit)).toBeNull();
});

// 이 자리의 flush가 커밋한 지급도 같은 규칙을 탄다 — 큐는 이미 비었으므로 마커에 남기지
// 않으면 조회 실패와 함께 '반영해야 할 지급이 있다'는 사실이 통째로 사라진다.
test('여기서 커밋했는데 조회가 실패하면 마커로 남아 다음 복귀가 이어받는다', async () => {
  mockFlush.mockResolvedValue(true);
  mockRefreshCoins.mockResolvedValue(false);
  await renderUploader();

  expect(mockRefreshCoins).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusBackgroundCommit)).toBe('1');

  // 큐는 이미 비었다(커밋 없음) — 그래도 마커가 남아 잔액을 다시 받는다.
  mockFlush.mockResolvedValue(false);
  mockRefreshCoins.mockResolvedValue(true);
  await act(async () => {
    appStateHandler?.('active');
  });
  await settle();

  expect(mockRefreshCoins).toHaveBeenCalledTimes(2);
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusBackgroundCommit)).toBeNull();
});

test('flush가 던져도 마커 소비는 살아남는다 — 백그라운드 지급이 실패에 묻히지 않는다', async () => {
  mockFlush.mockRejectedValue(new Error('network'));
  await markBackgroundFocusCommit();
  await renderUploader();

  expect(mockRefreshCoins).toHaveBeenCalledTimes(1);
});
