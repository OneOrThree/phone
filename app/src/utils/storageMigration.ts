// AsyncStorage 스키마 마이그레이션. 앱 시작 시(Provider 마운트 전) 1회 실행된다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { getUserIdFromToken } from '@/services/api';

// ⚠️ storageVersion 값은 영원히 '2'로 유지한다 — 이미 배포된 구 번들의 마이그레이션이
// "'2'가 아니면 구 키(ownedItems·equipment)를 삭제"하므로, 값을 올리면 OTA 롤백 시
// 구 번들이 보존해 둔 구 키를 지워버린다(코덱스 리뷰). v3부터는 버전 대신
// 마이그레이션별 완료 마커 키(STORAGE_KEYS.migrationV3)로 추적한다.
const V2_STORAGE_VERSION = '2';

// v2(이전 = 미설정): 숫자 id 캐시 제거. 토큰·로그인 정보는 유지한다.
// 엔티티 PK가 Long → UUID(string)로 바뀌면서(GROMO-443), 숫자 id가 박힌
// 기존 로컬 캐시는 서버가 주는 UUID와 매칭되지 않는다.
//  - ownedItems: number[] 형태의 보유 아이템 id (서버 재동기화 경로 없음 → 반드시 비움)
//  - equipment: 장착 아이템/가구의 숫자 id 포함
const STALE_NUMERIC_ID_KEYS: string[] = [STORAGE_KEYS.ownedItems, STORAGE_KEYS.equipment];

// 장착 상태가 실질적으로 비어 있는지 — v3 실패 후 Provider가 만든 기본값 버킷을
// "이미 마이그레이션된 데이터"로 오인해 임포트를 영구 봉인하지 않기 위한 판정(코덱스 리뷰).
interface SavedEquipmentShape {
  equippedItem?: unknown;
  equippedFurniture?: unknown[];
  equippedCostume?: unknown[];
}
function isEmptyEquipment(saved: SavedEquipmentShape | undefined): boolean {
  return (
    !saved ||
    (!saved.equippedItem && !saved.equippedFurniture?.length && !saved.equippedCostume?.length)
  );
}

// v3(GROMO-936): 장비·보유 아이템을 계정별 맵으로 전환해 **새 키**(:v2)에 기록한다.
//  - 구 키는 값째 보존 — OTA 롤백 시 구 번들이 구 형식을 계속 읽을 수 있어야 한다(코덱스 리뷰).
//  - 귀속은 복원 가능한 세션(user + onboardingComplete)일 때만 — 온보딩 미완료로 앱이
//    복원하지 않는 반쪽 세션의 토큰을 소유자로 오인하지 않고(코덱스 리뷰), 로그아웃
//    상태면 소유자 불명이라 귀속하지 않고 버린다(무관 계정 흡수 방지).
//  - 멱등성은 "대상 키 있으면 스킵"이 아니라 **병합**으로 확보 — 스킵 방식은 v3 실패 후
//    Provider가 만든 기본값이 임포트를 영구 봉인하는 허점이 있다(코덱스 리뷰).
//    보유 아이템은 합집합, 장착 상태는 실데이터가 있는 버킷 우선(빈 기본값만 대체).
async function migrateV3(): Promise<void> {
  const onboarded = await AsyncStorage.getItem(STORAGE_KEYS.onboardingComplete);
  const rawUser = onboarded ? await AsyncStorage.getItem(STORAGE_KEYS.user) : null;
  const accessToken = rawUser
    ? ((JSON.parse(rawUser) as { accessToken?: string }).accessToken ?? '')
    : '';
  const userId = accessToken ? getUserIdFromToken(accessToken) : null;

  const rawOwned = await AsyncStorage.getItem(STORAGE_KEYS.ownedItems);
  if (rawOwned) {
    const parsed = JSON.parse(rawOwned) as string[] | Record<string, string[]>;
    // 개발 중간 빌드가 구 키에 이미 맵을 썼다면 그대로 병합, 구 형식(배열)은 로그인 계정에만 귀속
    const imported = Array.isArray(parsed) ? (userId ? { [userId]: parsed } : null) : parsed;
    if (imported) {
      const rawV2 = await AsyncStorage.getItem(STORAGE_KEYS.ownedItemsV2);
      const map = rawV2 ? (JSON.parse(rawV2) as Record<string, string[]>) : {};
      for (const [owner, items] of Object.entries(imported)) {
        map[owner] = Array.from(new Set([...(map[owner] ?? []), ...items]));
      }
      await AsyncStorage.setItem(STORAGE_KEYS.ownedItemsV2, JSON.stringify(map));
    }
  }

  const rawEquipment = await AsyncStorage.getItem(STORAGE_KEYS.equipment);
  if (rawEquipment) {
    const parsed = JSON.parse(rawEquipment) as Record<string, unknown>;
    // 구 형식(단일 객체)은 장비 필드가 최상위에 있다 — 옛 형식 지식은 마이그레이션에 동결
    const isLegacy =
      'equippedItem' in parsed || 'equippedFurniture' in parsed || 'equippedCostume' in parsed;
    const imported = isLegacy ? (userId ? { [userId]: parsed } : null) : parsed;
    if (imported) {
      const rawV2 = await AsyncStorage.getItem(STORAGE_KEYS.equipmentV2);
      const map = rawV2 ? (JSON.parse(rawV2) as Record<string, SavedEquipmentShape>) : {};
      for (const [owner, saved] of Object.entries(imported)) {
        if (isEmptyEquipment(map[owner])) map[owner] = saved as SavedEquipmentShape;
      }
      await AsyncStorage.setItem(STORAGE_KEYS.equipmentV2, JSON.stringify(map));
    }
  }
}

