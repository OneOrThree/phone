import { StyleSheet, Text } from 'react-native';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';

// 초대 링크 프리뷰 시트 — 명세 docs/app/group-plan.md §6-6.
// ⚠️ 스켈레톤: SheetShell 껍데기와 props 계약만 있고 프리뷰·참여는 후속 워커(APP-7)가 채운다.
//
// 이 시트가 뜨는 경로(이미 배선 완료 — 후속 워커는 **내부만** 채우면 된다):
//   랜딩(§12) → gromo://join?g=<uuid>
//     → RootNavigator의 Linking 수신(getInitialURL / addEventListener)
//     → navigationRef.navigateToDeepLink() 의 'join' 케이스가 parseInviteLink로 groupId 추출
//     → 그룹 탭으로 이동 + 모듈 버퍼에 저장 & 리스너 통지(navigationRef.notifyGroupInvite)
//     → GroupScreen이 리스너/peekPendingInvite로 받아 이 시트를 groupId와 함께 렌더
//   ⚠️ 버퍼 수명은 GroupScreen이 관리한다(onClose/onJoined에서 clearPendingInvite 호출).
//      **이 파일 안에서 navigationRef의 버퍼를 직접 만지지 말 것** — 게스트 로그인 후 복귀가 깨진다.
//
// 구현 가이드(§6-6) — getGroupOverview(groupId) **1회 호출로 전부 판정**한다.
//   (상세 getGroupDetail은 그룹원만이라 참여 전에 부르면 403 — §3-1-4)
//  | 조건                          | 화면                                                     |
//  |------------------------------|----------------------------------------------------------|
//  | 게스트(useUser().isGuest)     | "로그인하고 참여하기" — 로그인 성공 후 이 시트를 다시 띄운다 |
//  | isMember === true             | 시트 없이 바로 그룹방으로 (onJoined 호출)                  |
//  | memberCount >= maxMembers     | "정원이 가득 찼어요" — 참여 버튼 비활성                    |
//  | 404(NOT_FOUND)                | "사라진 그룹이에요"                                       |
//  | 그 외                         | 그룹명·인원·미션 프리뷰 + '참여하기'                       |
//  · 참여하기 → joinGroup(groupId) → logGroupJoinAttempted({ join_method: 'invite' }) → onJoined()
//  · 이미 다른 그룹에 가입한 상태면(그룹 1개 전제) "이미 참여 중인 그룹이 있어요. 나가고 참여해주세요."
//    로 막는다 — 자동 탈퇴시키지 않는다.

export interface GroupInviteSheetProps {
  // 초대 링크에서 뽑은 그룹 UUID(형식 검증 완료 — parseInviteLink 통과값).
  groupId: string;
  // 닫기(딤 탭·취소·사라진 그룹 확인) — 부모가 시트를 내리고 초대 버퍼를 비운다.
  onClose: () => void;
  // 참여 성공 또는 이미 멤버 — 부모가 시트를 내리고 getMyGroups()를 재조회해 그룹방으로 전환한다.
  onJoined: () => void;
}

// TODO(APP-7, §6-6): props.groupId로 getGroupOverview 조회 → 위 표대로 분기.
export default function GroupInviteSheet(props: GroupInviteSheetProps) {
  return (
    <SheetShell onClose={props.onClose}>
      <Text style={s.title}>그룹 초대장이 도착했어요</Text>
      <Text style={s.placeholder}>초대 프리뷰는 준비 중이에요</Text>
      <Text style={s.debug}>{props.groupId}</Text>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  placeholder: { ...T.text.label, fontWeight: '500', color: T.inkMuted, marginTop: 2 },
  debug: { ...T.text.caption, color: T.inkFaint, marginTop: T.space.sm, marginBottom: T.space.xxl },
});
