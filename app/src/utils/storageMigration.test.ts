// storageMigration.ts 유닛 테스트(GROMO-948) — AsyncStorage 공식 mock(jest.setup.js) 기반.
// 시나리오는 실제 로직 기준으로 확정: v2(숫자 id 캐시 제거)·v3(계정별 맵 전환, GROMO-936)·
// 롤백 복귀 병합. 멱등성 설계가 '스킵'이 아니라 '병합'인 점(코덱스 리뷰)을 그대로 검증한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { runStorageMigrations } from './storageMigration';
import { clearSessionTokens } from '@/services/sessionStorage';

jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      values.delete(key);
    }),
  };
});

// api.ts는 axios 인스턴스·mock 어댑터까지 모듈 로드에 끌고 오므로 토큰 디코드만 가짜로 대체.
// 'jwt-<userId>' 형태만 유효한 토큰으로 인정한다.
jest.mock('@/services/api', () => ({
  getUserIdFromToken: (token: string) => (token.startsWith('jwt-') ? token.slice(4) : null),
}));

const USER_ID = 'user-1';
const LEGACY_EQUIPMENT = {
  equippedItem: 'hat-1',
  equippedFurniture: ['desk-1'],
  equippedCostume: [],
};
const EMPTY_EQUIPMENT = { equippedItem: null, equippedFurniture: [], equippedCostume: [] };

// 복원 가능한 로그인 세션(user + onboardingComplete) — v3가 소유자로 인정하는 조건
async function seedSession(userId = USER_ID): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
  await AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify({ accessToken: `jwt-${userId}` }));
}

async function getJson<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

beforeEach(async () => {
  await AsyncStorage.clear(); // mock 저장소는 워커 안에서 유지되므로 테스트마다 비운다
  await clearSessionTokens();
  jest.clearAllMocks();
});

describe('v2 — 숫자 id 캐시 제거', () => {
  test('storageVersion이 없으면 구 키를 지우고 버전·v3 마커를 기록한다 (구 숫자 id 번들 첫 실행)', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify([1, 2]));
    await AsyncStorage.setItem(STORAGE_KEYS.equipment, JSON.stringify({ equippedItem: 3 }));

    await runStorageMigrations();

    expect(await AsyncStorage.getItem(STORAGE_KEYS.storageVersion)).toBe('2');
    expect(await AsyncStorage.getItem(STORAGE_KEYS.ownedItems)).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.equipment)).toBeNull();
    // v2가 지운 뒤라 v3가 옮길 것이 없고, 마커만 남는다
    expect(await AsyncStorage.getItem(STORAGE_KEYS.ownedItemsV2)).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.migrationV3)).toBe('1');
  });

  test("storageVersion이 '2'면 구 키를 지우지 않는다", async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.storageVersion, '2');
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(['a']));

    await runStorageMigrations();

    expect(await getJson(STORAGE_KEYS.ownedItems)).toEqual(['a']);
  });
});

