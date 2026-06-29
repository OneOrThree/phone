import { useRef, useState } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native';
import { T } from '@/v2/constants/theme';

// 커스텀 가로 슬라이더 — core RN PanResponder.
// (@react-native-community/slider가 이 RN/New Arch 셋업에서 미빌드라 직접 구현)
interface Props {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}

export default function Slider({ min, max, step, value, onChange }: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  // PanResponder는 1회만 생성되므로 최신 value/onChange는 ref로 참조(스테일 클로저 방지).
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commit = (x: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const ratio = Math.max(0, Math.min(1, x / w));
    let v = min + ratio * (max - min);
    v = Math.round(v / step) * step;
    v = Math.max(min, Math.min(max, v));
    if (v !== valueRef.current) onChangeRef.current(v);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => commit(e.nativeEvent.locationX),
      onPanResponderMove: (e: GestureResponderEvent) => commit(e.nativeEvent.locationX),
    }),
  ).current;

  const pct = max > min ? (value - min) / (max - min) : 0;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  };

  return (
    <View style={s.wrap} onLayout={onLayout} {...pan.panHandlers} hitSlop={{ top: 12, bottom: 12 }}>
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
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 3,
  },
});
