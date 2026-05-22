import { View, Text, Animated } from 'react-native';
import { s } from '../styles/characterStyles';
import { c } from '../styles/costumeStyles';

export function Hat() {
  return (
    <View style={c.beret}>
      <View style={c.beretTop} />
    </View>
  );
}

export function Ponytail() {
  return <View style={c.ponytail} />;
}

export function Earring() {
  return <Text style={c.earring}>★</Text>;
}

export function HoodieOverlay() {
  return <View style={c.hoodieString} />;
}

export function Jeans() {
  return <View style={c.jeans} />;
}

export function Arms({ leftArmAngle = null, rightArmAngle = null }) {
  const leftRot  = leftArmAngle
    ? leftArmAngle.interpolate({ inputRange: [-180, 0, 180], outputRange: ['-180deg', '0deg', '180deg'], extrapolate: 'clamp' })
    : '-30deg';
  const rightRot = rightArmAngle
    ? rightArmAngle.interpolate({ inputRange: [-180, 0, 180], outputRange: ['-180deg', '0deg', '180deg'], extrapolate: 'clamp' })
    : '30deg';

  return (
    <>
      <Animated.View style={[c.armLeft,  { transform: [{ translateY: 13 }, { rotate: leftRot  }, { translateY: -13 }] }]}>
        <View style={c.arm} /><View style={c.hand} />
      </Animated.View>
      <Animated.View style={[c.armRight, { transform: [{ translateY: 13 }, { rotate: rightRot }, { translateY: -13 }] }]}>
        <View style={c.arm} /><View style={c.hand} />
      </Animated.View>
    </>
  );
}

export function Paws({ widePaws = false }) {
  return (
    <View style={[s.pawsRow, widePaws && s.pawsWide]}>
      <View style={s.paw} />
      <View style={s.paw} />
    </View>
  );
}
