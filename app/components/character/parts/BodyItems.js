// ============================================================
// BodyItems.js — 몸통 소품 컴포넌트 모음
//
// 캐릭터 몸통 중앙에 표시되는 소품들입니다.
// characterVariants.js에서 Item 필드로 불러와 Character2D에 전달됩니다.
//
// 새 소품을 추가하려면:
//   1. 이 파일에 새 함수 작성 (export 필수)
//   2. characterVariants.js의 원하는 variant에 Item: 새함수 연결
//   3. 스타일은 characterStyles.js에 추가
// ============================================================

import { View, Text } from 'react-native';
import { s } from '../styles/characterStyles';

// ── BodyLaptop ───────────────────────────────────────────────
// 노트북: 파란 직사각형으로 표현.
// focus variant에서 사용.
export function BodyLaptop() {
  return <View style={s.laptop} />;
}

// ── BodyBook ─────────────────────────────────────────────────
// 책: 두 페이지 + 책등으로 구성된 펼쳐진 책.
// reading variant에서 사용.
export function BodyBook() {
  return (
    <View style={s.bookWrap}>
      <View style={s.bookPage}>
        <View style={s.bookLine} />
        <View style={s.bookLine} />
        <View style={s.bookLine} />
      </View>
      <View style={s.bookSpine} />
      <View style={s.bookPage}>
        <View style={s.bookLine} />
        <View style={s.bookLine} />
        <View style={s.bookLine} />
      </View>
    </View>
  );
}

// ── BodyDumbbell ─────────────────────────────────────────────
// 덤벨: 왼쪽 원판 + 바 + 오른쪽 원판.
// exercise variant에서 사용.
export function BodyDumbbell() {
  return (
    <View style={s.dbWrap}>
      <View style={s.dbWeight} />
      <View style={s.dbBar} />
      <View style={s.dbWeight} />
    </View>
  );
}

// ── BodyPaper ────────────────────────────────────────────────
// 종이 + 연필: 공부하는 느낌의 소품.
// study variant에서 사용.
export function BodyPaper() {
  return (
    <View style={s.paperWrap}>
      <View style={s.paper}>
        <View style={s.paperLine} />
        <View style={s.paperLine} />
        <View style={s.paperLine} />
      </View>
      <View style={s.pencil} />
    </View>
  );
}

// ── BodyYogaAura ─────────────────────────────────────────────
// 요가 오라: ✦ 기호로 평화로운 분위기 연출.
// yoga variant에서 사용.
export function BodyYogaAura() {
  return (
    <View style={s.auraWrap}>
      <Text style={s.auraText}>✦</Text>
    </View>
  );
}
