import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { CharacterImage } from '@/components/character/CharacterImage';

// 그룹방 멤버 타일(3열 그리드 1칸) — 명세 docs/app/group-plan.md §6-4.
// 아바타 + 순위 배지 + 닉네임 + 누적/오늘 집중 시간. 방장은 왕관 배지로 구분한다.
// 순위·누적은 리더보드(3차)용 — 서버가 누적 집중 내림차순으로 준 순서·순위를 그대로 그린다(앱 재정렬 금지).
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
  // 전체 누적 집중 시간(분) — 리더보드 지표. 서버가 이 값 내림차순으로 정렬해 내려준다.
  totalFocusMinutes: number;
  // 서버 정렬 순서 기준 순위(1-based) — 리더보드 순서를 배지로 눈에 보이게 한다.
  rank: number;
  isOwner?: boolean;
}

export default function MemberTile({
  nickname,
  focusTimeMinutes,
  totalFocusMinutes,
  rank,
  isOwner,
}: MemberTileProps) {
  return (
    <View style={s.tile} testID={`group.member.tile.${rank}`}>
      <View style={s.avatar}>
        <CharacterImage size={AVATAR * 0.66} />
        {/* 순위 배지 — 서버 정렬(누적 집중 내림차순) 순서를 좌상단 숫자로 노출(정렬이 눈에 보이게) */}
        <View style={s.rank}>
          <Text style={s.rankText}>{rank}</Text>
        </View>
        {isOwner && (
          <View style={s.crown}>
            <Ionicons name="ribbon" size={10} color={T.white} />
          </View>
        )}
      </View>
      <Text style={s.name} numberOfLines={1}>
        {nickname}
      </Text>
      {/* 리더보드 지표 — 누적 집중 시간(강조) */}
      <Text style={s.total} numberOfLines={1}>
        {fmtFocus(totalFocusMinutes)}
      </Text>
      {/* 오늘 집중 시간(보조) */}
      <Text style={s.today} numberOfLines={1}>
        오늘 {fmtFocus(focusTimeMinutes)}
      </Text>
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
  // 순위 배지 — 좌상단(왕관은 우하단)에 겹쳐 순위를 숫자로. 색은 순위 배지 토큰(T.blue).
  rank: {
    position: 'absolute',
    left: -4,
    top: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: T.blue,
    borderWidth: 2,
    borderColor: T.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { ...T.text.caption, fontSize: 10, fontWeight: '800', color: T.white },
  name: { ...T.text.caption, fontWeight: '700', color: T.ink },
  // 누적(리더보드 지표) — 강조 수치 색(accentDeep)으로 오늘분과 위계를 가른다.
  total: { ...T.text.caption, fontWeight: '800', color: T.accentDeep, fontVariant: ['tabular-nums'] },
  // 오늘분(보조) — 흐린 색·기본 두께로 뒤로 물린다.
  today: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
});
