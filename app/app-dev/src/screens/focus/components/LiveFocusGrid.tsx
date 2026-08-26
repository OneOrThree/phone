import { memo } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { T, withAlpha } from '@/constants/theme';
import { useLiveFocusClock } from '@/hooks/useLiveFocusClock';
import { liveTotalSeconds } from '@/utils/liveFocus';
import { hms } from '../format';
import { StarAvatar } from './StarAvatar';

// 집중 세션 소셜 그리드 공통 컴포넌트 — 친구(656)·리그(811)·같은 시험(812) 페이지가 공유.
// 전원 오늘 총 집중시간을 hh:mm:ss로 표기하고(GROMO-929, 비집중은 분 원본이라 초 :00 고정),
// 집중중(isFocusing)은 초록 테두리·과목·초 단위 라이브로 구분.
// 내 프로필 셀(GROMO-932)은 me prop으로 렌더 — "나도 이 판에 있다" 감각.
// 순서는 핀(pinnedIds) → 집중중 → 시간순, 나(me)도 같은 규칙에 섞인다 — 아래 cells 주석.
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
  isFocusing: boolean; // 로컬 타이머 진행 여부 — 일시정지·뽀모도로 휴식이면 false(비집중 표시)
  totalSeconds: number; // 오늘 총 집중 초 (정산 누적 + 진행 세션 미정산 경과)
  tagName: string | null; // 현재 세션 과목
}

// 그리드 렌더 셀 — 타인(member)·나(me)를 한 목록에 섞어 정렬하기 위한 형태(932).
// 표시에 필요한 값을 **전부 원시값으로 미리 계산**해 담는다: 이래야 셀(Cell)이 공용 시계(now)를
// 몰라도 되고, memo 얕은 비교가 실제로 먹어서 매초 틱에 '집중중 셀만' 다시 그려진다.
interface GridCell {
  id: string;
  isMe: boolean;
  nickname: string;
  color: string;
  isFocusing: boolean;
  tagName: string | null; // 비집중이면 null (과목 줄은 공백으로 자리만 유지)
  seconds: number; // 오늘 총 집중초(라이브 반영분 포함)
  pinned: boolean;
}

// 별사탕 아바타 팔레트 (시안 6인 색 그대로 순환)
const AVATAR_COLORS = T.avatarPalette;

// 셀 하나 — memo로 감싼다. props가 전부 원시값이라 값이 그대로면 재렌더를 건너뛴다.
// 상한 없이 top-100을 그리는 지금은 이게 매초 틱의 비용을 '집중중 인원'만큼으로 묶어 준다.
const Cell = memo(function Cell({
  isMe,
  nickname,
  color,
  isFocusing,
  tagName,
  seconds,
}: Omit<GridCell, 'id' | 'pinned'>) {
  return (
    <View style={[s.cell, !isFocusing && s.cellOff]}>
      {/* '나' 배지는 리그 포디움과 같은 패턴 — 아바타가 overflow hidden이라 형제로 겹쳐 올린다 */}
      <View>
        <View style={[s.avatar, isFocusing ? s.avatarActive : s.avatarIdle]}>
          <StarAvatar color={color} size={50} />
        </View>
        {isMe && (
          <View style={s.meBadge} pointerEvents="none">
            <Text style={s.meBadgeText} allowFontScaling={false}>
              나
            </Text>
          </View>
        )}
      </View>
      <Text testID="live.grid.name" style={s.name} numberOfLines={1}>
        {nickname}
      </Text>
      <Text style={isFocusing ? s.timeActive : s.timeIdle}>{hms(seconds)}</Text>
      {/* 과목 줄 — 태그 유무와 무관하게 항상 자리를 차지해(없으면 공백) 카드 높이를 통일한다.
          같은 행 카드가 2줄/3줄로 어긋나는 것 방지 */}
      <Text style={s.tag} numberOfLines={1}>
        {tagName ?? ' '}
      </Text>
    </View>
  );
});

