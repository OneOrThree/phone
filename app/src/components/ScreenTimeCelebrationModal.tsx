import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, InteractionManager } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { CharacterImage } from '@/components/character/CharacterImage';
import { ConfettiBurst, type ConfettiObstacle } from '@/components/ConfettiBurst';
import { useCharacter } from '@/store/CharacterContext';
import { M, pop } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { hapticSuccess } from '@/utils/haptics';
import { T, withAlpha } from '@/constants/theme';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { CURRENCY } from '@/constants/currency';

// 스크린타임 목표 달성 축하 모달(GROMO-629) — 어제 사용 시간이 목표 이내였으면 그날 첫 홈 진입에
// 1회 노출. 목표 보상으로 지급된 시간조각을 rewardCoins로 받아 +N 한 줄로 표시한다(>0일 때만) —
// 값은 호출자가 넘긴다. 모양은 포커스 목표 축하(GoalCelebrationModal)와 동일, 문구만 스크린타임용.
// '연속 목표달성'만 표시한다.
interface Props {
  visible: boolean;
  streakDays: number; // 어제 포함 연속 목표달성 일수
  goalMinutes?: number; // 어제 목표 사용 시간(분) — "N시간 이내로 사용하기 성공" 문구용
  rewardCoins?: number; // 목표 보상 시간조각 — >0일 때만 +N ⏳ 표기
  onClose: () => void;
}

// 분 → "3시간" / "3시간 30분" / "30분" (목표 시간 문장 표기용)
function goalLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

