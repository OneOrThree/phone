import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { T } from '@/constants/theme';
import type { GroupSummaryResponse } from '@/types/dto/group';

// 그룹방 — 명세 docs/app/group-plan.md §6-4.
// ⚠️ 스켈레톤: props 계약과 껍데기만 있고 내용은 후속 워커(APP-5)가 채운다.
//
// 형태: 탭 셸 없는 단일 ScrollView. **별도 라우트가 아니라 GroupScreen 안에서 렌더된다**
//      (그룹 1개 전제라 목록 화면이 없다 — §0).
//
// 구현 가이드(§6-4):
//  · 데이터: getGroupDetail(groupId) + getAnnouncements(groupId) (@/services/groupApi).
//    date는 groupApi가 todayStr()을 기본값으로 붙인다 — 누락하면 서버 400(§3-1-1).
//  · 내 권한 판정(상세 응답에 내 role이 없어 직접 계산):
//      const me = detail.members.find((m) => m.userId === userId);   // userId는 useUser()
//      const isOwner = me?.role === 'OWNER';
//      const canWriteNotice = isOwner || detail.noticeGrantedUserIds.includes(userId);
//  · 레이아웃: 헤더(이름 · 비공개면 자물쇠 · n/m · ⋯) → 초대 링크 카드 → 공지 섹션(최근 3건 + 모두보기)
//    → 멤버 3열 그리드(MemberTile + '＋ 초대' 타일)
//  · 초대: Share.share({ message: `gromo 그룹 "${name}"에 초대합니다\n${buildInviteLink(groupId)}` })
//    + logGroupInviteShared(). 공개방에서도 노출하고, 비공개방에선 상단 고정(유일한 입구).
//    정원이 찼으면 카드 비활성 + "정원이 가득 찼어요" 캡션.
//  · '⋯' 액션시트 → 그룹 나가기: 확인 Alert → withdrawGroup(groupId) → 성공 시 onLeft() 호출.
//    HOST_WITHDRAW(400)면 "방장은 나갈 수 없어요…" 안내로 끝낸다(위임 UI 없음 — §14).
//  · 공지 카드/모두보기 → navigation.navigate('GroupNotice', { groupId, canWrite: canWriteNotice })
//  · RefreshControl로 상세+공지 동시 재조회. focusTimeMinutes는 null 가능 → '0분' 표기.
//  · ❌ detail.code · codeExpiresAt은 읽지 않는다 — 코드 개념 폐기(§3-1-5).

export interface GroupRoomScreenProps {
  groupId: string;
  // 탭 진입점이 가진 요약(getMyGroups[0]) — 상세 응답 도착 전 헤더를 먼저 그리는 용도(선택).
  summary?: GroupSummaryResponse;
  // 그룹 나가기 성공 시 호출 — 부모(GroupScreen)가 재조회해 빈 상태로 되돌린다.
  onLeft: () => void;
}

// TODO(APP-5, §6-4): props(groupId·onLeft)를 받아 상세·공지 조회 + 레이아웃을 구현한다.
// onLeft는 withdrawGroup 성공 후에만 호출한다(부모가 빈 상태로 되돌린다).
export default function GroupRoomScreen(props: GroupRoomScreenProps) {
  return (
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.card}>
        <Text style={s.name}>{props.summary?.name ?? '내 그룹'}</Text>
        <Text style={s.placeholder}>그룹방 화면은 준비 중이에요</Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: T.space.lg },
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    padding: T.space.xl,
    gap: T.space.xs,
  },
  name: { ...T.text.heading, fontWeight: '800', color: T.ink },
  placeholder: { ...T.text.caption, color: T.inkMuted },
});
