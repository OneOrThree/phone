import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '../utils/api';
import { useUser } from './UserContext';

const STORAGE_KEY = 'gromo:equipment';
const EquipmentContext = createContext(null);

// 프론트 slot → 백엔드 SlotType
const TO_SERVER_SLOT = {
  hat: 'HAT',
  hair: 'HEAD',
  top: 'BODY',
  bottom: 'SHOES',
  accessory: 'ACC',
};

// 백엔드 SlotType → 프론트 slot
const FROM_SERVER_SLOT = {
  HAT: 'hat',
  HEAD: 'hair',
  BODY: 'top',
  SHOES: 'bottom',
  ACC: 'accessory',
};

export function EquipmentProvider({ children }) {
  const { userId } = useUser();
  const [equippedItem, setEquippedItem] = useState(null);
  const [equippedFurniture, setEquippedFurniture] = useState([]);
  const [equippedCostume, setEquippedCostume] = useState([]);
  const loaded = useRef(false);

  useEffect(() => {
    if (!userId) {
      // userId 없으면 로컬 데이터로 폴백
      AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw);
          setEquippedItem(saved.equippedItem ?? null);
          setEquippedFurniture(saved.equippedFurniture ?? []);
          setEquippedCostume(saved.equippedCostume ?? []);
        }
        loaded.current = true;
      });
      return;
    }

    apiFetch(`/api/equipment/${userId}`)
      .then((res) => res.json())
      .then((slots) => {
        const costumes = slots
          .filter((s) => s.item !== null)
          .map((s) => ({
            ...s.item,
            slot: FROM_SERVER_SLOT[s.slotType] ?? s.slotType.toLowerCase(),
          }));
        setEquippedCostume(costumes);
      })
      .catch(() => {
        // 서버 실패 시 로컬 폴백
        AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
          if (raw) {
            const saved = JSON.parse(raw);
            setEquippedCostume(saved.equippedCostume ?? []);
          }
        });
      })
      .finally(() => {
        loaded.current = true;
      });

    // furniture/item은 여전히 로컬에서 로드
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        const saved = JSON.parse(raw);
        setEquippedItem(saved.equippedItem ?? null);
        setEquippedFurniture(saved.equippedFurniture ?? []);
      }
    });
  }, [userId]);

  // furniture/item 로컬 저장
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

  async function toggleCostume(item) {
    const already = equippedCostume.some((c) => c.id === item.id);
    const serverSlot = TO_SERVER_SLOT[item.slot];

    if (already) {
      setEquippedCostume((prev) => prev.filter((c) => c.id !== item.id));
      if (userId && serverSlot) {
        await apiFetch(`/api/equipment/${userId}/${serverSlot}`, { method: 'DELETE' }).catch(
          () => {},
        );
      }
    } else {
      setEquippedCostume((prev) => [...prev, item]);
      if (userId && item.id) {
        await apiFetch('/api/equipment/equip', {
          method: 'POST',
          body: JSON.stringify({ userId, itemId: item.id }),
        }).catch(() => {});
      }
    }
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
