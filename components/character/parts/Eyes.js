import { View, Text } from 'react-native';
import { s } from '../styles/characterStyles';

export function EyeNormal() {
  return (
    <View style={s.eye}>
      <View style={s.pupil}>
        <View style={s.shine} />
      </View>
    </View>
  );
}

export function EyeSquint() {
  return (
    <View style={[s.eye, s.eyeSquint]}>
      <View style={[s.pupil, s.pupilFlat]} />
    </View>
  );
}

export function EyeCrescent() {
  return <View style={s.eyeCrescent} />;
}

export function EyeStar() {
  return (
    <View style={s.eye}>
      <Text style={s.starEyeText}>★</Text>
    </View>
  );
}
