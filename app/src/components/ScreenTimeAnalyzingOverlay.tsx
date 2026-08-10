import { useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { M } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { T } from '@/constants/theme';

// 분석 연출 타이밍 — 기본 2초에 90%까지 리니어하게 찬 뒤, 마지막에 잠깐 멈춰 100%로.
// 네이티브 리포트(DeviceActivityReport 익스텐션)가 그려질 시간을 벌어주는 가드 성격이다.
// 익스텐션 내부 렌더라 로드 완료 신호가 JS로 오지 않아 진행바는 시간 기반이다.
// 레이어를 실제로 걷는 시점은 화면마다 다르다 — 온보딩은 ANALYZE_MS 타이머로 CTA를
// 노출하고, 홈 상세는 리포트가 다 그려지면 그 불투명 배경이 이 레이어를 덮는다.
//
// ⚠️ 아래 3개는 **모션 토큰(M.dur)으로 승격하지 않는다** (GROMO-1381 컨트랙트 §4).
//    연출 시간이 아니라 네이티브 리포트 렌더를 기다리는 **가드 타임**이다. 모션 톤을 조정하려고
//    M.dur을 손대는 날, 이 값까지 같이 움직이면 리포트가 다 그려지기 전에 레이어가 걷혀
//    빈 화면이 노출된다. 톤과 무관한 값이므로 로컬 상수로 남긴다.
// ⚠️ 같은 이유로 '동작 줄이기'에서도 **가드 타임 자체는 그대로 흐른다.** 없앨 수 있는 건
//    진행바의 시각 효과뿐이다(ANALYZE_MS를 소비하는 호출부 타이머는 건드리지 않는다).
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
  // 리포트가 위를 덮은 뒤 true — 접근성 트리에서 숨겨 스크린리더가 완료된 리포트 위에서
  // "분석 중"을 계속 읽지 않게 한다. 시각 레이어(뒤에 깔린 캐릭터)는 그대로 둔다.
  // (레이어를 언마운트하지 않고 홈 상세에서 리포트가 늦게 떠도 빈 화면이 안 보이게 하기 위함.)
  covered?: boolean;
};

// 캐릭터 + "분석하고 있어요" 문구 + 진행바 로딩 연출(absoluteFill 레이어).
// 온보딩 '어제 스크린타임'(YesterdayScreenTimeStep)과 홈 '핸드폰 사용' 상세(UsageDetailScreen)
// 에서 공용으로 쓴다. 이 컴포넌트는 연출만 담당하고, 레이어를 걷는 시점은 각 화면이 정한다.
export default function ScreenTimeAnalyzingOverlay({
  message = DEFAULT_MESSAGE,
  covered = false,
}: Props) {
  const progress = useSharedValue(0);
  const m = useMotion();
  // 마운트 시각 — 호출부의 ANALYZE_MS 타이머가 시작된 시점이기도 하다.
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    // ⚠️ **확정 전에는 아무것도 하지 않는다.** 미확정 구간의 보수적 true로 즉시 100%를 만들면,
    //    확정된 뒤 시퀀스를 처음부터 다시 돌리게 되어 호출부의 ANALYZE_MS 타이머와 시작점이
    //    어긋난다 — 오버레이가 걷힐 때 진행바가 아직 90% 대기 구간에 있어 마지막 연출이
    //    보이지 않고, 확정 전 보이던 100%가 0%로 순간 이동하기도 한다(codex 리뷰).
    //    확정될 때까지는 시작 프레임(0%)에서 기다린다.
    if (!m.ready) return;
    // '동작 줄이기'면 차오르는 연출 없이 즉시 100%. 진행바는 "기다리는 중"의 표시일 뿐이고,
    // 실제 대기는 호출부의 ANALYZE_MS 타이머가 담당하므로 여기를 즉시 채워도 흐름은 같다.
    if (m.reduce) {
      progress.value = 1;
      return;
    }
    // ⚠️ 확정이 늦어진 만큼 시퀀스를 **앞에서 깎는다.** 호출부 타이머는 마운트 시점부터 이미
    //    흐르고 있으므로, 전체 길이를 그대로 쓰면 그만큼 뒤로 밀려 끝을 못 보여 준다.
    //    보통 조회는 한두 프레임이라 깎이는 게 없고, 늦어진 경우에만 따라잡는다.
    let left = Math.max(0, Date.now() - mountedAtRef.current);
    const take = (ms: number): number => {
      const used = Math.min(left, ms);
      left -= used;
      return ms - used;
    };
    const fillMs = take(FILL_MS);
    const holdMs = take(HOLD_MS);
    const finishMs = take(FINISH_MS);
    // ⚠️ **이미 100%면 되감지 않는다.** 오버레이가 떠 있는 동안 '동작 줄이기'를 켰다 끄면
    //    위 분기가 만든 100%를 여기서 0%로 되돌려 순간 이동한 뒤 다시 차오른다(codex 리뷰).
    //    끝난 연출은 끝난 채로 둔다 — 되감는 건 어떤 경우에도 얻는 게 없다.
    if (progress.value >= 1) return;
    // 경과분을 이미 깎았으므로 남은 구간만 재생한다. 시작값은 지금 값 그대로 두면 앞 구간이
    // 이미 지나간 만큼에서 이어진다.
    if (progress.value <= 0) progress.value = 0;
    progress.value = withSequence(
      // ⚠️ withSequence는 **첫 인자**로 게이트를 받는다(오버로드). 조합자마다 자리가 달라
      //    (withDelay는 세 번째, withRepeat는 다섯 번째) 하나씩 확인해야 한다.
      M.never,
      // reduceMotion: M.never — reanimated 기본값(정적 System 플래그)은 '동작 줄이기'를 켠 채
      // 앱을 켰다가 끈 사용자에게 계속 걸려, 재시작 전까지 진행바가 아예 차오르지 않는다.
      withTiming(0.9, { duration: fillMs, easing: Easing.linear, reduceMotion: M.never }),
      withDelay(
        holdMs,
        withTiming(1, {
          duration: finishMs,
          easing: Easing.out(Easing.cubic),
          reduceMotion: M.never,
        }),
        // ⚠️ withDelay도 세 번째 인자로 게이트를 받는다. 안 넘기면 기본값(정적 System)이 걸려
        //    HOLD_MS 900ms가 통째로 생략되고, 진행바가 ANALYZE_MS보다 일찍 100%에 닿아
        //    남은 시간 동안 멈춰 보인다(codex 리뷰).
        M.never,
      ),
    );
    // ⚠️ m.reduce를 의존성에 포함 — 재생 도중 설정이 켜져도 90%에서 굳지 않게 한다.
  }, [progress, m.reduce, m.ready]);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View
      style={s.layer}
      accessibilityElementsHidden={covered}
      importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
    >
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
