import { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { getDefaultSubjects } from '@/constants/focusCategories';
import { T } from '@/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W6 · 실시간 랭킹 — "같은 목표 준비생이 지금 함께 달리고 있어요"(설득).
// 리스트는 사용자가 만지지 않아도 크레딧처럼 계속 위로 흐른다(무한 루프, 목업 데이터).
// TODO: 로그인/리그 연동 후 실데이터. 현재는 온보딩 설득용 샘플.
const ROWS = [
  { name: '민지노트', time: '04:12:38', focusing: true },
  { name: '현생사는중', time: '03:58:02', focusing: true },
  { name: '준비된자', time: '03:41:19', focusing: true },
  { name: '합격기원', time: '03:20:55', focusing: false },
  { name: '열공모드', time: '03:02:11', focusing: true },
  { name: '서연', time: '02:31:47', focusing: true },
  { name: '스터디윗미', time: '02:18:09', focusing: true },
  { name: '긍정왕', time: '02:04:33', focusing: false },
  { name: '노트필기왕', time: '01:52:20', focusing: true },
  { name: '카페인러버', time: '01:39:58', focusing: true },
  { name: '새벽형인간', time: '01:27:11', focusing: false },
  { name: '조용한불꽃', time: '01:15:40', focusing: true },
];
const MARQUEE_HEIGHT = 400;
const SPEED = 34; // px/초

function Row({
  name,
  subject,
  time,
  focusing,
}: {
  name: string;
  subject: string;
  time: string;
  focusing: boolean;
}) {
  return (
    <View style={s.row}>
      <View style={s.avatarWrap}>
        <View style={s.avatar}>
          <CharacterImage size={34} />
        </View>
        <View style={[s.online, focusing ? null : s.offline]} />
      </View>
      <View style={s.rowMain}>
        <Text style={s.name}>{name}</Text>
        <Text style={s.subject}>{subject}</Text>
      </View>
      <View style={s.rowRight}>
        <Text style={[s.time, focusing ? null : s.timeIdle]}>{time}</Text>
        <View style={s.focusing}>
          <View style={[s.focusDot, focusing ? null : s.focusDotIdle]} />
          <Text style={[s.focusText, focusing ? null : s.focusTextIdle]}>
            {focusing ? '집중 중' : '쉬는 중'}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function LiveRankingStep({ data, onNext, onBack }: StepProps) {
  const category = data.focusCategory ?? '같은 목표';
  const subs = getDefaultSubjects(data.focusCategory);
  const subjectFor = (i: number) => (subs.length ? subs[i % subs.length] : category);

  // 크레딧 자동 스크롤 — 리스트 1벌 높이(copyHeight)만큼 위로 이동 후 리셋(2벌이라 이음새 없음).
  const scrollY = useRef(new Animated.Value(0)).current;
  const [copyHeight, setCopyHeight] = useState(0);

  useEffect(() => {
    if (copyHeight <= 0) return;
    scrollY.setValue(0);
    const anim = Animated.loop(
      Animated.timing(scrollY, {
        toValue: -copyHeight,
        duration: (copyHeight / SPEED) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [copyHeight, scrollY]);

  const list = (prefix: string, onLayout?: (h: number) => void) => (
    <View onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.height) : undefined}>
      {ROWS.map((r, i) => (
        <Row
          key={`${prefix}-${i}`}
          name={r.name}
          subject={subjectFor(i)}
          time={r.time}
          focusing={r.focusing}
        />
      ))}
    </View>
  );

  return (
    <StepScaffold
      header={
        <View style={s.badge}>
          <View style={s.badgeDot} />
          <Text style={s.badgeText}>
            지금 <Text style={s.badgeStrong}>1,240</Text>명 집중 중
          </Text>
        </View>
      }
      title={`${category} 준비생들이\n지금 함께 달리고 있어요`}
      subtitle="실시간 집중 랭킹 · 매초 갱신"
      ctaLabel="나도 지금 합류하기"
      onCta={onNext}
      onBack={onBack}
    >
      <View style={s.marquee} pointerEvents="none">
        <Animated.View style={{ transform: [{ translateY: scrollY }] }}>
          {list('a', setCopyHeight)}
          {list('b')}
        </Animated.View>
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: T.greenBg,
    borderWidth: 1,
    borderColor: T.successBorder,
    borderRadius: 99,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  badgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: T.green },
  badgeText: { ...T.text.caption, fontWeight: '700', fontSize: 11, color: T.successInk },
  badgeStrong: { fontWeight: '800' },
  marquee: { alignSelf: 'stretch', height: MARQUEE_HEIGHT, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.chipBorder,
    borderRadius: 15,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 8, // gap 대신 margin — 2벌 이음새를 균일하게(무한 루프)
  },
  avatarWrap: { width: 38, height: 38 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: T.sand,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  online: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: T.green,
    borderWidth: 2,
    borderColor: T.white,
  },
  rowMain: { flex: 1, minWidth: 0 },
  name: { ...T.text.caption, fontWeight: '700', color: T.ink },
  subject: { fontSize: 10, fontWeight: '500', color: T.inkMuted, marginTop: 1 },
  rowRight: { alignItems: 'flex-end' },
  time: { ...T.text.caption, fontWeight: '800', color: T.ink, fontVariant: ['tabular-nums'] },
  focusing: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  focusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: T.green },
  focusText: { fontSize: 8, fontWeight: '600', color: T.successInk },
  // 집중 안 하는(쉬는) 사람 — 회색 처리
  offline: { backgroundColor: T.inkMuted },
  timeIdle: { color: T.inkMuted },
  focusDotIdle: { backgroundColor: T.inkMuted },
  focusTextIdle: { color: T.inkMuted },
});
