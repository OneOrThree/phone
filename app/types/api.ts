// 백엔드 API 응답/요청 및 화면 간 전달에 쓰이는 공용 DTO 타입.
// 네비게이션 파라미터·컨텍스트로 넘어가는 형태 위주로 정의하고,
// 특정 화면 내부에서만 쓰는 응답 형태는 각 화면에서 로컬로 선언한다.
import type { CostumeSlot, Variant } from '../components/character/characterTypes';

// 장착형 아이템(가구/소품 — EquipmentContext의 equippedItem/equippedFurniture).
// 서버/로컬에서 다양한 필드가 섞여 들어오므로 index signature를 둔다.
export interface ItemType {
  id: number;
  name?: string;
  focusVariant?: Variant;
  [key: string]: unknown;
}

// 코스튬 아이템 (서버 item 필드 + 프론트 슬롯 키)
export interface CostumeItem {
  id: number;
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
  userId: number;
  nickname: string;
  role: string;
  focusTimeMinutes?: number;
  isFocusing?: boolean;
  bio?: string;
}

// 그룹 상세
export interface Group {
  groupId: number;
  name: string;
  description?: string;
  members?: GroupMember[];
}

// 사용자 프로필 (서버 /api/v1/user 응답 + 로컬 캐시 병합 결과)
export interface UserProfile {
  userId?: number | null;
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
