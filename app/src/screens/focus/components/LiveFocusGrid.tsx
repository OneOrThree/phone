import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { T, withAlpha } from '@/constants/theme';
import { useLiveFocusClock } from '@/hooks/useLiveFocusClock';
import { liveTotalSeconds } from '@/utils/liveFocus';
import { hms } from '../format';
import { StarAvatar } from './StarAvatar';

// 집중 세션 소셜 그리드 공통 컴포넌트 — 친구(656)·리그(811)·같은 시험(812) 페이지가 공유.
// 전원 오늘 총 집중시간을 hh:mm:ss로 표기하고(GROMO-929, 비집중은 분 원본이라 초 :00 고정),
// 집중중(isFocusing)은 초록 테두리·과목·초 단위 라이브로 구분.
// 아바타 색은 팔레트 순환 — TODO: 캐릭터 장착 정보 렌더 연동 시 교체.

// 그리드 멤버 공통 형태 — SessionFriend(친구)·리그 랭킹 매핑 결과가 모두 이 형태를 만족한다.
export interface LiveGridMember {
  userId: string;
  nickname: string;
  focusTimeMinutes: number; // 오늘 누적 집중 분 (완료 세션 집계 — 진행 중 경과는 미포함)
  isFocusing: boolean;
  focusStartedAt: string | null; // 진행 중 세션 시작 시각(ISO) — 초 단위 틱업 기준
  focusTagName: string | null; // 진행 중 세션 태그명(집중 과목)
}

// 별사탕 아바타 팔레트 (시안 6인 색 그대로 순환)
const AVATAR_COLORS = T.avatarPalette;

export function LiveFocusGrid({
  members,
  title,
  emptyTitle,
  emptySub,
}: {
  members: LiveGridMember[];
  /** 페이지 구분 헤더 (예: '내 리그') — 없으면 생략 */
  title?: string;
  emptyTitle: string;
  emptySub: string;
}) {
  const focusing = members.filter((m) => m.isFocusing).length;

  // 초 단위 틱업 — 그리드 전체가 공용 시계 하나를 공유. 집중중 멤버가 없으면 인터벌 정지.
  const now = useLiveFocusClock(members.some((m) => m.isFocusing && m.focusStartedAt != null));

  if (members.length === 0) {
    return (
      <View style={s.emptyWrap}>
        <Text style={s.emptyTitle}>{emptyTitle}</Text>
        <Text style={s.emptySub}>{emptySub}</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {title != null && <Text style={s.title}>{title}</Text>}
      {/* 0명일 땐 라이브 점 없이 회색 톤 배너 — "0명이 같이 집중" 표기의 어색함 제거(GROMO-848) */}
      {focusing === 0 ? (
        <View style={[s.banner, s.bannerSolo]}>
          <Text style={[s.bannerText, s.bannerTextSolo]}>지금은 나만 집중하고 있어요</Text>
        </View>
      ) : (
        <View style={s.banner}>
          <View style={s.bannerDot} />
          <Text style={s.bannerText}>{focusing}명이 지금 같이 집중하고 있어요</Text>
        </View>
      )}

      {/* 인원이 화면을 넘으면 세로 스크롤(GROMO-848) — 가로 페이저와 축이 달라 충돌 없음 */}
      <ScrollView style={s.flex1} showsVerticalScrollIndicator={false}>
        <View style={s.grid}>
          {members.map((m, i) => (
            <View key={m.userId} style={[s.cell, !m.isFocusing && s.cellOff]}>
              <View style={[s.avatar, m.isFocusing ? s.avatarActive : s.avatarIdle]}>
                <StarAvatar color={AVATAR_COLORS[i % AVATAR_COLORS.length]} size={50} />
              </View>
              <Text style={s.name} numberOfLines={1}>
                {m.nickname}
              </Text>
              {m.isFocusing ? (
                <Text style={s.timeActive}>
                  {hms(liveTotalSeconds(m.focusTimeMinutes * 60, m.focusStartedAt, now))}
                </Text>
              ) : (
                <Text style={s.timeIdle}>{hms(m.focusTimeMinutes * 60)}</Text>
              )}
              {/* 과목 줄 — 태그 유무와 무관하게 항상 자리를 차지해(없으면 공백) 카드 높이를 통일한다.
                 flexWrap 그리드에서 같은 행 카드가 2줄/3줄로 어긋나는 것 방지 */}
              <Text style={s.tag} numberOfLines={1}>
                {m.isFocusing && m.focusTagName != null ? m.focusTagName : ' '}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: T.space.xl },
  title: {
    ...T.text.caption,
    fontWeight: '800',
    color: T.night.cream,
    textAlign: 'center',
    marginBottom: T.space.sm,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    backgroundColor: withAlpha(T.night.green, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(T.night.green, 0.25),
    borderRadius: 13,
    paddingVertical: T.space.sm,
    paddingHorizontal: T.space.md,
    marginBottom: T.space.xl,
  },
  bannerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.night.green },
  bannerText: { ...T.text.label, fontWeight: '700', color: T.night.greenSoft },
  // 0명(혼자 집중) 배너 — 회청색 톤으로 라이브 배너와 구분
  bannerSolo: {
    backgroundColor: withAlpha(T.night.muted, 0.1),
    borderColor: withAlpha(T.night.muted, 0.22),
  },
  bannerTextSolo: { color: T.night.muted },

  flex1: { flex: 1 },
  // 왼쪽부터 채움 — space-around는 1~2명 줄이 가운데로 퍼져 보인다(GROMO-848).
  // marginHorizontal 1.16% ≈ 구 space-around의 셀당 여백(7%/6)이라 꽉 찬 줄 간격은 동일.
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' },
  cell: {
    width: '31%',
    marginHorizontal: '1.16%',
    alignItems: 'center',
    gap: T.space.xs,
    marginVertical: T.space.md,
  },
  cellOff: { opacity: 0.5 },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: withAlpha(T.night.cream, 0.08),
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  avatarActive: { borderWidth: 2.5, borderColor: T.night.green },
  avatarIdle: { borderWidth: 2.5, borderColor: withAlpha(T.night.cream, 0.15) },
  name: { ...T.text.label, color: T.paperLight, maxWidth: 74 },
  tag: { ...T.text.caption, color: T.night.greenSoft, maxWidth: 74 },
  timeActive: {
    ...T.text.label,
    fontWeight: '700',
    color: T.night.green,
    fontVariant: ['tabular-nums'],
  },
  timeIdle: {
    ...T.text.label,
    fontWeight: '700',
    color: T.night.muted,
    fontVariant: ['tabular-nums'],
  },

  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    padding: 30,
  },
  emptyTitle: { ...T.text.label, fontWeight: '700', color: T.night.cream },
  emptySub: {
    ...T.text.caption,
    color: T.night.muted,
    textAlign: 'center',
    lineHeight: 19,
  },
});
