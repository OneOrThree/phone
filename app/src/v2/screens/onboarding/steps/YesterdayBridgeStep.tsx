import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { T } from '@/v2/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// 08 · 어제 사용 환기 (브릿지) — 입력 없음. 어두운 폰 일러스트로 '어제 얼마나 썼나' 환기 후 다음.
// 시안: 글로우 + 어두운 폰(노치·시계·"?시간"). 폰은 View+그라데이션, 시계는 svg. (일러스트 로컬 색)

function ClockIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24">
      <Circle cx={12} cy={13} r={8.5} fill="none" stroke="#C8A36A" strokeWidth={1.7} />
      <Path
        d="M12 9v4l2.5 1.5"
        stroke="#C8A36A"
        strokeWidth={1.7}
        fill="none"
        strokeLinecap="round"
      />
      <Path d="M9 2h6" stroke="#C8A36A" strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

function PhoneGlyph() {
  return (
    <View style={s.glyph}>
      <View style={s.glow} />
      <LinearGradient
        colors={['#2E231B', '#1A130D']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={s.phone}
      >
        <View style={s.notch} />
        <View style={s.screen}>
          <ClockIcon />
          <Text style={s.qtime}>?시간</Text>
        </View>
      </LinearGradient>
    </View>
  );
}

export default function YesterdayBridgeStep({ onNext, onBack }: StepProps) {
  return (
    <StepScaffold
      center
      header={<PhoneGlyph />}
      title={'잠깐,\n어제 핸드폰을\n얼마나 썼나요?'}
      subtitle={'생각보다 많을지도 몰라요.\n지금 바로 확인해볼게요.'}
      ctaLabel="어제 사용 시간 보기"
      onCta={onNext}
      onBack={onBack}
    />
  );
}

// 일러스트 로컬 색(테마 토큰 아님) — 어두운 폰 표현용.
const s = StyleSheet.create({
  glyph: { width: 150, height: 200, alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    width: 156,
    height: 156,
    borderRadius: 78,
    backgroundColor: 'rgba(232,200,140,0.20)',
  },
  phone: {
    width: 96,
    height: 182,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#4A3829',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notch: {
    position: 'absolute',
    top: 9,
    width: 30,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#0A0705',
  },
  screen: {
    position: 'absolute',
    top: 14,
    left: 10,
    right: 10,
    bottom: 14,
    borderRadius: 14,
    backgroundColor: '#241A12',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  qtime: { ...T.text.body, fontWeight: '800', color: '#E6D3B4' },
});
