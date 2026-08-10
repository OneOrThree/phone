import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { M, transition } from '@/constants/motion';
import { T } from '@/constants/theme';
import { useMotion } from '@/hooks/useMotion';

// 가로 진행바 — 목표 대비 달성률(집중 목표·사용시간 한도 등)을 채워서 보여준다
// (GROMO-1381 / 정책 D10).
//
// ⚠️ **`width`를 애니메이트한다. `scaleX`가 아니다.**
//    `FocusResultScreen`이 주간 막대에 `scaleY`(transform)를 고른 것과 다른 선택이며,
//    모순이 아니다:
//      · 그쪽은 막대가 **7개**라 매 프레임 레이아웃 패스를 피해야 했다(그 파일 :57 주석).
//      · 진행바는 **둥근 캡**이 있다. scaleX로 늘리면 캡까지 같이 늘어나 진행률이 낮을 때
//        반원이 납작하게 찌그러진다. 게다가 화면당 1~3개뿐이라 레이아웃 비용이 문제가 안 된다.
//    일반화하면 — **개수가 많다 → transform / 둥근 캡 + 개수가 적다 → width.**
//
// 구현은 CSS transition(`transitionProperty: 'width'`)이다. reanimated 4의 CSS 엔진은
// `width`를 부모 폭 기준 CSSLength 보간으로 등록해 두고 있어(InterpolatorRegistry) 퍼센트
// 문자열도 그대로 보간된다 — imperative(useAnimatedStyle)로 갈 이유가 없다.
// 값이 바뀌면 알아서 따라가므로 호출부는 `progress`만 갱신하면 된다.
//
// ⚠️ CSS API는 reduce-motion 내장 처리가 없다. `m.css()`를 통과시켜, '동작 줄이기'가 켜지면
//    전환 없이 목표 폭으로 즉시 점프하게 한다.

interface ProgressBarProps {
  /** 진행률 0~1. **0~1 밖의 값은 클램프된다** — 목표를 초과한 데이터가 실제로 들어온다. */
  progress: number;
  color: string;
  trackColor?: string;
  height?: number;
  /** 기본값은 `height / 2` — 완전한 둥근 캡. 각진 막대가 필요할 때만 넘긴다. */
  radius?: number;
  /** 채우기 시작 지연(ms). 화면 진입 애니메이션 뒤에 차오르게 할 때 쓴다. */
  delay?: number;
  testID?: string;
}

export function ProgressBar({
  progress,
  color,
  trackColor = T.track,
  height = 8,
  radius,
  delay = 0,
  testID,
}: ProgressBarProps) {
  const m = useMotion();
  // NaN(0으로 나눈 비율 등)이 그대로 style.width에 들어가면 막대가 사라진다 — 0으로 접는다.
  const clamped = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;

  // ⚠️ CSS transition은 **이전 렌더와 값이 달라야** 실행된다. 첫 렌더부터 최종 폭으로 그리면
  //    채우기 연출이 통째로 재생되지 않고 delay도 무시된다 — 그런데 "화면에 들어올 때 이미
  //    계산된 진행률을 넘긴다"가 오히려 기본 사용 경로다. 그래서 첫 프레임만 0으로 그린 뒤
  //    다음 프레임에 목표 폭으로 넘겨 전환을 발생시킨다.
  //    requestAnimationFrame인 이유: useEffect의 setState는 같은 커밋에 묶여 네이티브가 0%를
  //    한 번도 못 볼 수 있다. 실제 프레임 경계가 필요하다.
  //    reduce면 이 2단계를 건너뛴다(전환 스타일이 없으니 0%가 한 프레임 보이기만 할 뿐이다).
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (entered) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [entered]);
  const shown = entered || m.reduce ? clamped : 0;

  // ⚠️ delay는 **최초 채우기에만** 쓴다. 그대로 두면 이후 모든 width 변경에도 걸려서,
  //    새로고침으로 값이 갱신될 때 숫자는 즉시 바뀌는데 진행바만 delay(예: 470ms) 동안 옛 값을
  //    유지하다 600ms에 걸쳐 따라간다 — 두 표시가 최대 1초 넘게 어긋난다(codex 리뷰).
  //    delay의 목적은 "카드 진입이 끝난 뒤 차오르기 시작"이라는 **1회성 순서 맞춤**이다.
  const [delayUsed, setDelayUsed] = useState(delay <= 0);
  useEffect(() => {
    if (delayUsed || !entered) return;
    const id = setTimeout(() => setDelayUsed(true), delay);
    return () => clearTimeout(id);
  }, [delayUsed, entered, delay]);

  // 소수점 둘째 자리까지 — 부동소수 오차(0.1+0.2)로 '30.000000000000004%' 같은 값이 나가지 않게.
  const widthPct = `${Math.round(shown * 10000) / 100}%` as const;
  const cap = radius ?? height / 2;

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      // VoiceOver는 0~1이 아니라 0~100 스케일로 읽는다. 표기 반올림과 같은 값을 쓴다.
      accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
      style={[s.track, { height, borderRadius: cap, backgroundColor: trackColor }]}
    >
      <Animated.View
        // 채움 막대 자체는 트랙 안에 원래 있어야 하는 뷰다(래퍼를 추가한 게 아니다).
        // 테스트·E2E가 폭을 읽을 수 있게 부모 testID에서 파생한 이름을 준다.
        testID={testID ? `${testID}.fill` : undefined}
        style={[
          s.fill,
          { width: widthPct, backgroundColor: color, borderRadius: cap },
          m.css(
            transition({
              property: 'width',
              duration: M.dur.slow,
              curve: 'standard',
              delay: delayUsed ? 0 : delay,
            }),
          ),
        ]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden' },
  fill: { height: '100%' },
});
