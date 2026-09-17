import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  InteractionManager,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { CharacterImage } from '@/components/character/CharacterImage';
import { ConfettiBurst, type ConfettiObstacle } from '@/components/ConfettiBurst';
import { useCharacter } from '@/store/CharacterContext';
import { M, pop } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { Enter } from '@/components/Enter';
import { hapticSuccess } from '@/utils/haptics';
import { T, withAlpha } from '@/constants/theme';

// 축하 모달 공통 껍데기 — 집중 목표 달성(GROMO-630) · 스크린타임 목표 달성(GROMO-629) ·
// 주간 스트릭 완성(GROMO-667) 세 축하가 전부 이 파일을 쓴다.
//
// ⚠️ **왜 하나로 합쳤나.** 세 모달은 569줄 중 65줄만 다른 복제본이었고, 그 대가로 같은 결함을
//    세 번 고치면서 매 라운드 하나씩 빠뜨렸다 — 팝 게이트(charReady) · 노출 단위 초기화 ·
//    uiIdle이 각각 다른 모달에서 누락된 채 발견됐다. 연출·타이밍·게이트는 전부 여기 한 곳에
//    있고, 호출부는 **문구와 pill만** 넘긴다. 새 축하 표면이 생겨도 여기를 쓴다.
//
// 연출 순서(박자): 모달 페이드 인 → 캐릭터 그림 도착(onLoad) + UI 한가함(InteractionManager)
//                → 팝인(M.dur.slow) → 색종이. 각 게이트의 근거는 아래 주석에.

interface Props {
  visible: boolean;
  onClose: () => void;
  /** testID 접두 — 캐릭터는 `<prefix>.character`, 그림은 `<prefix>.character.image`. */
  testIDPrefix: string;
  /** 캐릭터 **위** pill(연속 목표달성 등). 없으면 생략한다. */
  badge?: ReactNode;
  title: string;
  sub: string;
  /** 문구 **아래** pill(보상 시간조각·주간 완주 등). 없으면 생략한다. */
  footer?: ReactNode;
  ctaLabel: string;
}

// 축하 pill 공통 모양 — 배지·보상·완주 표기가 전부 같은 알약이다. 여백만 호출부가 얹는다.
export function CelebrationPill({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return <View style={[s.pill, style]}>{children}</View>;
}

export function CelebrationModal({
  visible,
  onClose,
  testIDPrefix,
  badge,
  title,
  sub,
  footer,
  ctaLabel,
}: Props) {
  // 카드 위치·폭(오버레이 좌표) — 컨페티가 카드를 장애물로 취급할 때 쓴다. 노출당 1회만 기록한다.
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
  // ⚠️ cardRect도 함께 되돌린다 — 카드 높이는 문구 길이·회전에 따라 노출마다 달라지는데,
  //    첫 노출 좌표를 계속 들고 있으면 두 번째 축하에서 조각이 허공에 쌓인다.
  useEffect(() => {
    if (visible) return;
    setCharReady(false);
    setUiIdle(false);
    setPopDone(false);
    setCardRect(null);
  }, [visible]);
  // 팝인 완료 → 색종이. reduce면 지연이 0이 되지만 **타이머 자체는 남긴다**(정책 D7) —
  // 없애면 색종이 게이트가 영영 열리지 않는다. (색종이 자체의 reduce 처리는 ConfettiBurst 담당)
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
          {badge}
          {/* 팝 진입 — 카드에 overflow 제약이 없어 1.25배 오버슛이 잘리지 않는다.
              호흡(AnimatedCharacter)은 여기 쓰지 않는다: 무한 루프는 화면당 1개 상한이고,
              축하 순간에 필요한 건 '들어오는 팝'이지 상시 생명 신호가 아니다.
              ⚠️ 팝은 마운트가 아니라 **그림이 실제로 올라온 뒤**(onLoad) 시작한다 — 커스텀 누끼
              디코딩이 600ms보다 늦으면 팝이 안 보이는 사이 끝나 캐릭터가 최종 크기로 툭 나타난다
              (codex 리뷰). 그 전에는 opacity 0으로 접어 둬 '컸다가 줄어드는' 프레임도 없앤다. */}
          {/* ⚠️ 팝 래퍼는 **노출마다 마운트**돼야 한다. 이 모달은 visible=false인 동안에도 부모에
              마운트돼 있어 화면의 useMotion 결정이 실제 축하보다 훨씬 전에 얼린다 — 그 뒤 설정을
              바꾸고 열면 과거 결정으로 팝이 재생되거나 생략된다(codex 리뷰). key로 다시 마운트시킨다.
              ⚠️ 게이트가 `charShown`인 이유: InteractionManager가 늦는 전환에서 모달이 안정되기 전에 팝이
              끝나 팝→색종이 박자가 깨진다. 확정 전에는 pending(opacity 0) — 팝의 시작 프레임이다. */}
          <Enter
            key={visible ? 'shown' : 'hidden'}
            testID={`${testIDPrefix}.character`}
            preset={pop()}
            style={charShown ? undefined : s.charPending}
            active={charShown}
          >
            <CharacterImage
              size={104}
              sourceUri={activeSource ?? undefined}
              testID={`${testIDPrefix}.character.image`}
              onLoad={() => setCharReady(true)}
            />
          </Enter>
          <Text style={s.title}>{title}</Text>
          <Text style={s.sub}>{sub}</Text>
          {footer}
          <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={onClose}>
            <Text style={s.ctaText}>{ctaLabel}</Text>
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
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.sm,
  },
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
