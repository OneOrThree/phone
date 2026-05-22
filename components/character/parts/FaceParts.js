import { View } from 'react-native';
import { s } from '../styles/characterStyles';

export function Glasses() {
  return (
    <View style={s.glassesRow}>
      <View style={s.glassesFrame} />
      <View style={s.glassesBridge} />
      <View style={s.glassesFrame} />
    </View>
  );
}

export function Sweat() {
  return <View style={s.sweat} />;
}

export function Cheeks() {
  return (
    <View style={s.cheeksRow}>
      <View style={s.cheek} />
      <View style={s.cheek} />
    </View>
  );
}

export function Nose() {
  return <View style={s.nose} />;
}

export function Mouth({ type }) {
  if (type === 'smile')    return <View style={s.mouth} />;
  if (type === 'bigSmile') return <View style={s.mouthBig} />;
  if (type === 'flat')     return <View style={s.mouthFlat} />;
  if (type === 'open')     return <View style={s.mouthOpen} />;
  if (type === 'tongue')   return (
    <View style={s.mouthTongueWrap}>
      <View style={s.mouthFlat} />
      <View style={s.tongue} />
    </View>
  );
  return null;
}
