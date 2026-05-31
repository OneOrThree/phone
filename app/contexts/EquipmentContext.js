import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'gromo:equipment';
const EquipmentContext = createContext(null);

export function EquipmentProvider({ children }) {
  const [equippedItem, setEquippedItem] = useState(null);
  const [equippedFurniture, setEquippedFurniture] = useState([]);
  const [equippedCostume, setEquippedCostume] = useState([]);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        const saved = JSON.parse(raw);
        setEquippedItem(saved.equippedItem ?? null);
        setEquippedFurniture(saved.equippedFurniture ?? []);
        setEquippedCostume(saved.equippedCostume ?? []);
      }
      loaded.current = true;
    });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ equippedItem, equippedFurniture, equippedCostume }),
    );
  }, [equippedItem, equippedFurniture, equippedCostume]);

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
    <EquipmentContext.Provider
      value={{
        equippedItem,
        setEquippedItem,
        equippedFurniture,
        toggleFurniture,
        equippedCostume,
        toggleCostume,
      }}
    >
      {children}
    </EquipmentContext.Provider>
  );
}

export function useEquipment() {
  const context = useContext(EquipmentContext);
  if (!context) throw new Error('useEquipment must be used inside EquipmentProvider');
  return context;
}
