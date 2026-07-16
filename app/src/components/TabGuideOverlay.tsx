import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T, withAlpha } from '@/constants/theme';

// GROMO-652 — 탭 첫 진입 사용법 안내(코치마크). 캐릭터가 말풍선으로 화면 기능을 설명한다.
// 스텝에 anchor(ref)가 있으면 해당 요소만 밝게 뚫린 스포트라이트(딤 4분할)와 강조 링을 그린다.
// 화면 아무 곳이나 탭하면 다음 스텝, 마지막 스텝에서 닫히며 storageKey에 노출 완료를 기록 —
// 같은 탭에서는 다시 보이지 않는다(기기 로컬, 재설치 시 재노출).
// Modal(transparent)이라 탭바 위까지 덮는다. anchor 좌표는 measureInWindow(윈도) 기준으로 일치.

export interface GuideStep {
  text: string;
  character: ImageSourcePropType; // 스텝별 캐릭터 표정 (character_hi 등)
  anchor?: RefObject<View | null>; // 스포트라이트 대상 — 없으면 전체 딤
  rect?: Rect; // 정적 스포트라이트 좌표(윈도 기준) — 다른 트리의 요소(탭바 FAB 등)용
  round?: boolean; // 스포트라이트 링을 원형으로 (FAB 등 원형 버튼)
  // 측정 전에 실행 — 앵커가 화면 밖이면 여기서 스크롤로 끌어온 뒤 resolve(GROMO-652 통계 투어).
  // prepare가 있는 스텝은 준비 동안 전체 딤으로 전환된다.
  prepare?: () => Promise<void> | void;
}

const HOLE_PAD = 8; // 앵커 주위 여유
const HOLE_PAD_ROUND = 5; // 원형은 버튼 크기에 딱 맞게 — FAB 파임 호(NOTCH_R)와 비슷한 둘레
const CHAR_SIZE = 96;

type Rect = { x: number; y: number; w: number; h: number };
type Hole = Rect | null;

function padRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

