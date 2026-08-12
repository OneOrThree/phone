// item 도메인 API 래퍼 (EquipmentController + InventoryController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import { api } from '@/services/api';
import type {
  CharacterEquipmentResponse,
  UserItemResponse,
  EquipRequest,
  SlotType,
} from '@/types/dto/item';

// GET /api/v1/equipment/{userId} — 유저의 슬롯별 장비 착용 상태 조회.
export async function getEquipment(userId: string): Promise<CharacterEquipmentResponse[]> {
  const { data } = await api.get<CharacterEquipmentResponse[]>(`/api/v1/equipment/${userId}`);
  return data;
}

// POST /api/v1/equipment/equip — 아이템 장착(변경된 슬롯 상태 반환).
export async function equipItem(request: EquipRequest): Promise<CharacterEquipmentResponse> {
  const { data } = await api.post<CharacterEquipmentResponse>('/api/v1/equipment/equip', request);
  return data;
}

// DELETE /api/v1/equipment/{userId}/{slotType} — 해당 슬롯 장비 해제.
export async function unequipItem(userId: string, slotType: SlotType): Promise<void> {
  await api.delete(`/api/v1/equipment/${userId}/${slotType}`);
}

// GET /api/v1/inventory/{userId} — 유저의 보유 아이템 목록 조회.
export async function getInventory(userId: string): Promise<UserItemResponse[]> {
  const { data } = await api.get<UserItemResponse[]>(`/api/v1/inventory/${userId}`);
  return data;
}