export function LiveFocusGrid({
  members,
  me,
  pinnedIds,
  title,
  emptyTitle,
  emptySub,
  showMeWhenEmpty = false,
  visible = true,
}: {
  members: LiveGridMember[];
  /** 내 프로필 셀(GROMO-932) — 있으면 정렬에 나도 포함해 집중 중(초록)으로 렌더 */
  me?: LiveGridMe;
  /** 핀한 유저 ID 집합 — 해당 멤버를 최상단 그룹으로 고정(그룹 안은 집중중 → 시간순) */
  pinnedIds?: ReadonlySet<string>;
  /** 페이지 구분 헤더 (예: '내 리그') — 없으면 생략 */
  title?: string;
  emptyTitle: string;
  emptySub: string;
  /** 타인이 0명이어도 me가 있으면 빈 상태 대신 내 셀만 그린다(1인 그룹 페이지용 — 코덱스 리뷰) */
  showMeWhenEmpty?: boolean;
  /**
   * 이 그리드가 지금 보이는 페이지인가. 가로 페이저는 모든 페이지를 마운트한 채 두므로,
   * 안 넘기면 보이지도 않는 그리드의 1초 시계가 몇 시간짜리 세션 내내 돈다(캐릭터의
   * AnimatedCharacter active와 같은 부류). 서버 폴링은 이와 무관하게 계속 돌아야 한다.
   */
  visible?: boolean;
}) {
  // 배너 인원은 타인 기준 유지 — 나를 세면 혼자일 때 "1명이 같이 집중"이 돼 문구가 어긋난다.
  // members를 자르지 않고 전부 받으므로(상한 제거) 이 수는 리그 top-100 전체 기준이다.
  const focusing = members.filter((m) => m.isFocusing).length;

  // 초 단위 틱업 — 그리드 전체가 공용 시계 하나를 공유. 집중중 멤버가 없거나 페이지가
  // 안 보이면 인터벌 정지. 표시 시간은 '시작시각 → now' 계산식이라 시계를 멈춰도 값이
  // 밀리지 않는다 — 다시 보일 때 useLiveFocusClock이 즉시 now를 현재로 올린다.
  const now = useLiveFocusClock(
    visible && members.some((m) => m.isFocusing && m.focusStartedAt != null),
  );

  // 렌더 순서(932) — 핀 → 집중중 → 오늘 총 집중시간(라이브) 내림차순. 나(me)도 같은 규칙에
  // 섞인다(핀은 시간 무관하게 나보다 위 — 오스카 확정).
  // 집중중을 시간보다 위 키로 두는 이유: 이 그리드의 목적이 "지금 같이 집중 중"이라 오늘
  // 많이 한 비집중자가 위를 차지하면 화면이 회색으로 덮인다. 대신 폴링(60초)으로 누가
  // 집중을 끝내면 그 셀이 비집중 구간으로 한 번에 내려간다 — 초 단위 요동은 아니다.
  // 아바타 색은 정렬 전 서버 순서 인덱스로 고정 — 재정렬돼도 각자의 색이 안 바뀐다.
  const cells: GridCell[] = members.map((m, i) => ({
    id: m.userId,
    isMe: false,
    nickname: m.nickname,
    color: AVATAR_COLORS[i % AVATAR_COLORS.length],
    isFocusing: m.isFocusing,
    tagName: m.isFocusing ? m.focusTagName : null,
    seconds: liveTotalSeconds(m.focusTimeMinutes * 60, m.isFocusing ? m.focusStartedAt : null, now),
    pinned: pinnedIds?.has(m.userId) ?? false,
  }));
  if (me != null) {
    // 내 셀은 공용 시계를 안 쓴다 — 부모가 틱마다 계산해 내려준 값 그대로(일시정지·뽀모도로
    // 휴식이면 로컬 값이 멈추는 게 맞다). 집중 표시도 로컬 상태를 따른다(코덱스 리뷰).
    cells.push({
      id: 'me',
      isMe: true,
      nickname: me.nickname,
      color: T.night.gold,
      isFocusing: me.isFocusing,
      tagName: me.isFocusing ? me.tagName : null,
      seconds: me.totalSeconds,
      pinned: false,
    });
  }
  cells.sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      Number(b.isFocusing) - Number(a.isFocusing) ||
      b.seconds - a.seconds,
  );

  if (members.length === 0 && !(showMeWhenEmpty && me != null)) {
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

      {/* 인원이 화면을 넘으면 세로 스크롤(GROMO-848) — 가로 페이저와 축이 달라 충돌 없음.
          FlatList는 화면 밖 셀을 만들지 않는다 — 리그 상한을 없애 top-100을 다 그리게 되면서
          종전 ScrollView + map(전량 마운트)로는 감당이 안 돼 가상화로 바꿨다. */}
      <FlatList
        style={s.flex1}
        data={cells}
        numColumns={3}
        keyExtractor={(c) => c.id}
        columnWrapperStyle={s.row}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <Cell
            isMe={item.isMe}
            nickname={item.nickname}
            color={item.color}
            isFocusing={item.isFocusing}
            tagName={item.tagName}
            seconds={item.seconds}
          />
        )}
      />
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
  // FlatList numColumns={3}의 행 래퍼 — 종전 flexWrap 그리드와 같은 그림(마지막 줄 좌측 정렬).
  row: { justifyContent: 'flex-start' },
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
