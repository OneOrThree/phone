import { useRef, useState } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { T } from '@/constants/theme';

// 커스텀 가로 슬라이더 — core RN PanResponder.
// (@react-native-community/slider가 이 RN/New Arch 셋업에서 미빌드라 직접 구현)
// 부드러운 이동을 위해: ① 부모 ScrollView가 제스처 가로채지 못하게 capture+terminationRequest=false
//                        ② 절대 좌표(pageX) − 트랙 절대 x 로 계산 (thumb 위 터치해도 안 튐)
interface Props {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}

export default function Slider({ min, max, step, value, onChange }: Props) {
  const [width, setWidth] = useState(0);
  const geom = useRef({ x: 0, width: 0 }); // 트랙의 화면상 절대 x + 너비
  const trackRef = useRef<View>(null);
  // PanResponder는 1회 생성되므로 최신 value/onChange는 ref로 참조(스테일 클로저 방지).
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commit = (pageX: number) => {
    const { x, width: w } = geom.current;
    if (w <= 0) return;
    const ratio = Math.max(0, Math.min(1, (pageX - x) / w));
    let v = min + ratio * (max - min);
    v = Math.round(v / step) * step;
    v = Math.max(min, Math.min(max, v));
    if (v !== valueRef.current) onChangeRef.current(v);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // 부모 ScrollView 등에 제스처를 넘기지 않음 → 드래그 끊김 방지
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e: GestureResponderEvent) => commit(e.nativeEvent.pageX),
      onPanResponderMove: (e: GestureResponderEvent) => commit(e.nativeEvent.pageX),
    }),
  ).current;

  const pct = max > min ? (value - min) / (max - min) : 0;

  const measure = () => {
    trackRef.current?.measureInWindow((x, _y, w) => {
      geom.current = { x, width: w };
      setWidth(w);
    });
  };

  return (
    <View
      ref={trackRef}
      style={s.wrap}
      onLayout={measure}
      {...pan.panHandlers}
      hitSlop={{ top: 16, bottom: 16 }}
    >
      <View style={s.track} />
      <View style={[s.fill, { width: pct * width }]} />
      <View style={[s.thumb, { left: pct * width - 13 }]} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { height: 26, justifyContent: 'center', alignSelf: 'stretch' },
  track: { height: 8, borderRadius: 4, backgroundColor: T.border },
  fill: { position: 'absolute', height: 8, borderRadius: 4, backgroundColor: T.accent },
  thumb: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: T.white,
    borderWidth: 3,
    borderColor: 'rgba(0,0,0,0.12)',
    shadowColor: T.black,
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 3,
  },
});
