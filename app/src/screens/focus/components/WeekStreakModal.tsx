import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CharacterImage } from '@/components/character/CharacterImage';
import { useCharacter } from '@/store/CharacterContext';
import { M, pop } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { Enter } from '@/components/Enter';
import { hapticSuccess } from '@/utils/haptics';
import { T, withAlpha } from '@/constants/theme';
import { ConfettiBurst, type ConfettiObstacle } from '@/components/ConfettiBurst';

// 주간 스트릭 완성 축하 모달(GROMO-667) — 월~일 7일을 모두 채운 주, 일요일 결과 화면의
// ✓ 팝 뒤에 노출(주 1회). 종이폭죽은 모달과 동시에 오버레이 안에서 터진다(오스카 결정).
// 코인/재화 지급 없음(축하+스트릭 정책).
interface Props {
  visible: boolean;
  onClose: () => void;
}

export function WeekStreakModal({ visible, onClose }: Props) {
  // 카드 위치·폭(오버레이 좌표) — 컨페티가 카드를 장애물로 취급할 때 사용. 최초 1회만 기록.
  const [cardRect, setCardRect] = useState<ConfettiObstacle | null>(null);
  // 캐릭터 그림이 실제로 올라왔는가(GROMO-1381) — 이 모달만 원래 이 게이트가 없었는데,
  // 팝을 마운트 시점에 걸면 커스텀 누끼 디코딩이 늦을 때 안 보이는 사이 팝이 끝나 버린다.
  // 다른 두 축하 모달(Goal·ScreenTime)과 같은 결함이라 같은 방식으로 막는다(codex 리뷰).
  const [charReady, setCharReady] = useState(false);
  // 팝인이 끝났는가 — 캐릭터가 튀어 들어온 **뒤에** 색종이가 터진다.
  // 같은 오버레이·같은 등장 순간이라는 기존 결정(위 주석)은 유지하고 박자만 나눈 것이다.
  const [popDone, setPopDone] = useState(false);
  // 장착 캐릭터 — custom 선택 + 누끼 있으면 그 URI, 아니면 null(기본 정적 에셋).
  const { activeSource } = useCharacter();
  const m = useMotion();
  // 축하 순간의 촉감 — notification 계열 "따-단". 축하 표면 전용이다.
  useEffect(() => {
    if (visible) hapticSuccess();
  }, [visible]);
  // 노출 단위 초기화(codex 리뷰) — 닫혀도 이 컴포넌트는 언마운트되지 않아 준비 플래그가
  // 다음 노출까지 살아남는다. charReady를 이번 라운드에 새로 넣은 곳이라 같은 함정이 그대로
  // 있었다. 근거·시점 판단은 GoalCelebrationModal의 같은 자리 주석 참고.
  useEffect(() => {
    if (visible) return;
    setCharReady(false);
    setPopDone(false);
  }, [visible]);
  // 색종이는 팝이 시작(=charReady)한 뒤 팝 길이만큼 지나서. reduce여도 타이머는 남긴다(정책 D7) —
  // 지연만 0이 된다. 없애면 게이트가 영영 안 열린다.
  // ⚠️ **'동작 줄이기'가 확정되기 전에는 팝 시퀀스를 시작하지 않는다.** 미확정 구간의 m.reduce는
  //    보수적으로 true라 지연이 0으로 눌리고, popDone이 즉시 켜진다. 그러면 나중에 false로
  //    확정될 때 팝과 색종이가 **동시에** 시작해 팝 → 색종이 순서가 깨지고, 캐릭터가 최종 크기로
  //    먼저 보였다가 뒤늦게 팝한다(codex 리뷰). 조회는 실패해도 false로 확정되므로 안 멈춘다.
  // ⚠️ 의존성에 m(매 렌더 새 객체)을 넣지 않는다 — 다시 돌면 타이머가 재시작돼 색종이가 밀린다.
  //    지연은 ref로 최신값을 읽는다(결정 D-29).
  const popDelayRef = useRef(m.delay(M.dur.slow));
  popDelayRef.current = m.delay(M.dur.slow);
  useEffect(() => {
    if (!visible || !charReady || !m.ready) return undefined;
    const t = setTimeout(() => setPopDone(true), popDelayRef.current);
    return () => clearTimeout(t);
  }, [visible, charReady, m.ready]);
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
          {/* 팝 진입 — 카드에 overflow 제약이 없어 1.25배 오버슛이 잘리지 않는다.
              호흡(AnimatedCharacter)은 쓰지 않는다(무한 루프 상한 + 축하엔 진입 팝이 맞다).
              ⚠️ 팝은 마운트가 아니라 그림이 실제로 올라온 뒤(onLoad) 시작한다 — 근거는
              GoalCelebrationModal의 같은 자리 주석(codex 리뷰). */}
          {/* ⚠️ 팝 래퍼는 **노출마다 마운트**돼야 한다. 이 모달은 visible=false인 동안에도 부모에
              마운트돼 있어 화면의 useMotion 결정이 실제 축하보다 훨씬 전에 얼린다 — 그 뒤 설정을
              바꾸고 열면 과거 결정으로 팝이 재생되거나 생략된다(codex 리뷰). key로 다시 마운트시킨다.
              ⚠️ 게이트가 `charReady`인 이유: InteractionManager가 늦는 전환에서 모달이 안정되기 전에 팝이
              끝나 팝→색종이 박자가 깨진다. 확정 전에는 pending(opacity 0) — 팝의 시작 프레임이다. */}
          <Enter
            key={visible ? 'shown' : 'hidden'}
            testID="weekStreak.character"
            preset={pop()}
            style={charReady ? undefined : s.charPending}
            active={charReady}
          >
            <CharacterImage
              size={104}
              sourceUri={activeSource ?? undefined}
              testID="weekStreak.character.image"
              onLoad={() => setCharReady(true)}
            />
          </Enter>
          <Text style={s.title}>이번 주 스트릭 완성! 🎉</Text>
          <Text style={s.sub}>월요일부터 일요일까지 하루도 빠짐없이 채웠어요</Text>
          <View style={s.weekBox}>
            <Ionicons name="flame" size={15} color={T.flame} />
            <Text style={s.weekText}>7일 연속 집중 완주</Text>
          </View>
          <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={onClose}>
            <Text style={s.ctaText}>다음 주도 함께해요!</Text>
          </TouchableOpacity>
        </View>
        {/* 종이폭죽 — 캐릭터 팝인이 끝난 직후, 카드 위 레이어에서 낙하(카드에 쌓이거나 옆으로 흘러내림) */}
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
  weekBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.sm,
    marginTop: T.space.md,
  },
  weekText: { ...T.text.label, fontWeight: '600', color: T.accentDeep },
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
