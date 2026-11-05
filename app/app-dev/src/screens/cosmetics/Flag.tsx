import { C } from '@/design-system/primitives';
import Svg, { Circle, Path } from 'react-native-svg';

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
