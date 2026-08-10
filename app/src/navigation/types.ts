// v2 루트 스택 파라미터 — 탭(Main) 위에 상세 화면을 얹는 구조.
// 별도 파일로 분리해 화면 ↔ 네비게이터 순환 import을 피한다.
import type { FocusTimerMode, PomodoroConfig } from '@/screens/focus/types';

export type V2RootStackParamList = {
  Main: undefined; // 4탭 + FAB
  Stats: undefined; // 통계 상세 (홈 '자세히'에서 진입)
  UsageDetail: undefined; // 앱별 사용시간 상세 (홈 '핸드폰 사용' 탭에서 진입)
  Notifications: undefined; // 알림 보관함 (홈 우측 상단 종에서 진입 — GROMO-661)
  CurrencyHistory: undefined; // 시간조각(재화) 거래 내역 (전체 탭 잔액 행에서 진입)
  // 02 과목 선택 (홈 ● 집중 FAB에서 진입). initialGroupId: 그룹방 FAB에서 진입 시 — 세션까지 넘겨
  // 집중 세션이 그 그룹의 '그룹: {그룹명}' 페이지로 기본 진입하게 한다(F2 Part2).
  FocusCategory: { initialGroupId?: string } | undefined;
  FocusSession: {
    subjectId: string;
    subjectName: string;
    mode: FocusTimerMode;
    goalSeconds?: number; // 카운트다운 목표
    pomodoro?: PomodoroConfig; // 뽀모도로 설정
    initialGroupId?: string; // 그룹방 FAB 진입 시 — 스와이프를 그 그룹의 '그룹: {그룹명}' 페이지로 기본 진입(F2 Part2)
  }; // 06~11 집중 세션
  FocusResult: {
    focusSeconds: number; // 이번 세션 집중 초
    subjectId: string;
    subjectName: string;
    completed: boolean; // 정상 완료 여부 — 중도 이탈(정지·이탈 타임아웃) 세션은 별점 요청 스킵(GROMO-980)
  }; // 집중 결과 화면 — 세션 종료 후 (GROMO-603)
  FriendAdd: undefined; // 친구 추가/검색 (리그 친구 탭에서 진입)
  FriendProfile: {
    userId: string;
    nickname: string;
    tierLevel: number;
    isFriend: boolean;
    isMe?: boolean; // 내 프로필 — 리그 내 행 탭 진입. 비교(상대 시리즈)·친구/핀 CTA 없이 내 그래프만 (GROMO-940)
    isPinned?: boolean; // 핀 초기값 — 진입 후 서버 핀 목록(GET /pins)으로 재동기화 (핀은 친구 아니어도 가능, GROMO-609)
    rank?: number; // 진입한 랭킹 목록에서의 순위 — 서버 프로필 rank(아레나 내)와 스코프가 달라 목록 값을 그대로 전달, 랭킹 진입에서만 (GROMO-685)
    rankLabel?: string; // 순위 스코프 라벨 — '전체' 또는 직군명
  }; // 유저 프로필 상세 — 내 프로필/친구/비친구·과목 겹침 여부로 분기 (친구 그리드·랭킹·친구 추가·리그 내 행에서 진입)
  TierGuide: undefined; // 티어 5단계 안내 (리그 내 티어 스트립에서 진입)
  LeagueResult: {
    type: 'promote' | 'maintain' | 'demote'; // 연출 텍스트 분기 — 서버 result 매핑(모르는 값은 유지 폴백)
    fromLevel: number; // 정산 전 티어 (previousTierLevel)
    toLevel: number; // 정산 후 티어 (newTierLevel)
    weekHours: number; // 해당 주차 집중 시간(시간 단위, 소수 허용) — focusSeconds ÷ 3600
    weekStartAt: string; // ack 대상 주차(ISO) — 화면 닫힐 때 확인 처리
    promotionBonusCoins?: number; // 승급 보상 시간조각(승급 시 >0일 때만 배지 표기)
  }; // 승격/유지/강등 연출 — 리그 탭 포커스 시 미확인 last-result가 있으면 진입 (GROMO-831)

  // 그룹(A안, docs/app/group-plan.md §9) — 진입점은 '그룹' 탭(GroupScreen), 아래는 스택 push.
  GroupCreate: undefined; // 그룹 생성 (빈 상태 '그룹 만들기'에서 진입)
  // 그룹방 — 2차에서 라우트로 승격(docs/app/group-plan-2.md §0-2). A-9(3차) 이후 **라우트 진입
  // 전용**이다: 소속 수와 무관하게 목록이 그룹 탭의 기본 화면이고, 여기로 push 해야 방이 열린다.
  GroupRoom: {
    groupId: string;
    // 챌린지 종료 푸시가 지목한 챌린지(GROMO-1088) — 진입 직후 그 챌린지의 결과 모달을 자동으로
    // 연다. 1회 가드(이미 본 결과)를 넘어서 열되, 화면 안에서 한 번만 소비된다.
    //
    // ⚠️ **optional(`?`)이 아니라 `| undefined`인 것은 의도다.** 이미 스택에 있는 'GroupRoom'으로
    //    다시 navigate 하면 React Navigation이 파라미터를 얕게 병합한다
    //    (`{ ...route.params, ...payload.params }`). 키를 빼면 직전 진입의 challengeId가 그대로
    //    남아 **다른 그룹의 방에 이전 그룹의 지목이 새어 들어간다**(그룹방 위에 뜬 초대 시트로
    //    다른 그룹에 참여하는 경로 — @claude 리뷰). 키를 필수로 두면 모든 호출부가 값을
    //    명시하게 되어 컴파일 시점에 이 불변식이 강제된다.
    challengeId: string | undefined;
  };
  GroupNotice: {
    groupId: string;
    canWrite: boolean; // 방장·공지 권한 멤버 여부 — false면 작성/수정/삭제 진입점을 렌더하지 않는다(403 예방)
  }; // 공지 목록 (그룹방 '모두보기'·공지 카드에서 진입)
  // 그룹 챌린지 내역(GROMO-1277 · N6-1) — 구 'GroupBetHistory'(챌린지 축)를 대체한다.
  // 이력의 소유자가 챌린지에서 **그룹**으로 올라가, 챌린지가 삭제돼도 목록이 살아 있다.
  // 진입 둘·화면 하나(IA §1): 그룹방 「챌린지 내역」 링크(필터 없음) / 지난 결과 시트
  // 「지난 기록 더보기」(challengeId 필터). 미션 메타는 회차 스냅샷으로 응답에 실려 오므로
  // route param으로 나르지 않는다 — 진입 경로에 표시가 의존하지 않는다.
  //
  // ⚠️ 필터 두 칸은 위 `GroupRoom.challengeId`와 **같은 이유로** optional(`?`)이 아니라
  //    `| undefined`다. 이미 필터로 열린 이 화면이 스택에 남아 있는데(예: 그룹방 위에 뜬
  //    초대·딥링크로 다른 방을 올린 뒤) 전체 내역 링크를 누르면, React Navigation의 얕은
  //    파라미터 병합이 **생략한 키를 직전 진입 값으로 채운다** — 다른 그룹의 챌린지 필터가
  //    그대로 남아 "왜 이 방 기록이 안 보이지"가 된다. 키를 필수로 두면 모든 호출부가 값을
  //    명시하게 되어 이 불변식이 컴파일 시점에 강제된다(codex 리뷰).
  GroupChallengeHistory: {
    groupId: string;
    challengeId: string | undefined; // 있으면 그 챌린지만(서버는 같은 엔드포인트의 필터로 처리한다)
    challengeLabel: string | undefined; // 필터 진입에서 헤더에 적을 미션 라벨 — 없으면 아무것도 지어내지 않는다
  };

  // 그룹 운영(3차) — 그룹방 ⋯ 가 GroupSettings(관리 허브)로 직행한다(팝업 메뉴 폐지).
  // 허브에서 아래 화면들로 갈라진다. 관리 행은 방장 전용이고 비방장은 나가기만 본다.
  // 멤버십이 바뀌면(위임·강퇴·탈퇴) 복귀 시 상태를 재동기화한다.
  GroupSettings: { groupId: string }; // A-1 관리 허브 — 프로필설정·위임·멤버관리·공지권한 진입 + 그룹 나가기
  GroupCardEmojiEdit: { groupId: string }; // OWNER·MEMBER 공통 기기 로컬 카드 아이콘 편집
  GroupProfileEdit: { groupId: string }; // A-1 그룹 프로필 편집(이름/소개/정원/공개설정) — 허브에서 push
  GroupMemberManage: { groupId: string }; // A-3 멤버 관리(강퇴)
  GroupOwnerTransfer: {
    groupId: string;
    // A-2 위임 진입 경로 — 위임 성공 뒤 동작이 갈린다.
    //   settings : 위임만 하고 허브로 복귀
    //   withdraw : 위임 직후 그룹 나가기까지 실행(방장 탈퇴 경로)
    //   account  : 계정 탈퇴 흐름 — 위임만 하고 계정 화면으로 복귀(그룹 수만큼 반복)
    source: 'settings' | 'withdraw' | 'account';
  }; // A-2 방장 위임(멤버 선택)
  GroupNoticePermission: { groupId: string }; // A-4 공지 작성 권한 관리(멤버별 토글)

  // 설정(GROMO-559) — 허브는 '전체' 탭(MenuScreen), 하위 화면은 아래 스택에서 push.
  SettingsProfileEdit: undefined; // 프로필 편집 (닉네임 · 스킨[준비중])
  SettingsOccupation: undefined; // 준비 시험 변경 (focusCategory)
  SettingsAccount: undefined; // 계정 설정 (소셜 연동 · 로그아웃 · 회원 탈퇴)
  SettingsGoals: undefined; // 개인 목표 수정 (집중 · 사용시간, 내일부터 적용)
  SettingsAllowedApps: undefined; // 집중 중 허용 앱 관리
  SettingsScreenTimePermission: undefined; // 스크린타임 권한 관리
  SettingsNotification: undefined; // 알림 · 심야 · 소리
  SettingsStatVisibility: undefined; // 통계 공개 범위
  SettingsPrivacyPolicy: undefined; // 개인정보 처리방침 (URL 미정 — placeholder)
  SettingsVersion: undefined; // 버전 정보

  // 사진에서 캐릭터 만들기 — '전체' 탭 '캐릭터' 섹션에서 진입. 생성 완료 시 커스텀 캐릭터로 저장.
  CharacterCreate: undefined;
  // 캐릭터 변경 — 홈 '캐릭터 변경'에서 진입. 기본 그로몬 / 내 캐릭터(누끼) 중 장착 선택.
  CharacterSelect: undefined;
};
