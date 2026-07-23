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
import { api } from '@/services/api';
import { useUser } from './UserContext';
import { STORAGE_KEYS } from '@/types/storage';
import type { CostumeItem, CostumeSlot, ItemType } from '@/types/api';

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

// 계정별 장비 맵. 로그아웃 시 키를 지우는 방식은 이전 계정 Provider가 마운트된 채 남아
// 지운 키에 옛 상태를 도로 써넣는 레이스가 있어(코덱스 리뷰), 지우는 대신 계정별로 분리
// 보관해 계정 간 누출을 막는다(GROMO-936). 코스튬은 서버가 원본, 가구·아이템은 로컬 전용.
type EquipmentByUser = Record<string, SavedEquipment>;

// userId(JWT sub)를 디코드하지 못한 비정상 세션의 폴백 버킷 — 정상 경로에선 쓰이지 않는다.
const FALLBACK_BUCKET = 'unknown';

// 계정 구분 없던 구 형식(SavedEquipment 단일 객체) 여부 — 구 형식은 장비 필드가 최상위에 있다.
function isLegacyShape(parsed: SavedEquipment | EquipmentByUser): parsed is SavedEquipment {
  return 'equippedItem' in parsed || 'equippedFurniture' in parsed || 'equippedCostume' in parsed;
}

// 게스트 → 소셜 전환(계정 연결) 시 게스트 UUID 버킷의 장착 상태를 새 계정으로 인계.
// 새 계정에 이미 장착 상태가 있으면 유지하고 게스트 것은 버린다. 인계를 전환 시점으로
// 한정하는 이유는 CoinContext.transferOwnedItems 주석 참고(코덱스 리뷰).
export async function transferEquipment(fromUserId: string, toUserId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.equipment);
  if (!raw) return;
  const parsed = JSON.parse(raw) as SavedEquipment | EquipmentByUser;
  if (isLegacyShape(parsed)) return; // 구 형식은 소유자 불명 — 인계하지 않는다
  const fromSaved = parsed[fromUserId];
  if (!fromSaved) return;
  delete parsed[fromUserId];
  parsed[toUserId] ??= fromSaved;
  await AsyncStorage.setItem(STORAGE_KEYS.equipment, JSON.stringify(parsed));
}

// 서버 장비 슬롯 응답
interface ServerEquipmentSlot {
  slotType: string;
  item: (ItemType & { id: string }) | null;
}

export function EquipmentProvider({ children }: { children: ReactNode }) {
  const { userId } = useUser();
  // 게스트도 UUID JWT를 받으므로 userId 버킷만으로 계정이 분리된다(CoinContext와 동일).
  const bucket = userId ?? FALLBACK_BUCKET;
  const [equippedItem, setEquippedItem] = useState<ItemType | null>(null);
  const [equippedFurniture, setEquippedFurniture] = useState<ItemType[]>([]);
  const [equippedCostume, setEquippedCostume] = useState<CostumeItem[]>([]);
  const allEquipment = useRef<EquipmentByUser>({});
  const loaded = useRef(false);

  useEffect(() => {
    // 계정별 맵 로드 — 구 형식은 첫 로드 계정 소유로 귀속
    const loadLocal = AsyncStorage.getItem(STORAGE_KEYS.equipment).then((raw) => {
      if (raw) {
        const parsed = JSON.parse(raw) as SavedEquipment | EquipmentByUser;
        allEquipment.current = isLegacyShape(parsed) ? { [bucket]: parsed } : parsed;
      }
      return allEquipment.current[bucket];
    });

    if (!userId) {
      // userId 없으면 로컬 데이터로 폴백
      loadLocal.then((saved) => {
        if (saved) {
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
        loadLocal.then((saved) => {
          setEquippedCostume(saved?.equippedCostume ?? []);
        });
      })
      .finally(() => {
        loaded.current = true;
      });

    // furniture/item은 여전히 로컬에서 로드
    loadLocal.then((saved) => {
      if (saved) {
        setEquippedItem(saved.equippedItem ?? null);
        setEquippedFurniture(saved.equippedFurniture ?? []);
      }
    });
  }, [userId, bucket]);

  // furniture/item 로컬 저장 — 자기 버킷만 갱신해 다른 계정 장비를 건드리지 않는다
  useEffect(() => {
    if (!loaded.current) return;
    allEquipment.current = {
      ...allEquipment.current,
      [bucket]: { equippedItem, equippedFurniture, equippedCostume },
    };
    AsyncStorage.setItem(STORAGE_KEYS.equipment, JSON.stringify(allEquipment.current));
  }, [bucket, equippedItem, equippedFurniture, equippedCostume]);

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
