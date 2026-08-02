// 측정 시작일 앵커 기록(GROMO-1083) 테스트.
// 핵심 락: registerUsageBucketMonitoring이 등록 마커와 앵커를 **한 번의 multiSet**으로 함께 쓴다.
// 따로 쓰면 두 쓰기 사이에 앱이 강제 종료됐을 때 마커만 남고 앵커가 없는 상태가 되고, 다음 동기화가
// monitorPreexisted 추정 backfill(어제)을 타 '신규 유저에게 어제 목표 달성 축하'가 재발한다(코드리뷰 지적).
// 나머지는 "이미 있는 앵커는 덮지 않는다(가장 이른 날 유지)" 규칙.
// 시각은 jest.setSystemTime으로 고정한다(러너 TZ는 jest.config.js가 KST로 고정).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerUsageBucketMonitoring } from './screentimeSync';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { STORAGE_KEYS } from '@/types/storage';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    getAuthorizationStatus: jest.fn(),
    startUsageBucketMonitoring: jest.fn(),
  },
  nativeRegistersBucketStep15: jest.fn(() => true),
  nativeSupportsUsageBucketEvents: jest.fn(() => true),
}));
jest.mock('@/services/groupApi', () => ({
  getMyGroups: jest.fn(),
  getChallenges: jest.fn(),
}));
jest.mock('@/services/windowUsageApi', () => ({
  putWindowUsage: jest.fn(),
}));
jest.mock('@/services/analyticsEvents', () => ({
  logScreentimeWindowReported: jest.fn(),
  logScreentimeWindowUnsupported: jest.fn(),
}));

const mockAuth = ScreenTimeModule.getAuthorizationStatus as jest.Mock;
const mockStart = ScreenTimeModule.startUsageBucketMonitoring as jest.Mock;

const USER_ID = 'u1';
const TODAY = '2026-08-02';

// multiSet에 실린 항목을 키로 찾는다 — '한 번의 호출에 함께 실렸는가'가 이 테스트의 핵심이라
// 호출 단위로 뒤진다.
function entryInSingleMultiSet(key: string): string | undefined {
  const calls = (AsyncStorage.multiSet as jest.Mock).mock.calls;
  expect(calls).toHaveLength(1); // 등록 쓰기는 항상 한 번의 배치여야 한다
  const pair = (calls[0][0] as [string, string][]).find(([k]) => k === key);
  return pair?.[1];
}

// 앵커 픽스처를 심고 스파이를 초기화한다 — AsyncStorage 공식 mock은 setItem을 내부적으로
// multiSet으로 처리해서, 세팅 자체가 '등록이 쓴 배치'로 오인되지 않게 여기서 지운다.
async function seedAnchor(userId: string, date: string): Promise<void> {
  await AsyncStorage.setItem(
    STORAGE_KEYS.screentimeMeasurementStartDate,
    JSON.stringify({ userId, date }),
  );
  (AsyncStorage.multiSet as jest.Mock).mockClear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 10, 0));
  mockAuth.mockResolvedValue('approved');
  mockStart.mockResolvedValue(true);
  jest.spyOn(AsyncStorage, 'multiSet');
  jest.spyOn(AsyncStorage, 'setItem');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('registerUsageBucketMonitoring — 측정 시작일 앵커', () => {
  test('등록 마커와 앵커를 한 번의 multiSet으로 함께 쓴다 (강제 종료 창 없음)', async () => {
    await expect(registerUsageBucketMonitoring(USER_ID)).resolves.toBe(true);

    expect(entryInSingleMultiSet(STORAGE_KEYS.screentimeBucketMonitorRegistered)).toBe(USER_ID);
    expect(entryInSingleMultiSet(STORAGE_KEYS.screentimeMeasurementStartDate)).toBe(
      JSON.stringify({ userId: USER_ID, date: TODAY }),
    );
    // 앵커를 별도 setItem으로 쓰면 그 사이에 죽을 수 있다 — 배치 밖 쓰기가 없어야 한다.
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test('로그인 전(온보딩) 등록은 소유 미상 앵커로 남는다', async () => {
    await registerUsageBucketMonitoring(null);

    expect(entryInSingleMultiSet(STORAGE_KEYS.screentimeMeasurementStartDate)).toBe(
      JSON.stringify({ userId: '1', date: TODAY }),
    );
  });

  test('이미 같은 계정 앵커가 있으면 덮지 않는다 (가장 이른 날 유지)', async () => {
    await seedAnchor(USER_ID, '2026-07-01');

    await registerUsageBucketMonitoring(USER_ID);

    expect(entryInSingleMultiSet(STORAGE_KEYS.screentimeMeasurementStartDate)).toBeUndefined();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.screentimeMeasurementStartDate)).toBe(
      JSON.stringify({ userId: USER_ID, date: '2026-07-01' }),
    );
  });

  test("소유 미상('1') 앵커도 날짜를 그대로 둔다 — 귀속은 Syncer가 한다", async () => {
    await seedAnchor('1', '2026-07-30');

    await registerUsageBucketMonitoring(USER_ID);

    expect(entryInSingleMultiSet(STORAGE_KEYS.screentimeMeasurementStartDate)).toBeUndefined();
  });

  test('다른 계정 앵커면 이번 등록 기준으로 새로 쓴다 (계정 전환)', async () => {
    await seedAnchor('other', '2026-07-01');

    await registerUsageBucketMonitoring(USER_ID);

    expect(entryInSingleMultiSet(STORAGE_KEYS.screentimeMeasurementStartDate)).toBe(
      JSON.stringify({ userId: USER_ID, date: TODAY }),
    );
  });

  test('네이티브 등록이 실패하면 아무것도 쓰지 않는다', async () => {
    mockStart.mockResolvedValue(false);

    await expect(registerUsageBucketMonitoring(USER_ID)).resolves.toBe(false);

    expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.screentimeMeasurementStartDate)).toBeNull();
  });
});
