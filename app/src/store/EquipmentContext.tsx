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
// 구 키(equipment)와 형식이 달라 새 키(:v2)를 쓴다 — OTA 롤백 호환(storageMigration v3 참고).
type EquipmentByUser = Record<string, SavedEquipment>;

// userId(JWT sub)를 디코드하지 못한 비정상 세션의 폴백 버킷 — 정상 경로에선 쓰이지 않는다.
const FALLBACK_BUCKET = 'unknown';

// 장비 키에 닿는 모든 쓰기를 직렬화하는 큐 — Provider 저장과 전환 인계가 서로의 쓰기를
// 낡은 스냅샷으로 덮어쓰지 않게, 읽기-수정-쓰기를 한 단위로 순차 실행한다(코덱스 리뷰).
let equipmentWrites: Promise<void> = Promise.resolve();
function updateEquipmentStore(update: (map: EquipmentByUser) => EquipmentByUser): Promise<void> {
  const run = equipmentWrites.then(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.equipmentV2);
    const map = raw ? (JSON.parse(raw) as EquipmentByUser) : {};
    await AsyncStorage.setItem(STORAGE_KEYS.equipmentV2, JSON.stringify(update(map)));
  });
  // 큐는 실패해도 이어지도록 내부에서만 삼키고, 호출자에겐 실패를 그대로 전파한다(코덱스 리뷰).
  equipmentWrites = run.catch(() => {});
  return run;
}

// 게스트 → 소셜 전환(계정 연결) 시 게스트 UUID 버킷의 장착 상태를 새 계정으로 인계.
// 새 계정에 이미 장착 상태가 있으면 유지하고 게스트 것은 버린다. 인계를 전환 시점으로
// 한정하는 이유는 CoinContext.transferOwnedItems 주석 참고(코덱스 리뷰).
export function transferEquipment(fromUserId: string, toUserId: string): Promise<void> {
  return updateEquipmentStore((map) => {
    const fromSaved = map[fromUserId];
    if (!fromSaved) return map;
    delete map[fromUserId];
    map[toUserId] ??= fromSaved;
    return map;
  });
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
  const loaded = useRef(false);

  useEffect(() => {
    // 계정별 맵에서 자기 버킷 로드(형식 변환은 storageMigration v3가 마운트 전에 보장)
    const loadLocal = AsyncStorage.getItem(STORAGE_KEYS.equipmentV2).then((raw) => {
      const map = raw ? (JSON.parse(raw) as EquipmentByUser) : {};
      return map[bucket];
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
      .get<ServerEquipmentSlot[]>(`/api/v1/equipment/${userId}`)
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
    // 저장 실패는 무시 — 다음 상태 변경 때 자연 재시도된다
    updateEquipmentStore((map) => ({
      ...map,
      [bucket]: { equippedItem, equippedFurniture, equippedCostume },
    })).catch(() => {});
    // 구 키에도 현재 계정 장착 상태를 같이 써(듀얼라이트) OTA 롤백된 구 번들에서 장비가
    // 유지되게 한다. 장착 '선택'은 그때그때의 상태라, 롤백 중의 변경을 복귀 후 병합하는
    // 것은 하지 않는다(보유 아이템과 달리 유실이 아니라 되돌림 — 코덱스 리뷰에 사유 명시).
    AsyncStorage.setItem(
      STORAGE_KEYS.equipment,
      JSON.stringify({ equippedItem, equippedFurniture, equippedCostume }),
    ).catch(() => {});
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
        await api.delete(`/api/v1/equipment/${userId}/${serverSlot}`).catch(() => {});
      }
    } else {
      setEquippedCostume((prev) => [...prev, item]);
      if (userId && item.id) {
        await api.post('/api/v1/equipment/equip', { userId, itemId: item.id }).catch(() => {});
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
