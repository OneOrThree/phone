import { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '../utils/api';

const OWNED_ITEMS_KEY = 'gromo:ownedItems';
const CoinContext = createContext(null);

export function CoinProvider({ children }) {
  const [coins, setCoins] = useState(0);
  const [ownedItemIds, setOwnedItemIds] = useState([]);
  const loaded = useRef(false);

  // 서버에서 잔액 로드
  useEffect(() => {
    apiFetch('/api/v1/currency')
      .then((res) => res.json())
      .then((balance) => setCoins(balance))
      .catch(() => {});
  }, []);

  // 보유 아이템은 AsyncStorage 유지 (아이템 API 미구현)
  useEffect(() => {
    AsyncStorage.getItem(OWNED_ITEMS_KEY).then((raw) => {
      if (raw) setOwnedItemIds(JSON.parse(raw));
      loaded.current = true;
    });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(OWNED_ITEMS_KEY, JSON.stringify(ownedItemIds));
  }, [ownedItemIds]);

  async function addCoins(amount) {
    setCoins((prev) => prev + amount);
    apiFetch('/api/v1/currency/earn', {
      method: 'POST',
      body: JSON.stringify({ amount, reason: 'SESSION_COMPLETE' }),
    }).catch(() => {});
  }

  function isOwned(itemId) {
    return ownedItemIds.includes(itemId);
  }

  async function buyItem(itemId, price) {
    if (coins < price) return false;
    try {
      const res = await apiFetch('/api/v1/currency/spend', {
        method: 'POST',
        body: JSON.stringify({ amount: price, reason: 'PURCHASE' }),
      });
      if (!res.ok) return false;
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

export function useCoins() {
  const context = useContext(CoinContext);
  if (!context) throw new Error('useCoins must be used inside CoinProvider');
  return context;
}
