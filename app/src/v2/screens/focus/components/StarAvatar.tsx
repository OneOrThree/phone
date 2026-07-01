import Svg, { Polygon, Circle, Path } from 'react-native-svg';

// 09 친구 그리드 별사탕 아바타 — 시안 SVG를 react-native-svg로 옮김.
const POINTS =
  '50,6 62.6,19.5 81.1,18.9 80.5,37.4 94,50 80.5,62.6 81.1,81.1 62.6,80.5 50,94 ' +
  '37.4,80.5 18.9,81.1 19.5,62.6 6,50 19.5,37.4 18.9,18.9 37.4,19.5';

export function StarAvatar({ color, size = 50 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Polygon points={POINTS} fill={color} stroke={color} strokeWidth={9} strokeLinejoin="round" />
      <Circle cx={40} cy={48} r={3} fill="#3A2A1E" />
      <Circle cx={60} cy={48} r={3} fill="#3A2A1E" />
      <Path
        d="M43 58 Q50 64 57 58"
        stroke="#3A2A1E"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}
