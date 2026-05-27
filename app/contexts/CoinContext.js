import { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'otium:coins';
const CoinContext = createContext(null);

export function CoinProvider({ children }) {
  const [coins, setCoins] = useState(0);
  const [ownedItemIds, setOwnedItemIds] = useState([]);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        const saved = JSON.parse(raw);
        setCoins(saved.coins ?? 0);
        setOwnedItemIds(saved.ownedItemIds ?? []);
      }
      loaded.current = true;
    });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ coins, ownedItemIds }));
  }, [coins, ownedItemIds]);

  function addCoins(amount) {
    setCoins(prev => prev + amount);
  }

  function isOwned(itemId) {
    return ownedItemIds.includes(itemId);
  }

  function buyItem(itemId, price) {
    if (coins < price) return false;
    setCoins(prev => prev - price);
    setOwnedItemIds(prev => [...prev, itemId]);
    return true;
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
