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
import { logTabGuideCompleted } from '@/services/analyticsEvents';

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
  round?: boolean; // 완전 원형 스포트라이트 (FAB 등 원형 버튼)
  radius?: number; // 대상 요소의 모서리 라운드 — 구멍이 요소 모양을 따라가게 (기본 CARD_RADIUS)
  // 측정 전에 실행 — 앵커가 화면 밖이면 여기서 스크롤로 끌어온 뒤 resolve(GROMO-652 통계 투어).
  // prepare가 있는 스텝은 준비 동안 전체 딤으로 전환된다.
  prepare?: () => Promise<void> | void;
}

const HOLE_SCALE = 1.1; // 스포트라이트는 요소의 1.1배 크기(중심 기준)
const CARD_RADIUS = 20; // radius 미지정 시 기본 모서리(카드류)
const CHAR_SIZE = 96;

type Rect = { x: number; y: number; w: number; h: number };
type Hole = Rect | null;

// 중심을 유지한 채 HOLE_SCALE배로 키운 사각형
function scaleRect(r: Rect): Rect {
  const dw = (r.w * (HOLE_SCALE - 1)) / 2;
  const dh = (r.h * (HOLE_SCALE - 1)) / 2;
  return { x: r.x - dw, y: r.y - dh, w: r.w + dw * 2, h: r.h + dh * 2 };
}

