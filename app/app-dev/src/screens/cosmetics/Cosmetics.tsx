import React, { useState } from 'react';
import { View, Image } from 'react-native';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { assets, cat } from '@/constants/assets';
import { C } from '@/design-system/primitives';
import { State, Island } from '@/services/model';
export function Scarf({ size = 60 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.72} viewBox="0 0 100 72">
      <Path
        d="M12 12 Q46 25 79 10 L88 27 Q50 44 10 29Z"
        fill={C.pink}
        stroke={C.brown}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <Path
        d="M62 29 L84 30 L73 67 L48 58Z"
        fill={C.sky}
        stroke={C.brown}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <Path d="M60 44 L77 49 M55 55 L74 61" stroke={C.paper} strokeWidth="4" />
    </Svg>
  );
}
export function Flag({ size = 60 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M25 88 L25 10" stroke={C.brown} strokeWidth="5" strokeLinecap="round" />
      <Path
        d="M28 14 Q53 2 83 18 L70 36 L84 54 Q53 37 28 48Z"
        fill={C.pink}
        stroke={C.brown}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <Path d="M48 23 Q62 17 65 31 Q65 41 57 43 Q47 42 46 30Z" fill="#F76885" />
      <Path d="M51 24 L55 18 L60 24" stroke="#7CAA75" strokeWidth="3" />
      <Circle cx="54" cy="29" r="1.4" fill={C.butter} />
      <Circle cx="59" cy="34" r="1.4" fill={C.butter} />
    </Svg>
  );
}
export function BoatPortrait({ state, height = 270 }: { state: State; height?: number }) {
  return (
    <View
      style={{
        height,
        backgroundColor: C.sky,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Image
        source={assets[`boats/${state.equipped.hull}/day.png`]}
        style={{ width: 260, height: 230 }}
        resizeMode="contain"
      />
      <View style={{ position: 'absolute', top: 60, left: '50%', marginLeft: -47 }}>
        <Image source={cat(state.color, 'idle')} style={{ width: 94, height: 94 }} />
        {state.equipped.clothes !== 'default' && (
          <View style={{ position: 'absolute', top: 54, left: 19 }}>
            <Scarf size={58} />
          </View>
        )}
      </View>
      {state.equipped.decor !== 'none' && (
        <View
          style={{
            position: 'absolute',
            top: 80,
            left: state.equipped.position === 'front' ? '67%' : '17%',
          }}
        >
          <Flag size={65} />
        </View>
      )}
    </View>
  );
}
export function IslandDecor({
  island,
  width,
  height,
}: {
  island: Island;
  width: number;
  height: number;
}) {
  const roofs: Record<string, string> = {
    hall: 'M285 330 L407 263 L510 343 L384 405Z',
    board: 'M225 580 L362 548 L380 572 L241 611Z',
    tower: 'M756 321 Q775 269 788 267 Q808 288 823 322Z',
    mail: 'M378 1041 Q396 1028 410 1044 L410 1063 L378 1063Z',
    shop: 'M639 819 L746 743 L885 814 L792 875Z',
  };
  return (
    <Svg
      pointerEvents="none"
      width={width}
      height={height}
      viewBox="0 0 1024 1536"
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      {Object.entries(island.buildingThemes || {})
        .filter(([, v]) => v !== 'default')
        .map(([b]) => (
          <Path key={b} d={roofs[b]} fill={C.pink} opacity={0.7} stroke={C.brown} strokeWidth={3} />
        ))}
      {island.theme !== 'default' &&
        [
          [308, 470],
          [685, 620],
          [700, 1040],
          [350, 950],
          [460, 1200],
          [670, 1110],
          [320, 680],
          [450, 680],
        ].map(([x, y], n) => (
          <React.Fragment key={n}>
            <Circle cx={x - 7} cy={y} r={8} fill={C.pink} />
            <Circle cx={x + 7} cy={y} r={8} fill={C.pink} />
            <Circle cx={x} cy={y - 7} r={8} fill={C.pink} />
            <Circle cx={x} cy={y + 7} r={8} fill={C.pink} />
            <Circle cx={x} cy={y} r={5} fill={C.butter} />
          </React.Fragment>
        ))}
    </Svg>
  );
}

/** Scene images fill the preview; the decorations share the same crop and scale. */
export function IslandPreview({
  height = 220,
  radius = 22,
  island,
}: {
  height?: number;
  radius?: number;
  island?: Island;
}) {
  const [width, setWidth] = useState(360);
  const scale = Math.max(width / 1024, height / 1536);
  const w = 1024 * scale,
    h = 1536 * scale;
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        width: '100%',
        height,
        borderRadius: radius,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          position: 'absolute',
          width: w,
          height: h,
          left: (width - w) / 2,
          top: (height - h) / 2,
        }}
      >
        <Image
          source={assets['backgrounds/island/growth/05-final-shop/day.png']}
          style={{ width: w, height: h }}
        />
        {island && <IslandDecor island={island} width={w} height={h} />}
      </View>
    </View>
  );
}
