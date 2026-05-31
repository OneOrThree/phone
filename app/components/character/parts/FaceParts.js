// ============================================================
// FaceParts.js — 얼굴 부품 컴포넌트 모음
//
// 머리(Head) 안에 들어가는 부품들입니다:
//   Glasses  : 안경
//   Sweat    : 땀방울
//   Cheeks   : 볼터치 (양쪽)
//   Nose     : 코
//   Mouth    : 입 (5가지 모양)
//
// 스타일 수정은 characterStyles.js에서 합니다.
// ============================================================

import { View } from 'react-native';
import { s } from '../styles/characterStyles';

// ── Glasses ──────────────────────────────────────────────────
// 안경: 왼쪽 프레임 + 코받침 + 오른쪽 프레임.
// focus variant일 때만 Character2D에서 렌더됩니다.
// 안경 색상 변경: characterStyles.js의 glassesFrame, glassesBridge에서 borderColor/backgroundColor 수정
export function Glasses() {
  return (
    <View style={s.glassesRow}>
      <View style={s.glassesFrame} />
      <View style={s.glassesBridge} />
      <View style={s.glassesFrame} />
    </View>
  );
}

// ── Sweat ────────────────────────────────────────────────────
// 땀방울: 이마 오른쪽에 파란 물방울 모양.
// exercise variant일 때만 Character2D에서 렌더됩니다.
// 위치 변경: characterStyles.js의 sweat에서 top, right 수정
export function Sweat() {
  return <View style={s.sweat} />;
}

// ── Cheeks ───────────────────────────────────────────────────
// 볼터치: 양 볼에 반투명 분홍 타원.
// 모든 variant에서 항상 표시됩니다.
// 색상/크기 변경: characterStyles.js의 cheek에서 수정
export function Cheeks() {
  return (
    <View style={s.cheeksRow}>
      <View style={s.cheek} />
      <View style={s.cheek} />
    </View>
  );
}

// ── Nose ─────────────────────────────────────────────────────
// 코: 작은 분홍 타원.
// 모든 variant에서 항상 표시됩니다.
export function Nose() {
  return <View style={s.nose} />;
}

// ── Mouth ────────────────────────────────────────────────────
// 입: type prop에 따라 5가지 모양 중 하나를 렌더합니다.
//
// type 값별 모양:
//   'smile'    → 부드러운 미소 (아래쪽 반원 테두리)
//   'bigSmile' → 크게 웃는 입 (더 넓은 반원 테두리)
//   'flat'     → 일자 입 (감정 없음, focus variant)
//   'open'     → 벌린 입 (검은 타원, exercise variant)
//   'tongue'   → 혀 내밀기 (일자 + 아래 혀, study variant)
//
// 새 입 모양 추가 시:
//   1. characterStyles.js에 스타일 추가
//   2. 여기 조건 추가
//   3. characterTypes.js의 MOUTH_TYPES에 추가
//   4. characterVariants.js에서 해당 variant에 mouthType 연결
export function Mouth({ type }) {
  if (type === 'smile') return <View style={s.mouth} />;
  if (type === 'bigSmile') return <View style={s.mouthBig} />;
  if (type === 'flat') return <View style={s.mouthFlat} />;
  if (type === 'open') return <View style={s.mouthOpen} />;
  if (type === 'tongue')
    return (
      <View style={s.mouthTongueWrap}>
        <View style={s.mouthFlat} />
        <View style={s.tongue} />
      </View>
    );
  return null;
}
