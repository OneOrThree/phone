import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, InteractionManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CharacterImage } from '@/components/character/CharacterImage';
import { ConfettiBurst, type ConfettiObstacle } from '@/components/ConfettiBurst';
import { useCharacter } from '@/store/CharacterContext';
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
  // 장착 캐릭터 — custom 선택 + 누끼 있으면 그 URI, 아니면 null(기본 정적 에셋).
  const { activeSource } = useCharacter();
  useEffect(() => {
    if (!visible) return;
    const task = InteractionManager.runAfterInteractions(() => setUiIdle(true));
    return () => task.cancel();
  }, [visible]);
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
            <Ionicons name="ribbon" size={15} color={T.accentDeep} />
            <Text style={s.streakText}>
              연속 목표달성 <Text style={s.streakDays}>{streakDays}일</Text>
            </Text>
          </View>
          <CharacterImage
            size={104}
            sourceUri={activeSource ?? undefined}
            onLoad={() => setCharReady(true)}
          />
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
        {cardRect && charReady && uiIdle ? <ConfettiBurst obstacle={cardRect} /> : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
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
