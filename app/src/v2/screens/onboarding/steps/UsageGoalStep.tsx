import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import CircularGauge from '@/v2/components/CircularGauge';
import Slider from '@/v2/screens/onboarding/components/Slider';
import { T } from '@/v2/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';
import { formatDuration } from '@/v2/screens/onboarding/format';

// 12 · 하루 목표 사용시간 — usageGoalMinutes(60~600분). 서버: dailyScreenTimeGoalMinutes 로 매핑.
// '되찾는 시간'은 시안 샘플 기준(어제 8h12m=492분 → 9.4년)으로 환산. TODO: 실제 사용량 데이터 연동.
const MIN = 60;
const MAX = 600;
const STEP = 10;
const DEFAULT = 240;
// 시안 앵커: 492분/일 사용 → 남은 인생에서 폰에 9.4년. 이 비율로 환산.
const REF_MIN = 492;
const REF_YEARS = 9.4;
const RATE = REF_YEARS / REF_MIN; // 년 per (분/일)

const round1 = (n: number) => Math.round(n * 10) / 10;

export default function UsageGoalStep({ data, update, onNext, onBack }: StepProps) {
  const value = data.usageGoalMinutes ?? DEFAULT;
  // 기준(어제 사용): 09b 수동 입력값 있으면 사용, 없으면 시안 기본(492분). TODO: 권한 허용 시 실제 스크린타임 연동.
  const baselineMin = data.manualYesterdayMinutes ?? REF_MIN;
  const baselineYears = round1(baselineMin * RATE);
  const goalYears = round1(value * RATE);
  const reclaimed = round1(Math.max(0, baselineYears - goalYears));
  const progress = baselineYears > 0 ? reclaimed / baselineYears : 0;

  return (
    <StepScaffold
      title="하루 목표 사용시간"
      subtitle="줄일수록 인생에서 되찾는 시간이 커져요."
      ctaLabel="이 목표로 시작"
      onCta={() => {
        update({ usageGoalMinutes: value });
        onNext();
      }}
      onBack={onBack}
    >
      <View style={s.center}>
        <CircularGauge
          size={188}
          progress={progress}
          trackColor={T.paperAlt}
          progressColor={T.green}
        >
          <Text style={s.gaugeCap}>되찾는 시간</Text>
          <Text style={s.gaugeVal}>
            +{reclaimed}
            <Text style={s.gaugeUnit}>년</Text>
          </Text>
        </CircularGauge>

        <Text style={s.goal}>{formatDuration(value)}</Text>

        <View style={s.sliderArea}>
          <Slider
            min={MIN}
            max={MAX}
            step={STEP}
            value={value}
            onChange={(m) => update({ usageGoalMinutes: m })}
          />
          <View style={s.sliderLabels}>
            <Text style={s.minor}>1시간</Text>
            <Text style={s.minor}>10시간</Text>
          </View>
        </View>

        <View style={s.cards}>
          <View style={[s.card, s.cardRed]}>
            <Text style={s.cardCap}>지금이라면</Text>
            <Text style={[s.cardVal, { color: T.accentAlt }]}>{baselineYears}년</Text>
          </View>
          <Text style={s.arrow}>→</Text>
          <View style={[s.card, s.cardGreen]}>
            <Text style={s.cardCap}>목표대로면</Text>
            <Text style={[s.cardVal, { color: T.green }]}>{goalYears}년</Text>
          </View>
        </View>
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center' },
  gaugeCap: { ...T.text.caption, color: T.successInk },
  gaugeVal: { ...T.text.display, color: T.ink, lineHeight: 36 },
  gaugeUnit: { ...T.text.body, fontWeight: '700', color: T.successInk },
  goal: { ...T.text.display, color: T.ink, marginTop: 12 },
  sliderArea: { alignSelf: 'stretch', marginTop: 16, marginBottom: 18 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
  minor: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  cards: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  card: { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 12, alignItems: 'center' },
  cardRed: { backgroundColor: T.dangerBg, borderColor: T.dangerBorder },
  cardGreen: { backgroundColor: T.successBg, borderColor: T.successBorder },
  cardCap: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  cardVal: { ...T.text.subtitle, fontWeight: '800', marginTop: 2 },
  arrow: { ...T.text.body, color: T.inkMuted },
});