// 매 실행: 롤백된 구 번들이 구 키에 남긴 변경(예: 롤백 중 구매)을 소유자 버킷으로 병합한다.
// 소유자는 CoinContext의 듀얼라이트가 legacyOwner 키로 함께 남기므로 세션 휴리스틱이
// 아니라 정확한 귀속이다(코덱스 리뷰 — 롤백 복귀 시 구매 유실 방지). 합집합이라 멱등.
async function reconcileLegacyOwnedItems(): Promise<void> {
  const owner = await AsyncStorage.getItem(STORAGE_KEYS.ownedItemsLegacyOwner);
  if (!owner) return;
  const rawLegacy = await AsyncStorage.getItem(STORAGE_KEYS.ownedItems);
  if (!rawLegacy) return;
  const legacy = JSON.parse(rawLegacy) as string[] | Record<string, string[]>;
  if (!Array.isArray(legacy) || legacy.length === 0) return;
  const rawV2 = await AsyncStorage.getItem(STORAGE_KEYS.ownedItemsV2);
  const map = rawV2 ? (JSON.parse(rawV2) as Record<string, string[]>) : {};
  const current = map[owner] ?? [];
  const merged = Array.from(new Set([...current, ...legacy]));
  if (merged.length === current.length) return; // 변화 없으면 쓰기 생략
  map[owner] = merged;
  await AsyncStorage.setItem(STORAGE_KEYS.ownedItemsV2, JSON.stringify(map));
}

export async function runStorageMigrations(): Promise<void> {
  try {
    // v2 — 배포된 구 번들과 동일한 판정·기록을 유지해야 한다(위 storageVersion 주석 참고).
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.storageVersion);
    if (stored !== V2_STORAGE_VERSION) {
      await AsyncStorage.multiRemove(STALE_NUMERIC_ID_KEYS);
      await AsyncStorage.setItem(STORAGE_KEYS.storageVersion, V2_STORAGE_VERSION);
    }
    // v3 — 완료 마커가 없을 때만 실행. 실패하면 마커가 안 남아 다음 실행에서 재시도되고,
    // 그 사이 Provider가 만든 기본값은 위 병합 설계가 흡수한다.
    if (!(await AsyncStorage.getItem(STORAGE_KEYS.migrationV3))) {
      await migrateV3();
      await AsyncStorage.setItem(STORAGE_KEYS.migrationV3, '1');
    }
    // 롤백 복귀 병합은 매 실행 수행(듀얼라이트 소유자 키가 있을 때만 동작).
    await reconcileLegacyOwnedItems();
  } catch {
    // 마이그레이션 실패는 치명적이지 않음 — 마커 미기록 시 다음 실행에서 재시도된다.
  }
}
