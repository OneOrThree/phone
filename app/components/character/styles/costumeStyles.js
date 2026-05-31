// ============================================================
// costumeStyles.js — 코스튬 및 팔 스타일
//
// 착용 아이템(모자, 포니테일, 귀걸이, 후드티, 청바지)과
// 팔(arm, hand)의 스타일을 담습니다.
//
// INK / BW는 characterStyles.js에서 가져옵니다.
// (같은 외곽선 색과 두께를 공유하기 위해)
//
// 코스튬 색상 변경 가이드:
//   모자 색    → beretTop의 backgroundColor
//   포니테일   → ponytail의 backgroundColor
//   후드티 색  → bodyHoodie의 backgroundColor
//   청바지 색  → jeans의 backgroundColor
// ============================================================

import { StyleSheet } from 'react-native';
import { T } from '../../theme';
import { INK, BW } from './characterStyles'; // 외곽선 색/두께 공유

export const c = StyleSheet.create({

  // ── 팔 ────────────────────────────────────────────────────
  // armLeft / armRight: 몸통 양옆에 절대 위치로 배치
  //   top 105: 몸통 상단(100) + 5px 내려서 어깨에 자연스럽게 붙음
  //   left 13 / left 95: 각각 왼쪽·오른쪽 어깨 위치
  //   zIndex 4: 몸통(1)과 머리(2) 위에, 모자(5) 아래에 위치
  armLeft:  { position: 'absolute', top: 105, left: 13, width: 11, height: 26, zIndex: 4 },
  armRight: { position: 'absolute', top: 105, left: 95, width: 11, height: 26, zIndex: 4 },

  // 팔 막대 (위에서 아래로 뻗은 직사각형)
  // bottom: 0 → 회전 중심을 상단(어깨)으로 만들기 위해 아래쪽 기준 배치
  arm: {
    position: 'absolute',
    bottom: 0, left: 0,
    width: 11, height: 26,
    backgroundColor: '#FFF8E7',    // 피부색
    borderRadius: 6,
    borderWidth: BW, borderColor: INK,
  },

  // 손 (팔 끝에 붙는 작은 원)
  hand: {
    position: 'absolute',
    bottom: -5, left: 1,           // 팔 아래쪽으로 5px 삐져나옴
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: '#FFF8E7',    // 피부색
    borderWidth: BW - 0.5, borderColor: INK,
  },

  // ── 베레모 ────────────────────────────────────────────────
  // 머리 위에 절대 위치 (top: -2 → 머리 약간 위로 올라감)
  // zIndex 5: 가장 앞에 보임
  beret: {
    position: 'absolute', top: -2, zIndex: 5,
    alignItems: 'center',
  },
  // 베레모 본체 (가로로 넓적한 타원)
  // 색상 변경: backgroundColor 수정 (현재 어두운 빨강)
  beretTop: {
    width: 64, height: 18, borderRadius: 32,
    backgroundColor: '#8B3A3A',    // 베레모 색 (갈색 빨강)
    borderWidth: BW, borderColor: INK,
  },

  // ── 포니테일 ──────────────────────────────────────────────
  // 머리 오른쪽에 비스듬히 내려오는 세로 막대
  // zIndex 1: 머리(2) 뒤에 살짝 숨어 있음
  // 색상 변경: backgroundColor 수정 (현재 갈색)
  ponytail: {
    position: 'absolute', top: 24, right: 6, zIndex: 1,
    width: 10, height: 48, borderRadius: 5,
    backgroundColor: '#7B4A1E',    // 머리카락 색 (갈색)
    borderWidth: 1.5, borderColor: INK,
    transform: [{ rotate: '12deg' }], // 약간 오른쪽으로 기울임
  },

  // ── 별 귀걸이 ─────────────────────────────────────────────
  // 왼쪽 귀 근처에 절대 위치 (★ 텍스트)
  // 위치 조정: top, left 값 수정
  earring: {
    position: 'absolute', top: 46, left: 4, zIndex: 5,
    fontSize: 10, color: T.yellowDark,  // 노란 별
  },

  // ── 후드티 ────────────────────────────────────────────────
  // bodyHoodie: 몸통 배경색을 파란색으로 덮어씌움
  // Character2D에서 has('top')일 때 body 스타일에 추가됨
  // 색상 변경: backgroundColor 수정
  bodyHoodie: { backgroundColor: '#7EB8D4' }, // 후드티 색 (파랑)

  // 후드티 끈: 몸통 상단 중앙에 작은 세로 막대
  hoodieString: {
    position: 'absolute', top: 4,
    width: 4, height: 14, borderRadius: 2,
    backgroundColor: '#5A9AB8',    // 끈 색 (후드티보다 어두운 파랑)
    borderWidth: 1, borderColor: INK,
  },

  // ── 청바지 ────────────────────────────────────────────────
  // 몸통 하단을 가리는 직사각형 (borderBottomWidth: 0 → 아래는 열려 있음)
  // zIndex 2: 몸통(1) 위, 머리(2) 아래
  // 색상 변경: backgroundColor 수정
  jeans: {
    position: 'absolute', bottom: 12, zIndex: 2,
    width: 76, height: 18, borderRadius: 4,
    backgroundColor: '#3A5A8C',    // 청바지 색 (짙은 파랑)
    borderWidth: BW, borderColor: INK,
    borderBottomWidth: 0,          // 아래쪽 테두리 없음 (발에 가려짐)
  },
});
