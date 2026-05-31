// ============================================================
// Character2D.js — 캐릭터 최종 조립 컴포넌트
//
// 이 파일이 캐릭터의 "뼈대" 역할을 합니다.
// 각 부품 파일(Eyes, FaceParts, CostumeParts, BodyItems)에서
// 컴포넌트를 가져와서 하나의 캐릭터로 조립합니다.
//
// 사용 예시:
//   <Character2D size={120} variant="focus" costumeSlots={['hat', 'top']} />
// ============================================================

import { View } from 'react-native';
import { s } from './styles/characterStyles';
import { c } from './styles/costumeStyles';
import { VARIANTS } from './characterVariants';
import { Glasses, Sweat, Cheeks, Nose, Mouth } from './parts/FaceParts';
import { Hat, Ponytail, Earring, HoodieOverlay, Jeans, Arms, Paws } from './parts/CostumeParts';

// Props:
//   size          : 캐릭터 크기 (기준 120px 기준으로 비율 스케일)
//   variant       : 'default' | 'focus' | 'reading' | 'yoga' | 'exercise' | 'study'
//   costumeSlots  : ['hat', 'hair', 'top', 'bottom', 'accessory']
//   leftArmAngle  : 왼팔 회전각 (Animated.Value, 없으면 기본 -30deg)
//   rightArmAngle : 오른팔 회전각 (Animated.Value, 없으면 기본 30deg)
export function Character2D({
  size = 120,
  variant = 'default',
  costumeSlots = [],
  leftArmAngle = null,
  rightArmAngle = null,
}) {
  const scale = size / 120;
  const cfg = VARIANTS[variant] ?? VARIANTS.default;
  const { LeftEye, RightEye, Item, mouthType, glasses, sweat, widePaws } = cfg;
  const has = (slot) => costumeSlots.includes(slot);

  return (
    <View style={[s.wrapper, { transform: [{ scale }] }]}>
      {/* 몸통 — 렌더 순서상 가장 먼저 → 가장 뒤에 보임 */}
      <View style={[s.body, has('top') && c.bodyHoodie]}>
        {has('top') && <HoodieOverlay />}
        {Item && <Item />}
      </View>

      {/* 청바지 */}
      {has('bottom') && <Jeans />}

      {/* 귀 */}
      <View style={s.earLeft}>
        <View style={s.earInner} />
      </View>
      <View style={s.earRight}>
        <View style={s.earInner} />
      </View>

      {/* 포니테일 */}
      {has('hair') && <Ponytail />}

      {/* 머리 */}
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

      {/* 모자 */}
      {has('hat') && <Hat />}

      {/* 귀걸이 */}
      {has('accessory') && <Earring />}

      {/* 팔 */}
      <Arms leftArmAngle={leftArmAngle} rightArmAngle={rightArmAngle} />

      {/* 발 */}
      <Paws widePaws={widePaws} />
    </View>
  );
}
