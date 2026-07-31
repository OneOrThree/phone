import { StyleSheet, Text, View } from 'react-native';
import { T } from '@/constants/theme';

// 그룹방 멤버 타일(3열 그리드 1칸) — 명세 docs/app/group-plan.md §6-4.
// ⚠️ 스켈레톤: props 계약 + 최소 표시만 있고 아바타·방장 배지는 후속 워커(APP-5)가 채운다.
//
// 구현 가이드(§6-4):
//  · 아바타는 리그의 MemberAvatar(src/screens/league/components/MemberAvatar.tsx) 재사용 검토.
//    2개 feature에서 쓰이게 되면 src/components/로 승격한다(app/.claude/CLAUDE.md 콜로케이션 규칙).
//  · focusTimeMinutes는 null 가능 → '0분' 표기. 60분 이상은 '2시간' 꼴로 축약(리그 fmtMinutes 관행).
//  · 방장(isOwner)은 왕관/배지 등으로 구분.
//  · '＋ 초대' 타일은 이 컴포넌트가 아니라 GroupRoomScreen이 그린다 — 정원 초과 비활성 등
//    그룹 단위 상태에 의존하기 때문.

export interface MemberTileProps {
  nickname: string;
  // 오늘(getGroupDetail의 date 기준) 집중 시간(분). 서버가 null을 줄 수 있다.
  focusTimeMinutes: number | null;
  isOwner?: boolean;
}

export default function MemberTile({ nickname, focusTimeMinutes, isOwner }: MemberTileProps) {
  return (
    <View style={s.tile}>
      <Text style={s.name} numberOfLines={1}>
        {nickname}
        {isOwner ? ' 👑' : ''}
      </Text>
      {/* TODO(APP-5, §6-4): 분 → '2시간 30분' 축약 표기로 교체 */}
      <Text style={s.minutes}>{focusTimeMinutes ?? 0}분</Text>
    </View>
  );
}

const s = StyleSheet.create({
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.sm,
  },
  name: { ...T.text.caption, fontWeight: '700', color: T.ink },
  minutes: { ...T.text.caption, fontWeight: '600', color: T.inkSub },
});
