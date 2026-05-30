// ============================================================
// CostumeParts.js — 코스튬·팔·발 컴포넌트 모음
//
// 이 파일에는 두 가지 종류의 컴포넌트가 있습니다:
//   1. 코스튬 파츠: Hat, Ponytail, Earring, HoodieOverlay, Jeans
//      → costumeSlots 배열에 해당 슬롯이 있을 때만 렌더
//   2. 신체 파츠: Arms, Paws
//      → 항상 렌더 (variant에 따라 형태가 달라짐)
//
// 스타일 수정:
//   - 코스튬 관련: costumeStyles.js (c)
//   - 발 관련: characterStyles.js (s)
// ============================================================

import { View, Text, Animated } from 'react-native';
import { s } from '../styles/characterStyles';
import { c } from '../styles/costumeStyles';

// ── Hat ──────────────────────────────────────────────────────
// 베레모: 머리 위에 절대 위치(zIndex 5)로 렌더됨.
// costumeSlots에 'hat'이 있을 때만 표시.
// 색상 변경: costumeStyles.js의 beretTop에서 backgroundColor 수정
export function Hat() {
  return (
    <View style={c.beret}>
      <View style={c.beretTop} />
    </View>
  );
}

// ── Ponytail ─────────────────────────────────────────────────
// 포니테일: 머리 오른쪽에 세로로 배치된 갈색 막대.
// costumeSlots에 'hair'가 있을 때만 표시.
// 색상/굵기 변경: costumeStyles.js의 ponytail에서 수정
export function Ponytail() {
  return <View style={c.ponytail} />;
}

// ── Earring ──────────────────────────────────────────────────
// 별 귀걸이: 왼쪽 귀 위치에 ★ 아이콘 표시.
// costumeSlots에 'accessory'가 있을 때만 표시.
export function Earring() {
  return <Text style={c.earring}>★</Text>;
}

// ── HoodieOverlay ────────────────────────────────────────────
// 후드티 끈: 몸통 내부 상단에 작은 세로 막대로 표시.
// costumeSlots에 'top'이 있을 때 몸통 배경색과 함께 표시.
// (몸통 배경색 변경은 Character2D.js에서 c.bodyHoodie 스타일로 처리)
export function HoodieOverlay() {
  return <View style={c.hoodieString} />;
}

// ── Jeans ────────────────────────────────────────────────────
// 청바지: 몸통 아래쪽을 덮는 짙은 파란 직사각형.
// costumeSlots에 'bottom'이 있을 때만 표시.
// 색상 변경: costumeStyles.js의 jeans에서 backgroundColor 수정
export function Jeans() {
  return <View style={c.jeans} />;
}

// ── Arms ─────────────────────────────────────────────────────
// 팔 (왼쪽 + 오른쪽): 항상 표시됨.
//
// - 팔은 몸통 양옆에 절대 위치로 배치됨
// - leftArmAngle / rightArmAngle 이 Animated.Value일 때 → 애니메이션 회전
// - null이면 기본 각도 사용 (왼팔 -30deg, 오른팔 30deg)
//
// 회전 원리:
//   translateY(13) → 어깨 위치로 이동
//   rotate         → 어깨 기준으로 회전
//   translateY(-13) → 다시 원위치
//   (이렇게 하면 회전 중심이 팔 상단(어깨)이 됨)
export function Arms({ leftArmAngle = null, rightArmAngle = null }) {
  const leftRot = leftArmAngle
    ? leftArmAngle.interpolate({ inputRange: [-180, 0, 180], outputRange: ['-180deg', '0deg', '180deg'], extrapolate: 'clamp' })
    : '-30deg';

  const rightRot = rightArmAngle
    ? rightArmAngle.interpolate({ inputRange: [-180, 0, 180], outputRange: ['-180deg', '0deg', '180deg'], extrapolate: 'clamp' })
    : '30deg';

  return (
    <>
      <Animated.View style={[c.armLeft, { transform: [{ translateY: 13 }, { rotate: leftRot }, { translateY: -13 }] }]}>
        <View style={c.arm} />
        <View style={c.hand} />
      </Animated.View>
      <Animated.View style={[c.armRight, { transform: [{ translateY: 13 }, { rotate: rightRot }, { translateY: -13 }] }]}>
        <View style={c.arm} />
        <View style={c.hand} />
      </Animated.View>
    </>
  );
}

// ── Paws ─────────────────────────────────────────────────────
// 발 (왼쪽 + 오른쪽): 항상 표시됨.
// widePaws가 true면 발 간격이 넓어짐 (yoga variant 전용).
// 크기/색상 변경: characterStyles.js의 paw에서 수정
export function Paws({ widePaws = false }) {
  return (
    <View style={[s.pawsRow, widePaws && s.pawsWide]}>
      <View style={s.paw} />
      <View style={s.paw} />
    </View>
  );
}
