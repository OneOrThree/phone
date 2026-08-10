// 그룹 모듈 배럴 — 네비게이터 등 호출부는 여기서 import.
//   import { GroupScreen, GroupCreateScreen, GroupRoomRouteScreen, NoticeScreen } from '@/screens/group';
// 그룹방 본체(GroupRoomScreen)·목록(GroupListScreen)·시트들은 라우트가 아니라 GroupScreen 내부
// 또는 래퍼에서만 쓰이므로 내보내지 않는다 — 라우트로 등록되는 것만 배럴에 둔다.
export { default as GroupScreen } from './GroupScreen';
export { default as GroupCreateScreen } from './GroupCreateScreen';
export { default as GroupRoomRouteScreen } from './GroupRoomRouteScreen';
export { default as NoticeScreen } from './NoticeScreen';
// 그룹 챌린지 내역(GROMO-1277 · N6-1) — 그룹방 「챌린지 내역」 링크와 지난 결과 시트
// '지난 기록 더보기'가 같은 라우트로 들어온다(후자는 challengeId 필터).
export { default as GroupChallengeHistoryScreen } from './GroupChallengeHistoryScreen';
// 그룹 운영(3차) — 방장 전용 라우트 화면들. 그룹방 ⋯ '그룹 설정'(GroupSettings)이 허브다.
export { default as GroupSettingsScreen } from './GroupSettingsScreen';
export { default as GroupProfileEditScreen } from './GroupProfileEditScreen';
export { default as GroupMemberManageScreen } from './GroupMemberManageScreen';
export { default as GroupOwnerTransferScreen } from './GroupOwnerTransferScreen';
export { default as GroupNoticePermissionScreen } from './GroupNoticePermissionScreen';
