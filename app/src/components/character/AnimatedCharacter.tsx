// AnimatedCharacter.tsx
// CharacterImage에 **호흡(idle) 모션**만 얹은 래퍼. 캐릭터 에셋은 단일 PNG 한 장이라
// 프레임 시퀀스·스프라이트가 없다 — 가능한 건 transform 기반 연출뿐이다(GROMO-1381 조사).
// 레시피는 screens/character/ObjectCharacter.tsx:50-64의 숨쉬기를 그대로 옮긴 것이다
// (발이 바닥에 붙어 보이도록 원점을 아래 가운데로 두고 세로로만 늘린다).
//
// ⚠️ 화면당 1개 상한. 무한 루프라 여러 개를 띄우면 그만큼 프레임 예산을 계속 먹는다.
//    "캐릭터가 여러 마리 보이는 화면"(리그 멤버 아바타 그리드 등)에는 쓰지 않는다.
//
// ⚠️ overflow:'hidden' 컨테이너 안에서는 쓰지 않는다.
//    scaleY 1.025는 박스 밖으로 2.5% 삐져나오는데, 부모가 클리핑하면 머리·발이 잘려
//    "떨리는" 것처럼 보인다. 확인된 금지 자리: 홈 프로필 아바타(44px) · 리그 MemberAvatar ·
//    온보딩 CharacterIntroStep의 stage. **여유 공간이 있는 큰 캐릭터 전용** —
//    홈 216px · 집중 세션 230px가 대상이다.
//
// ⚠️ 더 중요한 것 — 캡처 범위(captureRef) **바깥**에 둘 것.
//    FocusSessionScreen.tsx:1278의 charShotRef는 캐릭터를 이미지로 구워 Live Activity·차폐
//    화면에 넣는다. 이 래퍼가 그 ref 안쪽에 들어가면 호흡 중간 프레임(세로로 눌린 캐릭터)이
//    그대로 구워져 위젯에 박힌다. ShareDayFrame·ShareBrandFooter도 같은 이유로 금지.
//
// reduce('동작 줄이기')면 애니메이션 스타일을 아예 붙이지 않는다 — 정지 프레임 그대로다.

import { useEffect, type ReactNode } from 'react';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { M } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { CharacterImage, type CharacterVariant } from './CharacterImage';

/** 호흡 표정. idle=평상시, calm=집중 세션 일시정지처럼 "가라앉은" 상태(느리고 얕게). */
export type CharacterMood = 'idle' | 'calm';

// duration은 M.dur 사다리(최대 1200) 밖의 값이다 — 호흡은 진입 연출이 아니라 생명 신호라
// 사람의 들숨/날숨 주기(약 3~5초 왕복)를 따라야 하고, 토큰 칸에 맞추면 헐떡이는 것처럼 보인다.
// ObjectCharacter에서 이미 튜닝된 1400을 그대로 가져오고 calm만 늘렸다.
const MOOD: Record<CharacterMood, { duration: number; ampY: number; ampX: number }> = {
  idle: { duration: 1400, ampY: 0.025, ampX: 0.012 },
  calm: { duration: 2600, ampY: 0.014, ampX: 0.007 },
};

