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
import { s } from './styles/characterStyles';   // 캐릭터 기본 스타일 (몸, 머리, 귀 등)
import { c } from './styles/costumeStyles';     // 코스튬 스타일 (후드티, 청바지 등)
import { VARIANTS } from './characterVariants'; // variant별 눈·소품·표정 설정
import { Glasses, Sweat, Cheeks, Nose, Mouth } from './parts/FaceParts';     // 얼굴 부품
import { Hat, Ponytail, Earring, HoodieOverlay, Jeans, Arms, Paws } from './parts/CostumeParts'; // 코스튬·팔·발

// ── Props 설명 ───────────────────────────────────────────────
// size          : 캐릭터 크기 (기준 120px 기준으로 비율 스케일)
// variant       : 캐릭터 상태 → 'default' | 'focus' | 'reading' | 'yoga' | 'exercise' | 'study'
// costumeSlots  : 착용 중인 코스튬 목록 → ['hat', 'hair', 'top', 'bottom', 'accessory']
// leftArmAngle  : 왼팔 회전각 (Animated.Value, 없으면 기본 -30deg)
// rightArmAngle : 오른팔 회전각 (Animated.Value, 없으면 기본 30deg)
// ────────────────────────────────────────────────────────────
export function Character2D({ size = 120, variant = 'default', costumeSlots = [], leftArmAngle = null, rightArmAngle = null }) {
  // size / 120 비율로 전체를 scale 변환 → 숫자 하나만 바꾸면 크기 조절 가능
  const scale = size / 120;

  // variant 이름에 해당하는 설정 객체를 가져옴. 없는 variant면 default로 fallback
  const cfg = VARIANTS[variant] ?? VARIANTS.default;
  const { LeftEye, RightEye, Item, mouthType, glasses, sweat, widePaws } = cfg;

  // 특정 코스튬 슬롯이 착용 중인지 확인하는 헬퍼
  const has = (slot) => costumeSlots.includes(slot);

  return (
    // wrapper: 전체 캐릭터를 감싸는 컨테이너. scale 적용 위치
    <View style={[s.wrapper, { transform: [{ scale }] }]}>

      {/* ── 몸통 (Body) ──────────────────────────────────────
          렌더 순서상 가장 먼저 → 가장 뒤에 보임
          후드티 착용 시 배경색이 파란색(bodyHoodie)으로 바뀜
          Item은 variant에 따라 노트북/책/덤벨 등이 들어감       */}
      <View style={[s.body, has('top') && c.bodyHoodie]}>
        {has('top') && <HoodieOverlay />}  {/* 후드티 끈 장식 */}
        {Item && <Item />}                  {/* variant 소품 */}
      </View>

      {/* ── 청바지 (bottom 슬롯) ─────────────────────────────
          몸통 아래쪽을 덮는 청바지 오버레이                     */}
      {has('bottom') && <Jeans />}

      {/* ── 귀 ───────────────────────────────────────────────
          position: absolute로 머리 양옆에 붙어 있음
          earLeft / earRight 위치는 characterStyles.js에서 조정  */}
      <View style={s.earLeft}><View style={s.earInner} /></View>
      <View style={s.earRight}><View style={s.earInner} /></View>

      {/* ── 포니테일 (hair 슬롯) ─────────────────────────────
          머리 오른쪽에 절대 위치로 렌더됨                       */}
      {has('hair') && <Ponytail />}

      {/* ── 머리 (Head) ──────────────────────────────────────
          눈, 안경, 땀, 볼터치, 코, 입이 모두 여기 안에 배치됨  */}
      <View style={s.head}>
        {/* 눈 두 개: variant에 따라 EyeNormal / EyeSquint 등 */}
        <View style={s.eyesRow}>
          <LeftEye />
          <RightEye />
        </View>

        {/* 안경: focus variant일 때만 표시 */}
        {glasses && <Glasses />}

        {/* 땀방울: exercise variant일 때만 표시 */}
        {sweat && <Sweat />}

        {/* 볼터치, 코, 입은 항상 표시 */}
        <Cheeks />
        <Nose />
        <Mouth type={mouthType} />  {/* mouthType은 variant 설정에서 결정 */}
      </View>

      {/* ── 모자 (hat 슬롯) ──────────────────────────────────
          머리 위에 절대 위치로 렌더됨 (zIndex 5, 가장 앞)      */}
      {has('hat') && <Hat />}

      {/* ── 귀걸이 (accessory 슬롯) ──────────────────────────
          왼쪽 귀 위치에 ★ 아이콘으로 표시                      */}
      {has('accessory') && <Earring />}

      {/* ── 팔 ───────────────────────────────────────────────
          Animated.Value를 받아 어깨 기준으로 회전
          FocusModeScreen에서 팔을 흔들 때 이 prop을 사용       */}
      <Arms leftArmAngle={leftArmAngle} rightArmAngle={rightArmAngle} />

      {/* ── 발 (paw) ─────────────────────────────────────────
          widePaws는 yoga variant일 때 true → 발 간격이 넓어짐  */}
      <Paws widePaws={widePaws} />

    </View>
  );
}
