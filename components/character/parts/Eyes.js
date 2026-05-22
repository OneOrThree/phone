// ============================================================
// Eyes.js — 눈 컴포넌트 모음
//
// 4가지 눈 모양을 export합니다.
// characterVariants.js에서 LeftEye / RightEye로 불러와서 사용합니다.
//
// 눈 모양을 바꾸고 싶다면:
//   - 크기/색상 → characterStyles.js의 eye, pupil 등 수정
//   - 모양 자체 → 이 파일의 각 컴포넌트 수정
//   - 새 눈 추가 → 새 함수 작성 후 characterVariants.js에 연결
// ============================================================

import { View, Text } from 'react-native';
import { s } from '../styles/characterStyles'; // 눈 관련 스타일: eye, pupil, shine 등

// ── EyeNormal ────────────────────────────────────────────────
// 기본 동그란 눈. 동공(pupil) 안에 하이라이트(shine)가 있음.
// default / reading variant에서 사용.
export function EyeNormal() {
  return (
    <View style={s.eye}>           {/* 흰자 영역 */}
      <View style={s.pupil}>       {/* 검은 동공 */}
        <View style={s.shine} />   {/* 반짝이는 하이라이트 */}
      </View>
    </View>
  );
}

// ── EyeSquint ────────────────────────────────────────────────
// 찡그린 눈. 눈 높이가 낮아지고 동공도 납작해짐.
// focus variant(양쪽), study variant(왼쪽만)에서 사용.
export function EyeSquint() {
  return (
    <View style={[s.eye, s.eyeSquint]}>          {/* eyeSquint: 높이를 줄여 찡그린 효과 */}
      <View style={[s.pupil, s.pupilFlat]} />     {/* pupilFlat: 동공을 납작하게 */}
    </View>
  );
}

// ── EyeCrescent ──────────────────────────────────────────────
// 초승달 모양 눈 (^_^ 표정).
// 눈 전체가 검은 가로 타원으로 표현됨.
// yoga variant에서 사용.
export function EyeCrescent() {
  return (
    <View style={s.eyeCrescent} /> // 가로로 긴 검은 둥근 사각형
  );
}

// ── EyeStar ──────────────────────────────────────────────────
// 별(★) 눈. 에너지 넘치는 표정.
// exercise variant에서 사용.
export function EyeStar() {
  return (
    <View style={s.eye}>
      <Text style={s.starEyeText}>★</Text>  {/* 노란색 별 아이콘 */}
    </View>
  );
}
