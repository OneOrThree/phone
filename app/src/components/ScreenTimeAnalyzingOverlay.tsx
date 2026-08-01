import { useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { T } from '@/constants/theme';

// 분석 연출 타이밍 — 기본 2초에 90%까지 리니어하게 찬 뒤, 마지막에 잠깐 멈춰 100%로.
// 네이티브 리포트(DeviceActivityReport 익스텐션)가 그려질 시간을 벌어주는 가드 성격이다.
// 익스텐션 내부 렌더라 로드 완료 신호가 JS로 오지 않아 진행바는 시간 기반이다.
// 레이어를 실제로 걷는 시점은 화면마다 다르다 — 온보딩은 ANALYZE_MS 타이머로 CTA를
// 노출하고, 홈 상세는 리포트가 다 그려지면 그 불투명 배경이 이 레이어를 덮는다.
const FILL_MS = 2000; // 0 → 90%
const HOLD_MS = 900; // 90%에서 멈춤(가드 타임)
const FINISH_MS = 300; // 90% → 100%
export const ANALYZE_MS = FILL_MS + HOLD_MS + FINISH_MS;

// 문구는 해요체·이모지 금지(캐릭터 보이스 규칙). 어제(온보딩)·오늘(홈 상세) 모두에 맞게
// 날짜를 특정하지 않는다.
const DEFAULT_MESSAGE = '그로모가 사용자님의\n사용시간을 분석하고 있어요!';

type Props = {
  // 분석 문구 오버라이드(기본: DEFAULT_MESSAGE).
  message?: string;
};

// 캐릭터 + "분석하고 있어요" 문구 + 진행바 로딩 연출(absoluteFill 레이어).
// 온보딩 '어제 스크린타임'(YesterdayScreenTimeStep)과 홈 '핸드폰 사용' 상세(UsageDetailScreen)
// 에서 공용으로 쓴다. 이 컴포넌트는 연출만 담당하고, 레이어를 걷는 시점은 각 화면이 정한다.
export default function ScreenTimeAnalyzingOverlay({ message = DEFAULT_MESSAGE }: Props) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withSequence(
      withTiming(0.9, { duration: FILL_MS, easing: Easing.linear }),
      withDelay(HOLD_MS, withTiming(1, { duration: FINISH_MS, easing: Easing.out(Easing.cubic) })),
    );
  }, [progress]);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View style={s.layer}>
      <Text style={s.message}>{message}</Text>
      <Image
        source={require('@/assets/character_study.png')}
        style={s.character}
        resizeMode="contain"
      />
      <View style={s.progressTrack}>
        <Animated.View style={[s.progressFill, fill]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.xl,
    backgroundColor: T.paper,
  },
  message: { ...T.text.heading, color: T.ink, textAlign: 'center', lineHeight: 28 },
  character: { width: 170, height: 200 },
  // 왼쪽→오른쪽으로 차오르는 분석 진행바.
  progressTrack: {
    alignSelf: 'stretch',
    marginHorizontal: T.space.xxl,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.caramel,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: T.accent },
});
