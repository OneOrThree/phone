import { StyleSheet, Text, View } from 'react-native';
import { T } from '@/constants/theme';
import type { GroupSummaryResponse } from '@/types/dto/group';

// 그룹 목록 — 명세 docs/app/group-plan-2.md §3-1.
//
// ⚠️ **스켈레톤이다.** 배관 트랙은 props 계약과 GroupScreen 분기만 확정하고, 본체(카드 그리드·
// 만들기/찾기 CTA·당겨서 새로고침)는 목록 트랙이 이 파일 안에서 채운다.
//
// props 계약(확정 — 목록 트랙은 이 시그니처를 바꾸지 않는다):
//   groups    : GroupSummaryResponse[]  내가 참여 중인 그룹(서버 순서 그대로, 앱 재정렬 금지)
//   onSelect  : (groupId: string) => void  카드 탭. **자체적으로 navigate 하지 않는다** —
//               1개일 땐 목록을 닫고, 2개 이상일 땐 GroupRoom push 하는 분기는 GroupScreen이 쥔다
//   onCreate  : () => void   '그룹 만들기' — GroupScreen이 전이 상태를 세우고 GroupCreate로 push
//   onFind    : () => void   '그룹 찾기' — GroupScreen이 GroupFindSheet를 연다
//   onRefresh : () => Promise<void>  당겨서 새로고침. 조회 실패 배너는 GroupScreen이 이미 그린다
//
// 렌더는 SafeAreaView 없이 컨텐츠만 — 탭 셸(SafeAreaView·배경)은 GroupScreen이 감싼다.
export interface GroupListScreenProps {
  groups: GroupSummaryResponse[];
  onSelect: (groupId: string) => void;
  onCreate: () => void;
  onFind: () => void;
  onRefresh: () => Promise<void>;
}

export default function GroupListScreen({ groups }: GroupListScreenProps) {
  return (
    <View style={s.root} testID="group.list">
      <Text style={s.placeholder}>그룹 {groups.length}개</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  placeholder: { ...T.text.body, color: T.inkSub },
});
