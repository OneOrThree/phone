import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { CharacterImage } from '@/components/character/CharacterImage';

// 그룹방 멤버 타일(3열 그리드 1칸) — 명세 docs/app/group-plan.md §6-4.
// 아바타 + 닉네임 + 오늘 집중 시간. 방장은 왕관 배지로 구분한다.
//
// 아바타는 리그의 MemberAvatar와 같은 모양이지만 그 파일을 import하지 않는다 —
// feature 폴더 간 직접 참조는 콜로케이션 규칙 위반이고(2곳 이상 쓰이면 src/components/로 승격),
// 승격은 리그 파일을 건드려야 해서 이번 작업 범위 밖이다. 공용 CharacterImage만 재사용한다.
//
// '＋ 초대' 타일은 이 컴포넌트가 아니라 GroupRoomScreen이 그린다 — 정원 초과 비활성 등
// 그룹 단위 상태에 의존하기 때문.

const AVATAR = 44;

// 분 → '0분' / '45분' / '2시간' / '2시간 30분'. focusTimeMinutes는 null 가능 → 0분(§6-4).
// 리그의 fmtMinutes는 '02:30:00' 디지털 표기라 타일에는 쓰지 않는다(명세 목업이 축약 표기).
function fmtFocus(minutes: number | null): string {
  const total = Math.max(0, Math.round(minutes ?? 0));
  if (total < 60) return `${total}분`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

export interface MemberTileProps {
  nickname: string;
  // 오늘(getGroupDetail의 date 기준) 집중 시간(분). 서버가 null을 줄 수 있다.
  focusTimeMinutes: number | null;
  isOwner?: boolean;
}

export default function MemberTile({ nickname, focusTimeMinutes, isOwner }: MemberTileProps) {
  return (
    <View style={s.tile}>
      <View style={s.avatar}>
        <CharacterImage size={AVATAR * 0.66} />
        {isOwner && (
          <View style={s.crown}>
            <Ionicons name="ribbon" size={10} color={T.white} />
          </View>
        )}
      </View>
      <Text style={s.name} numberOfLines={1}>
        {nickname}
      </Text>
      <Text style={s.minutes}>{fmtFocus(focusTimeMinutes)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  // 그룹방 카드 표면과 같은 T.paperAlt — 그룹 탭 배경이 흰 캔버스라 T.white 타일은 묻힌다.
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: T.space.xs,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.sm,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: T.sand,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  crown: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: T.accent,
    borderWidth: 2,
    borderColor: T.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...T.text.caption, fontWeight: '700', color: T.ink },
  minutes: { ...T.text.caption, fontWeight: '600', color: T.inkSub },
});
