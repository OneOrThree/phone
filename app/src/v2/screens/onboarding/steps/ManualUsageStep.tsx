import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import Slider from '@/v2/screens/onboarding/components/Slider';
import InfoNote, { NoteStrong } from '@/v2/screens/onboarding/components/InfoNote';
import { T } from '@/v2/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';
import { formatDuration } from '@/v2/screens/onboarding/format';

// 09b · 권한 거부 → 어제 사용시간 직접 입력. 결과(manualYesterdayMinutes)는 12의 기준값이 됨.
const MIN = 0;
const MAX = 720; // 12시간
const STEP = 10;
const DEFAULT = 300;

export default function ManualUsageStep({ data, update, onNext, onBack }: StepProps) {
  const value = data.manualYesterdayMinutes ?? DEFAULT;
  return (
    <StepScaffold
      title={'어제 핸드폰\n얼마나 썼나요?'}
      subtitle={'권한 없이도 시작할 수 있어요.\n대략적인 시간을 직접 알려주세요.'}
      ctaLabel="이 시간으로 시작"
      onCta={() => {
        update({ manualYesterdayMinutes: value });
        onNext();
      }}
      onBack={onBack}
    >
      <View style={s.center}>
        <Text style={s.big}>{formatDuration(value)}</Text>
        <Text style={s.cap}>어제 하루 동안</Text>

        <View style={s.sliderArea}>
          <Slider
            min={MIN}
            max={MAX}
            step={STEP}
            value={value}
            onChange={(m) => update({ manualYesterdayMinutes: m })}
          />
          <View style={s.labels}>
            <Text style={s.minor}>0시간</Text>
            <Text style={s.minor}>12시간+</Text>
          </View>
        </View>

        <InfoNote>
          나중에 <NoteStrong>설정 › 스크린 타임 권한</NoteStrong>을 켜면 자동으로 정확히 기록돼요.
        </InfoNote>
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', paddingTop: 8 },
  big: { ...T.text.timer, color: T.ink },
  cap: { ...T.text.caption, fontWeight: '600', color: T.inkMuted, marginTop: 6 },
  sliderArea: { alignSelf: 'stretch', marginTop: 24, marginBottom: 16 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
  minor: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
});
