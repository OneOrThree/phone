// AsyncStorage 스키마 마이그레이션. 앱 시작 시(Provider 마운트 전) 1회 실행된다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { getUserIdFromToken } from '@/services/api';

const CURRENT_STORAGE_VERSION = '3';

// v2(이전 = 미설정): 숫자 id 캐시 제거. 토큰·로그인 정보는 유지한다.
// 엔티티 PK가 Long → UUID(string)로 바뀌면서(GROMO-443), 숫자 id가 박힌
// 기존 로컬 캐시는 서버가 주는 UUID와 매칭되지 않는다.
//  - ownedItems: number[] 형태의 보유 아이템 id (서버 재동기화 경로 없음 → 반드시 비움)
//  - equipment: 장착 아이템/가구의 숫자 id 포함
const STALE_NUMERIC_ID_KEYS: string[] = [STORAGE_KEYS.ownedItems, STORAGE_KEYS.equipment];

// v3(GROMO-936): 장비·보유 아이템을 계정별 맵으로 전환해 **새 키**(:v2)에 기록한다.
//  - 구 키는 값째 보존 — OTA 롤백 시 구 번들이 구 형식을 계속 읽을 수 있어야 한다(코덱스 리뷰).
//  - 구 형식은 계정 구분이 없어 소유자를 알 수 없다. 마이그레이션 시점에 로그인 세션이
//    있으면(gromo:user) 그 계정 소유로 귀속하고, 로그아웃 상태면 귀속하지 않고 버린다 —
//    다음에 로그인하는 무관한 계정이 이전 사용자 데이터를 흡수하지 않게(코덱스 리뷰).
async function migrateV3(): Promise<void> {
  const rawUser = await AsyncStorage.getItem(STORAGE_KEYS.user);
  const accessToken = rawUser
    ? ((JSON.parse(rawUser) as { accessToken?: string }).accessToken ?? '')
    : '';
  const userId = accessToken ? getUserIdFromToken(accessToken) : null;

  const rawOwned = await AsyncStorage.getItem(STORAGE_KEYS.ownedItems);
  if (rawOwned) {
    const parsed = JSON.parse(rawOwned) as string[] | Record<string, string[]>;
    // 개발 중간 빌드가 구 키에 이미 맵을 썼다면 그대로 이전, 구 형식(배열)은 로그인 계정에만 귀속
    const map = Array.isArray(parsed) ? (userId ? { [userId]: parsed } : null) : parsed;
    if (map) await AsyncStorage.setItem(STORAGE_KEYS.ownedItemsV2, JSON.stringify(map));
  }

  const rawEquipment = await AsyncStorage.getItem(STORAGE_KEYS.equipment);
  if (rawEquipment) {
    const parsed = JSON.parse(rawEquipment) as Record<string, unknown>;
    // 구 형식(단일 객체)은 장비 필드가 최상위에 있다 — 옛 형식 지식은 마이그레이션에 동결
    const isLegacy =
      'equippedItem' in parsed || 'equippedFurniture' in parsed || 'equippedCostume' in parsed;
    const map = isLegacy ? (userId ? { [userId]: parsed } : null) : parsed;
    if (map) await AsyncStorage.setItem(STORAGE_KEYS.equipmentV2, JSON.stringify(map));
  }
}

export async function runStorageMigrations(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.storageVersion);
    if (stored === CURRENT_STORAGE_VERSION) return;
    const version = Number(stored ?? '0');
    if (version < 2) await AsyncStorage.multiRemove(STALE_NUMERIC_ID_KEYS);
    if (version < 3) await migrateV3();
    await AsyncStorage.setItem(STORAGE_KEYS.storageVersion, CURRENT_STORAGE_VERSION);
  } catch {
    // 마이그레이션 실패는 치명적이지 않음 — 버전 키 미기록 시 다음 실행에서 재시도된다.
  }
}
