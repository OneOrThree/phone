// 별점 요청 로직 검증(GROMO-980) — 별점창은 시뮬/개발빌드에서 안 뜨므로 조건 판정만 단위 검증한다.
// expo-store-review는 네이티브라 전체 mock, AsyncStorage는 jest.setup.js의 in-memory mock을 쓴다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';

import { STORAGE_KEYS } from '@/types/storage';

import { recordAccessDay, maybeRequestReview } from './storeReview';

jest.mock('expo-store-review', () => ({
  isAvailableAsync: jest.fn(),
  requestReview: jest.fn(),
}));

const mockIsAvailable = StoreReview.isAvailableAsync as jest.Mock;
const mockRequest = StoreReview.requestReview as jest.Mock;

async function readCount(): Promise<number> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.storeReviewAccessDays);
  return raw ? (JSON.parse(raw).count as number) : 0;
}

// 누적 접속일을 임의 값으로 심는다(마지막 카운트일은 과거로 둬 recordAccessDay 재호출과 무관하게).
async function seedAccessCount(count: number): Promise<void> {
  await AsyncStorage.setItem(
    STORAGE_KEYS.storeReviewAccessDays,
    JSON.stringify({ count, lastDate: '2000-01-01' }),
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockIsAvailable.mockReset().mockResolvedValue(true);
  mockRequest.mockReset().mockResolvedValue(undefined);
});

describe('recordAccessDay', () => {
  it('첫 접속이면 누적 접속일을 1 올린다', async () => {
    await recordAccessDay();
    expect(await readCount()).toBe(1);
  });

  it('같은 날 여러 번 호출해도 하루 1회만 증가한다', async () => {
    await recordAccessDay();
    await recordAccessDay();
    await recordAccessDay();
    expect(await readCount()).toBe(1);
  });

  it('마지막 카운트일이 과거면(날짜가 바뀌면) 증가한다', async () => {
    await seedAccessCount(6);
    await recordAccessDay();
    expect(await readCount()).toBe(7);
  });
});

describe('maybeRequestReview', () => {
  it('누적 7일 미만이면 요청하지 않는다', async () => {
    await seedAccessCount(6);
    await maybeRequestReview();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('누적 7일 이상 + 미요청 + 사용 가능하면 1회 요청하고 마커를 남긴다', async () => {
    await seedAccessCount(7);
    await maybeRequestReview();
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(STORAGE_KEYS.storeReviewRequested)).toBe('1');
  });

  it('이미 요청 마커가 있으면 다시 요청하지 않는다', async () => {
    await seedAccessCount(10);
    await AsyncStorage.setItem(STORAGE_KEYS.storeReviewRequested, '1');
    await maybeRequestReview();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('OS가 요청 불가하면(isAvailableAsync=false) 요청도 마커 저장도 하지 않는다', async () => {
    await seedAccessCount(7);
    mockIsAvailable.mockResolvedValue(false);
    await maybeRequestReview();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.storeReviewRequested)).toBeNull();
  });
});