export function ScreenTimeCelebrationModal({
  visible,
  streakDays,
  goalMinutes,
  rewardCoins,
  onClose,
}: Props) {
  const [cardRect, setCardRect] = useState<ConfettiObstacle | null>(null);
  // 색종이는 캐릭터가 그려지고 UI가 한가해진 뒤 시작(GROMO-848) — GoalCelebrationModal과 동일 가드
  const [charReady, setCharReady] = useState(false);
  const [uiIdle, setUiIdle] = useState(false);
  // 팝인이 끝났는가(GROMO-1381) — GoalCelebrationModal과 동일한 박자 게이트.
  const [popDone, setPopDone] = useState(false);
  // 장착 캐릭터 — custom 선택 + 누끼 있으면 그 URI, 아니면 null(기본 정적 에셋).
  const { activeSource } = useCharacter();
  const m = useMotion();
  useEffect(() => {
    if (!visible) return;
    const task = InteractionManager.runAfterInteractions(() => setUiIdle(true));
    return () => task.cancel();
  }, [visible]);
  // 축하 순간의 촉감(GROMO-1381) — notification 계열 "따-단". 축하 표면 전용이다.
  useEffect(() => {
    if (visible) hapticSuccess();
  }, [visible]);
  // 노출 단위 초기화(codex 리뷰) — 닫혀도 이 컴포넌트는 언마운트되지 않아 준비 플래그가
  // 다음 노출까지 살아남는다. 초기화하지 않으면 새 이미지의 onLoad를 기다리지 않고 팝·색종이가
  // 즉시 시작된다. 근거·시점 판단은 GoalCelebrationModal의 같은 자리 주석 참고.
  useEffect(() => {
    if (visible) return;
    setCharReady(false);
    setUiIdle(false);
    setPopDone(false);
  }, [visible]);
  // 팝인 완료 → 색종이. reduce여도 타이머는 남긴다(정책 D7) — 없애면 게이트가 안 열린다.
  const charShown = charReady && uiIdle;
  // ⚠️ **'동작 줄이기'가 확정되기 전에는 팝 시퀀스를 시작하지 않는다.** 미확정 구간의 m.reduce는
  //    보수적으로 true라 지연이 0으로 눌리고, popDone이 즉시 켜진다. 그러면 나중에 false로
  //    확정될 때 팝과 색종이가 **동시에** 시작해 팝 → 색종이 순서가 깨지고, 캐릭터가 최종 크기로
  //    먼저 보였다가 뒤늦게 팝한다(codex 리뷰). 조회는 실패해도 false로 확정되므로 안 멈춘다.
  // ⚠️ 의존성에 m(매 렌더 새 객체)을 넣지 않는다 — 다시 돌면 타이머가 재시작돼 색종이가 밀린다.
  //    지연은 ref로 최신값을 읽는다(결정 D-29).
  const popDelayRef = useRef(m.delay(M.dur.slow));
  popDelayRef.current = m.delay(M.dur.slow);
  useEffect(() => {
    if (!visible || !charShown || !m.ready) return undefined;
    const t = setTimeout(() => setPopDone(true), popDelayRef.current);
    return () => clearTimeout(t);
  }, [visible, charShown, m.ready]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
        <View
          style={s.card}
          onLayout={(e) => {
            const { x, y, width } = e.nativeEvent.layout;
            setCardRect((prev) => prev ?? { x, y, width });
          }}
        >
          <View style={s.streakBox}>
            <Ionicons name="flame" size={15} color={T.accentDeep} />
            <Text style={s.streakText}>
              연속 목표달성 <Text style={s.streakDays}>{streakDays}일</Text>
            </Text>
          </View>
          {/* 팝 진입 — 카드에 overflow 제약이 없어 1.25배 오버슛이 잘리지 않는다.
              호흡(AnimatedCharacter)은 쓰지 않는다(무한 루프 상한 + 축하엔 진입 팝이 맞다).
              ⚠️ 팝은 마운트가 아니라 그림이 실제로 올라온 뒤(onLoad) 시작한다 — 근거는
              GoalCelebrationModal의 같은 자리 주석(codex 리뷰). */}
          <Animated.View
            testID="screenTimeCelebration.character"
            style={charReady ? m.css(pop()) : s.charPending}
          >
            <CharacterImage
              size={104}
              sourceUri={activeSource ?? undefined}
              testID="screenTimeCelebration.character.image"
              onLoad={() => setCharReady(true)}
            />
          </Animated.View>
          <Text style={s.title}>어제 핸드폰 사용 시간 목표를 달성했군요!</Text>
          <Text style={s.sub}>
            {goalMinutes
              ? `${goalLabel(goalMinutes)} 이내로 사용하기 성공했어요.`
              : '목표 이내로 사용하기 성공했어요.'}
            {'\n'}오늘도 화이팅!
          </Text>
          {/* 목표 보상 시간조각 — 호출자가 넘긴 rewardCoins>0일 때만 */}
          {(rewardCoins ?? 0) > 0 ? (
            <View style={s.coinBox}>
              {/* 중첩 아이콘은 부모 문자열에 합쳐져 글리프로 읽히므로 라벨은 이 <Text>에 단다. */}
              <Text
                style={s.coinText}
                accessibilityLabel={`${CURRENCY.label} ${rewardCoins?.toLocaleString()} 획득!`}
              >
                +{rewardCoins?.toLocaleString()} <CurrencyIcon size={14} /> 획득!
              </Text>
            </View>
          ) : null}
          <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={onClose}>
            <Text style={s.ctaText}>좋아요!</Text>
          </TouchableOpacity>
        </View>
        {cardRect && popDone ? <ConfettiBurst obstacle={cardRect} /> : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  // 그림이 올라오기 전 — 자리(104)는 잡되 보이지 않게. opacity라 레이아웃은 그대로다.
  charPending: { opacity: 0 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: withAlpha(T.night.bottom, 0.5) },
  card: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: T.white,
    borderRadius: 24,
    paddingHorizontal: T.space.xxl,
    paddingTop: 28,
    paddingBottom: T.space.xl,
    gap: T.space.sm,
  },
  title: { ...T.text.subtitle, fontSize: 20, color: T.ink, marginTop: T.space.md },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkSub, textAlign: 'center' },
  streakBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.sm,
  },
  streakText: { ...T.text.label, fontWeight: '600', color: T.accentDeep },
  streakDays: { fontWeight: '800' },
  // 목표 보상 시간조각 pill(+N ⏳)
  coinBox: {
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.sm,
    marginTop: T.space.xs,
  },
  coinText: { ...T.text.label, fontWeight: '800', color: T.accentDeep },
  cta: {
    alignSelf: 'stretch',
    backgroundColor: T.accent,
    borderRadius: 14,
    paddingVertical: T.space.lg,
    alignItems: 'center',
    marginTop: T.space.lg,
  },
  ctaText: { ...T.text.subtitle, color: T.white },
});
