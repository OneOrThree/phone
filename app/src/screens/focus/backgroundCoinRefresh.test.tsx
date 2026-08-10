// 백그라운드 커밋 ↔ 포그라운드 복귀 **겹침** 회귀 (codex 후속 리뷰 P2).
//
// 여기서 잠그는 것: 사일런트 푸시의 flush가 **아직 도는 중**에 앱이 active로 전환되는 구간.
// 그때 복귀 쪽 flush는 전역 flushing 가드에 걸려 즉시 false를 받고, 커밋 마커는 아직 기록
// 전이라 역시 false다 — 복귀 이벤트는 아무것도 못 보고 끝난다. 마커를 '복귀 시점에 읽는 값'
// 으로만 두면 뒤늦게 남은 마커를 집어갈 주체가 없어, 다음 백그라운드→active 전환까지 잔액이
// 낡은 채로 남는다. 그래서 커밋이 확정되는 **그 순간** coinRefreshSignal로 트리를 깨운다.
//
// 겹침을 실제로 재현하려고 flush 본체·flushing 가드·CoinProvider를 전부 **실물**로 돌린다 —
// 목으로 대체하면 정작 문제인 순서 의존이 검증되지 않는다. 통제하는 것은 서버 저장 응답
// (saveFocusSession)의 완료 시점 하나뿐이다.
import { act, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CoinProvider } from '@/store/CoinContext';
import { PendingFocusUploader } from './PendingFocusUploader';
import { runSilentFlush } from '@/services/pushBackground';
import { saveFocusSession } from '@/services/focusApi';
import { api } from '@/services/api';
import { STORAGE_KEYS } from '@/types/storage';

const USER = 'user-a';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  getFreshAccessToken: jest.fn(async () => 'token'),
  getUserIdFromToken: jest.fn(() => 'user-a'),
}));
jest.mock('@/services/focusApi', () => ({ saveFocusSession: jest.fn() }));
jest.mock('@/services/screentimeSync', () => ({ syncWindowUsage: jest.fn(async () => {}) }));
// pushBackground는 네이티브 messaging을 import만 한다(핸들러 등록은 이 테스트가 쓰지 않는다).
jest.mock('@react-native-firebase/messaging', () => ({
  __esModule: true,
  default: () => ({ setBackgroundMessageHandler: jest.fn() }),
}));
jest.mock('@/store/UserContext', () => ({ useUser: () => ({ userId: 'user-a' }) }));
jest.mock('./pendingMarkerCancels', () => ({
  flushPendingMarkerCancels: jest.fn(() => Promise.resolve()),
}));

const mockGet = api.get as jest.Mock;
const mockSave = saveFocusSession as jest.Mock;

// 잔액 재조회 횟수 — refreshCoins의 관측 가능한 흔적이다(CoinContext는 이 GET 하나만 쏜다).
function currencyCalls(): number {
  return mockGet.mock.calls.filter(([url]) => url === '/api/v1/currency').length;
}

async function renderTree() {
  await render(
    <CoinProvider>
      <PendingFocusUploader />
    </CoinProvider>,
  );
  for (let i = 0; i < 5; i++) await act(async () => {});
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockGet.mockResolvedValue({ data: 100 });
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusPendingUploads,
    JSON.stringify([{ userId: USER, body: { subjectId: 's1', focusSeconds: 1500 } }]),
  );
});

test('백그라운드 flush가 도는 중 앱이 켜져도, 커밋 시점에 잔액이 갱신된다', async () => {
  let finishSave: (v: unknown) => void = () => {};
  mockSave.mockReturnValue(
    new Promise((resolve) => {
      finishSave = resolve;
    }),
  );

  // 1) 사일런트 푸시로 백그라운드 flush 시작 — 서버 저장 응답은 아직 오지 않았다.
  let silent: Promise<void> = Promise.resolve();
  await act(async () => {
    silent = runSilentFlush();
  });
  expect(mockSave).toHaveBeenCalledTimes(1);

  // 2) 그 사이 앱이 active — 트리가 뜨며 flush를 돌리지만 flushing 가드로 즉시 false고,
  //    커밋 마커도 아직 없다. 즉 이 복귀 이벤트는 갱신 근거를 하나도 보지 못한다.
  await renderTree();
  expect(currencyCalls()).toBe(1); // 마운트 1회 조회뿐

  // 3) 이제 백그라운드가 커밋한다 — 이 순간 신호가 트리에 닿아야 한다.
  await act(async () => {
    finishSave({});
    await silent;
  });

  expect(currencyCalls()).toBe(2);
  // 프로세스가 죽는 경우를 위한 보험(마커)도 함께 남는다 — 신호는 메모리에만 있다.
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusBackgroundCommit)).toBe('1');
});

test('커밋이 없으면 신호도 마커도 없다 — 불필요한 조회를 만들지 않는다', async () => {
  mockSave.mockRejectedValue(new Error('network')); // 업로드 실패 = 커밋 없음
  await renderTree();
  expect(currencyCalls()).toBe(1);

  await act(async () => {
    await runSilentFlush();
  });

  expect(currencyCalls()).toBe(1);
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusBackgroundCommit)).toBeNull();
});
