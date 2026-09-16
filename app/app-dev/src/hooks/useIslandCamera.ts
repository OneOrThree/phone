import { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { IslandCamera, XY, islandBaseScale } from '@/utils/island-camera';

export function useIslandCamera(size: { w: number; h: number }) {
  const camera = useRef(new IslandCamera()).current;
  const viewport = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const offset = useRef(new Animated.ValueXY()).current;
  const zoom = useRef(new Animated.Value(1)).current;
  const suppressed = useRef(false);
  const gesture = useRef<{
    count: number;
    start: XY;
    last: XY;
    distance: number;
    scale: number;
    anchor: XY;
  } | null>(null);
  const base = useRef(islandBaseScale(size.w, size.h));
  base.current = islandBaseScale(size.w, size.h);
  const publish = () => {
    offset.setValue({
      x: camera.width / 2 - (camera.center.x - 768) * camera.scale,
      y: camera.height / 2 - camera.center.y * camera.scale,
    });
    zoom.setValue(camera.scale / base.current);
  };
  useEffect(() => {
    camera.resize(size.w, size.h);
    publish();
  }, [size.w, size.h]);
  const points = (e: any): XY[] =>
    [...e.nativeEvent.touches].map((t: any) => ({
      x: t.pageX - origin.current.x,
      y: t.pageY - origin.current.y,
    }));
  const begin = (ps: XY[]) => {
    if (!ps.length) {
      gesture.current = null;
      return;
    }
    const a = ps[0],
      b = ps[1] || a,
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    gesture.current = {
      count: ps.length,
      start: a,
      last: a,
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      scale: camera.scale,
      anchor: camera.world(mid),
    };
  };
  const handlers = useMemo(
    () =>
      PanResponder.create({
        // Observe the first finger without taking taps away from the building Pressables.
        onStartShouldSetPanResponderCapture: (e) => {
          viewport.current?.measureInWindow((x, y) => {
            origin.current = { x, y };
          });
          const ps = points(e);
          if (ps.length === 1) {
            suppressed.current = false;
            begin(ps);
          }
          if (ps.length >= 2) {
            suppressed.current = true;
            begin(ps);
            return true;
          }
          return false;
        },
        onMoveShouldSetPanResponderCapture: (e) => {
          const ps = points(e),
            g = gesture.current;
          if (!g || !ps.length) return false;
          const take = ps.length >= 2 || Math.hypot(ps[0].x - g.start.x, ps[0].y - g.start.y) > 8;
          if (take) suppressed.current = true;
          return take;
        },
        onPanResponderGrant: (e) => {
          suppressed.current = true;
          if (!gesture.current) begin(points(e));
        },
        onPanResponderMove: (e) => {
          const ps = points(e),
            g = gesture.current;
          if (!ps.length) return;
          if (!g || g.count !== ps.length) {
            begin(ps);
            return;
          }
          if (ps.length >= 2) {
            const [a, b] = ps,
              mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            camera.zoom((g.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.distance, mid, g.anchor);
          } else {
            camera.pan(ps[0].x - g.last.x, ps[0].y - g.last.y);
            g.last = ps[0];
          }
          publish();
        },
        onPanResponderEnd: (e) => {
          if (e.nativeEvent.touches.length) begin(points(e));
        },
        onPanResponderRelease: () => {
          gesture.current = null;
        },
        onPanResponderTerminate: () => {
          gesture.current = null;
          suppressed.current = true;
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  ).panHandlers;
  return {
    viewport,
    handlers: {
      ...handlers,
      onTouchStart: (e: any) => {
        const ps = points(e);
        if (ps.length >= 2 && gesture.current?.count !== ps.length) {
          suppressed.current = true;
          begin(ps);
        }
      },
    },
    camera,
    offset,
    zoom,
    // page coordinates remain stable when the world has been translated/scaled.
    tapPoint: (pageX: number, pageY: number, onPoint: (p: XY) => void) => {
      // Measure at release, after page transitions and orientation changes settle.
      // An onLayout measurement may still contain the entering page's offset.
      viewport.current?.measureInWindow((x, y) => {
        origin.current = { x, y };
        if (suppressed.current) return;
        const p = camera.world({ x: pageX - x, y: pageY - y });
        onPoint({ x: p.x - 768, y: p.y });
      });
    },
    measure: () =>
      viewport.current?.measureInWindow((x, y) => {
        origin.current = { x, y };
      }),
    canTap: () => !suppressed.current,
  };
}
