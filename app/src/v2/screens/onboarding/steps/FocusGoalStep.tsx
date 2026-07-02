import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import CircularGauge from '@/v2/screens/onboarding/components/CircularGauge';
import Slider from '@/v2/screens/onboarding/components/Slider';
import { T } from '@/v2/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';
import { formatDuration } from '@/v2/screens/onboarding/format';

// 17 · 하루 목표 집중시간 — dailyFocusMinutes(30~600분, 기본 240=4시간). 서버 계약 미정(신규 필드).
const MIN = 30;
const MAX = 600;
const STEP = 10;
const DEFAULT = 240;
const PEER_AVG = '3.2시간'; // 시안 샘플. TODO: 실제 또래 평균 연동.

const round1 = (n: number) => Math.round(n * 10) / 10;

export default function FocusGoalStep({ data, update, onNext, onBack }: StepProps) {
  const value = data.dailyFocusMinutes ?? DEFAULT;
  const weekly = round1((value / 60) * 7);
  const progress = (value - MIN) / (MAX - MIN);

  return (
    <StepScaffold
      title="하루 목표 집중시간"
      subtitle="많이 채울수록 좋아요. 무리하지 않을 만큼만."
      ctaLabel="이 목표로 시작"
      onCta={() => {
        update({ dailyFocusMinutes: value });
        onNext();
      }}
      onBack={onBack}
    >
      <View style={s.center}>
        <CircularGauge
          size={200}
          progress={progress}
          trackColor={T.paperAlt}
          progressColor={T.accent}
        >
          <Text style={s.gaugeCap}>하루 목표</Text>
          <Text style={s.gaugeVal}>{formatDuration(value)}</Text>
        </CircularGauge>

        <View style={s.sliderArea}>
          <Slider
            min={MIN}
            max={MAX}
            step={STEP}
            value={value}
            onChange={(m) => update({ dailyFocusMinutes: m })}
          />
          <View style={s.sliderLabels}>
            <Text style={s.minor}>30분</Text>
            <Text style={s.minor}>10시간</Text>
          </View>
        </View>

        <View style={s.cards}>
          <View style={[s.card, s.cardGreen]}>
            <Text style={s.cardCap}>이번 주 목표</Text>
            <Text style={[s.cardVal, { color: T.green }]}>{weekly}시간</Text>
          </View>
          <View style={[s.card, s.cardSand]}>
            <Text style={s.cardCap}>또래 평균</Text>
            <Text style={[s.cardVal, { color: T.accent }]}>{PEER_AVG}</Text>
          </View>
        </View>
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center' },
  gaugeCap: { ...T.text.caption, color: T.accentDeep },
  gaugeVal: { ...T.text.display, color: T.ink, lineHeight: 36 },
  sliderArea: { alignSelf: 'stretch', marginTop: 18, marginBottom: 18 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
  minor: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  cards: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  card: { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 12, alignItems: 'center' },
  cardGreen: { backgroundColor: T.successBg, borderColor: T.successBorder },
  cardSand: { backgroundColor: T.noteBg, borderColor: T.noteBorder },
  cardCap: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  cardVal: { ...T.text.subtitle, fontWeight: '800', marginTop: 2 },
});
