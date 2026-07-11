import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Animated, PanResponder, ScrollView, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { T } from '@/constants/theme';

// 통계 카드 순서 편집(GROMO-762) — 별도 목록 화면 없이, 실제 카드 오른쪽 위에 6점 핸들을 띄우고
// 핸들을 잡아 카드 자체를 위아래로 끌면 순서가 바뀐다. 드래그를 놓을 때마다 onReorder로 확정.
// 카드 높이가 제각각이라: 평소엔 일반 플로우로 두고 onLayout으로 각 카드의 y·높이를 기록해 두었다가,
// 드래그가 시작되는 순간 전체를 absolute로 얼리고(freeze) 측정값 기반으로 슬롯을 계산·애니메이트한다.
// 순수 RN(PanResponder+Animated) 구현 — reanimated4가 New Arch를 요구해 직접 구현(DraggableSubjectRows와 동일 기법).
const EDGE = 80; // 뷰포트 위/아래 이 범위 안으로 끌면 자동 스크롤
const STEP = 12; // 자동 스크롤 한 틱 이동량(px)

interface Props {
  cards: { key: string; node: ReactNode }[];
  onReorder: (keys: string[]) => void;
}

export function CardOrderEditor({ cards, onReorder }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0); // 현재 스크롤 오프셋
  const contentH = useRef(0); // 스크롤 콘텐츠 전체 높이(자동 스크롤 상한용)
  const viewportH = useRef(0); // 스크롤 보이는 높이
  const listTop = useRef(0); // 스크롤 뷰포트의 화면(window) 상단 y

  const [dragKey, setDragKey] = useState<string | null>(null);
  const dragKeyRef = useRef<string | null>(null);
  const orderRef = useRef<string[]>(cards.map((x) => x.key)); // 드래그 중 라이브 순서
  const cardsRef = useRef(cards); // 스테일 클로저 방지
  cardsRef.current = cards;

  // 일반 플로우에서 측정한 카드 y·높이(컨테이너 기준) — 드래그 슬롯 계산의 기준값
  const layouts = useRef<Record<string, { y: number; h: number }>>({});
  const gap = useRef(0); // 카드 사이 간격 — 측정값에서 역산(스타일 gap 하드코딩 회피)
  const baseY = useRef(0); // 첫 카드의 y
  const tops = useRef<Record<string, Animated.Value>>({});
  const panders = useRef<Record<string, ReturnType<typeof PanResponder.create>>>({});
  const grabOffset = useRef(0); // 잡은 지점의 카드 내부 오프셋
  const fingerY = useRef(0); // 뷰포트 기준 손가락 y
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [frozenH, setFrozenH] = useState<number | null>(null); // 드래그 중 컨테이너 고정 높이(null=일반 플로우)

  cards.forEach((c) => {
    if (!tops.current[c.key]) tops.current[c.key] = new Animated.Value(0);
  });
  // 드래그 중이 아닐 때만 순서를 cards에 맞춰 리셋
  useEffect(() => {
    if (dragKeyRef.current) return;
    orderRef.current = cards.map((x) => x.key);
  }, [cards]);

  function stopAuto() {
    if (autoTimer.current) {
      clearInterval(autoTimer.current);
      autoTimer.current = null;
    }
  }

  // 순서에 따른 각 카드의 목표 top — 앞 카드들의 (높이+간격) 누적
  function positionsFor(order: string[]): Record<string, number> {
    const pos: Record<string, number> = {};
    let acc = baseY.current;
    for (const k of order) {
      pos[k] = acc;
      acc += (layouts.current[k]?.h ?? 0) + gap.current;
    }
    return pos;
  }

  // 라이브 순서 기준으로 드래그 중이 아닌 카드들을 제자리로 애니메이트
  function settleOthers() {
    const pos = positionsFor(orderRef.current);
    orderRef.current.forEach((k) => {
      if (k === dragKeyRef.current) return;
      Animated.timing(tops.current[k], {
        toValue: pos[k],
        duration: 180,
        useNativeDriver: false,
      }).start();
    });
  }

  // 손가락 위치(+스크롤)로 드래그 카드 top 갱신 + 카드 세로 중심이 속한 슬롯으로 순서 재배치
  function updateHover() {
    const key = dragKeyRef.current;
    if (!key) return;
    const top = fingerY.current + scrollY.current - grabOffset.current;
    tops.current[key].setValue(top);
    const center = top + (layouts.current[key]?.h ?? 0) / 2;
    const order = orderRef.current;
    let acc = baseY.current;
    let hover = order.length - 1;
    for (let i = 0; i < order.length; i++) {
      const slotH = (layouts.current[order[i]]?.h ?? 0) + gap.current;
      if (center < acc + slotH) {
        hover = i;
        break;
      }
      acc += slotH;
    }
    const cur = order.indexOf(key);
    if (hover !== cur) {
      const next = [...order];
      next.splice(cur, 1);
      next.splice(hover, 0, key);
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
      if (!dragKeyRef.current) return;
      const dir = fingerY.current < EDGE ? -STEP : STEP;
      const maxY = Math.max(0, contentH.current - viewportH.current);
      const nextY = Math.min(maxY, Math.max(0, scrollY.current + dir));
      if (nextY === scrollY.current) return;
      scrollY.current = nextY;
      scrollRef.current?.scrollTo({ y: nextY, animated: false });
      updateHover();
    }, 16);
  }

  function panFor(key: string) {
    if (panders.current[key]) return panders.current[key];
    const pan = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        // 현재 측정값으로 전체를 absolute 고정(freeze)하고 드래그 시작
        const order = cardsRef.current.map((x) => x.key);
        orderRef.current = order;
        baseY.current = Math.min(...order.map((k) => layouts.current[k]?.y ?? 0));
        if (order.length > 1) {
          const a = layouts.current[order[0]];
          const b = layouts.current[order[1]];
          if (a && b) gap.current = Math.max(0, b.y - a.y - a.h);
        }
        order.forEach((k) => tops.current[k].setValue(layouts.current[k]?.y ?? 0));
        const last = layouts.current[order[order.length - 1]];
        setFrozenH(last ? last.y + last.h : 0);
        dragKeyRef.current = key;
        setDragKey(key);
        fingerY.current = e.nativeEvent.pageY - listTop.current;
        grabOffset.current = fingerY.current + scrollY.current - (layouts.current[key]?.y ?? 0);
      },
      onPanResponderMove: (e) => {
        fingerY.current = e.nativeEvent.pageY - listTop.current;
        updateHover();
        maybeAutoScroll();
      },
      onPanResponderRelease: () => finishDrag(key),
      onPanResponderTerminate: () => finishDrag(key),
    });
    panders.current[key] = pan;
    return pan;
  }

  function finishDrag(key: string) {
    stopAuto();
    const next = [...orderRef.current];
    const pos = positionsFor(next);
    // 제자리로 안착 애니메이션이 끝난 뒤 순서 확정 → 부모가 새 순서로 렌더하면 일반 플로우로 복귀
    Animated.timing(tops.current[key], {
      toValue: pos[key] ?? 0,
      duration: 180,
      useNativeDriver: false,
    }).start(() => {
      dragKeyRef.current = null;
      setDragKey(null);
      setFrozenH(null);
      if (next.length === cardsRef.current.length) onReorder(next);
    });
  }

  useEffect(() => () => stopAuto(), []);

  const frozen = frozenH !== null;
  return (
    <ScrollView
      ref={scrollRef}
      style={s.flex1}
      scrollEnabled={dragKey === null}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(e) => {
        scrollY.current = e.nativeEvent.contentOffset.y;
      }}
      onContentSizeChange={(_w, h) => {
        contentH.current = h;
      }}
      onLayout={(e) => {
        viewportH.current = e.nativeEvent.layout.height;
        e.currentTarget.measureInWindow((_x, y) => {
          listTop.current = y;
        });
      }}
      contentContainerStyle={s.content}
    >
      <View style={frozen ? { height: frozenH } : s.flow}>
        {cards.map((c) => {
          const isDrag = dragKey === c.key;
          return (
            <Animated.View
              key={c.key}
              onLayout={(e) => {
                if (dragKeyRef.current) return; // freeze 중 측정 무시
                const { y, height } = e.nativeEvent.layout;
                layouts.current[c.key] = { y, h: height };
              }}
              style={[
                frozen ? [s.frozenItem, { top: tops.current[c.key] }] : null,
                isDrag ? s.dragItem : null,
              ]}
            >
              {/* 편집 중엔 카드 내용 터치 차단 — 핸들만 조작 대상 */}
              <View pointerEvents="none">{c.node}</View>
              {/* 6점 핸들 — 카드 오른쪽 위. 잡고 끌면 카드가 통째로 움직인다 */}
              <View style={s.handle} {...panFor(c.key).panHandlers}>
                <MaterialCommunityIcons name="drag-vertical" size={20} color={T.inkSub} />
              </View>
            </Animated.View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1 },
  // StatsScreen s.scroll과 같은 여백 — 편집 모드에서도 카드가 같은 자리에 보이도록
  content: { paddingHorizontal: 18, paddingBottom: 40 },
  flow: { gap: 14 },
  frozenItem: { position: 'absolute', left: 0, right: 0 },
  dragItem: {
    zIndex: 10,
    shadowColor: T.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  handle: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: T.paperAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
