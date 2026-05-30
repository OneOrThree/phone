// ============================================================
// characterStyles.js — 캐릭터 기본 스타일
//
// 캐릭터의 신체(몸통, 머리, 귀, 눈, 코, 입, 볼, 발)와
// 몸통 소품(노트북, 책, 덤벨, 종이, 오라) 스타일을 담습니다.
//
// INK : 외곽선 색상 (T.ink) — 전체 캐릭터의 테두리 색
// BW  : 기본 테두리 두께 (2.5px) — 굵기를 바꾸려면 이 값만 수정
//
// 자주 바꾸는 값:
//   피부색    → '#FFF8E7' 검색해서 원하는 색으로 변경
//   볼터치색  → cheek의 backgroundColor 수정
//   코 색상   → nose의 backgroundColor 수정
// ============================================================

import { StyleSheet } from 'react-native';
import { T } from '../../theme'; // 앱 전체 색상 팔레트

export const INK = T.ink; // 외곽선 색 (다크 잉크색)
export const BW = 2.5;    // Border Width 기본값

export const s = StyleSheet.create({

  // ── 전체 래퍼 ──────────────────────────────────────────────
  // 캐릭터 전체를 감싸는 컨테이너.
  // 120×175가 기준 크기이고, Character2D에서 scale로 조절됨.
  wrapper: {
    width: 120,
    height: 175,
    alignItems: 'center',
  },

  // ── 귀 ────────────────────────────────────────────────────
  // earLeft / earRight: 머리 양옆 절대 위치
  // 위치 조정: top, left/right 값 변경
  // 크기 조정: width, height, borderRadius 변경
  earLeft: {
    position: 'absolute', top: 0, left: 16,
    width: 28, height: 30, borderRadius: 14,
    backgroundColor: '#FFF8E7',             // 피부색
    borderWidth: BW, borderColor: INK,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  earRight: {
    position: 'absolute', top: 0, right: 16,
    width: 28, height: 30, borderRadius: 14,
    backgroundColor: '#FFF8E7',
    borderWidth: BW, borderColor: INK,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  // earInner: 귀 안쪽 분홍 부분
  earInner: {
    width: 14, height: 18, borderRadius: 7,
    backgroundColor: '#FFB7C5',             // 귀 안쪽 분홍색
    borderWidth: 1.5, borderColor: INK,
  },

  // ── 머리 ──────────────────────────────────────────────────
  // 절대 위치로 귀 위에 겹쳐 렌더됨 (zIndex 2)
  // paddingTop: 눈 위치를 머리 상단에서 얼마나 내릴지
  head: {
    position: 'absolute', top: 14, left: 0, right: 0, height: 100,
    borderRadius: 50, backgroundColor: '#FFF8E7',  // 피부색
    borderWidth: BW, borderColor: INK,
    alignItems: 'center', paddingTop: 20, zIndex: 2,
  },

  // ── 눈 ────────────────────────────────────────────────────
  eyesRow: { flexDirection: 'row', gap: 20 }, // 두 눈 사이 간격: gap으로 조절

  // 기본 눈 (흰자)
  eye: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#FFF',
    borderWidth: 2, borderColor: INK,
    alignItems: 'center', justifyContent: 'center',
  },
  // 찡그린 눈: eye 위에 덮어씌워서 높이를 줄임
  eyeSquint: { height: 14, borderRadius: 7, marginTop: 6 },

  // 동공 (검은 원)
  pupil: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: INK,
    alignItems: 'flex-end', justifyContent: 'flex-start', padding: 2,
  },
  // 납작 동공 (찡그린 눈용)
  pupilFlat: { height: 8, borderRadius: 4, width: 14 },

  // 하이라이트 (동공 안의 작은 흰 점)
  shine: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFF' },

  // 초승달 눈 (yoga variant, ^_^ 모양)
  eyeCrescent: {
    width: 22, height: 8, borderRadius: 4,
    backgroundColor: INK, marginTop: 4,
  },
  // 별 눈 텍스트 스타일
  starEyeText: { fontSize: 13, color: T.yellowDark },

  // ── 안경 ──────────────────────────────────────────────────
  // glassesRow: 머리 안에서 절대 위치 (눈 위에 겹침)
  // top 값을 바꾸면 안경 높이가 달라짐
  glassesRow: {
    position: 'absolute', top: 18,
    flexDirection: 'row', alignItems: 'center',
  },
  glassesFrame: {
    width: 30, height: 22, borderRadius: 8,
    borderWidth: 2, borderColor: T.inkMed,   // 안경 테 색상
    backgroundColor: 'transparent',
  },
  glassesBridge: { width: 8, height: 2.5, backgroundColor: T.inkMed }, // 코받침

  // ── 땀방울 ────────────────────────────────────────────────
  // 이마 오른쪽 상단에 배치
  // 위치 변경: top, right 값 수정
  sweat: {
    position: 'absolute', top: 14, right: 16,
    width: 8, height: 11, borderRadius: 4,
    borderBottomLeftRadius: 4, borderBottomRightRadius: 4,
    borderTopLeftRadius: 8, borderTopRightRadius: 0,  // 물방울 모양 만들기
    backgroundColor: T.sky,                            // 하늘색 땀
    borderWidth: 1.5, borderColor: INK,
    transform: [{ rotate: '15deg' }],                 // 약간 기울임
  },

  // ── 볼터치 ────────────────────────────────────────────────
  cheeksRow: { flexDirection: 'row', gap: 36, marginTop: 4 }, // 두 볼 간격
  cheek: {
    width: 20, height: 12, borderRadius: 10,
    backgroundColor: 'rgba(255, 120, 120, 0.25)',  // 반투명 분홍 (투명도 조절 가능)
  },

  // ── 코 ────────────────────────────────────────────────────
  nose: {
    width: 9, height: 6, borderRadius: 4,
    backgroundColor: '#FF8FAB',    // 코 색상 (분홍)
    borderWidth: 1.5, borderColor: INK, marginTop: 2,
  },

  // ── 입 ────────────────────────────────────────────────────
  // 미소 (아래 테두리만 있는 반원)
  mouth: {
    marginTop: 5, width: 22, height: 10,
    borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderRightWidth: 2.5, borderTopWidth: 0,
    borderBottomLeftRadius: 11, borderBottomRightRadius: 11, borderColor: INK,
  },
  // 크게 웃는 입 (더 넓고 높은 반원)
  mouthBig: {
    marginTop: 4, width: 30, height: 14,
    borderBottomWidth: 3, borderLeftWidth: 3, borderRightWidth: 3, borderTopWidth: 0,
    borderBottomLeftRadius: 15, borderBottomRightRadius: 15, borderColor: INK,
  },
  // 일자 입 (감정 없는 표정)
  mouthFlat: { marginTop: 8, width: 18, height: 3, borderRadius: 2, backgroundColor: INK },
  // 벌린 입 (검은 타원)
  mouthOpen: {
    marginTop: 5, width: 18, height: 12,
    borderRadius: 6, backgroundColor: INK,
    alignItems: 'center', justifyContent: 'center',
  },
  // 혀 내밀기용 래퍼
  mouthTongueWrap: { alignItems: 'center' },
  // 혀 (mouthFlat 아래에 겹쳐서 렌더됨)
  tongue: {
    width: 12, height: 8, borderRadius: 6,
    backgroundColor: '#FF8FAB',    // 혀 색상 (분홍)
    borderWidth: 1.5, borderColor: INK,
    marginTop: -2,                  // 일자 입과 살짝 겹치게
  },

  // ── 몸통 ──────────────────────────────────────────────────
  // 머리 아래에 절대 위치 (zIndex 1)
  // top 값이 머리 bottom과 맞닿는 위치
  body: {
    position: 'absolute', top: 100, left: 18, right: 18, height: 62,
    borderRadius: 30, backgroundColor: '#FFF8E7',  // 기본 피부색 (후드티 착용 시 덮어씌워짐)
    borderWidth: BW, borderColor: INK,
    zIndex: 1, alignItems: 'center', justifyContent: 'center',
  },

  // ── 몸통 소품 스타일 ────────────────────────────────────────

  // 노트북 (파란 직사각형)
  laptop: {
    width: 34, height: 24, borderRadius: 4,
    borderWidth: 2, borderColor: INK, backgroundColor: '#C8E6FF',  // 화면 색상
  },

  // 책 관련
  bookWrap: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  bookPage: {
    width: 18, height: 26, backgroundColor: '#FFFCF0',  // 종이색
    borderWidth: 1.5, borderColor: INK,
    borderRadius: 2, padding: 3, gap: 4,
  },
  bookSpine: { width: 4, height: 26, backgroundColor: T.coral, borderWidth: 1, borderColor: INK }, // 책등 색상: T.coral
  bookLine: { height: 2, backgroundColor: T.inkLight, borderRadius: 1 }, // 페이지 줄

  // 덤벨 관련
  dbWrap: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  dbWeight: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: T.inkMed, borderWidth: 1.5, borderColor: INK, // 원판 색상: T.inkMed
  },
  dbBar: {
    width: 22, height: 6, backgroundColor: T.inkLight,
    borderWidth: 1.5, borderColor: INK,
  },

  // 종이+연필 관련
  paperWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  paper: {
    width: 26, height: 30, backgroundColor: '#FFFCF0',  // 종이색
    borderWidth: 1.5, borderColor: INK, borderRadius: 2,
    padding: 4, gap: 4,
  },
  paperLine: { height: 2, backgroundColor: T.sky, borderRadius: 1 }, // 줄 색상: T.sky (파랑)
  pencil: {
    width: 6, height: 28, borderRadius: 3,
    backgroundColor: T.yellow,                           // 연필 색상: 노랑
    borderWidth: 1.5, borderColor: INK,
    marginTop: 1,
  },

  // 요가 오라
  auraWrap: { alignItems: 'center' },
  auraText: { fontSize: 22, color: T.mint }, // 오라 색상: T.mint (민트)

  // ── 발 ────────────────────────────────────────────────────
  pawsRow: { position: 'absolute', bottom: 0, flexDirection: 'row', gap: 30, zIndex: 3 },
  pawsWide: { gap: 44 }, // yoga variant: 발 간격 더 넓게
  paw: {
    width: 22, height: 16, borderRadius: 11,
    backgroundColor: '#FFF8E7',    // 피부색
    borderWidth: BW, borderColor: INK,
  },
});