export function AnimatedCharacter({
  size,
  variant,
  sourceUri,
  mood = 'idle',
  active = true,
  testID,
  children,
}: {
  size: number;
  variant?: CharacterVariant;
  /** 커스텀 누끼. 있으면 variant는 무시되고 호흡만 적용된다(CharacterImage 헤더 주석 참고). */
  sourceUri?: string;
  mood?: CharacterMood;
  /**
   * false면 호흡을 멈추고 정지 프레임으로 둔다. **탭 화면은 반드시 넘겨야 한다.**
   *
   * ⚠️ 탭 네비게이터는 `unmountOnBlur`가 없어 다른 탭으로 가도 홈이 마운트된 채 남는다.
   *    그러면 보이지도 않는 캐릭터의 무한 루프가 **앱 세션 내내** UI 스레드를 먹는다
   *    (codex 리뷰). "화면당 무한 루프 1개" 상한은 *보이는* 화면 기준이지, 마운트된 화면
   *    전부를 세면 상한이 무의미해진다.
   *    호출부에서 `useIsFocused()`를 넘긴다 — 이 컴포넌트가 직접 읽지 않는 이유는
   *    네비게이터 밖(테스트·모달)에서도 쓸 수 있어야 하기 때문이다.
   */
  active?: boolean;
  /** 래퍼 뷰에 붙는다 — 캐릭터를 통째로 집는 셀렉터. */
  testID?: string;
  /**
   * 호흡 래퍼 **안쪽**에 그릴 내용. 주면 내부 `CharacterImage` 대신 이게 들어가고
   * `size`·`variant`·`sourceUri`는 무시된다.
   *
   * ⚠️ 이 슬롯이 있는 이유 — 집중 세션은 캐릭터를 `captureRef`로 떠서 Live Activity·차폐
   *    화면에 굽는다. 캡처 ref가 호흡 transform **안쪽**에 들어가면 눌린 중간 프레임이 그대로
   *    구워지므로, 래퍼는 ref의 **부모**여야 한다. 슬롯이 없으면 그 구조를 만들 수 없어
   *    호출부가 호흡 레시피를 손으로 복제하게 된다(codex 리뷰 · W-F 보고).
   *
   *    올바른 형태:
   *      <AnimatedCharacter>
   *        <View ref={charShotRef} collapsable={false}>
   *          <CharacterImage size={230} variant="study" ... />
   *        </View>
   *      </AnimatedCharacter>
   */
  children?: ReactNode;
}) {
  const m = useMotion();
  const { duration, ampY, ampX } = MOOD[mood];
  const breath = useSharedValue(0);

  // ⚠️ deps에 m.reduce가 들어가야 한다 — 재생 도중 '동작 줄이기'가 켜졌을 때 반쯤 눌린
  //    중간 프레임으로 굳는 것을 막는다(useMotion 헤더 주석).
  useEffect(() => {
    if (m.reduce || !active) {
      // 진행 중이던 반복을 끊고 정지 프레임으로 되돌린다 — 그냥 두면 중간 값에서 굳는다.
      cancelAnimation(breath);
      breath.value = 0;
      return;
    }
    // ⚠️ reduceMotion: M.never — 이 호출은 useMotion의 timing을 거치지 않는 직접 호출이라
    //    reanimated 기본값(정적 System 플래그)이 그대로 걸린다. 그러면 '동작 줄이기'를 켠 채
    //    앱을 켰다가 끈 사용자는 앱 재시작 전까지 호흡이 멈춘 캐릭터를 본다.
    // ⚠️ withRepeat도 다섯 번째 인자로 게이트를 받는다 — 안쪽 withTiming만 막으면 반복
    //    래퍼가 기본값(정적 System 플래그)을 그대로 쓴다(codex 리뷰 계보).
    // ⚠️ **새 반복을 걸기 전에 값을 0으로 되돌린다.** withRepeat(..., reverse=true)는 시작 시점의
    //    값과 목표값 사이를 왕복하므로, mood가 바뀌어(duration 변경) 이 effect가 다시 돌 때
    //    현재 값이 0.6이었다면 그 뒤로는 0.6~1만 왕복한다. 전환을 반복할수록 캐릭터가 늘어난
    //    상태에 눌어붙는다(codex 리뷰). 진행 중이던 반복을 끊고 바닥에서 다시 시작한다.
    cancelAnimation(breath);
    breath.value = 0;
    breath.value = withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.quad), reduceMotion: M.never }),
      -1,
      true,
      undefined,
      M.never,
    );
  }, [breath, duration, m.reduce, active]);

  const breathStyle = useAnimatedStyle(() => ({
    transformOrigin: '50% 100%',
    transform: [{ scaleY: 1 + ampY * breath.value }, { scaleX: 1 - ampX * breath.value }],
  }));

  return (
    // reduce면 스타일 자체를 붙이지 않는다 — 평범한 View가 되어 워클릿도 돌지 않는다.
    <Animated.View testID={testID} style={m.reduce || !active ? undefined : breathStyle}>
      {children ?? <CharacterImage size={size} variant={variant} sourceUri={sourceUri} />}
    </Animated.View>
  );
}
