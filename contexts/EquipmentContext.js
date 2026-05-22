import React, { createContext, useContext, useState } from 'react';

const EquipmentContext = createContext(null);

export function EquipmentProvider({ children }) {
  const [equippedItem, setEquippedItem] = useState(null);
  const [equippedFurniture, setEquippedFurniture] = useState([]);
  const [equippedCostume, setEquippedCostume] = useState([]);

  function toggleFurniture(item) {
    setEquippedFurniture((prev) => {
      const already = prev.some((f) => f.id === item.id);
      return already ? prev.filter((f) => f.id !== item.id) : [...prev, item];
    });
  }

  function toggleCostume(item) {
    setEquippedCostume((prev) => {
      const already = prev.some((c) => c.id === item.id);
      return already ? prev.filter((c) => c.id !== item.id) : [...prev, item];
    });
  }

  return (
    <EquipmentContext.Provider value={{
      equippedItem, setEquippedItem,
      equippedFurniture, toggleFurniture,
      equippedCostume, toggleCostume,
    }}>
      {children}
    </EquipmentContext.Provider>
  );
}

export function useEquipment() {
  const context = useContext(EquipmentContext);

  if (!context) {
    throw new Error('useEquipment must be used inside EquipmentProvider');
  }

  return context;
}
