import { View } from 'react-native';
import { s } from './styles/characterStyles';
import { c } from './styles/costumeStyles';
import { VARIANTS } from './characterVariants';
import { Glasses, Sweat, Cheeks, Nose, Mouth } from './parts/FaceParts';
import { Hat, Ponytail, Earring, HoodieOverlay, Jeans, Arms, Paws } from './parts/CostumeParts';

export function Character2D({ size = 120, variant = 'default', costumeSlots = [], leftArmAngle = null, rightArmAngle = null }) {
  const scale = size / 120;
  const cfg = VARIANTS[variant] ?? VARIANTS.default;
  const { LeftEye, RightEye, Item, mouthType, glasses, sweat, widePaws } = cfg;
  const has = (slot) => costumeSlots.includes(slot);

  return (
    <View style={[s.wrapper, { transform: [{ scale }] }]}>
      {/* Body */}
      <View style={[s.body, has('top') && c.bodyHoodie]}>
        {has('top') && <HoodieOverlay />}
        {Item && <Item />}
      </View>

      {/* Bottom */}
      {has('bottom') && <Jeans />}

      {/* Ears */}
      <View style={s.earLeft}><View style={s.earInner} /></View>
      <View style={s.earRight}><View style={s.earInner} /></View>

      {/* Hair */}
      {has('hair') && <Ponytail />}

      {/* Head */}
      <View style={s.head}>
        <View style={s.eyesRow}>
          <LeftEye />
          <RightEye />
        </View>
        {glasses && <Glasses />}
        {sweat && <Sweat />}
        <Cheeks />
        <Nose />
        <Mouth type={mouthType} />
      </View>

      {/* Hat */}
      {has('hat') && <Hat />}

      {/* Accessory */}
      {has('accessory') && <Earring />}

      {/* Arms */}
      <Arms leftArmAngle={leftArmAngle} rightArmAngle={rightArmAngle} />

      {/* Paws */}
      <Paws widePaws={widePaws} />
    </View>
  );
}
