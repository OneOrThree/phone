// 백엔드 API 응답/요청 및 화면 간 전달에 쓰이는 공용 DTO 타입.
// 네비게이션 파라미터·컨텍스트로 넘어가는 형태 위주로 정의하고,
// 특정 화면 내부에서만 쓰는 응답 형태는 각 화면에서 로컬로 선언한다.
import type { CostumeSlot, Variant } from '@/components/character/characterTypes';

// 장착형 아이템(가구/소품 — EquipmentContext의 equippedItem/equippedFurniture).
// 서버/로컬에서 다양한 필드가 섞여 들어오므로 index signature를 둔다.
export interface ItemType {
  id: string;
  name?: string;
  focusVariant?: Variant;
  [key: string]: unknown;
}

// 코스튬 아이템 (서버 item 필드 + 프론트 슬롯 키)
export interface CostumeItem {
  id: string;
  slot: CostumeSlot;
  name?: string;
  [key: string]: unknown;
}

// 집중 세션 종료 결과 (FocusMode → 홈 화면으로 전달)
export interface FocusResult {
  sessionSeconds: number;
  totalSeconds: number;
  coinsEarned: number;
  tagName: string | null;
  subject: string | null;
}

// 그룹 멤버 (서버 역할 문자열은 'OWNER' 등 — 값이 늘 수 있어 string 유지)
export interface GroupMember {
  userId: string;
  nickname: string;
  role: string;
  focusTimeMinutes?: number;
  isFocusing?: boolean;
  bio?: string;
}

// 그룹 상세
export interface Group {
  groupId: string;
  name: string;
  description?: string;
  members?: GroupMember[];
}

// 사용자 프로필 (서버 /api/v1/user 응답 + 로컬 캐시 병합 결과)
export interface UserProfile {
  userId?: string | null;
  nickname?: string;
  accessToken?: string;
  refreshToken?: string;
  isNewUser?: boolean;
  dailyScreenTimeGoalMinutes?: number;
  // 서버 응답에 추가 필드가 섞여 들어올 수 있음
  [key: string]: unknown;
}

// 소셜 로그인(kakao/apple) 결과 — LoginScreen.onLogin 으로 전달
export interface LoginResult {
  accessToken: string;
  refreshToken?: string;
  isNewUser?: boolean;
  nickname?: string;
  [key: string]: unknown;
}

// 온보딩 완료 데이터 — OnboardingScreen.onComplete 으로 전달
export interface OnboardingData {
  nickname: string;
  gender: string; // 'male' | 'female' | 'other'
  birthday: string;
  goalSeconds: number;
  dayStartTime: string;
  dayEndTime: string;
  reportTime: string;
}

// ─────────────────────────────────────────────────────────────
// 리그 (백엔드 league/dto record 대응 — GET /api/v1/league/*)
// v2 리그 화면은 우선 mock을 이 타입으로 채우고, API 연동 시 스왑만 한다.
// ─────────────────────────────────────────────────────────────

// GET /league/me/tier — 내 티어/아레나 배정 상태
export interface LeagueTierResponse {
  assigned: boolean;
  tierLevel: number | null;
  arenaId: string | null;
  weekStartAt: string | null; // Instant ISO 문자열
  status: string | null;
  badgeId: string | null;
}

// GET /league/me/ranking — 아레나 랭킹 한 행
export interface LeagueMemberResponse {
  rank: number;
  userId: string;
  nickname: string;
  totalFocusMinutes: number;
  // 주간 정산 결과 ('PROMOTED'/'DEMOTED' 등) — 정산 전엔 null. 서버 enum 확장 대비 string 유지
  result: string | null;
}

// GET /league/me/rank — 내 순위 요약
export interface LeagueRankResponse {
  assigned: boolean;
  myRank: number | null;
  totalFocusMinutes: number | null;
  result: string | null;
}

// ─────────────────────────────────────────────────────────────
// 친구 (백엔드 friend/dto 대응 — /api/v1/friends*)
// ─────────────────────────────────────────────────────────────

// 검색 결과에서 나와 해당 유저의 기존 관계 (friend/dto/FriendRelation)
export type FriendRelation = 'NONE' | 'PENDING' | 'FRIEND';

// GET /friends — 친구 한 명
export interface FriendResponse {
  userId: string;
  nickname: string;
  tierLevel: number | null;
  isPinned: boolean;
}

// GET /friends/requests — 받은/보낸 요청
export interface FriendRequestResponse {
  requestId: string;
  userId: string;
  nickname: string;
  tierLevel: number | null;
  createdAt: string; // Instant ISO 문자열
}

// GET /friends/search — 검색 결과 한 행
export interface FriendSearchResultResponse {
  userId: string;
  nickname: string;
  tierLevel: number | null;
  relation: FriendRelation;
}

// GET /friends/pinned — 나만의 랭킹(핀 친구) 한 명
export interface PinnedFriendResponse {
  userId: string;
  nickname: string;
  // 장착 슬롯/아이템 표시정보 (item/dto/CharacterEquipmentResponse) — 캐릭터 렌더 연동 전이라 형태만
  character: { id: string; slotType: string; item: unknown | null }[];
  focusTimeMinutes: number; // 오늘 누적 집중 분
  isFocusing: boolean; // 현재 집중 세션 진행 중 여부
}
