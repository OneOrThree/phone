import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { T } from '@/constants/theme';
import { formatDuration } from '@/v2/screens/onboarding/format';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W11 · 전날 스크린타임 — 실제 사용시간(권한 허용 시)과 추측(W9)을 대비시킨다.
// 네이티브는 총량(getTotalScreenTime)만 제공 — 카테고리 분해는 총량 비례 합성값.
// TODO: 어제 단위·카테고리별 실데이터가 네이티브에 생기면 교체. 권한 거부 유저는 컨트롤러가 스킵.
const SAMPLE_TOTAL_MIN = 492; // 시안 기준 8시간 12분
const BREAKDOWN: { label: string; ratio: number; color: string }[] = [
  { label: 'SNS', ratio: 0.37, color: T.accent },
  { label: '영상', ratio: 0.33, color: T.accentDeep },
  { label: '메신저', ratio: 0.16, color: T.link },
  { label: '기타', ratio: 0.14, color: T.borderDark },
];

export default function YesterdayScreenTimeStep({ data, onNext, onBack }: StepProps) {
  const [totalMin, setTotalMin] = useState<number>(
    data.guessedYesterdayMinutes ?? SAMPLE_TOTAL_MIN,
  );

  useEffect(() => {
    let alive = true;
    ScreenTimeModule.getTotalScreenTime()
      .then((sec) => {
        const min = Math.round(sec / 60);
        if (alive && min > 0) setTotalMin(min);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const maxRatio = Math.max(...BREAKDOWN.map((b) => b.ratio));

  return (
    <StepScaffold
      title="어제의 화면 시간 · Yesterday"
      subtitle="추측과 얼마나 달랐나요? 조금씩 줄여봐요."
      ctaLabel="다음"
      onCta={onNext}
      onBack={onBack}
    >
      <View style={s.headline}>
        <Text style={s.big}>{h}시간</Text>
        {m > 0 ? <Text style={s.bigUnit}> {m}분</Text> : null}
      </View>

      <View style={s.list}>
        {BREAKDOWN.map((b) => {
          const catMin = Math.round(totalMin * b.ratio);
          return (
            <View key={b.label}>
              <View style={s.rowTop}>
                <Text style={s.rowLabel}>{b.label}</Text>
                <Text style={s.rowVal}>{formatDuration(catMin)}</Text>
              </View>
              <View style={s.track}>
                <View
                  style={[
                    s.fill,
                    { width: `${(b.ratio / maxRatio) * 100}%`, backgroundColor: b.color },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  headline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    alignSelf: 'flex-start',
    marginBottom: 22,
  },
  big: { fontSize: 50, fontWeight: '800', letterSpacing: -2, color: T.ink },
  bigUnit: { fontSize: 28, fontWeight: '800', color: T.accent },
  list: { alignSelf: 'stretch', gap: 18 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  rowLabel: { ...T.text.label, fontWeight: '600', color: T.ink },
  rowVal: { ...T.text.label, fontWeight: '700', color: T.link },
  track: { height: 9, borderRadius: 5, backgroundColor: T.caramel, overflow: 'hidden' },
  fill: { height: 9, borderRadius: 5 },
});
