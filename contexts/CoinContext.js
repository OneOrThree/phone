import { createContext, useContext, useState } from 'react';

const CoinContext = createContext(null);

export function CoinProvider({ children }) {
  const [coins, setCoins] = useState(0);
  const [ownedItemIds, setOwnedItemIds] = useState([]);

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