export function TabGuideOverlay({
  storageKey,
  steps,
  onFinish,
}: {
  storageKey: string;
  steps: GuideStep[];
  onFinish?: () => void; // 마지막 스텝을 닫은 직후 — 투어 중 옮긴 스크롤 원복 등
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [idx, setIdx] = useState(0);
  const [hole, setHole] = useState<Hole>(null);
  const holeReq = useRef(0); // 늦게 도착한 이전 스텝 측정 무시용
  // steps는 렌더마다 새 배열일 수 있어 ref로 최신값만 읽는다 — 스텝 전환 시에만 재측정
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((v) => {
      if (v !== '1') setVisible(true);
    });
  }, [storageKey]);

  // 스텝이 바뀔 때마다 스포트라이트 결정 — prepare(스크롤 등) → rect 또는 앵커 측정. 없으면 전체 딤
  const step = steps[idx];
  useEffect(() => {
    if (!visible) return;
    const req = ++holeReq.current;
    const st = stepsRef.current[idx];
    (async () => {
      if (st?.prepare) {
        setHole(null); // 스크롤로 화면이 움직이는 동안엔 전체 딤
        try {
          await st.prepare();
        } catch {}
        if (req !== holeReq.current) return;
      }
      const pad = st?.round ? HOLE_PAD_ROUND : HOLE_PAD;
      if (st?.rect) {
        setHole(padRect(st.rect, pad));
        return;
      }
      const node = st?.anchor?.current;
      if (!node) {
        setHole(null);
        return;
      }
      node.measureInWindow((x, y, w, h) => {
        if (req !== holeReq.current) return;
        setHole(w > 0 && h > 0 ? padRect({ x, y, w, h }, pad) : null);
      });
    })();
  }, [visible, idx]);

  if (!visible || !step) return null;

  function advance() {
    if (idx + 1 < steps.length) {
      setIdx(idx + 1);
      return;
    }
    setVisible(false);
    AsyncStorage.setItem(storageKey, '1').catch(() => {});
    onFinish?.();
  }

  // 원형 컷아웃 보더 두께 — 구멍에서 화면 가장자리까지 어느 방향이든 덮도록 최대변 사용
  const cutBw = Math.max(winW, winH);

  // 말풍선+캐릭터를 스포트라이트와 겹치지 않는 쪽(위/아래 중 넓은 쪽)에 배치
  const holeCenterY = hole ? hole.y + hole.h / 2 : winH / 2;
  const placeBelow = hole !== null && holeCenterY < winH / 2;
  const panelStyle = placeBelow
    ? { top: (hole ? hole.y + hole.h : 0) + 18 }
    : { bottom: winH - (hole ? hole.y : winH * 0.62) + 18 };

  return (
    <Modal transparent statusBarTranslucent animationType="fade" onRequestClose={advance}>
      <Pressable style={s.flex1} onPress={advance}>
        {/* 딤 — 원형 스텝은 거대 원형 보더로 동그란 구멍을, 사각은 구멍 주위 4분할. 없으면 전체 */}
        {hole ? (
          <>
            {step.round ? (
              // cutBw(화면 최대변)만큼 두꺼운 원형 보더가 구멍 밖 전부를 딤으로 덮는다
              <View
                style={[
                  s.roundCut,
                  {
                    top: hole.y - cutBw,
                    left: hole.x - cutBw,
                    width: hole.w + cutBw * 2,
                    height: hole.h + cutBw * 2,
                    borderRadius: cutBw + hole.w / 2,
                    borderWidth: cutBw,
                  },
                ]}
              />
            ) : (
              <>
                <View style={[s.dim, s.dimTop, { height: Math.max(0, hole.y) }]} />
                <View style={[s.dim, s.dimBottom, { top: hole.y + hole.h }]} />
                <View
                  style={[
                    s.dim,
                    s.dimLeft,
                    { top: hole.y, width: Math.max(0, hole.x), height: hole.h },
                  ]}
                />
                <View
                  style={[
                    s.dim,
                    s.dimRight,
                    { top: hole.y, left: hole.x + hole.w, height: hole.h },
                  ]}
                />
              </>
            )}
            <View
              pointerEvents="none"
              style={[
                s.ring,
                { top: hole.y, left: hole.x, width: hole.w, height: hole.h },
                step.round && { borderRadius: hole.h / 2 },
              ]}
            />
          </>
        ) : (
          <View style={[s.dim, StyleSheet.absoluteFillObject]} />
        )}

        {/* 캐릭터 + 말풍선 */}
        <View style={[s.panel, panelStyle, { maxWidth: winW - 40 }]} pointerEvents="none">
          <View style={s.bubble}>
            <Text style={s.bubbleText}>{step.text}</Text>
            <View style={s.bubbleMeta}>
              <View style={s.dots}>
                {steps.map((_, i) => (
                  <View key={i} style={[s.dot, i === idx && s.dotOn]} />
                ))}
              </View>
              <Text style={s.hint}>{idx + 1 < steps.length ? '탭하여 계속' : '탭하여 시작'}</Text>
            </View>
            <View style={s.bubbleTail} />
          </View>
          <Image source={step.character} style={s.character} resizeMode="contain" />
        </View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1 },
  // SheetShell 딤과 같은 색 계열, 스포트라이트 대비를 위해 더 진하게
  dim: { position: 'absolute', backgroundColor: withAlpha(T.night.bottom, 0.62) },
  dimTop: { top: 0, left: 0, right: 0 },
  dimBottom: { left: 0, right: 0, bottom: 0 },
  dimLeft: { left: 0 },
  dimRight: { right: 0 },
  // 원형 컷아웃 — 투명한 원 중심 + 딤 색 보더
  roundCut: { position: 'absolute', borderColor: withAlpha(T.night.bottom, 0.62) },
  ring: {
    position: 'absolute',
    borderRadius: 16,
    borderWidth: 2.5,
    borderColor: T.accent,
  },
  panel: { position: 'absolute', alignSelf: 'center', alignItems: 'center' },
  bubble: {
    backgroundColor: T.white,
    borderRadius: 18,
    paddingVertical: T.space.lg,
    paddingHorizontal: T.space.xl,
    shadowColor: T.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  bubbleText: { ...T.text.label, fontWeight: '600', color: T.ink, lineHeight: 21 },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: T.space.md,
  },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.paperAlt },
  dotOn: { backgroundColor: T.accent },
  hint: { ...T.text.caption, color: T.inkMuted },
  // 말풍선 꼬리 — 캐릭터 쪽(아래 중앙)으로
  bubbleTail: {
    position: 'absolute',
    bottom: -8,
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: T.white,
  },
  character: { width: CHAR_SIZE, height: CHAR_SIZE, marginTop: T.space.md },
});
