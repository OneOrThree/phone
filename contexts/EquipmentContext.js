import React, { createContext, useContext, useState } from 'react';

const EquipmentContext = createContext(null);

export function EquipmentProvider({ children }) {
  const [equippedItem, setEquippedItem] = useState(null);

  return (
    <EquipmentContext.Provider value={{ equippedItem, setEquippedItem }}>
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