export function TabGuideOverlay({
  storageKey,
  steps,
  onFinish,
  visible: controlledVisible,
  completionMode = 'internal',
  allowRequestClose = true,
  testID = 'guide.overlay',
  accessibilityTitle,
}: {
  storageKey: string;
  steps: GuideStep[];
  onFinish?: () => void; // 마지막 스텝을 닫은 직후 — 투어 중 옮긴 스크롤 원복 등
  // groupDeck처럼 별도 queue/controller가 수명을 소유할 때만 사용한다.
  visible?: boolean;
  completionMode?: 'internal' | 'external';
  allowRequestClose?: boolean;
  testID?: string;
  accessibilityTitle?: string;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const viewportKey = `${winW}x${winH}`;
  const [internalVisible, setInternalVisible] = useState(false);
  const [idx, setIdx] = useState(0);
  const [measuredHole, setMeasuredHole] = useState<{
    viewportKey: string;
    value: Hole;
  } | null>(null);
  // 화면 크기가 바뀐 첫 렌더부터 이전 좌표를 숨긴다. 새 anchor 측정이 끝날 때까지 전체 dim이다.
  const hole = measuredHole?.viewportKey === viewportKey ? measuredHole.value : null;
  const holeReq = useRef(0); // 늦게 도착한 이전 스텝 측정 무시용
  const prepareStateRef = useRef<{
    stepIndex: number;
    status: 'pending' | 'completed';
    promise: Promise<void>;
  } | null>(null);
  // steps는 렌더마다 새 배열일 수 있어 ref로 최신값만 읽는다 — 스텝 전환 시에만 재측정
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const controlled = controlledVisible !== undefined;
  const visible = controlled ? controlledVisible : internalVisible;
  const previousVisibleRef = useRef(false);
  // 재개 첫 렌더에서 idx state가 이전 마지막 단계여도 0단계를 사용한다. visible effect의
  // setIdx(0)을 기다리면 같은 commit의 prepare effect가 이전 단계 prepare를 먼저 실행한다.
  const effectiveIdx = visible && !previousVisibleRef.current ? 0 : idx;

  useEffect(() => {
    if (controlled) return;
    AsyncStorage.getItem(storageKey).then((v) => {
      if (v !== '1') setInternalVisible(true);
    });
  }, [controlled, storageKey]);

  useEffect(() => {
    previousVisibleRef.current = visible;
    if (visible) setIdx(0);
  }, [visible]);

  // 스텝이 바뀔 때마다 스포트라이트 결정 — prepare(스크롤 등) → rect 또는 앵커 측정. 없으면 전체 딤
  const step = steps[effectiveIdx];
  useEffect(() => {
    if (!visible) {
      prepareStateRef.current = null;
      return;
    }
    const req = ++holeReq.current;
    const st = stepsRef.current[effectiveIdx];
    const measure = () => {
      if (req !== holeReq.current) return;
      if (st?.rect) {
        setMeasuredHole({ viewportKey, value: scaleRect(st.rect) });
        return;
      }
      const node = st?.anchor?.current;
      if (!node) {
        setMeasuredHole({ viewportKey, value: null });
        return;
      }
      node.measureInWindow((x, y, w, h) => {
        if (req !== holeReq.current) return;
        setMeasuredHole({
          viewportKey,
          value: w > 0 && h > 0 ? scaleRect({ x, y, w, h }) : null,
        });
      });
    };

    // 같은 단계의 prepare가 진행 중이면 viewport 변경 effect도 그 Promise를 함께 기다린다.
    // 완료된 단계는 prepare를 되풀이하지 않고 현재 anchor만 다시 측정한다.
    const existingPrepare =
      prepareStateRef.current?.stepIndex === effectiveIdx ? prepareStateRef.current : null;
    if (existingPrepare) {
      if (existingPrepare.status === 'completed') measure();
      else existingPrepare.promise.then(measure);
      return;
    }

    if (!st?.prepare) {
      measure();
      return;
    }

    setMeasuredHole({ viewportKey, value: null }); // 준비 동안엔 전체 딤
    try {
      const prepared = st.prepare();
      if (prepared && typeof prepared.then === 'function') {
        const prepareState = {
          stepIndex: effectiveIdx,
          status: 'pending' as const,
          promise: Promise.resolve(prepared).then(
            () => undefined,
            () => undefined,
          ),
        };
        prepareStateRef.current = prepareState;
        prepareState.promise.then(() => {
          if (prepareStateRef.current === prepareState) {
            prepareStateRef.current = { ...prepareState, status: 'completed' };
          }
          measure();
        });
      } else {
        prepareStateRef.current = {
          stepIndex: effectiveIdx,
          status: 'completed',
          promise: Promise.resolve(),
        };
        measure();
      }
    } catch {
      prepareStateRef.current = {
        stepIndex: effectiveIdx,
        status: 'completed',
        promise: Promise.resolve(),
      };
      measure();
    }
  }, [visible, effectiveIdx, viewportKey]);

  if (!visible || !step) return null;

  function advance() {
    if (idx + 1 < steps.length) {
      setIdx(idx + 1);
      return;
    }
    if (!controlled) setInternalVisible(false);
    if (completionMode === 'internal') {
      AsyncStorage.setItem(storageKey, '1').catch(() => {});
      // 마지막 스텝까지 보고 닫은 경우만 — guide는 키 접미(home/league/stats 등, GROMO-782)
      logTabGuideCompleted({ guide: storageKey.replace('gromo:guide:', '') });
    }
    onFinish?.();
  }

  // 컷아웃 보더 두께 — 구멍에서 화면 가장자리까지 어느 방향이든 덮도록 최대변 사용
  const cutBw = Math.max(winW, winH);
  // 구멍 모서리 — 원형이면 반지름, 아니면 요소 라운드(1.1배 확대에 맞춰 살짝 키움)
  const holeRadius = step.round ? (hole?.h ?? 0) / 2 : (step.radius ?? CARD_RADIUS) * HOLE_SCALE;

  // 말풍선+캐릭터를 스포트라이트와 겹치지 않는 쪽(위/아래 중 넓은 쪽)에 배치
  const holeCenterY = hole ? hole.y + hole.h / 2 : winH / 2;
  const placeBelow = hole !== null && holeCenterY < winH / 2;
  const panelStyle = placeBelow
    ? { top: (hole ? hole.y + hole.h : 0) + 18 }
    : { bottom: winH - (hole ? hole.y : winH * 0.62) + 18 };

  return (
    <Modal
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={allowRequestClose ? advance : () => {}}
    >
      {/* Maestro E2E — 코치마크 식별·진행용(GROMO-947). 사라질 때까지 탭해서 닫는다. */}
      <Pressable
        testID={testID}
        style={s.flex1}
        onPress={advance}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityTitle ? `${accessibilityTitle}, ` : ''}단계 ${idx + 1}/${steps.length}. ${step.text}. ${idx + 1 < steps.length ? '다음' : '시작'}`}
        accessibilityActions={[
          { name: 'activate', label: idx + 1 < steps.length ? '다음' : '시작' },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') advance();
        }}
      >
        {/* 딤 — 요소 모양(라운드)을 따라 뚫린 컷아웃: cutBw(화면 최대변)만큼 두꺼운 보더가
            구멍 밖 전부를 덮는다(안쪽 모서리 = borderRadius - borderWidth). 구멍 없으면 전체 딤 */}
        {hole ? (
          <>
            <View
              testID={`${testID}.cutout`}
              style={[
                s.cutout,
                {
                  top: hole.y - cutBw,
                  left: hole.x - cutBw,
                  width: hole.w + cutBw * 2,
                  height: hole.h + cutBw * 2,
                  borderRadius: cutBw + holeRadius,
                  borderWidth: cutBw,
                },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                s.ring,
                {
                  top: hole.y,
                  left: hole.x,
                  width: hole.w,
                  height: hole.h,
                  borderRadius: holeRadius,
                },
              ]}
            />
          </>
        ) : (
          <View testID={`${testID}.dim`} style={[s.dim, StyleSheet.absoluteFill]} />
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
              <Text style={s.hint}>{idx + 1 < steps.length ? '다음' : '시작'}</Text>
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
  // 컷아웃 — 투명한 구멍 중심 + 딤 색 보더
  cutout: { position: 'absolute', borderColor: withAlpha(T.night.bottom, 0.62) },
  ring: {
    position: 'absolute',
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
