// 서버 group 도메인 DTO 미러 (GroupController, base /api/v1).
// 명세: docs/app/group-plan.md §7. ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.
//
// 폐기된 개념(§0) — 앱은 아래 필드를 절대 쓰지 않는다:
//   · password  : 보내는 순간 그 그룹은 아무도 못 들어온다(§3-1-3)
//   · code      : 참가 코드는 3시간 만료라 초대 흐름이 죽는다 → 링크에 groupId를 담는다(§3-1-5)

export type GroupMemberRole = 'OWNER' | 'MEMBER';
// ⚠️ 서버에 상태 전이가 없어 전 그룹이 영구 WAITING이다 — UI에 노출하지 않는다(§13-5).
export type GroupStatus = 'WAITING' | 'ACTIVE' | 'ENDED';
export type MissionType = 'TIME_WINDOW' | 'DURATION';
export type MissionCategory = 'FOCUS' | 'SCREEN_TIME';
// 챌린지 상태 (Java enum GroupChallengeStatus). 앱은 목록을 그대로 그리고 상태로 거르지 않는다.
// ⚠️ 서버 enum은 ACTIVE·INACTIVE 두 값뿐이다(back GroupChallengeStatus.java, 백 계약 §1 표) —
//    그룹 자체의 GroupStatus(WAITING|ACTIVE|ENDED)와 값이 다르니 'ENDED'로 헷갈리지 않는다.
//    유니온이 어긋나 있으면 `status !== 'ENDED'` 같은 필터가 TS를 통과한 채 조용히 no-op이 된다.
export type GroupChallengeStatus = 'ACTIVE' | 'INACTIVE';

// POST /groups 요청. missionType·missionCategory는 서버 @NotNull이라 챌린지가 범위 밖이어도
// 반드시 보낸다 — 앱은 'DURATION' + 'FOCUS' 고정으로 채운다(§3-1-2).
export interface CreateGroupRequest {
  name: string; // ≤ 50자
  maxMembers: number; // 1~10
  missionType: MissionType; // 'DURATION' 고정
  missionCategory: MissionCategory; // 'FOCUS' 고정
  durationMinutes?: number; // 하루 목표 집중 시간(분)
  isPrivate: boolean; // 백엔드 P1-1(is_private) 선행 필요 — 그전엔 서버가 무시(§13-1)
  // password·description은 절대 보내지 않는다 (§3-1-2, §3-1-3)
}

// POST /groups 응답. code는 무시한다(§3-1-5).
export interface CreateGroupResponse {
  groupId: string;
  code: string;
}

// GET /groups — 내가 참여 중인 그룹 목록(그룹 1개 전제라 [0]만 쓴다).
export interface GroupSummaryResponse {
  groupId: string;
  name: string;
  code: string | null; // 무시
  currentMembers: number;
  maxMembers: number;
  role: GroupMemberRole;
  status: GroupStatus;
  isPrivate?: boolean; // 백엔드 P1-1에서 추가
}

// GET /groups/search?query — 이름 검색(공개방만 내려온다).
export interface GroupSearchResponse {
  groupId: string;
  name: string;
  currentMembers: number;
  maxMembers: number;
  status: GroupStatus;
  hasPassword: boolean; // 무시
}

// GET /groups/{id}/overview — 무권한 공개 엔드포인트(참여 여부 무관). 초대 링크 프리뷰용(§3-1-4).
export interface GroupOverviewResponse {
  id: string;
  name: string;
  description: string | null;
  missionCategory: MissionCategory | null;
  missionType: MissionType | null;
  durationMinutes: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  maxMembers: number;
  memberCount: number;
  status: GroupStatus;
  hasPassword: boolean; // 무시
  // ⚠️ 와이어 키가 두 개다 — 반드시 readIsMember()로 읽는다(GroupInviteSheet).
  //   백엔드 GroupOverviewResponse는 record가 아니라 Lombok @Getter 일반 클래스라,
  //   Jackson이 boolean 게터의 'is'를 떼고 직렬화한다 → 실제 JSON 키가 `member`로 나간다.
  //   (같은 문제를 FriendResponse·GroupSummaryResponse는 @JsonProperty로 이미 고쳐 뒀다.)
  //   백엔드가 @JsonProperty("isMember")를 붙이면 키가 `isMember`로 바뀌므로 둘 다 받는다 —
  //   앱/서버 배포 순서와 무관하게 동작해야 하기 때문.
  isMember?: boolean;
  member?: boolean;
}

// GET /groups/{id} 멤버 항목. focusTimeMinutes는 date 기준 '오늘 집중분'(null 가능 → 0분 표기).
export interface GroupDetailMemberResponse {
  userId: string;
  nickname: string;
  role: GroupMemberRole;
  focusTimeMinutes: number | null;
}

// GET /groups/{id}?date — 그룹 상세(그룹원만). code·codeExpiresAt은 읽지 않는다(§3-1-5).
export interface GroupDetailResponse {
  id: string;
  name: string;
  description: string | null;
  missionCategory: MissionCategory | null;
  missionType: MissionType | null;
  durationMinutes: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  maxMembers: number;
  status: GroupStatus;
  members: GroupDetailMemberResponse[];
  code: string | null; // 무시
  codeExpiresAt: string | null; // 무시
  noticeGrantedUserIds: string[]; // 공지 작성 권한 부여 멤버 — 방장과 합쳐 canWriteNotice 판정
  isPrivate?: boolean; // 백엔드 P1-1에서 추가
}

// GET /groups/{id}/announcements — 서버가 createdAt DESC로 정렬해 내려준다(앱 재정렬 금지).
export interface GroupAnnouncementResponse {
  id: string;
  title: string;
  content: string;
  createdAt: string; // ISO 문자열
}

