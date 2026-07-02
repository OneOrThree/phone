// v2 루트 스택 파라미터 — 탭(Main) 위에 상세 화면을 얹는 구조.
// 별도 파일로 분리해 화면 ↔ 네비게이터 순환 import을 피한다.
export type V2RootStackParamList = {
  Main: undefined; // 4탭 + FAB
  Stats: undefined; // 통계 상세 (홈 '자세히'에서 진입)
  FriendAdd: undefined; // 친구 추가/검색 (리그 친구 탭에서 진입)
  TierGuide: undefined; // 티어 5단계 안내 (리그 내 티어 스트립에서 진입)
  LeagueResult: { type: 'promote' | 'demote' }; // 승격/강등 연출 (주간 정산 트리거 — 현재는 미리보기)
};
