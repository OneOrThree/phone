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
  return (
    <View style={s.laptop} /> // 단순 직사각형 (파란 배경)
  );
}

// ── BodyBook ─────────────────────────────────────────────────
// 책: 두 페이지 + 책등으로 구성된 펼쳐진 책.
// reading variant에서 사용.
export function BodyBook() {
  return (
    <View style={s.bookWrap}>        {/* 전체 책 컨테이너 (가로 배치) */}
      <View style={s.bookPage}>      {/* 왼쪽 페이지 */}
        <View style={s.bookLine} />  {/* 줄 1 */}
        <View style={s.bookLine} />  {/* 줄 2 */}
        <View style={s.bookLine} />  {/* 줄 3 */}
      </View>
      <View style={s.bookSpine} />   {/* 책등 (빨간 세로 띠) */}
      <View style={s.bookPage}>      {/* 오른쪽 페이지 */}
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
    <View style={s.dbWrap}>     {/* 가로 배치 컨테이너 */}
      <View style={s.dbWeight} />{/* 왼쪽 원판 */}
      <View style={s.dbBar} />   {/* 중간 손잡이 바 */}
      <View style={s.dbWeight} />{/* 오른쪽 원판 */}
    </View>
  );
}

// ── BodyPaper ────────────────────────────────────────────────
// 종이 + 연필: 공부하는 느낌의 소품.
// study variant에서 사용.
export function BodyPaper() {
  return (
    <View style={s.paperWrap}>      {/* 가로 배치 컨테이너 */}
      <View style={s.paper}>        {/* 종이 (흰 직사각형) */}
        <View style={s.paperLine} />{/* 줄 1 (파란 선) */}
        <View style={s.paperLine} />{/* 줄 2 */}
        <View style={s.paperLine} />{/* 줄 3 */}
      </View>
      <View style={s.pencil} />     {/* 연필 (노란 세로 막대) */}
    </View>
  );
}

// ── BodyYogaAura ─────────────────────────────────────────────
// 요가 오라: ✦ 기호로 평화로운 분위기 연출.
// yoga variant에서 사용.
export function BodyYogaAura() {
  return (
    <View style={s.auraWrap}>
      <Text style={s.auraText}>✦</Text>  {/* 민트색 별 장식 */}
    </View>
  );
}
