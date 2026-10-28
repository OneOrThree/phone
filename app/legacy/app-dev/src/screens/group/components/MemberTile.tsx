import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import { CharacterImage } from '@/components/character/CharacterImage';

// 그룹방 멤버 타일(3열 그리드 1칸) — 명세 docs/app/group-plan.md §6-4.
// 아바타 + 좌상단 순위 배지 + (방장) 머리 위 왕관 + (본인) 아바타 링 & 우상단 "나" 뱃지 + 닉네임 + 누적/오늘 집중.
// 순위·누적은 리더보드(3차)용 — 서버가 누적 집중 내림차순으로 준 순서·순위를 그대로 그린다(앱 재정렬 금지).
//
// 본인 식별(F3)·방장 구별(F5)은 한 타일에서 공존하되 서로 다른 '채널'로 가른다:
//  - isOwner→ 아바타 머리 위 왕관(accent). 색이 아니라 '형태'로 구분.
//  - isMe   → 리그(LeagueScreen 포디움 본인 표시)와 동일하게 아바타 accent 링 + 우상단 "나" 뱃지 + 닉네임 accentDeep.
// 색 없이도 식별되게 왕관(형태)·"나"(텍스트)로 전달한다(색맹 대응). 내가 방장이면 왕관+링+"나"가 함께 뜬다.
//
// 아바타/본인 표시는 리그의 MemberAvatar·podiumAvatarWrapMe·podiumMeBadge와 같은 모양이지만 그 파일을
// import하지 않는다 — feature 폴더 간 직접 참조는 콜로케이션 규칙 위반이고(2곳 이상 쓰이면 src/components/로
// 승격), 승격은 리그 파일을 건드려야 해서 이번 범위 밖이다. 공용 CharacterImage만 재사용한다.
//
// 초대 진입점은 상단 초대 링크 카드로 일원화됐다(F4) — 그리드 끝의 '＋ 초대' 타일은 제거됐다.

const AVATAR = 44;

// 분 → '0분' / '45분' / '2시간' / '2시간 30분'. focusTimeMinutes는 null 가능 → 0분(§6-4).
// 리그의 fmtMinutes는 '02:30:00' 디지털 표기라 타일에는 쓰지 않는다(명세 목업이 축약 표기).
function fmtFocus(minutes: number | null): string {
  const total = Math.max(0, Math.round(minutes ?? 0));
  if (total < 60) return t('group.memberTile.minutes', { minutes: total });
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0
    ? t('group.memberTile.hours', { hours: h })
    : t('group.memberTile.hoursMinutes', { hours: h, minutes: m });
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
  // 이 타일이 '나'인가 — GroupRoomScreen이 member.userId === 내 userId로 판정해 넘긴다(F3).
  isMe?: boolean;
  // 타일 탭 — 멤버 통계 비교 화면으로 이동(GROMO-1200). 없으면 비활성.
  onPress?: () => void;
}

export default function MemberTile({
  nickname,
  focusTimeMinutes,
  totalFocusMinutes,
  rank,
  isOwner,
  isMe,
  onPress,
}: MemberTileProps) {
  return (
    <TouchableOpacity
      style={s.tile}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      testID={`group.member.tile.${rank}`}
    >
      {/* 본인은 아바타 accent 링(리그 podiumAvatarWrapMe)으로 감싼다 — 평소엔 투명 래퍼라 레이아웃 무변화. */}
      <View style={[s.avatarWrap, isMe && s.avatarWrapMe]}>
        <View style={s.avatar}>
          <CharacterImage size={AVATAR * 0.66} />
          {/* 순위 배지 — 서버 정렬(누적 집중 내림차순) 순서를 좌상단 숫자로 노출(정렬이 눈에 보이게) */}
          <View style={s.rank}>
            <Text style={s.rankText}>{rank}</Text>
          </View>
        </View>
        {/* 본인(F3) = 아바타 우상단 "나" 뱃지(리그 podiumMeBadge). 색 외에 텍스트로도 신원 전달(색맹 대응). */}
        {isMe && (
          <View style={s.meBadge} pointerEvents="none" testID="group.member.me">
            <Text style={s.meBadgeText} allowFontScaling={false}>
              {t('common.me')}
            </Text>
          </View>
        )}
        {/* 방장(F5) = 머리 위 왕관. avatarWrap의 '마지막 자식' + zIndex/elevation으로 링·원 위에 확실히 얹는다(가림 방지). */}
        {isOwner && (
          <View style={s.crown} pointerEvents="none" testID="group.member.owner">
            <MaterialCommunityIcons name="crown" size={18} color={T.accent} />
          </View>
        )}
      </View>
      <Text style={[s.name, isMe && s.nameMe]} numberOfLines={1}>
        {nickname}
      </Text>
      {/* 리더보드 지표 — 누적 집중 시간(강조) */}
      <Text style={s.total} numberOfLines={1}>
        {fmtFocus(totalFocusMinutes)}
      </Text>
      {/* 오늘 집중 시간(보조) */}
      <Text style={s.today} numberOfLines={1}>
        {t('group.memberTile.todayFocus', { value: fmtFocus(focusTimeMinutes) })}
      </Text>
    </TouchableOpacity>
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
  // 아바타 래퍼 — 기본은 투명(레이아웃 무변화), 내 것이면 accent 글로우 링(리그 podiumAvatarWrapMe와 동일).
  avatarWrap: { alignItems: 'center', justifyContent: 'center' },
  avatarWrapMe: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: T.accent,
    backgroundColor: T.white,
    shadowColor: T.accent,
    shadowOpacity: 0.45,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
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
  // 순위 배지 — 좌상단에 겹쳐 순위를 숫자로. 색은 순위 배지 토큰(T.blue).
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
  // 방장 왕관 — 아바타 위쪽 중앙. avatarWrap의 마지막 자식 + zIndex/elevation으로 링·원 위에 얹어 가림을 막는다.
  crown: {
    position: 'absolute',
    top: -14,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
    elevation: 10,
  },
  // 본인 "나" 뱃지 — 아바타 우상단(리그 podiumMeBadge). accent 채움 + 흰 테두리.
  meBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: T.accent,
    borderRadius: 9,
    paddingHorizontal: T.space.xs,
    paddingVertical: 1,
    borderWidth: 1.5,
    borderColor: T.white,
    zIndex: 2,
  },
  meBadgeText: { fontSize: 10, fontWeight: '800', color: T.white },
  name: { ...T.text.caption, fontWeight: '700', color: T.ink },
  // 본인 닉네임 — 리그 podiumNameMe와 같은 강조(accentDeep, 굵게).
  nameMe: { color: T.accentDeep, fontWeight: '800' },
  // 누적(리더보드 지표) — 강조 수치 색(accentDeep)으로 오늘분과 위계를 가른다.
  total: {
    ...T.text.caption,
    fontWeight: '800',
    color: T.accentDeep,
    fontVariant: ['tabular-nums'],
  },
  // 오늘분(보조) — 흐린 색·기본 두께로 뒤로 물린다.
  today: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
});
