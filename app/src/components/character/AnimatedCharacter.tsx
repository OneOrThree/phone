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
  testID,
  children,
}: {
  size: number;
  variant?: CharacterVariant;
  /** 커스텀 누끼. 있으면 variant는 무시되고 호흡만 적용된다(CharacterImage 헤더 주석 참고). */
  sourceUri?: string;
  mood?: CharacterMood;
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
    if (m.reduce) {
      breath.value = 0;
      return;
    }
    // ⚠️ reduceMotion: M.never — 이 호출은 useMotion의 timing을 거치지 않는 직접 호출이라
    //    reanimated 기본값(정적 System 플래그)이 그대로 걸린다. 그러면 '동작 줄이기'를 켠 채
    //    앱을 켰다가 끈 사용자는 앱 재시작 전까지 호흡이 멈춘 캐릭터를 본다.
    breath.value = withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.quad), reduceMotion: M.never }),
      -1,
      true,
    );
  }, [breath, duration, m.reduce]);

  const breathStyle = useAnimatedStyle(() => ({
    transformOrigin: '50% 100%',
    transform: [{ scaleY: 1 + ampY * breath.value }, { scaleX: 1 - ampX * breath.value }],
  }));

  return (
    // reduce면 스타일 자체를 붙이지 않는다 — 평범한 View가 되어 워클릿도 돌지 않는다.
    <Animated.View testID={testID} style={m.reduce ? undefined : breathStyle}>
      {children ?? <CharacterImage size={size} variant={variant} sourceUri={sourceUri} />}
    </Animated.View>
  );
}
