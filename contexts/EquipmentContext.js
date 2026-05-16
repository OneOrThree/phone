import React, { createContext, useContext, useState } from 'react';

const EquipmentContext = createContext(null);

export function EquipmentProvider({ children }) {
  const [equippedItem, setEquippedItem] = useState(null);
  const [equippedFurniture, setEquippedFurniture] = useState([]);

  function toggleFurniture(item) {
    setEquippedFurniture((prev) => {
      const alreadyEquipped = prev.some((f) => f.id === item.id);
      return alreadyEquipped ? prev.filter((f) => f.id !== item.id) : [...prev, item];
    });
  }

  return (
    <EquipmentContext.Provider value={{ equippedItem, setEquippedItem, equippedFurniture, toggleFurniture }}>
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
