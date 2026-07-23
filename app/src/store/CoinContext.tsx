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

// 게스트 세션의 버킷 키 — 로그인(계정 연결) 시 해당 계정으로 인계된다.
const GUEST_BUCKET = 'guest';

export function CoinProvider({ children }: { children: ReactNode }) {
  const { userId, isGuest } = useUser();
  // 게스트도 실제 UUID JWT를 받으므로(auth.ts guestLogin) userId만으론 게스트를 못 가른다.
  // isGuest로 판별해 고정 버킷에 둬야 소셜 전환(다른 UUID) 시 인계가 동작한다(코덱스 리뷰).
  const bucket = isGuest ? GUEST_BUCKET : (userId ?? GUEST_BUCKET);
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
      // 게스트 구매분은 이후 로그인한 계정으로 인계(게스트 → 소셜 계정 연결 흐름)
      const guestItems = allOwned.current[GUEST_BUCKET];
      if (bucket !== GUEST_BUCKET && guestItems) {
        delete allOwned.current[GUEST_BUCKET];
        allOwned.current[bucket] = Array.from(
          new Set([...(allOwned.current[bucket] ?? []), ...guestItems]),
        );
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
