// 서버 friend 도메인 DTO 미러 (com.oneorthree.phone.friend.dto).
// 값 단위·의미는 백엔드 기준. 시각(Instant)은 ISO 문자열.
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.
import type { CharacterEquipmentResponse } from '@/types/dto/item';

// 검색 결과에서 나와 해당 유저의 기존 관계 (Java enum FriendRelation).
export type FriendRelation = 'NONE' | 'PENDING' | 'FRIEND';

// GET /friends/search 의 type 파라미터 (Java enum SearchType).
export type SearchType = 'NICKNAME' | 'CODE';

// GET /friends/requests 의 type 파라미터 (String, received=받은 | sent=보낸).
export type FriendRequestType = 'received' | 'sent';

// GET /friends — ACCEPTED·미삭제 친구 1명.
export interface FriendResponse {
  userId: string;
  nickname: string;
  tierLevel: number;
  isPinned: boolean; // @JsonProperty("isPinned")
}

// GET /friends/requests — 받은/보낸 PENDING 요청 1건.
export interface FriendRequestResponse {
  requestId: string;
  userId: string;
  nickname: string;
  tierLevel: number;
  createdAt: string; // Instant
}

// GET /friends/search — 검색 결과 1명 (기존 관계 포함).
export interface FriendSearchResultResponse {
  userId: string;
  nickname: string;
  tierLevel: number;
  relation: FriendRelation;
}

// GET /friends/pinned — 핀한 친구 1명 (캐릭터 표시정보 + 오늘 집중분 + 현재 집중 여부).
export interface PinnedFriendResponse {
  userId: string;
  nickname: string;
  character: CharacterEquipmentResponse[]; // 장착 슬롯/아이템 표시정보
  focusTimeMinutes: number; // 오늘 누적 집중 분
  isFocusing: boolean; // @JsonProperty("isFocusing"), 현재 진행 중 FocusSession 여부
}

// POST /friends/requests — 친구 요청 생성 바디.
export interface FriendRequestCreateRequest {
  targetUserId: string;
}
