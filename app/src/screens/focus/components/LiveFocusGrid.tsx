import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { T, withAlpha } from '@/constants/theme';
import { useLiveFocusClock } from '@/hooks/useLiveFocusClock';
import { liveTotalSeconds } from '@/utils/liveFocus';
import { hms } from '../format';
import { StarAvatar } from './StarAvatar';

// 집중 세션 소셜 그리드 공통 컴포넌트 — 친구(656)·리그(811)·같은 시험(812) 페이지가 공유.
// 전원 오늘 총 집중시간을 hh:mm:ss로 표기하고(GROMO-929, 비집중은 분 원본이라 초 :00 고정),
// 집중중(isFocusing)은 초록 테두리·과목·초 단위 라이브로 구분.
// 내 프로필 셀(GROMO-932)은 me prop으로 렌더 — "나도 이 판에 있다" 감각.
// 순서는 핀(pinnedIds) 최상단, 그 외 나 포함 시간순 — 자세한 규칙은 아래 cells 주석.
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

// 내 프로필 셀(GROMO-932) — 서버 폴링이 아니라 세션 로컬 타이머 기준이라 멤버와 형태가 다르다.
// totalSeconds는 부모(세션 화면)가 타이머 틱마다 다시 계산해 내려줘 초 단위로 오른다.
export interface LiveGridMe {
  nickname: string;
  totalSeconds: number; // 오늘 총 집중 초 (정산 누적 + 진행 세션 미정산 경과)
  tagName: string | null; // 현재 세션 과목
}

// 그리드 렌더 셀 — 타인(member)·나(me)를 한 목록에 섞어 정렬하기 위한 형태(932).
type GridCell =
  | { kind: 'me'; me: LiveGridMe }
  | { kind: 'member'; member: LiveGridMember; color: string };

// 별사탕 아바타 팔레트 (시안 6인 색 그대로 순환)
const AVATAR_COLORS = T.avatarPalette;

export function LiveFocusGrid({
  members,
  me,
  pinnedIds,
  title,
  emptyTitle,
  emptySub,
}: {
  members: LiveGridMember[];
  /** 내 프로필 셀(GROMO-932) — 있으면 시간순 정렬에 나도 포함해 집중 중(초록)으로 렌더 */
  me?: LiveGridMe;
  /** 핀한 유저 ID 집합 — 해당 멤버를 최상단 그룹으로 고정(그룹 안은 시간순) */
  pinnedIds?: ReadonlySet<string>;
  /** 페이지 구분 헤더 (예: '내 리그') — 없으면 생략 */
  title?: string;
  emptyTitle: string;
  emptySub: string;
}) {
  // 배너 인원은 타인 기준 유지 — 나를 세면 혼자일 때 "1명이 같이 집중"이 돼 문구가 어긋난다
  const focusing = members.filter((m) => m.isFocusing).length;

  // 초 단위 틱업 — 그리드 전체가 공용 시계 하나를 공유. 집중중 멤버가 없으면 인터벌 정지.
  const now = useLiveFocusClock(members.some((m) => m.isFocusing && m.focusStartedAt != null));

  // 렌더 순서(932) — 핀 최상단 고정, 핀 그룹 안팎 모두 오늘 총 집중시간(라이브) 내림차순이고
  // 나도 시간순에 포함된다(핀은 시간 무관하게 나보다 위 — 오스카 확정).
  // 아바타 색은 정렬 전 서버 순서 인덱스로 고정 — 재정렬돼도 각자의 색이 안 바뀐다.
  // 라이브 값 정렬이지만 집중중 멤버끼리는 증가 속도가 같아 순서가 고정이고, 멈춘 값
  // (비집중·일시정지된 나)을 넘어서는 순간에만 한 칸씩 자리를 바꾼다.
  const cells: GridCell[] = members.map((m, i) => ({
    kind: 'member',
    member: m,
    color: AVATAR_COLORS[i % AVATAR_COLORS.length],
  }));
  if (me != null) cells.push({ kind: 'me', me });
  const pinRank = (c: GridCell) => (c.kind === 'member' && pinnedIds?.has(c.member.userId) ? 0 : 1);
  const liveSecondsOf = (c: GridCell) =>
    c.kind === 'me'
      ? c.me.totalSeconds
      : liveTotalSeconds(
          c.member.focusTimeMinutes * 60,
          c.member.isFocusing ? c.member.focusStartedAt : null,
          now,
        );
  cells.sort((a, b) => pinRank(a) - pinRank(b) || liveSecondsOf(b) - liveSecondsOf(a));

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
          {cells.map((c) =>
            c.kind === 'me' ? (
              // 내 셀(GROMO-932) — 집중 중 초록. 시간은 부모가 틱마다 계산한 값 그대로
              // (멤버들의 공용 시계 미사용 — 일시정지·뽀모도로 휴식이면 로컬 값이 멈추는 게 맞다).
              // '나' 배지는 리그 포디움과 같은 패턴, 아바타가 overflow hidden이라 형제로 겹쳐 올린다
              <View key="me" style={s.cell}>
                <View>
                  <View style={[s.avatar, s.avatarActive]}>
                    <StarAvatar color={T.night.gold} size={50} />
                  </View>
                  <View style={s.meBadge} pointerEvents="none">
                    <Text style={s.meBadgeText} allowFontScaling={false}>
                      나
                    </Text>
                  </View>
                </View>
                <Text style={s.name} numberOfLines={1}>
                  {c.me.nickname}
                </Text>
                <Text style={s.timeActive}>{hms(c.me.totalSeconds)}</Text>
                <Text style={s.tag} numberOfLines={1}>
                  {c.me.tagName ?? ' '}
                </Text>
              </View>
            ) : (
              <View key={c.member.userId} style={[s.cell, !c.member.isFocusing && s.cellOff]}>
                <View style={[s.avatar, c.member.isFocusing ? s.avatarActive : s.avatarIdle]}>
                  <StarAvatar color={c.color} size={50} />
                </View>
                <Text style={s.name} numberOfLines={1}>
                  {c.member.nickname}
                </Text>
                {c.member.isFocusing ? (
                  <Text style={s.timeActive}>
                    {hms(
                      liveTotalSeconds(
                        c.member.focusTimeMinutes * 60,
                        c.member.focusStartedAt,
                        now,
                      ),
                    )}
                  </Text>
                ) : (
                  <Text style={s.timeIdle}>{hms(c.member.focusTimeMinutes * 60)}</Text>
                )}
                {/* 과목 줄 — 태그 유무와 무관하게 항상 자리를 차지해(없으면 공백) 카드 높이를 통일한다.
                   flexWrap 그리드에서 같은 행 카드가 2줄/3줄로 어긋나는 것 방지 */}
                <Text style={s.tag} numberOfLines={1}>
                  {c.member.isFocusing && c.member.focusTagName != null
                    ? c.member.focusTagName
                    : ' '}
                </Text>
              </View>
            ),
          )}
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
  // 내 아바타 우상단 '나' 배지 — 리그 포디움(podiumMeBadge)과 동일 톤
  meBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: T.accent,
    borderRadius: 9,
    paddingHorizontal: T.space.sm,
    paddingVertical: 1,
    borderWidth: 1.5,
    borderColor: T.white,
    zIndex: 2,
  },
  meBadgeText: { fontSize: 11, fontWeight: '800', color: T.white },
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
