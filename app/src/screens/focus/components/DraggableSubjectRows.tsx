import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  Animated,
  PanResponder,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated from 'react-native-reanimated';
import { T } from '@/constants/theme';
import { playTapSound } from '@/utils/sound';
import { hmsCompact } from '../format';
import type { Subject } from '../types';
import { glassSlide, glassPill } from '@/components/liquidGlass';
import { useMotion } from '@/hooks/useMotion';

// 순수 RN(PanResponder+Animated) 드래그 정렬 리스트.
// ⋮ 를 잡고 위아래로 움직이면 순서 변경. 화면 가장자리 근처로 끌면 자동 스크롤.
// (reanimated4가 New Arch를 요구해 구 아키텍처에선 못 써서 직접 구현. New Arch 전환 시 draggable-flatlist로 교체 가능)
const ROW_H = 54; // 행 높이(고정) — 드래그 위치 계산의 기준
const GAP = 10;
const SLOT = ROW_H + GAP;
const EDGE = 64; // 위/아래 이 범위 안이면 자동 스크롤
const STEP = 12; // 자동 스크롤 한 틱 이동량(px)

type MenuAnchor = { x: number; y: number; w: number; h: number };

interface Props {
  subjects: Subject[];
  activeId?: string;
  onReorder: (next: Subject[]) => void;
  onPressRow: (sub: Subject) => void;
  onOpenColor: (id: string, anchor: MenuAnchor) => void; // 색 네모 탭 — 색 선택 팝오버 열기
  onOpenMenu: (id: string, anchor: MenuAnchor) => void;
  footer?: ReactNode;
}

