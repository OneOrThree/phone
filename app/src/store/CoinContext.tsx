import {
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/services/api';
import { useUser } from './UserContext';
import { STORAGE_KEYS } from '@/types/storage';

interface CoinContextValue {
  coins: number;
  // 서버 잔액 재조회. 마운트 1회 로드만으로는 **서버가 깎은 잔액**(그룹 내기 판돈 차감·정산 지급)이
  // 앱에 영영 반영되지 않는다 — 잔액을 보여 주는 화면이 열릴 때 직접 부른다(3차 내기 시트).
  refresh: () => Promise<void>;
  addCoins: (amount: number) => Promise<void>;
  isOwned: (itemId: string) => boolean;
  buyItem: (itemId: string, price: number) => Promise<boolean>;
}

const CoinContext = createContext<CoinContextValue | null>(null);

// 계정별 보유 아이템 맵. 아이템 API가 없어 로컬이 유일한 구매 기록이므로, 로그아웃 시
// 지우는 대신 계정별로 분리 보관해 계정 간 누출과 구매 기록 소실을 모두 막는다(GROMO-936 리뷰).
// 구 키(ownedItems)와 형식이 달라 새 키(:v2)를 쓴다 — OTA 롤백 호환(storageMigration v3 참고).
type OwnedItemsByUser = Record<string, string[]>;

// userId(JWT sub)를 디코드하지 못한 비정상 세션의 폴백 버킷 — 정상 경로에선 쓰이지 않는다.
const FALLBACK_BUCKET = 'unknown';

// 보유 아이템 키에 닿는 모든 쓰기를 직렬화하는 큐 — Provider 저장과 전환 인계가 서로의
// 쓰기를 낡은 스냅샷으로 덮어쓰지 않게, 읽기-수정-쓰기를 한 단위로 순차 실행한다(코덱스 리뷰).
let ownedItemsWrites: Promise<void> = Promise.resolve();
function updateOwnedItemsStore(update: (map: OwnedItemsByUser) => OwnedItemsByUser): Promise<void> {
  const run = ownedItemsWrites.then(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.ownedItemsV2);
    const map = raw ? (JSON.parse(raw) as OwnedItemsByUser) : {};
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItemsV2, JSON.stringify(update(map)));
  });
  // 큐는 실패해도 이어지도록 내부에서만 삼키고, 호출자에겐 실패를 그대로 전파한다(코덱스 리뷰).
  ownedItemsWrites = run.catch(() => {});
  return run;
}

// 게스트 → 소셜 전환(계정 연결) 시 게스트 UUID 버킷의 구매 기록을 새 계정으로 인계(합집합).
// 고정 'guest' 버킷 대신 전환 시점에만 옮기는 이유: 고정 버킷은 게스트 로그아웃 후에도 남아
// 다음 게스트·무관한 소셜 계정에 누출된다(코덱스 리뷰). 호출처는 App.applyStoredSession —
// 이전·새 userId를 모두 아는 유일한 시점이다.
export function transferOwnedItems(fromUserId: string, toUserId: string): Promise<void> {
  return updateOwnedItemsStore((map) => {
    const fromItems = map[fromUserId];
    if (!fromItems) return map;
    delete map[fromUserId];
    map[toUserId] = Array.from(new Set([...(map[toUserId] ?? []), ...fromItems]));
    return map;
  });
}

export function CoinProvider({ children }: { children: ReactNode }) {
  const { userId } = useUser();
  // 게스트도 UUID JWT를 받으므로(auth.ts guestLogin) userId 버킷만으로 계정이 분리된다.
  const bucket = userId ?? FALLBACK_BUCKET;
  const [coins, setCoins] = useState(0);
  const [ownedItemIds, setOwnedItemIds] = useState<string[]>([]);
  const loaded = useRef(false);

  // 서버에서 잔액 로드. 실패는 조용히 무시한다 — 잔액은 화면을 막을 값이 아니고,
  // 다음 refresh(시트 오픈 등)에서 자연 재시도된다.
  const refresh = useCallback(async () => {
    try {
      const res = await api.get<number>('/api/v1/currency');
      setCoins(res.data);
    } catch {
      // 무시
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 보유 아이템은 AsyncStorage 유지 (아이템 API 미구현)
  // 형식 변환은 storageMigration v3가 Provider 마운트 전에 보장하므로 맵으로 바로 읽는다.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.ownedItemsV2).then((raw) => {
      const map = raw ? (JSON.parse(raw) as OwnedItemsByUser) : {};
      setOwnedItemIds(map[bucket] ?? []);
      loaded.current = true;
    });
  }, [bucket]);

  useEffect(() => {
    if (!loaded.current) return;
    // 저장 실패는 무시 — 다음 상태 변경 때 자연 재시도된다
    updateOwnedItemsStore((map) => ({ ...map, [bucket]: ownedItemIds })).catch(() => {});
    // 구 키에도 현재 계정 것을 같이 써(듀얼라이트) OTA 롤백된 구 번들에서도 구매가 보이게
    // 하고, 소유자 키를 함께 남겨 롤백 중의 구매를 복귀 후 정확한 버킷으로 병합한다
    // (storageMigration.reconcileLegacyOwnedItems, 코덱스 리뷰).
    AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(ownedItemIds)).catch(() => {});
    AsyncStorage.setItem(STORAGE_KEYS.ownedItemsLegacyOwner, bucket).catch(() => {});
  }, [bucket, ownedItemIds]);

  async function addCoins(amount: number) {
    setCoins((prev) => prev + amount);
    api.post('/api/v1/currency/earn', { amount, reason: 'SESSION_COMPLETE' }).catch(() => {});
  }

  function isOwned(itemId: string) {
    return ownedItemIds.includes(itemId);
  }

  async function buyItem(itemId: string, price: number) {
    if (coins < price) return false;
    try {
      await api.post('/api/v1/currency/spend', { amount: price, reason: 'PURCHASE' });
      setCoins((prev) => prev - price);
      setOwnedItemIds((prev) => [...prev, itemId]);
      return true;
    } catch {
      return false;
    }
  }

  return (
    <CoinContext.Provider value={{ coins, refresh, addCoins, isOwned, buyItem }}>
      {children}
    </CoinContext.Provider>
  );
}

export function useCoins(): CoinContextValue {
  const context = useContext(CoinContext);
  if (!context) throw new Error('useCoins must be used inside CoinProvider');
  return context;
}
