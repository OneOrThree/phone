import { useLayoutEffect, useState } from 'react';
import { Animated, Platform } from 'react-native';

/** 지도 원점의 화면 위치와 배율 — 지도 점 p 는 화면 (left + p.x·scale, top + p.y·scale) 에 놓인다. */
export type MapViewport = { left: number; top: number; scale: number };
type MapShift = { x: number; y: number; k: number };

/**
 * 커밋된 배치(from)를 다른 카메라의 배치(to)처럼 보이게 하는 transform 값.
 * RN 의 [translateX, translateY, scale] 은 뷰(width×height) 가운데 c 를 기준으로 s → c + t + k·(s − c) 다.
 */
export function viewportShift(
  from: MapViewport,
  to: MapViewport,
  width: number,
  height: number,
): MapShift {
  const k = to.scale / from.scale;
  return {
    x: to.left - k * from.left - (1 - k) * (width / 2),
    y: to.top - k * from.top - (1 - k) * (height / 2),
    k,
  };
}

// 웹(react-native-web)에는 네이티브 애니메이션 모듈이 없어 값을 네이티브로 만들면 죽는다 — 웹은 JS 값으로 둔다.
const NATIVE = { useNativeDriver: Platform.OS !== 'web' };

/**
 * 지도 손가락 변환(GROMO-2373). 끄는 동안에는 React 로 지도를 다시 그리지 않고, 지도 컨테이너 하나의 transform 을
 * 네이티브 드라이버 값으로만 바꾼다(setValue → UI 스레드). 손을 떼면 부모가 보이는 카메라를 state 로 한 번 커밋하고,
 * 그 커밋 직후(레이아웃 이펙트) transform 을 항등으로 되돌린다. 새 배치 마운트는 커밋 순간 UI 스레드 큐에 먼저
 * 올라가고 되돌리기는 그 뒤에 들어가므로, 되돌리기가 새 배치보다 먼저 보이는(손 떼기 전 자리로 튀는) 일은 없다.
 * ponytail: 두 작업이 같은 프레임에 묶인다는 보장은 RN 에 없어, 드물게 한 프레임 동안 이동이 두 번 더해져 보일 수
 * 있다. 실기기에서 보이면 바깥 transform 을 남기고 안쪽 View 의 정적 역변환으로 같은 커밋에서 상쇄하는 방식으로 바꾼다.
 * 쉬는 동안 transform 은 항등이라 터치 좌표·접근성·측정은 커밋된 배치 그대로다.
 */
export function useMapGesture<C>(camera: C) {
  const [gesture] = useState(() => {
    const x = new Animated.Value(0, NATIVE),
      y = new Animated.Value(0, NATIVE),
      k = new Animated.Value(1, NATIVE);
    let visible = camera,
      moved = false;
    const set = (shift: MapShift) => {
      x.setValue(shift.x);
      y.setValue(shift.y);
      k.setValue(shift.k);
    };
    return {
      transform: [{ translateX: x }, { translateY: y }, { scale: k }],
      /** 지금 화면에 보이는 카메라 — 끄는 중이면 아직 커밋하지 않은 값. */
      visible: () => visible,
      /** 끄는 중: 커밋된 배치를 next 카메라 자리로 옮겨 보인다. */
      show(next: C, shift: MapShift) {
        visible = next;
        moved = true;
        set(shift);
      },
      /** 손을 뗐을 때 커밋할 카메라. 움직이지 않았으면 null. */
      release: () => (moved ? visible : null),
      /** 카메라 state 가 커밋된 직후 — 움직였던 transform 을 항등으로 되돌린다. */
      committed(next: C) {
        visible = next;
        if (!moved) return;
        moved = false;
        set({ x: 0, y: 0, k: 1 });
      },
    };
  });
  useLayoutEffect(() => gesture.committed(camera), [gesture, camera]);
  return gesture;
}
