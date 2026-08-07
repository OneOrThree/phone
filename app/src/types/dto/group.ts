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

// POST /groups 요청. 3차 §D18에서 챌린지를 그룹 생성과 분리했다 — createGroup은 더 이상
// 대표 챌린지를 만들지 않으므로 missionType·missionCategory·durationMinutes를 보내지 않는다.
// 챌린지는 그룹방에서 CreateChallengeRequest로 따로 만든다.
export interface CreateGroupRequest {
  name: string; // ≤ 50자
  description?: string; // 소개(선택) — 서버 ≤ 200자. 빈 값이면 앱이 키를 생략한다
  maxMembers: number; // 1~10
  isPrivate: boolean; // 백엔드 P1-1(is_private) 선행 필요 — 그전엔 서버가 무시(§13-1)
  // password·code는 절대 보내지 않는다 (§3-1)
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
  // 소개(F6) — 목록 카드에 1~2줄 노출. 미입력 그룹은 서버가 null을 내려주고, 필드 자체가
  // 없는 구서버(배포 순서 무관 동작 관행 — isPrivate과 같은 기준)도 있어 optional·null 둘 다 받는다.
  description?: string | null;
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
  // 소개(F6) — 찾기 결과 카드에 1~2줄 노출. 미입력이면 null, 구서버는 미포함이라 optional·null 둘 다 받는다.
  description?: string | null;
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

// GET /groups/{id} 멤버 항목.
//   focusTimeMinutes : date 기준 '오늘 집중분'(null 가능 → 0분 표기)
//   totalFocusMinutes: 전체 누적 집중 시간(분) — 그룹방 멤버 리더보드 지표. 서버가 이 값
//                      내림차순(동점 시 닉네임 오름차순)으로 정렬해 members를 내려준다 → 앱 재정렬 금지.
export interface GroupDetailMemberResponse {
  userId: string;
  nickname: string;
  role: GroupMemberRole;
  focusTimeMinutes: number | null;
  totalFocusMinutes: number;
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

// PATCH /groups/{id} — 그룹 설정 수정(방장만). 모든 필드 선택 — 보낸 필드만 부분 반영한다.
// 3차 A-1: 앱은 이름·소개·정원·공개설정만 다룬다. password는 폐기 개념(§3-1)이라 보내지 않는다.
export interface UpdateGroupRequest {
  name?: string; // ≤ 50자
  description?: string; // ≤ 200자
  maxMembers?: number; // 1~10 · 현재 인원 미만이면 서버가 MAX_MEMBERS_TOO_SMALL(400)
  isPrivate?: boolean; // 공개/비공개 전환
}

// GET /groups/{id}/settings 항목 — 전 멤버(방장 포함)의 공지 작성 권한 뷰(A-4).
// 방장은 항상 granted=true(토글 불가). 채팅 필드는 3차에서 계약에서 제거됐다.
export interface GroupAnnouncementGrantView {
  userId: string;
  nickname: string;
  granted: boolean;
}

// GET /groups/{id}/settings — 방장 전용. 공지 권한 관리가 전부라 announcementGrants만 내려온다.
export interface GroupSettingsResponse {
  announcementGrants: GroupAnnouncementGrantView[];
}

// PATCH /groups/{id}/settings — 항목별 granted upsert(204). 목록에 없는 멤버는 미변경,
// 방장·비멤버 항목은 서버가 무시한다. 낙관적 토글 후 부분 실패 시 앱이 롤백한다.
export interface UpdateGroupSettingsRequest {
  announcementGrants: { userId: string; granted: boolean }[];
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
// memberProgress는 date를 안 보내면 null이다. TIME_WINDOW도 신서버(V20+)는 창 클리핑 진행률을
// 채워 주지만, 구서버·창 목표분 없는 기존 창 챌린지는 여전히 null일 수 있다 — null 캡션 유지.
export interface GroupChallengeResponse {
  id: string;
  missionType: MissionType;
  missionCategory: MissionCategory;
  // DURATION은 하루 목표(분). TIME_WINDOW도 신서버는 창 목표분을 채워 준다(additive) —
  // null인 창 챌린지는 목표가 없어 판정 불가·내기 불가다(카드 betSupported 판정에 쓴다).
  durationMinutes: number | null;
  windowStart: string | null; // 백엔드 원본 문자열
  windowEnd: string | null; // 백엔드 원본 문자열
  status: GroupChallengeStatus;
  createdAt: string; // ISO 문자열
  canParticipate: boolean;
  memberProgress: ChallengeMemberProgress[] | null;
  // 휴면 여부(GROMO-1201) — 지금 OPEN 내기가 없고 과거 내기 이력은 있는 챌린지(서버 조회 시점
  // 파생, CANCELED 이력 포함). 마지막 참가자가 철회해도 서버는 챌린지를 지우지 않는다 —
  // 목록에 남되 이 플래그로 카드 표시(휴면 칩·캡션)만 가른다.
  // ⚠️ optional인 이유: 이 필드를 모르는 구서버가 존재한다(아래 bet과 같은 관행) — undefined는
  //    '휴면 아님'이 아니라 '휴면을 모르는 서버'다. 앱은 === true일 때만 배지를 그린다.
  dormant?: boolean;
  // ── 내기(3차, docs/back/group-bet-plan.md §2-3) ──
  // 백엔드가 병행 구현 중이라 **아직 필드 자체가 없는 서버**가 존재한다(배포 순서 무관 동작이 원칙,
  // GroupSummaryResponse.isPrivate와 같은 관행) — 그래서 optional이면서 null도 받는다.
  bet?: GroupChallengeBet | null; // 해당 date의 내기. 없으면 null
  lastSettledBet?: LastSettledBet | null; // 가장 최근 정산 내기(카드 '지난 내기' 1줄용)
}

// ── 내기(3차·확장) — 계약 정본 docs/app/challenge-impl-2026-08/contract.md §2 ──
// ⚠️ 참가비는 1~1000 자유 입력이고(GROMO-1097 — 구 {10,30,50,100} 고정에서 확대) 내기는
//    챌린지당·날짜당 1개다.
// 내기 대상은 전 조합이다 — FOCUS·SCREEN_TIME × DURATION·TIME_WINDOW(창은 목표분 있는 것만).
// SCREEN_TIME 달성은 클라 신뢰 데이터지만 리스크 수용으로 확대됐다(계약 확정 정책).

// 내기 상태. OPEN=참가 가능 · SETTLED=정산 완료 · REFUNDED=구 룰의 전원 환불(V19 이전 이력)
// · FORFEITED=승자 0명 전액 몰수·소멸 · CANCELED=개설자 단독 취소(판돈 환불).
// ⚠️ CANCELED는 lastSettledBet에 실리지 않는다(서버가 걸러 준다 — 구앱 오표시 방지).
//    모르는 status가 와도 화면이 죽지 않게 각 화면은 else 강하를 유지한다.
export type GroupBetStatus = 'OPEN' | 'SETTLED' | 'REFUNDED' | 'FORFEITED' | 'CANCELED';

// 내기 참가자(진행 중 내기) — 닉네임만 쓴다.
export interface GroupChallengeBetParticipant {
  userId: string;
  nickname: string;
}

// 오늘(조회 date)의 내기. myAchievedNow는 '지금 이미 목표를 달성했나' —
// FOCUS는 달성 확정 후의 무위험 참가를 서버가 막으므로(BET_ALREADY_ACHIEVED) 앱이 미리 버튼을 잠근다.
// ⚠️ SCREEN_TIME의 myAchievedNow는 '잠정 달성'(지금까지 목표 이하 유지 중)이라 **표시용**이다 —
//    하루/창이 끝나야 확정되므로 참가를 잠그는 근거로 쓰면 안 된다(계약 §2 참가 가드 행).
//    스크린타임의 참가 차단 근거는 반대 방향(이미 목표 초과 = 확정 실패, BET_ALREADY_FAILED)이다.
export interface GroupChallengeBet {
  betId: string;
  stake: number;
  pot: number; // 판돈 × 참가자 수
  status: GroupBetStatus;
  myJoined: boolean;
  myAchievedNow: boolean;
  participants: GroupChallengeBetParticipant[];
  // 개설자 userId — 앱 취소 버튼(개설자 단독·OPEN일 때만) 판정용(계약 §2 additive 필드).
  // ⚠️ optional인 이유: 이 필드를 모르는 구서버가 존재한다(GroupChallengeResponse.bet과 같은 관행).
  //    undefined면 개설자를 알 수 없으므로 취소 진입점을 그리지 않는다 — 없는 기능을 세우지 않는다.
  creatorUserId?: string;
  // 내기 기준일 'YYYY-MM-DD' — 참가 철회 버튼의 '시작 전' 판정용(챌린지 개선 배치 계약 §4).
  // '내일 내기'(계약 §3)가 생기며 조회 date와 내기 날짜가 달라질 수 있어 필요해졌다.
  // ⚠️ optional: 이 필드를 모르는 구서버가 존재한다(creatorUserId와 같은 관행). undefined면
  //    조회일(오늘) 내기로 간주한다 — DURATION 철회는 미래 내기만 허용이라 자연히 숨는다.
  date?: string;
}

// 정산된 내기의 인별 결과. payout은 **받은 금액**(승자 분배금 or 환불금)이지 손익이 아니다 —
// 화면에서 ±로 보이려면 판돈을 빼야 한다(payout - stake).
// ⚠️ 두 필드 모두 nullable이다(계약 §3, 서버 Boolean/Integer) — 정산 전·정산 부분 실패면 null이다.
//    ChallengeMemberProgress와 같은 규칙으로 **null과 0을 뭉개지 않는다**: null을 0으로 읽으면
//    아직 판정되지 않은 참가자가 '미달성 · -30'(판돈을 잃은 것처럼) 보인다.
export interface LastSettledBetResult {
  userId: string;
  nickname: string;
  achieved: boolean | null;
  payout: number | null;
  // 정산 판정에 쓴 실측 분 — 정산 시점 스냅샷(GROMO-1207, 서버 옵션 C). 3상을 뭉개지 않는다:
  //   undefined = 필드 자체를 모르는 구서버 — 근거 표기를 **아예 그리지 않는다**(기존 레이아웃 불변)
  //   null      = 신서버지만 과거 정산분(백필 불가·안 함) — 미집계 '—' 표기
  //   number    = 실측 분 — '52/60분' 표기(progressFormat 조각)
  progressMinutes?: number | null;
}

// 이 챌린지의 가장 최근 정산 내기(카드 하단 '지난 내기' 1줄 + 탭 시 결과 상세).
export interface LastSettledBet {
  betDate: string; // 'YYYY-MM-DD'
  stake: number;
  pot: number;
  status: GroupBetStatus;
  results: LastSettledBetResult[];
  // 정산 시점의 목표 분 스냅샷(GROMO-1207) — 조회 시점의 durationMinutes와 다를 수 있다(목표 수정
  // 대비 스냅샷이 정본). progressMinutes와 같은 3상: undefined=구서버, null=과거 정산분·목표 없던
  // 구 창(TIME_WINDOW). 표기에서는 falsy(undefined·null·0)면 분모를 생략한다('52분') —
  // progressFraction의 규칙 그대로(0 목표는 '72/0분'이라는 읽을 수 없는 표기가 된다, 티켓 1205).
  goalMinutes?: number | null;
}

// POST /groups/{groupId}/challenges/{challengeId}/bets — 내기 개설(개설자 자동 참가·판돈 즉시 차감).
export interface CreateBetRequest {
  stake: number; // 1~1000 정수 — 범위 밖은 서버가 BET_INVALID_STAKE
  // 'YYYY-MM-DD'. 오늘 또는 내일(창 마감 뒤 '내일 시간대부터 적용' — GROMO-1103) — 그 외는 BET_CLOSED.
  date: string;
}

export interface CreateBetResponse {
  betId: string;
}

// POST /groups/{id}/challenges — 챌린지 생성(방장만). DURATION·TIME_WINDOW 둘 다 만든다
// (계약 §2 — V20부터 창 판정·창 목표분을 서버가 지원한다).
// TIME_WINDOW일 때 durationMinutes는 **필수**다(0 < x ≤ 창 길이, 위반 INVALID_MISSION_PARAMS).
export interface CreateChallengeRequest {
  missionCategory: MissionCategory;
  missionType: MissionType;
  durationMinutes: number; // 하루/창 목표(분)
  // TIME_WINDOW 전용 — ISO-8601 Instant 문자열. 서버는 이 값을 KST 시각(time-of-day) 앵커로
  // 해석한다(계약 설계 보정 — '매일 반복 시간대'). 앱은 +09:00 오프셋을 명시해 보낸다.
  windowStart?: string;
  windowEnd?: string;
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