export function DraggableSubjectRows({
  subjects,
  activeId,
  onReorder,
  onPressRow,
  onOpenColor,
  onOpenMenu,
  footer,
}: Props) {
  // 화면이 SafeAreaView edges={['top']}이라 하단 인셋은 여기서 직접 챙긴다 —
  // 없으면 끝까지 스크롤해도 footer(새 과목 추가)가 홈 인디케이터에 가려 잘린다(GROMO-886).
  const insets = useSafeAreaInsets();
  // '동작 줄이기'면 선택 알약이 미끄러지지 않고 활성 행에 즉시 놓인다(위치·표시는 그대로).
  const m = useMotion();
  // ⚠️ 정렬 타이밍은 **실행 시점의** 값으로 판정한다. m을 의존성에 넣으면 드래그 중 재구독이
  //    걸려 PanResponder가 갈아끼워진다(D-29). 확정 전(ready=false)의 보수적 true로 "즉시
  //    완료"를 굳히면 설정을 켜지 않은 사용자가 정렬 연출을 잃는다(D-30).
  const settleInstantRef = useRef(false);
  settleInstantRef.current = m.ready && m.reduce;
  // ⚠️ **진행 중인 안착도 멈춘다.** 위 ref는 앞으로의 호출만 즉시 처리할 뿐, 이미 시작된
  //    160ms Animated.timing은 계속 돈다 — 재정렬 도중 접근성 단축키로 설정을 켜면 행이
  //    그대로 미끄러진다(codex 리뷰). 켜지는 순간 모든 행을 지금 순서의 제자리로 확정한다.
  //    ⚠️ 단, **지금 손가락이 잡고 있는 행은 건너뛴다.** 그 행은 안착 애니메이션 중이 아니라
  //       손가락을 추종하는 중이다. 여기서 슬롯으로 밀면 손가락 아래에서 제자리로 튄 뒤 다음
  //       move 이벤트에 다시 손가락 위치로 돌아온다(codex 리뷰). settleOthers()가 드래그 행을
  //       빼는 것과 같은 이유다 — 확정 대상은 **실제로 Animated.timing 중인 나머지 행**이다.
  useEffect(() => {
    if (!settleInstantRef.current) return;
    orderRef.current.forEach((id, i) => {
      if (id === dragIdRef.current) return;
      const v = tops.current[id];
      if (!v) return;
      v.stopAnimation(() => v.setValue(i * SLOT));
    });
  }, [m.ready, m.reduce]);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0); // 현재 스크롤 오프셋
  const viewportH = useRef(0); // 스크롤 보이는 높이
  const listTop = useRef(0); // 스크롤 뷰포트의 화면(window) 상단 y
  const contentH = subjects.length * SLOT;

  const [dragId, setDragId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const orderRef = useRef<string[]>(subjects.map((x) => x.id)); // 드래그 중 라이브 순서
  const subjectsRef = useRef(subjects); // 스테일 클로저 방지
  subjectsRef.current = subjects;

  const tops = useRef<Record<string, Animated.Value>>({});
  const dotRefs = useRef<Record<string, View | null>>({});
  const chipRefs = useRef<Record<string, View | null>>({});
  const panders = useRef<Record<string, ReturnType<typeof PanResponder.create>>>({});
  const grabOffset = useRef(0); // 잡은 지점의 행 내부 오프셋
  const fingerY = useRef(0); // 뷰포트 기준 손가락 y
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 각 행의 top(Animated) 준비
  subjects.forEach((sub, i) => {
    if (!tops.current[sub.id]) tops.current[sub.id] = new Animated.Value(i * SLOT);
  });
  // 드래그 중이 아닐 때만 순서/위치를 subjects에 맞춰 리셋
  useEffect(() => {
    if (dragIdRef.current) return;
    orderRef.current = subjects.map((x) => x.id);
    subjects.forEach((sub, i) => tops.current[sub.id]?.setValue(i * SLOT));
  }, [subjects]);

  function stopAuto() {
    if (autoTimer.current) {
      clearInterval(autoTimer.current);
      autoTimer.current = null;
    }
  }

  // 라이브 순서 기준으로 드래그 중이 아닌 행들을 제자리로 애니메이트
  function settleOthers() {
    orderRef.current.forEach((id, i) => {
      if (id === dragIdRef.current) return;
      // ⚠️ 드래그 **추종**은 끄지 않는다(손가락을 따라오는 건 직접 조작이다). 끄는 건 손을 뗀
      //    뒤의 **안착·정렬 타이밍**뿐이다 — 그건 시간 기반 애니메이션이다.
      if (settleInstantRef.current) {
        tops.current[id].setValue(i * SLOT);
        return;
      }
      Animated.timing(tops.current[id], {
        toValue: i * SLOT,
        duration: 160,
        useNativeDriver: false,
      }).start();
    });
  }

  // 손가락 위치(+스크롤)로 드래그 행 top 갱신 + 필요 시 순서 재배치
  function updateHover() {
    const id = dragIdRef.current;
    if (!id) return;
    const top = fingerY.current + scrollY.current - grabOffset.current;
    tops.current[id].setValue(top);
    const hover = Math.max(0, Math.min(orderRef.current.length - 1, Math.round(top / SLOT)));
    const cur = orderRef.current.indexOf(id);
    if (hover !== cur) {
      const next = [...orderRef.current];
      next.splice(cur, 1);
      next.splice(hover, 0, id);
      orderRef.current = next;
      settleOthers();
    }
  }

  function maybeAutoScroll() {
    const y = fingerY.current;
    const near = y < EDGE || y > viewportH.current - EDGE;
    if (!near) {
      stopAuto();
      return;
    }
    if (autoTimer.current) return;
    autoTimer.current = setInterval(() => {
      if (!dragIdRef.current) return;
      const dir = fingerY.current < EDGE ? -STEP : STEP;
      const maxY = Math.max(0, contentH - viewportH.current);
      const nextY = Math.min(maxY, Math.max(0, scrollY.current + dir));
      if (nextY === scrollY.current) return;
      scrollY.current = nextY;
      scrollRef.current?.scrollTo({ y: nextY, animated: false });
      updateHover();
    }, 16);
  }

  function panFor(id: string) {
    if (panders.current[id]) return panders.current[id];
    const pan = PanResponder.create({
      // 탭은 메뉴(TouchableOpacity)로 흘려보내고, 세로로 움직일 때만 드래그 시작
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
      onPanResponderGrant: (e) => {
        dragIdRef.current = id;
        setDragId(id);
        orderRef.current = subjectsRef.current.map((x) => x.id);
        const idx = orderRef.current.indexOf(id);
        fingerY.current = e.nativeEvent.pageY - listTop.current;
        grabOffset.current = fingerY.current + scrollY.current - idx * SLOT;
      },
      onPanResponderMove: (e) => {
        fingerY.current = e.nativeEvent.pageY - listTop.current;
        updateHover();
        maybeAutoScroll();
      },
      onPanResponderRelease: () => finishDrag(id),
      onPanResponderTerminate: () => finishDrag(id),
    });
    panders.current[id] = pan;
    return pan;
  }

  function finishDrag(id: string) {
    stopAuto();
    const pos = orderRef.current.indexOf(id);
    if (pos >= 0) {
      // 놓은 행의 안착도 같은 규칙 — '동작 줄이기'면 미끄러지지 않고 제자리에 놓인다.
      if (settleInstantRef.current) {
        tops.current[id].setValue(pos * SLOT);
      } else {
        Animated.timing(tops.current[id], {
          toValue: pos * SLOT,
          duration: 160,
          useNativeDriver: false,
        }).start();
      }
    }
    const byId = new Map(subjectsRef.current.map((x) => [x.id, x]));
    const next = orderRef.current.map((oid) => byId.get(oid)).filter((x): x is Subject => !!x);
    dragIdRef.current = null;
    setDragId(null);
    if (next.length === subjectsRef.current.length) onReorder(next);
  }

  useEffect(() => () => stopAuto(), []);

  // GROMO-848 리퀴드 글래스 — 선택 과목 행 위의 유리 알약. 선택이 바뀌면 그 행으로
  // 오버슛 슬라이드(./liquidGlass). 행 top이 index * SLOT 고정이라 측정 없이 계산.
  const activeIndex = activeId ? subjects.findIndex((x) => x.id === activeId) : -1;

  return (
    <ScrollView
      ref={scrollRef}
      style={s.flex1}
      scrollEnabled={dragId === null}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(e) => {
        scrollY.current = e.nativeEvent.contentOffset.y;
      }}
      onLayout={(e) => {
        viewportH.current = e.nativeEvent.layout.height;
        e.currentTarget.measureInWindow((_x, y) => {
          listTop.current = y;
        });
      }}
      contentContainerStyle={[s.content, { paddingBottom: insets.bottom + T.space.lg }]}
    >
      <View style={{ height: contentH }}>
        {subjects.map((sub, i) => {
          const selected = sub.id === activeId;
          const isDrag = dragId === sub.id;
          return (
            <Animated.View
              key={sub.id}
              style={[
                s.rowWrap,
                isDrag ? s.rowWrapDrag : s.rowWrapIdle,
                { top: tops.current[sub.id] },
              ]}
            >
              <TouchableOpacity
                testID={`focus.subject.item.${i}`}
                style={[s.row, selected && s.rowSelected, isDrag && s.rowActive]}
                activeOpacity={0.85}
                // 행 계열은 스케일 없이 사운드만 — transform은 드래그 PanResponder의 좌표
                // 계산과 간섭하고, 같은 터치 영역이 롱프레스 메뉴·순서 드래그도 받으므로
                // 햅틱을 주면 '주요 CTA' 신호가 잘못 나간다(집중 시작 햅틱은 방식 선택 시트의
                // 시작 버튼에만). 발화 시점은 PressableScale과 맞춰 press-in.
                onPressIn={playTapSound}
                onPress={() => onPressRow(sub)}
                // 행 길게 누르기 — ⋮ 위치를 앵커로 이름편집/삭제 팝오버
                onLongPress={() =>
                  dotRefs.current[sub.id]?.measureInWindow((x, y, w, h) =>
                    onOpenMenu(sub.id, { x, y, w, h }),
                  )
                }
                delayLongPress={350}
              >
                <View style={[s.iconBox, selected ? s.iconBoxSelected : s.iconBoxIdle]}>
                  <Ionicons name="play" size={13} color={selected ? T.white : T.accent} />
                </View>
                <Text style={s.rowName} numberOfLines={1}>
                  {sub.name}
                </Text>
                <Text style={s.rowTime}>{hmsCompact(sub.accumulatedSeconds)}</Text>
                {/* 대표색 네모 — 탭하면 색 선택 팝오버(위치는 측정해서 올림) */}
                <View
                  collapsable={false}
                  ref={(r) => {
                    chipRefs.current[sub.id] = r;
                  }}
                >
                  <TouchableOpacity
                    hitSlop={6}
                    activeOpacity={0.7}
                    // 중첩 터처블이라 부모 행의 onPressIn이 오지 않는다 — 실제 동작이 있는
                    // 버튼이므로 여기서 직접 사운드를 낸다(행 계열이라 스케일·햅틱은 없음)
                    onPressIn={playTapSound}
                    onPress={() =>
                      chipRefs.current[sub.id]?.measureInWindow((x, y, w, h) =>
                        onOpenColor(sub.id, { x, y, w, h }),
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${sub.name} 대표색 변경`}
                    style={[s.colorChip, { backgroundColor: sub.color }]}
                  />
                </View>
                {/* ⋮ 영역: PanResponder(드래그) + 내부 TouchableOpacity(탭=메뉴) */}
                <View
                  style={s.moreBtn}
                  collapsable={false}
                  ref={(r) => {
                    dotRefs.current[sub.id] = r;
                  }}
                  {...panFor(sub.id).panHandlers}
                >
                  <TouchableOpacity
                    hitSlop={8}
                    activeOpacity={0.6}
                    // 같은 이유로 사운드만 — 이 영역은 PanResponder(순서 드래그)도 받으므로
                    // transform(스케일)을 얹으면 드래그 좌표 계산과 간섭한다
                    onPressIn={playTapSound}
                    onPress={() =>
                      dotRefs.current[sub.id]?.measureInWindow((x, y, w, h) =>
                        onOpenMenu(sub.id, { x, y, w, h }),
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${sub.name} 메뉴`}
                  >
                    <Ionicons name="ellipsis-vertical" size={16} color={T.inkMuted} />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </Animated.View>
          );
        })}
        {activeIndex >= 0 && (
          <Reanimated.View
            pointerEvents="none"
            style={[
              s.glass,
              glassPill,
              { transform: [{ translateY: activeIndex * SLOT }] },
              m.css(glassSlide),
            ]}
          />
        )}
      </View>
      {footer}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1 },
  content: { paddingHorizontal: T.space.xxl, paddingTop: T.space.sm },
  rowWrap: { position: 'absolute', left: 0, right: 0, height: ROW_H },
  // 드래그 중인 행만 다른 행 위로 떠오르게
  rowWrapDrag: { zIndex: 10 },
  rowWrapIdle: { zIndex: 1 },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingHorizontal: T.space.md,
  },
  rowSelected: { borderColor: T.accent },
  rowActive: {
    borderColor: T.accent,
    shadowColor: T.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxIdle: { backgroundColor: T.caramel },
  iconBoxSelected: { backgroundColor: T.accent },
  // 유리 알약 래퍼 — 행 카드가 불투명이라 위에 얹는다(드래그 중 행 zIndex 10 아래).
  // ⚠️ 글자 위 오버레이라 네이티브 리퀴드 글래스 금지 — 유리가 뒤 글자를 블러시켜 안 보인다.
  //    반투명 틴트(glassPill)만 사용.
  glass: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: ROW_H,
    borderRadius: 14,
    zIndex: 5,
  },
  rowName: { flex: 1, ...T.text.label, fontWeight: '700', color: T.ink },
  rowTime: { ...T.text.caption, color: T.inkMuted, fontVariant: ['tabular-nums'] },
  colorChip: { width: 19, height: 19, borderRadius: 6 },
  moreBtn: { width: 30, height: '100%', alignItems: 'center', justifyContent: 'center' },
});
