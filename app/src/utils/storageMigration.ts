// AsyncStorage 스키마 마이그레이션.
// 엔티티 PK가 Long → UUID(string)로 바뀌면서(GROMO-443), 숫자 id가 박힌
// 기존 로컬 캐시는 서버가 주는 UUID와 매칭되지 않는다. 앱 시작 시 1회 무효화한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

const CURRENT_STORAGE_VERSION = '2';

// v2(이전 = 미설정): 숫자 id 캐시 제거. 토큰·로그인 정보는 유지한다.
//  - ownedItems: number[] 형태의 보유 아이템 id (서버 재동기화 경로 없음 → 반드시 비움)
//  - equipment: 장착 아이템/가구의 숫자 id 포함
const STALE_NUMERIC_ID_KEYS: string[] = [STORAGE_KEYS.ownedItems, STORAGE_KEYS.equipment];

export async function runStorageMigrations(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.storageVersion);
    if (stored === CURRENT_STORAGE_VERSION) return;

    await AsyncStorage.multiRemove(STALE_NUMERIC_ID_KEYS);
    await AsyncStorage.setItem(STORAGE_KEYS.storageVersion, CURRENT_STORAGE_VERSION);
  } catch {
    // 마이그레이션 실패는 치명적이지 않음 — 버전 키 미기록 시 다음 실행에서 재시도된다.
  }
}
