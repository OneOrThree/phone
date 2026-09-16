// 서버 item 도메인 DTO 미러 (com.oneorthree.phone.item.dto).
// enum 값·의미는 백엔드 기준. 시각(Instant)은 ISO 문자열.
// ⚠️ CharacterEquipmentResponse는 friend 도메인에서 import하므로 반드시 이 파일에 유지한다.
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.

// Java enum ItemType — 아이템 종류.
export type ItemType = 'EQUIPPABLE' | 'DECORATIVE';

// Java enum SlotType — 장비 슬롯.
export type SlotType = 'HAIR' | 'TOP' | 'BOTTOM' | 'SHOES';

// Java enum Rarity — 아이템 희귀도.
export type Rarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'LEGENDARY';

// Java enum PriceType — 가격 유형(재화/프리미엄/둘 다).
export type PriceType = 'CURRENCY' | 'PREMIUM' | 'BOTH';

// 아이템 정보(상점/인벤토리/장비 공용).
export interface ItemResponse {
  id: string; // UUID
  name: string;
  itemType: ItemType;
  slotType: SlotType | null; // 장착 불가(DECORATIVE 등) 아이템은 null
  rarity: Rarity;
  assetAddress: string;
  priceType: PriceType;
  currencyPrice: number | null; // Integer, 해당 가격 유형 아니면 null
  premiumPrice: number | null; // Integer, 해당 가격 유형 아니면 null
}

// GET /equipment/{userId} · POST /equipment/equip — 캐릭터 슬롯별 장비 착용 상태.
export interface CharacterEquipmentResponse {
  id: string; // UUID
  slotType: SlotType;
  item: ItemResponse | null; // null이면 미착용
}

// GET /inventory/{userId} — 유저 보유 아이템 1건.
export interface UserItemResponse {
  id: string; // UUID
  item: ItemResponse;
  acquiredAt: string; // Instant, 획득 시각
}

// POST /equipment/equip 요청 바디.
export interface EquipRequest {
  userId: string; // UUID
  itemId: string; // UUID
}

// POST /inventory/grant 요청 바디.
export interface GrantItemRequest {
  userId: string; // UUID
  itemId: string; // UUID
}