// POST·PUT /groups/{id}/announcements — 공지 작성·수정 요청. title ≤ 100자, content 필수.
export interface CreateAnnouncementRequest {
  title: string;
  content: string;
}

// ── 챌린지(2차, docs/back/group-plan-2.md §1 정본) ───────────────────────────

// GET /groups/{id}/challenges 의 멤버별 진행. 두 필드 모두 null이 의미를 갖는다 —
//   progressMinutes : FOCUS는 통계가 없어도 0 · SCREEN_TIME은 통계가 없으면 null(미집계 '—' 표기)
//   achieved        : FOCUS는 progress ≥ 목표 · SCREEN_TIME은 progress ≤ 목표, progress가 null이면 null
// ⚠️ 0과 null을 뭉개면 '0분 집중'과 '스크린타임 미집계'가 같은 칸으로 보인다.
export interface ChallengeMemberProgress {
  userId: string;
  nickname: string;
  progressMinutes: number | null;
  achieved: boolean | null;
}

// GET /groups/{id}/challenges?date — 챌린지 목록(그룹원만). date는 선택.
// memberProgress는 date를 안 보냈거나 TIME_WINDOW 챌린지면 null이다(서버 미지원 — 백 명세 결정 3).
export interface GroupChallengeResponse {
  id: string;
  missionType: MissionType;
  missionCategory: MissionCategory;
  durationMinutes: number | null;
  windowStart: string | null; // 백엔드 원본 문자열
  windowEnd: string | null; // 백엔드 원본 문자열
  status: GroupChallengeStatus;
  createdAt: string; // ISO 문자열
  canParticipate: boolean;
  memberProgress: ChallengeMemberProgress[] | null;
  // ── 내기(3차, docs/back/group-bet-plan.md §2-3) ──
  // 백엔드가 병행 구현 중이라 **아직 필드 자체가 없는 서버**가 존재한다(배포 순서 무관 동작이 원칙,
  // GroupSummaryResponse.isPrivate와 같은 관행) — 그래서 optional이면서 null도 받는다.
  bet?: GroupChallengeBet | null; // 해당 date의 내기. 없으면 null
  lastSettledBet?: LastSettledBet | null; // 가장 최근 정산 내기(카드 '지난 내기' 1줄용)
}

// ── 내기(3차) — 계약 정본 docs/back/group-bet-plan.md §2 ─────────────────────
// ⚠️ 판돈은 서버 허용값 {10,30,50,100}만이고 내기는 챌린지당·날짜당 1개다(백 명세 결정 8).
// ⚠️ 내기는 FOCUS 챌린지만 가능하다(백 명세 결정 3 — 스크린타임 달성은 클라 신뢰라 돈을 걸 수 없다).

// 내기 상태. OPEN=참가 가능 · SETTLED=정산 완료 · REFUNDED=승자 0명이라 전원 환불.
export type GroupBetStatus = 'OPEN' | 'SETTLED' | 'REFUNDED';

// 내기 참가자(진행 중 내기) — 닉네임만 쓴다.
export interface GroupChallengeBetParticipant {
  userId: string;
  nickname: string;
}

// 오늘(조회 date)의 내기. myAchievedNow는 '지금 이미 목표를 달성했나' —
// 달성 확정 후의 무위험 참가를 서버가 막으므로(BET_ALREADY_ACHIEVED) 앱은 미리 버튼을 잠근다.
export interface GroupChallengeBet {
  betId: string;
  stake: number;
  pot: number; // 판돈 × 참가자 수
  status: GroupBetStatus;
  myJoined: boolean;
  myAchievedNow: boolean;
  participants: GroupChallengeBetParticipant[];
}

// 정산된 내기의 인별 결과. payout은 **받은 금액**(승자 분배금 or 환불금)이지 손익이 아니다 —
// 화면에서 ±로 보이려면 판돈을 빼야 한다(payout - stake).
export interface LastSettledBetResult {
  userId: string;
  nickname: string;
  achieved: boolean;
  payout: number;
}

// 이 챌린지의 가장 최근 정산 내기(카드 하단 '지난 내기' 1줄 + 탭 시 결과 상세).
export interface LastSettledBet {
  betDate: string; // 'YYYY-MM-DD'
  stake: number;
  pot: number;
  status: GroupBetStatus;
  results: LastSettledBetResult[];
}

// POST /groups/{groupId}/challenges/{challengeId}/bets — 내기 개설(개설자 자동 참가·판돈 즉시 차감).
export interface CreateBetRequest {
  stake: number; // 10|30|50|100 — 그 외는 서버가 BET_INVALID_STAKE
  date: string; // 'YYYY-MM-DD' (클라 로컬 날짜)
}

export interface CreateBetResponse {
  betId: string;
}

// POST /groups/{id}/challenges — 챌린지 생성(방장만). 앱은 DURATION만 만든다(§3-2) —
// TIME_WINDOW는 진행률이 서버 미지원이라 생성 경로 자체를 열지 않는다.
export interface CreateChallengeRequest {
  missionCategory: MissionCategory;
  missionType: MissionType; // 'DURATION' 고정
  durationMinutes: number; // 하루 목표(분)
}

// POST 응답의 미참여자 — SCREEN_TIME 챌린지에서 스크린타임 권한을 허용하지 않은 멤버.
export interface CreateChallengeNonParticipant {
  userId: string;
  nickname: string;
}

// POST /groups/{id}/challenges 응답. nonParticipants가 비어 있지 않으면 앱이 안내 Alert를 띄운다.
export interface CreateChallengeResponse {
  id: string;
  nonParticipants: CreateChallengeNonParticipant[];
}
