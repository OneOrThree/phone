import { useEffect, useState } from 'react';
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

// 포커스 목표 달성 축하 모달(GROMO-630) — 오늘 누적 집중이 목표를 처음 채운 순간 결과 화면에서
// 1회 노출. 목표 보상으로 지급된 시간조각을 rewardCoins로 받아 +N 한 줄로 표시한다(>0일 때만).
// 값은 호출자가 넘긴다 — 지급이 없거나 아직 안 정해졌으면 줄을 숨겨 축하 + 스트릭만 남는다.
// '연속 목표달성' 표기는 '연속 공부'(하루 10분 스트릭)와 다른 개념이라 이 모달에는 섞지 않는다.
interface Props {
  visible: boolean;
  goalStreakDays: number; // 오늘 포함 연속 목표달성 일수
  goalMinutes?: number; // 달성한 목표 시간(분) — 제목에 "N시간 집중 목표 달성!" 표기
  rewardCoins?: number; // 목표 보상 시간조각 — >0일 때만 +N ⏳ 표기
  onClose: () => void;
}

// 분 → "5시간" / "1시간 30분" / "30분" (축하 제목용 — 00:00:00 표기보다 문장에 자연스러움)
function goalLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

export function GoalCelebrationModal({
  visible,
  goalStreakDays,
  goalMinutes,
  rewardCoins,
  onClose,
}: Props) {
  const [cardRect, setCardRect] = useState<ConfettiObstacle | null>(null);
  // 색종이는 캐릭터가 그려지고 UI가 한가해진 뒤 시작(GROMO-848) — 등장 직후 로딩 잭으로
  // 프레임이 밀리면 시간 기준 애니메이션이 건너뛰어 "이미 떨어진 상태"로 보이는 것 방지.
  const [charReady, setCharReady] = useState(false);
  const [uiIdle, setUiIdle] = useState(false);
  // 팝인이 끝났는가(GROMO-1381) — 축하의 박자를 '캐릭터가 튀어 들어온 뒤 색종이'로 나눈다.
  // 둘이 동시에 시작하면 서로를 묻는다.
  const [popDone, setPopDone] = useState(false);
  // 장착 캐릭터 — custom 선택 + 누끼 있으면 그 URI, 아니면 null(기본 정적 에셋).
  const { activeSource } = useCharacter();
  const m = useMotion();
  useEffect(() => {
    if (!visible) return;
    const task = InteractionManager.runAfterInteractions(() => setUiIdle(true));
    return () => task.cancel();
  }, [visible]);
  // 축하 순간의 촉감(GROMO-1381) — impact가 아니라 notification 계열이라 "따-단" 2박자다.
  // ⚠️ 축하 표면 전용. 일반 성공 통보에 붙이면 이 인상이 닳는다.
  useEffect(() => {
    if (visible) hapticSuccess();
  }, [visible]);
  // 노출 단위 초기화(codex 리뷰) — 이 모달은 닫혀도 **언마운트되지 않는다**. RN Modal은
  // visible=false면 children만 통째로 언마운트하므로 다음 노출에서 CharacterImage는 새로
  // 마운트돼 onLoad를 다시 준다. 그런데 준비 플래그는 바깥(이 컴포넌트)에 살아남아, 초기화하지
  // 않으면 이전 노출의 true가 남는다 → 새 이미지의 onLoad를 기다리지 않고 팝·색종이가 즉시
  // 시작돼, 누끼 디코딩이 600ms를 넘으면 "안 보이는 사이 팝이 끝나는" 문제가 그대로 재현된다.
  // ⚠️ 초기화 시점은 '닫힐 때'다. onClose 콜백이 아니라 visible **prop**을 보고 있어서 CTA·딤·
  //    시스템 백 어느 경로로 닫히든 여기 한 곳을 반드시 지난다 — 경로를 빠뜨릴 수가 없다.
  //    '열 때 초기화'는 오히려 위험하다: 캐시된 이미지의 onLoad가 초기화 이펙트보다 먼저 도착하면
  //    방금 올라온 true를 되돌려 팝이 영영 안 붙는다.
  useEffect(() => {
    if (visible) return;
    setCharReady(false);
    setUiIdle(false);
    setPopDone(false);
  }, [visible]);
  // 팝인 완료 → 색종이. reduce면 지연이 0이 되지만 **타이머 자체는 남긴다**(정책 D7) —
  // 없애면 색종이 게이트가 영영 열리지 않는다. (색종이 자체의 reduce 처리는 ConfettiBurst 담당)
  const charShown = charReady && uiIdle;
  useEffect(() => {
    if (!visible || !charShown) return undefined;
    const t = setTimeout(() => setPopDone(true), m.delay(M.dur.slow));
    return () => clearTimeout(t);
  }, [visible, charShown, m]);
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
              연속 목표달성 <Text style={s.streakDays}>{goalStreakDays}일</Text>
            </Text>
          </View>
          {/* 팝 진입 — 카드에 overflow 제약이 없어 1.25배 오버슛이 잘리지 않는다.
              호흡(AnimatedCharacter)은 여기 쓰지 않는다: 무한 루프는 화면당 1개 상한이고,
              축하 순간에 필요한 건 '들어오는 팝'이지 상시 생명 신호가 아니다.
              ⚠️ 팝은 마운트가 아니라 **그림이 실제로 올라온 뒤**(onLoad) 시작한다 — 커스텀 누끼
              디코딩이 600ms보다 늦으면 팝이 안 보이는 사이 끝나 캐릭터가 최종 크기로 툭 나타난다
              (codex 리뷰). 그 전에는 opacity 0으로 접어 둬 '컸다가 줄어드는' 프레임도 없앤다. */}
          <Animated.View
            testID="goalCelebration.character"
            style={charReady ? m.css(pop()) : s.charPending}
          >
            <CharacterImage
              size={104}
              sourceUri={activeSource ?? undefined}
              testID="goalCelebration.character.image"
              onLoad={() => setCharReady(true)}
            />
          </Animated.View>
          <Text style={s.title}>
            {goalMinutes ? `${goalLabel(goalMinutes)} 집중 목표 달성!` : '오늘 목표 달성!'}
          </Text>
          <Text style={s.sub}>내일도 힘내서 목표 달성해요!</Text>
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