describe('v3 — 장비·보유 아이템 계정별 맵 전환', () => {
  // 배포된 번들은 이미 v2를 마친 상태에서 v3를 만난다
  beforeEach(async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.storageVersion, '2');
  });

  test('로그인 세션이 있으면 구 형식을 계정에 귀속해 새 키에 기록하고, 구 키는 값째 보존한다', async () => {
    await seedSession();
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(['a', 'b']));
    await AsyncStorage.setItem(STORAGE_KEYS.equipment, JSON.stringify(LEGACY_EQUIPMENT));

    await runStorageMigrations();

    expect(await getJson(STORAGE_KEYS.ownedItemsV2)).toEqual({ [USER_ID]: ['a', 'b'] });
    expect(await getJson(STORAGE_KEYS.equipmentV2)).toEqual({ [USER_ID]: LEGACY_EQUIPMENT });
    // OTA 롤백 호환 — 구 번들이 계속 읽을 수 있게 구 키를 지우지 않는다
    expect(await getJson(STORAGE_KEYS.ownedItems)).toEqual(['a', 'b']);
    expect(await getJson(STORAGE_KEYS.equipment)).toEqual(LEGACY_EQUIPMENT);
    expect(await AsyncStorage.getItem(STORAGE_KEYS.migrationV3)).toBe('1');
  });

  test('완료 마커가 있으면 재실행해도 v3를 다시 수행하지 않는다 — 이후 구매가 덮이지 않음', async () => {
    await seedSession();
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(['a']));
    await runStorageMigrations();

    // 마이그레이션 이후의 구매를 새 키에 반영한 상황
    await AsyncStorage.setItem(
      STORAGE_KEYS.ownedItemsV2,
      JSON.stringify({ [USER_ID]: ['a', 'bought-later'] }),
    );
    await runStorageMigrations();

    expect(await getJson(STORAGE_KEYS.ownedItemsV2)).toEqual({ [USER_ID]: ['a', 'bought-later'] });
  });

  test('마커 없이 재시도돼도 병합이라 중복·유실이 없다 — Provider 기본값 버킷도 흡수', async () => {
    await seedSession();
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(['a', 'b']));
    await AsyncStorage.setItem(STORAGE_KEYS.equipment, JSON.stringify(LEGACY_EQUIPMENT));
    // v3 실패 후 Provider가 새 키에 만든 상태: 일부 구매('c') + 빈 장착 기본값
    await AsyncStorage.setItem(
      STORAGE_KEYS.ownedItemsV2,
      JSON.stringify({ [USER_ID]: ['b', 'c'] }),
    );
    await AsyncStorage.setItem(
      STORAGE_KEYS.equipmentV2,
      JSON.stringify({ [USER_ID]: EMPTY_EQUIPMENT }),
    );

    await runStorageMigrations();

    // 보유 아이템은 합집합, 빈 장착 버킷은 구 실데이터로 대체된다
    expect(await getJson(STORAGE_KEYS.ownedItemsV2)).toEqual({ [USER_ID]: ['b', 'c', 'a'] });
    expect(await getJson(STORAGE_KEYS.equipmentV2)).toEqual({ [USER_ID]: LEGACY_EQUIPMENT });
  });

  test('실데이터가 있는 장착 버킷은 구 데이터로 덮지 않는다', async () => {
    await seedSession();
    const current = { equippedItem: 'hat-2', equippedFurniture: [], equippedCostume: [] };
    await AsyncStorage.setItem(STORAGE_KEYS.equipment, JSON.stringify(LEGACY_EQUIPMENT));
    await AsyncStorage.setItem(STORAGE_KEYS.equipmentV2, JSON.stringify({ [USER_ID]: current }));

    await runStorageMigrations();

    expect(await getJson(STORAGE_KEYS.equipmentV2)).toEqual({ [USER_ID]: current });
  });

  test('로그아웃 상태면 구 형식을 귀속하지 않고 버린다(무관 계정 흡수 방지) — 구 키는 보존', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(['a']));
    await AsyncStorage.setItem(STORAGE_KEYS.equipment, JSON.stringify(LEGACY_EQUIPMENT));

    await runStorageMigrations();

    expect(await AsyncStorage.getItem(STORAGE_KEYS.ownedItemsV2)).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.equipmentV2)).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.migrationV3)).toBe('1'); // 버려도 완료는 완료
    expect(await getJson(STORAGE_KEYS.ownedItems)).toEqual(['a']);
  });

  test('온보딩 미완료 세션(user만 있음)은 소유자로 인정하지 않는다', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.user,
      JSON.stringify({ accessToken: `jwt-${USER_ID}` }),
    );
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(['a']));

    await runStorageMigrations();

    expect(await AsyncStorage.getItem(STORAGE_KEYS.ownedItemsV2)).toBeNull();
  });

  test('구 키가 이미 맵 형태(개발 중간 빌드)면 로그인 여부와 무관하게 그대로 병합한다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify({ 'user-9': ['x'] }));

    await runStorageMigrations();

    expect(await getJson(STORAGE_KEYS.ownedItemsV2)).toEqual({ 'user-9': ['x'] });
  });
});

describe('손상 값 처리', () => {
  test('구 키 JSON이 손상돼도 예외 없이 끝나고, 마커를 남기지 않아 다음 실행에서 재시도한다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.storageVersion, '2');
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, 'not-json{');

    await expect(runStorageMigrations()).resolves.toBeUndefined();

    expect(await AsyncStorage.getItem(STORAGE_KEYS.migrationV3)).toBeNull();
  });

  test('user JSON이 손상돼도 예외 없이 끝나고 원본 데이터는 남는다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.storageVersion, '2');
    await AsyncStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
    await AsyncStorage.setItem(STORAGE_KEYS.user, '{broken');
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(['a']));

    await expect(runStorageMigrations()).resolves.toBeUndefined();

    expect(await AsyncStorage.getItem(STORAGE_KEYS.migrationV3)).toBeNull();
    expect(await getJson(STORAGE_KEYS.ownedItems)).toEqual(['a']);
  });
});

describe('롤백 복귀 병합(reconcileLegacyOwnedItems) — v3 완료 후에도 매 실행 동작', () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.storageVersion, '2');
    await AsyncStorage.setItem(STORAGE_KEYS.migrationV3, '1');
  });

  test('듀얼라이트 소유자 키가 있으면 구 키 변경분(롤백 중 구매)을 소유자 버킷에 합집합 병합한다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItemsLegacyOwner, USER_ID);
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(['a', 'rollback-buy']));
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItemsV2, JSON.stringify({ [USER_ID]: ['a'] }));

    await runStorageMigrations();

    expect(await getJson(STORAGE_KEYS.ownedItemsV2)).toEqual({ [USER_ID]: ['a', 'rollback-buy'] });
  });

  test('이미 병합돼 변화가 없으면 새로 쓰지 않는다(쓰기 생략)', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItemsLegacyOwner, USER_ID);
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(['a']));
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItemsV2, JSON.stringify({ [USER_ID]: ['a'] }));

    (AsyncStorage.setItem as jest.Mock).mockClear();
    await runStorageMigrations();

    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(
      STORAGE_KEYS.ownedItemsV2,
      expect.anything(),
    );
  });
});
