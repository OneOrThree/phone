import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../utils/api';
import { STORAGE_KEYS } from '../types/storage';

interface CoinContextValue {
  coins: number;
  addCoins: (amount: number) => Promise<void>;
  isOwned: (itemId: number) => boolean;
  buyItem: (itemId: number, price: number) => Promise<boolean>;
}

const CoinContext = createContext<CoinContextValue | null>(null);

export function CoinProvider({ children }: { children: ReactNode }) {
  const [coins, setCoins] = useState(0);
  const [ownedItemIds, setOwnedItemIds] = useState<number[]>([]);
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
      if (raw) setOwnedItemIds(JSON.parse(raw) as number[]);
      loaded.current = true;
    });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(ownedItemIds));
  }, [ownedItemIds]);

  async function addCoins(amount: number) {
    setCoins((prev) => prev + amount);
    api.post('/api/v1/currency/earn', { amount, reason: 'SESSION_COMPLETE' }).catch(() => {});
  }

  function isOwned(itemId: number) {
    return ownedItemIds.includes(itemId);
  }

  async function buyItem(itemId: number, price: number) {
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
