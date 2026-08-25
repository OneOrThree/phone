// 백엔드 API 응답/요청 및 화면 간 전달에 쓰이는 공용 DTO 타입.
// 네비게이션 파라미터·컨텍스트로 넘어가는 형태 위주로 정의하고,
// 특정 화면 내부에서만 쓰는 응답 형태는 각 화면에서 로컬로 선언한다.
import type { UserProfileResponse } from '@/types/dto/user';
// 캐릭터 상태/코스튬 슬롯 — 상점·장비 도메인 값.
// (구 components/character/characterTypes.ts에서 이전 — 파츠 캐릭터 폐기 후 타입만 유지)
export type Variant = 'default' | 'focus' | 'reading' | 'yoga' | 'exercise' | 'study';
export type CostumeSlot = 'hat' | 'hair' | 'top' | 'bottom' | 'accessory';

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

// 사용자 세션 (로컬 저장 토큰·플래그 + GET /users/me 응답 병합 캐시 — App.tsx 게이트 전용).
// 서버 프로필과 겹치는 필드는 UserProfileResponse에서 파생해 이중 정의를 피한다(GROMO-921).
export interface UserProfile extends Partial<
  Pick<UserProfileResponse, 'nickname' | 'dailyScreenTimeGoalMinutes' | 'dailyFocusTimeGoalMinutes'>
> {
  userId?: string | null;
  accessToken?: string;
  refreshToken?: string;
  isNewUser?: boolean;
  isGuest?: boolean; // 게스트 세션 여부 — 로그인 시점 태깅(서버 isGuest 응답 시 그 값 우선)
  // 준비 시험 코드(enum name), 백필용(GROMO-758) — LoginResult 병합 경로도 있어 string 유지(Occupation 아님)
  occupation?: string | null;
  // 서버 응답에 추가 필드가 섞여 들어올 수 있음
  [key: string]: unknown;
}

// 소셜 로그인(kakao/apple) 결과 — LoginScreen.onLogin 으로 전달
export interface LoginResult {
  accessToken: string;
  refreshToken?: string;
  isNewUser?: boolean;
  isGuest?: boolean; // 게스트 세션 여부 (게스트=true / 소셜=false)
  nickname?: string;
  occupation?: string | null; // 준비 시험 코드 — 기존 계정 로그인 시 /users/me 병합으로 유입(757), 백필용(GROMO-758)
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
  tierLevel: number; // 멤버별 실제 티어(league_arena_users.tier_level) — GROMO-748
  totalFocusSeconds: number; // 이번 주 누적 집중 초 (GROMO-665: 분→초 정밀도 전환)
  // ※ 항상 null이던 result는 서버에서 제거됨(GROMO-824가 818 위임분 흡수) — 854에서 미러도 제거
  // ※ 서버 응답의 isPinned는 미러 생략 — 핀 상태는 GET /pins(usePinned)로 별도 관리
  // ※ isFriend는 isPinned와 달리 미러한다 — 친구 여부의 정본은 이 응답(GROMO-1630)
  isFriend?: boolean; // 나와 친구인지(내 행은 false) — 서버 미배포 호환 optional, 소비처는 ?? false 폴백
  // GROMO-824 라이브 필드 — 서버는 항상 내려주지만 목데이터·시안 placeholder 호환을 위해 optional 유지
  isFocusing?: boolean; // 현재 집중 세션 진행 중 여부
  focusTimeMinutes?: number; // 당일 누적 집중 분
  focusStartedAt?: string | null; // 진행 중 세션 시작 시각(ISO) — 초 단위 경과 렌더링 기준
  focusTagName?: string | null; // 진행 중 세션 태그명(집중 과목)
}

// GET /league/me/rank — 내 순위 요약
// ※ 주간 정산 결과(result)는 서버가 /league/me/last-result로 분리하며 이 응답에서 제거(티켓 567) —
//   죽은 미러 필드도 함께 제거. 결과 조회·ack 배선은 티켓 831(PR 283)이 담당.
export interface LeagueRankResponse {
  assigned: boolean;
  myRank: number | null;
  totalFocusSeconds: number | null; // GROMO-665: 분→초 정밀도 전환
}

// GET /league/me/schedule — 다음 리그 마감(다음 월요일 00:00 KST) 스케줄
export interface LeagueScheduleResponse {
  nextResetAt: string; // Instant ISO 문자열
  remainingSeconds: number; // 지금부터 nextResetAt까지 남은 초(항상 ≥ 0)
}

// GET /league/me/last-result — 주간 마감 결과 (GROMO-567).
// 결과 행이 없으면(미배정/신규 유저) hasResult=false 이고 나머지는 null/false.
export interface LeagueLastResultResponse {
  hasResult: boolean;
  weekStartAt: string | null; // 정산 대상 주차 시작 시각(ISO) — ack 요청에 그대로 되돌려 보낸다
  result: string | null; // 'PROMOTED' | 'STAY' | 'RELEGATED' — 서버 enum 확장 대비 string 유지
  previousTierLevel: number | null; // 정산 전 티어
  newTierLevel: number | null; // 정산 후 티어
  focusSeconds: number | null; // 해당 주차 집중 시간(초)
  acknowledged: boolean; // 확인 처리 여부 — true면 결과 화면 재노출 안 함
  // ⚠️ additive — 현재 백엔드 응답엔 없다(undefined로 도착). 서버가 승급 보상을 붙이면 이름 그대로 소비한다.
  promotionBonusCoins?: number | null; // 승급 보상 시간조각(승급 아닐 땐 0/null)
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
  occupation: string | null; // 준비 시험 코드(Occupation enum name) — 미설정 null (GROMO-747)
  // GROMO-658 라이브 필드(822 스펙) — 서버 배포 전이라 optional. date 쿼리 미전달 시 focusTimeMinutes 는 null.
  focusTimeMinutes?: number | null; // 오늘 누적 집중 분 (완료 세션 집계)
  isFocusing?: boolean; // 현재 집중 세션 진행 중 여부
  focusStartedAt?: string | null; // 진행 중 세션 시작 시각(ISO) — 초 단위 경과 렌더링 기준. 미집중이면 null
  focusTagName?: string | null; // 진행 중 세션 태그명. 미집중·무태그면 null
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
  occupation: string | null; // 준비 시험 코드(Occupation enum name) — 미설정 null (GROMO-747)
}

// GET /pins — 나만의 랭킹(핀한 유저, 친구 아님 포함) 한 명
export interface PinnedFriendResponse {
  userId: string;
  nickname: string;
  // 장착 슬롯/아이템 표시정보 (item/dto/CharacterEquipmentResponse) — 캐릭터 렌더 연동 전이라 형태만
  character: { id: string; slotType: string; item: unknown | null }[];
  focusTimeMinutes: number; // 오늘 누적 집중 분
  isFocusing: boolean; // 현재 집중 세션 진행 중 여부
  // GROMO-658 라이브 필드(822 스펙) — 서버 배포 전이라 optional
  focusStartedAt?: string | null; // 진행 중 세션 시작 시각(ISO) — 초 단위 경과 렌더링 기준. 미집중이면 null
  focusTagName?: string | null; // 진행 중 세션 태그명. 미집중·무태그면 null
}
