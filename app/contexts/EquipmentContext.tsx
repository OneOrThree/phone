import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../utils/api';
import { useUser } from './UserContext';
import { STORAGE_KEYS } from '../types/storage';
import type { CostumeItem, ItemType } from '../types/api';
import type { CostumeSlot } from '../components/character/characterTypes';

interface EquipmentContextValue {
  equippedItem: ItemType | null;
  setEquippedItem: Dispatch<SetStateAction<ItemType | null>>;
  equippedFurniture: ItemType[];
  toggleFurniture: (item: ItemType) => void;
  equippedCostume: CostumeItem[];
  toggleCostume: (item: CostumeItem) => Promise<void>;
}

const EquipmentContext = createContext<EquipmentContextValue | null>(null);

// 프론트 slot → 백엔드 SlotType
const TO_SERVER_SLOT: Record<CostumeSlot, string> = {
  hat: 'HAT',
  hair: 'HEAD',
  top: 'BODY',
  bottom: 'SHOES',
  accessory: 'ACC',
};

// 백엔드 SlotType → 프론트 slot
const FROM_SERVER_SLOT: Record<string, CostumeSlot> = {
  HAT: 'hat',
  HEAD: 'hair',
  BODY: 'top',
  SHOES: 'bottom',
  ACC: 'accessory',
};

// 로컬에 저장되는 장비 상태
interface SavedEquipment {
  equippedItem?: ItemType | null;
  equippedFurniture?: ItemType[];
  equippedCostume?: CostumeItem[];
}

// 서버 장비 슬롯 응답
interface ServerEquipmentSlot {
  slotType: string;
  item: (ItemType & { id: number }) | null;
}

export function EquipmentProvider({ children }: { children: ReactNode }) {
  const { userId } = useUser();
  const [equippedItem, setEquippedItem] = useState<ItemType | null>(null);
  const [equippedFurniture, setEquippedFurniture] = useState<ItemType[]>([]);
  const [equippedCostume, setEquippedCostume] = useState<CostumeItem[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    if (!userId) {
      // userId 없으면 로컬 데이터로 폴백
      AsyncStorage.getItem(STORAGE_KEYS.equipment).then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw) as SavedEquipment;
          setEquippedItem(saved.equippedItem ?? null);
          setEquippedFurniture(saved.equippedFurniture ?? []);
          setEquippedCostume(saved.equippedCostume ?? []);
        }
        loaded.current = true;
      });
      return;
    }

    api
      .get<ServerEquipmentSlot[]>(`/api/equipment/${userId}`)
      .then((res) => {
        const costumes: CostumeItem[] = res.data
          .filter((s) => s.item !== null)
          .map((s) => ({
            ...s.item!,
            slot: FROM_SERVER_SLOT[s.slotType] ?? (s.slotType.toLowerCase() as CostumeSlot),
          }));
        setEquippedCostume(costumes);
      })
      .catch(() => {
        // 서버 실패 시 로컬 폴백
        AsyncStorage.getItem(STORAGE_KEYS.equipment).then((raw) => {
          if (raw) {
            const saved = JSON.parse(raw) as SavedEquipment;
            setEquippedCostume(saved.equippedCostume ?? []);
          }
        });
      })
      .finally(() => {
        loaded.current = true;
      });

    // furniture/item은 여전히 로컬에서 로드
    AsyncStorage.getItem(STORAGE_KEYS.equipment).then((raw) => {
      if (raw) {
        const saved = JSON.parse(raw) as SavedEquipment;
        setEquippedItem(saved.equippedItem ?? null);
        setEquippedFurniture(saved.equippedFurniture ?? []);
      }
    });
  }, [userId]);

  // furniture/item 로컬 저장
  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(
      STORAGE_KEYS.equipment,
      JSON.stringify({ equippedItem, equippedFurniture, equippedCostume }),
    );
  }, [equippedItem, equippedFurniture, equippedCostume]);

  function toggleFurniture(item: ItemType) {
    setEquippedFurniture((prev) => {
      const already = prev.some((f) => f.id === item.id);
      return already ? prev.filter((f) => f.id !== item.id) : [...prev, item];
    });
  }

  async function toggleCostume(item: CostumeItem) {
    const already = equippedCostume.some((c) => c.id === item.id);
    const serverSlot = TO_SERVER_SLOT[item.slot];

    if (already) {
      setEquippedCostume((prev) => prev.filter((c) => c.id !== item.id));
      if (userId && serverSlot) {
        await api.delete(`/api/equipment/${userId}/${serverSlot}`).catch(() => {});
      }
    } else {
      setEquippedCostume((prev) => [...prev, item]);
      if (userId && item.id) {
        await api.post('/api/equipment/equip', { userId, itemId: item.id }).catch(() => {});
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

export function useEquipment(): EquipmentContextValue {
  const context = useContext(EquipmentContext);
  if (!context) throw new Error('useEquipment must be used inside EquipmentProvider');
  return context;
}
