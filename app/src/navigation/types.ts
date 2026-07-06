// v2 루트 스택 파라미터 — 탭(Main) 위에 상세 화면을 얹는 구조.
// 별도 파일로 분리해 화면 ↔ 네비게이터 순환 import을 피한다.
import type { FocusTimerMode, PomodoroConfig } from '@/v2/screens/focus/types';

export type V2RootStackParamList = {
  Main: undefined; // 4탭 + FAB
  Stats: undefined; // 통계 상세 (홈 '자세히'에서 진입)
  UsageDetail: undefined; // 앱별 사용시간 상세 (홈 '핸드폰 사용' 탭에서 진입)
  FocusCategory: undefined; // 02 과목 선택 (홈 ● 집중 FAB에서 진입)
  FocusSession: {
    subjectId: string;
    subjectName: string;
    mode: FocusTimerMode;
    goalSeconds?: number; // 카운트다운 목표
    pomodoro?: PomodoroConfig; // 뽀모도로 설정
  }; // 06~11 집중 세션
  FriendAdd: undefined; // 친구 추가/검색 (리그 친구 탭에서 진입)
  FriendProfile: {
    userId: string;
    nickname: string;
    tierLevel: number;
    exam?: string; // 준비 시험 — 백엔드 응답에 아직 없어 mock 진입(랭킹)에서만 전달
    isFriend: boolean;
    isPinned?: boolean; // 핀 초기값 — 진입 후 서버 친구 목록으로 재동기화
  }; // 유저 프로필 상세 — 친구/비친구·과목 겹침 여부로 3분기 (친구 그리드·랭킹·친구 추가에서 진입)
  TierGuide: undefined; // 티어 5단계 안내 (리그 내 티어 스트립에서 진입)
  LeagueResult: { type: 'promote' | 'demote' }; // 승격/강등 연출 (주간 정산 트리거 — 현재는 미리보기)

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
};
