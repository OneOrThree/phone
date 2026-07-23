import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/services/api';
import { useUser } from './UserContext';
import { STORAGE_KEYS } from '@/types/storage';

interface CoinContextValue {
  coins: number;
  addCoins: (amount: number) => Promise<void>;
  isOwned: (itemId: string) => boolean;
  buyItem: (itemId: string, price: number) => Promise<boolean>;
}

const CoinContext = createContext<CoinContextValue | null>(null);

// 계정별 보유 아이템 맵. 아이템 API가 없어 로컬이 유일한 구매 기록이므로, 로그아웃 시
// 지우는 대신 계정별로 분리 보관해 계정 간 누출과 구매 기록 소실을 모두 막는다(GROMO-936 리뷰).
type OwnedItemsByUser = Record<string, string[]>;

// userId(JWT sub)를 디코드하지 못한 비정상 세션의 폴백 버킷 — 정상 경로에선 쓰이지 않는다.
const FALLBACK_BUCKET = 'unknown';

// 게스트 → 소셜 전환(계정 연결) 시 게스트 UUID 버킷의 구매 기록을 새 계정으로 인계(합집합).
// 고정 'guest' 버킷 대신 전환 시점에만 옮기는 이유: 고정 버킷은 게스트 로그아웃 후에도 남아
// 다음 게스트·무관한 소셜 계정에 누출된다(코덱스 리뷰). 호출처는 App.applyStoredSession —
// 이전·새 userId를 모두 아는 유일한 시점이다.
export async function transferOwnedItems(fromUserId: string, toUserId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.ownedItems);
  if (!raw) return;
  const parsed = JSON.parse(raw) as string[] | OwnedItemsByUser;
  if (Array.isArray(parsed)) return; // 구 형식은 소유자 불명 — 인계하지 않는다
  const fromItems = parsed[fromUserId];
  if (!fromItems) return;
  delete parsed[fromUserId];
  parsed[toUserId] = Array.from(new Set([...(parsed[toUserId] ?? []), ...fromItems]));
  await AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(parsed));
}

export function CoinProvider({ children }: { children: ReactNode }) {
  const { userId } = useUser();
  // 게스트도 UUID JWT를 받으므로(auth.ts guestLogin) userId 버킷만으로 계정이 분리된다.
  const bucket = userId ?? FALLBACK_BUCKET;
  const [coins, setCoins] = useState(0);
  const [ownedItemIds, setOwnedItemIds] = useState<string[]>([]);
  const allOwned = useRef<OwnedItemsByUser>({});
  const loaded = useRef(false);

  // 서버에서 잔액 로드
  useEffect(() => {
    api
      .get<number>('/api/v1/currency')
      .then((res) => setCoins(res.data))
      .catch(() => {});
  }, []);

  // 보유 아이템은 AsyncStorage 유지 (아이템 API 미구현)
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.ownedItems).then((raw) => {
      if (raw) {
        const parsed = JSON.parse(raw) as string[] | OwnedItemsByUser;
        // 계정 구분 없던 구 형식(string[])은 첫 로드 계정 소유로 귀속시켜 유지
        allOwned.current = Array.isArray(parsed) ? { [bucket]: parsed } : parsed;
      }
      setOwnedItemIds(allOwned.current[bucket] ?? []);
      loaded.current = true;
    });
  }, [bucket]);

  useEffect(() => {
    if (!loaded.current) return;
    allOwned.current = { ...allOwned.current, [bucket]: ownedItemIds };
    AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(allOwned.current));
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
    <CoinContext.Provider value={{ coins, addCoins, isOwned, buyItem }}>
      {children}
    </CoinContext.Provider>
  );
}

export function useCoins(): CoinContextValue {
  const context = useContext(CoinContext);
  if (!context) throw new Error('useCoins must be used inside CoinProvider');
  return context;
}
