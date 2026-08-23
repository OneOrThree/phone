// 측정 대상 변경과 진행 중 동기화의 경쟁 — GROMO-1593 코드리뷰 10차.
//
// 피커가 대상을 저장하며 오늘 캐시를 지워도, **그 전에 시작된 동기화**가 네트워크를 마치고
// 바꾸기 전 기준의 분값을 다시 쓰면 캐시가 되살아난다. 그러면 다음날 마감의
// `Math.max(last.minutes, 어제분)` 이 그 옛 값을 채택해 최종 사용량과 목표 판정을 잘못 확정한다.
//
// 그래서 동기화는 **측정 시작 시점의 변경 표식과 쓰기 직전의 표식을 대조**해, 그 사이 대상이
// 바뀌었으면 자기 값을 버린다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncScreenTimeUsage } from './screentimeSync';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { STORAGE_KEYS } from '@/types/storage';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('@/services/screentimeApi', () => ({ saveScreenTime: jest.fn() }));
jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    getAuthorizationStatus: jest.fn(async () => 'approved'),
    getTodayUsageBucketMinutes: jest.fn(async () => 30),
    getYesterdayUsageBucketMinutes: jest.fn(async () => 0),
    startUsageBucketMonitoring: jest.fn(async () => true),
  },
  nativeRegistersBucketStep15: jest.fn(() => true),
  nativeSupportsUsageBucketEvents: jest.fn(() => false),
}));
jest.mock('@/services/groupApi', () => ({ getMyOpenBetSessions: jest.fn(async () => []) }));
jest.mock('@/services/windowUsageApi', () => ({ putWindowUsage: jest.fn() }));
jest.mock('@/services/analyticsEvents', () => ({
  logScreentimeGoalEvaluated: jest.fn(),
  logScreentimeWindowReported: jest.fn(),
  logScreentimeWindowUnsupported: jest.fn(),
}));

const mockMinutes = ScreenTimeModule.getTodayUsageBucketMinutes as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockMinutes.mockResolvedValue(30);
  // 등록 마커가 있어야 일일 동기화가 오늘분을 올린다.
  await AsyncStorage.setItem(STORAGE_KEYS.screentimeBucketMonitorRegistered, 'u1');
});

test('측정 중 대상이 바뀌지 않았으면 오늘 캐시를 쓴다', async () => {
  await syncScreenTimeUsage('u1', 3600);

  expect(await AsyncStorage.getItem(STORAGE_KEYS.screentimeSyncState)).not.toBeNull();
});

test('측정 도중 대상이 바뀌면 옛 기준 값을 쓰지 않는다', async () => {
  // 사용량을 재는 사이에 피커가 대상을 저장한 상황.
  mockMinutes.mockImplementation(async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.screentimeSelectionChangedAt, '12345');
    return 30;
  });

  await syncScreenTimeUsage('u1', 3600);

  // 캐시가 되살아나면 안 된다 — 이 값이 다음날 마감에 그대로 쓰인다.
  expect(await AsyncStorage.getItem(STORAGE_KEYS.screentimeSyncState)).toBeNull();
});
