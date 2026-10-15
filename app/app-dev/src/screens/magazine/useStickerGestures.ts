import { useEffect, useRef } from 'react';
import { GestureResponderEvent, PanResponder, PanResponderGestureState } from 'react-native';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { MAGAZINE_STICKERS, MAGAZINE_TAPES } from '@/constants/magazineAssets';
import {
  CELL_ASPECT,
  EditTarget,
  POS_MAX,
  POS_MIN,
  PromotionLayout,
  bringToFront,
  moveTape,
  normalizeRotation,
  updateSticker,
} from './layout';

/** 스티커가 칸 둘레 8% 까지 걸칠 수 있어 손가락을 받는 판은 칸보다 그만큼 넓다(POS_MIN·POS_MAX). */
export const CANVAS_PAD = -POS_MIN;
/** 아주 작은 스티커도 44pt 안에서는 잡힌다. */
const TOUCH_HALF = semanticTokens.size.tapMin / 2;

type Box = { cx: number; cy: number; hw: number; hh: number; rotation: number };

/** 꾸미기 하나가 칸 안에서 차지하는 상자(px, 칸 왼쪽 위 기준·가운데·반 너비/높이·회전). 모르는 재료면 null. */
export function itemBox(layout: PromotionLayout, target: EditTarget, width: number): Box | null {
  const height = width * CELL_ASPECT;
  if (target.kind === 'tape') {
    const tape = layout.tape;
    const art = tape && MAGAZINE_TAPES[tape.assetId];
    if (!tape || !art) return null;
    const w = componentTokens.magazineCell.tapeWidthRatio * width;
    return {
      cx: tape.x * width,
      cy: tape.y * height,
      hw: w / 2,
      hh: w / art.aspect / 2,
      rotation: tape.rotation,
    };
  }
  const s = layout.stickers[target.index];
  const art = s && MAGAZINE_STICKERS[s.assetId];
  if (!s || !art) return null;
  const w = s.scale * width;
  return {
    cx: s.x * width,
    cy: s.y * height,
    hw: w / 2,
    hh: w / art.aspect / 2,
    rotation: s.rotation,
  };
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

function inside(box: Box, x: number, y: number) {
  // 점을 상자 기준으로 거꾸로 돌려 회전된 스티커도 정확히 잡는다
  const dx = x - box.cx;
  const dy = y - box.cy;
  const c = Math.cos(rad(-box.rotation));
  const s = Math.sin(rad(-box.rotation));
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return (
    Math.abs(lx) <= Math.max(box.hw, TOUCH_HALF) && Math.abs(ly) <= Math.max(box.hh, TOUCH_HALF)
  );
}

/** 칸 좌표(px)의 점 아래 가장 위에 그려진 꾸미기 — 테이프가 스티커보다 위, 스티커는 배열 뒤가 위다. */
export function hitTest(
  layout: PromotionLayout,
  width: number,
  x: number,
  y: number,
): EditTarget | null {
  const tape = itemBox(layout, { kind: 'tape' }, width);
  if (tape && inside(tape, x, y)) return { kind: 'tape' };
  for (let i = layout.stickers.length - 1; i >= 0; i--) {
    const box = itemBox(layout, { kind: 'sticker', index: i }, width);
    if (box && inside(box, x, y)) return { kind: 'sticker', index: i };
  }
  return null;
}

/** 고른 꾸미기의 오른쪽 아래 손잡이(크기·회전, 한 손가락) 위치(px). */
export function handlePoint(layout: PromotionLayout, target: EditTarget, width: number) {
  const box = itemBox(layout, target, width);
  if (!box) return null;
  const c = Math.cos(rad(box.rotation));
  const s = Math.sin(rad(box.rotation));
  return { x: box.cx + box.hw * c - box.hh * s, y: box.cy + box.hw * s + box.hh * c };
}

type Pt = { x: number; y: number };
type Gesture =
  | { mode: 'none'; moved: boolean }
  | { mode: 'drag'; target: EditTarget; start: Pt; base: Pt; moved: boolean }
  | {
      mode: 'handle';
      target: EditTarget;
      center: Pt;
      v0: Pt;
      scale: number;
      rotation: number;
      moved: boolean;
    }
  | {
      mode: 'pinch';
      target: EditTarget;
      d0: number;
      a0: number;
      c0: Pt;
      start: Pt;
      scale: number;
      rotation: number;
      moved: boolean;
    };

/**
 * 칸 위 꾸미기 손가락 조작 — 칸 판 하나에 PanResponder 하나를 건다.
 *  - 한 손가락: 스티커·테이프를 눌러 고르고 끌어 옮긴다. 빈 곳을 톡 누르면 고르기를 푼다.
 *  - 두 손가락: 고른 스티커 크기(두 손가락 거리 비)·회전(두 손가락 각도 차)·위치(가운데 이동)를 함께 바꾼다.
 *  - 고른 꾸미기 오른쪽 아래 손잡이를 한 손가락으로 끌면 크기·회전(두 손가락이 어려울 때).
 * 범위 자르기는 layout.ts 의 같은 함수를 쓴다. 테이프는 크기가 없고, 손을 떼면 가장 가까운 테두리 띠에 붙는다.
 * 움직이는 동안의 값은 한 화면 그리기(requestAnimationFrame)에 한 번만 올려 보낸다.
 * ponytail: 매 프레임 칸을 다시 그린다(스티커 최대 5장) — 실기기에서 끊기면 고른 스티커만 Animated 로 띄운다.
 */
export function useStickerGestures({
  width,
  layout,
  selection,
  enabled,
  onSelect,
  onChange,
}: {
  /** 칸 너비(px) — 판은 이보다 양옆·위아래로 CANVAS_PAD 만큼 넓다. */
  width: number;
  layout: PromotionLayout;
  selection: EditTarget | null;
  enabled: boolean;
  onSelect: (target: EditTarget | null) => void;
  onChange: (layout: PromotionLayout) => void;
}) {
  const latest = useRef({ width, layout, selection, enabled, onSelect, onChange });
  latest.current = { width, layout, selection, enabled, onSelect, onChange };
  const gesture = useRef<Gesture>({ mode: 'none', moved: false });
  const origin = useRef<Pt>({ x: 0, y: 0 });
  // 이번 손동작으로 고치는 중인 레이아웃 — 부모가 다시 그려 props 가 따라오기 전에도 다음 움직임·손 떼기가 이 값을 본다
  const work = useRef<PromotionLayout | null>(null);
  const frame = useRef<number | null>(null);

  const push = (next: PromotionLayout) => {
    work.current = next;
    if (frame.current == null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (work.current && latest.current.enabled) latest.current.onChange(work.current);
      });
  };
  // 하던 손동작을 버린다 — 고치던 배치도, 예약한 그리기도 올려 보내지 않는다
  const abort = () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    work.current = null;
    // moved = 손을 떼도 「빈 곳 톡」(고르기 풀기)으로 보지 않는다
    gesture.current = { mode: 'none', moved: true };
  };
  // 편집이 꺼지면(자정 다시 읽기로 읽기 전용 · 저장 중) 손가락이 칸 위에 있어도 하던 손동작을 바로 버린다.
  // 그대로 두면 마감 전 배치가 다음 움직임·손 떼기에서 읽기 전용 화면을 덮는다
  useEffect(() => {
    if (!enabled) abort();
  }, [enabled]);
  // 판 기준 → 칸 기준 좌표(px)
  const toCell = (pageX: number, pageY: number): Pt => {
    const w = latest.current.width;
    return {
      x: pageX - origin.current.x - CANVAS_PAD * w,
      y: pageY - origin.current.y - CANVAS_PAD * w * CELL_ASPECT,
    };
  };
  const current = () => work.current ?? latest.current.layout;
  const valuesOf = (target: EditTarget) => {
    const l = current();
    if (target.kind === 'tape')
      return l.tape ? { x: l.tape.x, y: l.tape.y, rotation: l.tape.rotation, scale: 1 } : null;
    const st = l.stickers[target.index];
    return st ? { x: st.x, y: st.y, rotation: st.rotation, scale: st.scale } : null;
  };
  const apply = (
    target: EditTarget,
    v: { x?: number; y?: number; scale?: number; rotation?: number },
  ) => {
    const l = current();
    if (target.kind === 'sticker') return push(updateSticker(l, target.index, v));
    if (!l.tape) return;
    // 테이프는 끄는 동안 띠에 붙이지 않고 범위만 자른다 — 손을 뗄 때 붙인다
    const clampPos = (n: number) => Math.min(POS_MAX, Math.max(POS_MIN, n));
    push({
      ...l,
      tape: {
        ...l.tape,
        x: clampPos(v.x ?? l.tape.x),
        y: clampPos(v.y ?? l.tape.y),
        rotation: normalizeRotation(v.rotation ?? l.tape.rotation),
      },
    });
  };

  const startPinch = (
    target: EditTarget,
    touches: GestureResponderEvent['nativeEvent']['touches'],
  ) => {
    const v = valuesOf(target);
    if (!v) return;
    const [a, b] = [
      toCell(touches[0].pageX, touches[0].pageY),
      toCell(touches[1].pageX, touches[1].pageY),
    ];
    gesture.current = {
      mode: 'pinch',
      target,
      d0: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      a0: Math.atan2(b.y - a.y, b.x - a.x),
      c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      start: { x: v.x, y: v.y },
      scale: v.scale,
      rotation: v.rotation,
      moved: gesture.current.moved,
    };
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.enabled,
      onMoveShouldSetPanResponder: () => latest.current.enabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const { pageX, pageY, locationX, locationY } = evt.nativeEvent;
        origin.current = { x: pageX - locationX, y: pageY - locationY };
        const { layout: l, selection: sel, width: w } = latest.current;
        const p = toCell(pageX, pageY);
        const handle = sel && handlePoint(l, sel, w);
        if (sel && handle && Math.hypot(p.x - handle.x, p.y - handle.y) <= TOUCH_HALF) {
          const v = valuesOf(sel)!;
          const center = { x: v.x * w, y: v.y * w * CELL_ASPECT };
          gesture.current = {
            mode: 'handle',
            target: sel,
            center,
            v0: { x: p.x - center.x, y: p.y - center.y },
            scale: v.scale,
            rotation: v.rotation,
            moved: false,
          };
          return;
        }
        let target = hitTest(l, w, p.x, p.y);
        if (!target) {
          gesture.current = { mode: 'none', moved: false };
          return;
        }
        // 누른 스티커는 맨 앞으로 온다(10/15) — 이번 손동작은 앞으로 옮긴 배치·번호로 이어 간다
        const last = l.stickers.length - 1;
        if (target.kind === 'sticker' && target.index !== last) {
          push(bringToFront(current(), target.index));
          target = { kind: 'sticker', index: last };
        }
        latest.current.onSelect(target);
        const v = valuesOf(target)!;
        gesture.current = { mode: 'drag', target, start: v, base: { x: 0, y: 0 }, moved: false };
      },
      // 두 번째 손가락이 닿는 순간을 두 손가락 기준(거리·각도)으로 잡는다 — 첫 움직임까지 기다리면 벌린 만큼을 잃는다
      onPanResponderStart: (evt: GestureResponderEvent) => {
        if (!latest.current.enabled) return abort();
        const g = gesture.current;
        const touches = evt.nativeEvent.touches;
        if (g.mode !== 'none' && g.target.kind === 'sticker' && touches.length >= 2)
          startPinch(g.target, touches);
      },
      onPanResponderMove: (evt: GestureResponderEvent, gs: PanResponderGestureState) => {
        // 효과(useEffect)가 돌기 전 같은 그리기 사이에 온 움직임도 버린다
        if (!latest.current.enabled) return abort();
        const g = gesture.current;
        if (g.mode === 'none') return;
        const w = latest.current.width;
        const h = w * CELL_ASPECT;
        const touches = evt.nativeEvent.touches;
        g.moved = g.moved || Math.abs(gs.dx) + Math.abs(gs.dy) > 2;
        if (touches.length >= 2 && g.target.kind === 'sticker') {
          if (g.mode !== 'pinch') startPinch(g.target, touches);
          const p = gesture.current;
          if (p.mode !== 'pinch') return;
          const [a, b] = [
            toCell(touches[0].pageX, touches[0].pageY),
            toCell(touches[1].pageX, touches[1].pageY),
          ];
          const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          p.moved = true;
          return apply(p.target, {
            scale: (p.scale * Math.hypot(b.x - a.x, b.y - a.y)) / p.d0,
            rotation: p.rotation + deg(Math.atan2(b.y - a.y, b.x - a.x) - p.a0),
            x: p.start.x + (c.x - p.c0.x) / w,
            y: p.start.y + (c.y - p.c0.y) / h,
          });
        }
        if (g.mode === 'pinch') {
          // 두 손가락 중 하나를 뗐다 — 지금 값에서 한 손가락 끌기로 이어 간다
          const v = valuesOf(g.target)!;
          gesture.current = {
            mode: 'drag',
            target: g.target,
            start: v,
            base: { x: gs.dx, y: gs.dy },
            moved: true,
          };
          return;
        }
        if (g.mode === 'handle') {
          const p = toCell(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
          const v = { x: p.x - g.center.x, y: p.y - g.center.y };
          const r0 = Math.hypot(g.v0.x, g.v0.y);
          return apply(g.target, {
            scale: r0 > 0 ? (g.scale * Math.hypot(v.x, v.y)) / r0 : g.scale,
            rotation: g.rotation + deg(Math.atan2(v.y, v.x) - Math.atan2(g.v0.y, g.v0.x)),
          });
        }
        apply(g.target, {
          x: g.start.x + (gs.dx - g.base.x) / w,
          y: g.start.y + (gs.dy - g.base.y) / h,
        });
      },
      onPanResponderRelease: () => finish(),
      onPanResponderTerminate: () => finish(),
    }),
  ).current;

  function finish() {
    if (!latest.current.enabled) return abort();
    const g = gesture.current;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    let final = work.current;
    work.current = null;
    gesture.current = { mode: 'none', moved: false };
    if (g.mode === 'none') {
      if (!g.moved) latest.current.onSelect(null);
      return;
    }
    // 테이프는 손을 떼는 순간 가장 가까운 테두리 띠로 붙는다
    if (final?.tape && g.target.kind === 'tape')
      final = moveTape(final, final.tape.x, final.tape.y);
    if (final) latest.current.onChange(final);
  }

  return responder.panHandlers;
}
