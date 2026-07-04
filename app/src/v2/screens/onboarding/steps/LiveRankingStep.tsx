import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { getDefaultSubjects } from '@/constants/focusCategories';
import { T } from '@/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W6 · 실시간 랭킹 — "같은 목표 준비생이 지금 함께 달리고 있어요"(설득). 목업 랭킹.
// TODO: 로그인/리그 연동 후 실데이터. 현재는 온보딩 설득용 샘플.
const ROWS = [
  { name: '민지노트', time: '04:12:38' },
  { name: '현생사는중', time: '03:58:02' },
  { name: '준비된자', time: '03:41:19' },
  { name: '합격기원', time: '03:20:55' },
  { name: '열공모드', time: '03:02:11' },
  { name: '나', time: '02:48:30', me: true },
  { name: '서연', time: '02:31:47' },
];

export default function LiveRankingStep({ data, onNext, onBack }: StepProps) {
  const category = data.focusCategory ?? '같은 목표';
  const subs = getDefaultSubjects(data.focusCategory);
  const subjectFor = (i: number) => (subs.length ? subs[i % subs.length] : category);

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
      <View style={s.list}>
        {ROWS.map((r, i) => (
          <View key={r.name} style={[s.row, r.me ? s.rowMe : null]}>
            <Text style={[s.rank, i < 3 ? s.rankTop : null]}>{i + 1}</Text>
            <View style={s.avatarWrap}>
              <View style={s.avatar}>
                <CharacterImage size={34} />
              </View>
              <View style={s.online} />
            </View>
            <View style={s.rowMain}>
              <Text style={s.name}>
                {r.name}
                {r.me ? <Text style={s.meTag}> 나</Text> : null}
              </Text>
              <Text style={s.subject}>{subjectFor(i)}</Text>
            </View>
            <View style={s.rowRight}>
              <Text style={s.time}>{r.time}</Text>
              <View style={s.focusing}>
                <View style={s.focusDot} />
                <Text style={s.focusText}>집중 중</Text>
              </View>
            </View>
          </View>
        ))}
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
  list: { alignSelf: 'stretch', gap: 8 },
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
  },
  rowMe: { backgroundColor: T.successBg, borderWidth: 2, borderColor: T.successInk },
  rank: { width: 18, textAlign: 'center', ...T.text.label, fontWeight: '800', color: T.inkMuted },
  rankTop: { color: T.accent },
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
  meTag: { fontSize: 9, fontWeight: '600', color: T.successInk },
  subject: { fontSize: 10, fontWeight: '500', color: T.inkMuted, marginTop: 1 },
  rowRight: { alignItems: 'flex-end' },
  time: { ...T.text.caption, fontWeight: '800', color: T.ink, fontVariant: ['tabular-nums'] },
  focusing: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  focusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: T.green },
  focusText: { fontSize: 8, fontWeight: '600', color: T.successInk },
});
