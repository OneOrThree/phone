import { StyleSheet, Text } from 'react-native';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';

// 그룹 찾기 시트 — 명세 docs/app/group-plan.md §6-3.
// ⚠️ 스켈레톤: SheetShell 껍데기와 props 계약만 있고 검색·참여는 후속 워커(APP-4)가 채운다.
// 선행: 백엔드 P0(is_private + 검색 필터). 그 전에는 비공개방이 검색에 그대로 노출된다(§13-1).
//
// 구현 가이드(§6-3):
//  · 검색 인풋(FriendAddScreen:132-149 관행) + 350ms 디바운스 + stale 플래그로 이전 응답 무시
//    (FriendAddScreen:66-92 패턴을 그대로 따른다). 빈 문자열이면 호출하지 않고 결과를 비운다.
//  · searchGroups(query) (@/services/groupApi) → 행: 이름 + n/m + '›'. 공개방만 내려온다.
//  · 응답 시 logGroupSearchPerformed({ query_length, result_count })
//  · 행 탭 → 확인 Alert("이 그룹에 참여할까요?") → joinGroup(groupId)
//    → 성공 시 logGroupJoinAttempted({ join_method: 'search' }) → onJoined() (부모가 닫고 재조회)
//  · 정원이 찬 그룹(currentMembers >= maxMembers)은 행을 흐리게 + 탭 비활성
//  · 에러 분기(groupErrorCode, §3-2):
//      ALREADY_MEMBER → 성공 취급(onJoined) / ROOM_FULL → "정원이 가득 찼어요" + 목록 갱신
//      NOT_FOUND → "사라진 그룹이에요" + 목록에서 제거 / GUEST_FORBIDDEN → 닫고 로그인 유도
//  · 결과 없음 문구: "그런 이름의 공개 그룹이 없어요"

export interface GroupFindSheetProps {
  // 딤 탭·취소 — 부모가 시트를 내린다.
  onClose: () => void;
  // 참여 성공(ALREADY_MEMBER 포함) — 부모가 시트를 내리고 getMyGroups()를 재조회한다.
  onJoined: () => void;
}

// TODO(APP-4, §6-3): props.onJoined는 joinGroup 성공(및 ALREADY_MEMBER) 시에만 호출한다.
export default function GroupFindSheet(props: GroupFindSheetProps) {
  return (
    <SheetShell onClose={props.onClose}>
      <Text style={s.title}>그룹 찾기</Text>
      <Text style={s.placeholder}>이름 검색은 준비 중이에요</Text>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  placeholder: {
    ...T.text.label,
    fontWeight: '500',
    color: T.inkMuted,
    marginTop: 2,
    marginBottom: T.space.xxl,
  },
});
