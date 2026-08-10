import { useEffect, useRef, useState } from 'react';
import { Text, type TextStyle } from 'react-native';
import { M } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';

// 숫자가 목표값까지 세어 올라가는 텍스트 — 코인·스트릭·홈 지표처럼 '늘어난 것'이 의미인 값에 쓴다
// (GROMO-1381 / 정책 D9).
//
// ⚠️ **`<Text>` + JS 보간이다.** 정석으로 통하는
//    `Animated.createAnimatedComponent(TextInput)` + `animatedProps={{ text }}` 트릭을
//    일부러 쓰지 않는다:
//      ① Maestro가 `TextInput.value`를 안정적으로 읽지 못한다 → **E2E testID 계약 위반**.
//      ② TextInput은 기본 패딩·폰트 메트릭이 `<Text>`와 달라 `T.text.stat` 정렬이 깨진다.
//         이 스타일은 네이티브 `HomeUsageView`(size 22 heavy)와 **크기 계약**이 있다.
//      ③ VoiceOver가 텍스트가 아니라 **입력 필드**로 읽는다.
//    TextInput 트릭의 이점은 JS 리렌더를 피하는 것인데, 그게 의미 있으려면 화면에 세어 올라가는
//    숫자가 수십 개여야 한다. 이 앱은 **화면당 1~3개**다.
//
// ⚠️ **리프 전용. 리스트 행 내부나 큰 서브트리 안에서 쓰지 않는다.**
//    매 프레임 setState가 도는 컴포넌트라, 무거운 서브트리의 루트에 놓으면 그 트리 전체가
//    프레임마다 다시 렌더된다. 숫자 하나만 감싼 잎사귀 자리에 둔다.
//
// 접근성: `accessibilityLabel`에 **최종 포맷값**을 넣는다. 라벨이 없으면 VoiceOver가 렌더될
// 때마다 중간 숫자(1, 4, 9, 17…)를 읽어 버린다.
//
// '동작 줄이기'가 켜져 있으면 **첫 프레임에 최종값** — 세는 과정 자체가 애니메이션이다.

const defaultFormat = (n: number): string => String(Math.round(n));

interface AnimatedNumberProps {
  value: number;
  /** 표시 문자열 변환. 보간 중인 **소수값**이 들어오므로 반올림·자리수 처리를 여기서 한다. */
  format?: (n: number) => string;
  style?: TextStyle;
  duration?: number;
  testID?: string;
}

export function AnimatedNumber({
  value,
  format = defaultFormat,
  style,
  duration = M.dur.slow,
  testID,
}: AnimatedNumberProps) {
  const m = useMotion();
  const [display, setDisplay] = useState(value);
  // 화면에 떠 있는 현재 값 — 애니메이션 **도중에 value가 바뀌어도** 0이나 이전 목표로 되감지
  // 않고 지금 보이는 숫자에서 새 목표로 이어가기 위한 출발점이다.
  const displayRef = useRef(value);

  useEffect(() => {
    // ⚠️ '동작 줄이기' 조회가 끝나기 전에는 **목표값을 소비하지 않는다.** 미확정 구간의
    //    `m.reduce`는 보수적으로 true라, 그 값으로 아래 분기를 타면 displayRef가 새 목표로
    //    확정된다. 이후 false로 확정돼 effect가 다시 돌아도 `from === value`에서 끝나므로
    //    설정을 켜지 않은 사용자가 카운트업을 영구히 잃는다(codex 리뷰).
    //    출발값을 보존한 채 기다리면 확정 시점에 정상적으로 이어진다. 조회는 실패해도 false로
    //    확정되므로(useReduceMotion.ts) 표시가 옛 값에 영영 묶이지 않는다.
    if (!m.ready) return;
    if (m.reduce) {
      displayRef.current = value;
      setDisplay(value);
      return;
    }
    const from = displayRef.current;
    if (from === value) return;

    const startedAt = Date.now();
    let frame = requestAnimationFrame(function tick() {
      // 경과 시간 기준으로 진행률을 계산한다 — 프레임 수를 세면 기기가 버벅일 때 재생 시간이
      // 늘어난다(같은 600ms 안에 끝나야 다른 모션과 호흡이 맞는다).
      const t = Math.min((Date.now() - startedAt) / duration, 1);
      // 감속 커브는 토큰에서 가져온다. `.fn`은 워클릿이지만 평범한 JS 함수이기도 해서
      // JS 스레드에서 그대로 호출할 수 있다(여기서 UI 스레드는 관여하지 않는다).
      const next = from + (value - from) * M.curve.out.fn(t);
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        // 마지막 프레임은 커브 오차 없이 정확히 목표값으로 못박는다.
        displayRef.current = value;
        setDisplay(value);
      }
    });
    // 언마운트·목표 변경 시 반드시 취소한다. 남겨 두면 사라진 컴포넌트에 setState가 날아간다.
    return () => cancelAnimationFrame(frame);
  }, [value, duration, m.reduce, m.ready]);

  return (
    <Text testID={testID} style={style} accessibilityLabel={format(value)}>
      {format(display)}
    </Text>
  );
}
