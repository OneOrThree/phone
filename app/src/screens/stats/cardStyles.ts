// 통계 카드들이 공용으로 쓰는 스타일 — 카드별 전용 스타일은 각 카드 파일 하단 s에 둔다.
import { StyleSheet } from 'react-native';
import { T } from '@/constants/theme';
import { FOCUS_COLOR } from './constants';

export const cs = StyleSheet.create({
  // 히어로 숫자 — '숫자가 주인공' 규칙: 항상 지표색(기본 집중=초록). 폰 지표만 PHONE_COLOR로 덮어쓴다
  bigStat: { ...T.text.title, color: FOCUS_COLOR },
  emptyText: { ...T.text.body, color: T.inkMuted, paddingVertical: T.space.sm },
  compareLoading: { paddingVertical: T.space.xl, alignItems: 'center' },
  // 공유하기 — 타임테이블 카드 하단 오른쪽(헤더에 두면 순서 편집 핸들과 겹침)
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    alignSelf: 'flex-end',
    marginTop: T.space.md,
  },
  shareBtnText: { ...T.text.caption, color: T.inkMuted },
  // 캡처 이미지 배경(투명 PNG 방지) + 좌우 여백 — 음수 마진으로 상쇄해 화면 레이아웃은 그대로,
  // 저장되는 이미지에만 여백이 생긴다(LineChart의 DOT_PAD 확장과 같은 기법)
  ttShot: { backgroundColor: T.white, paddingHorizontal: T.space.lg, marginHorizontal: -16 },
  // 월 달력 그리드 — 공부 잔디(월)·목표 달성(월) 공용: 한 줄 7칸(작은 정사각형), 블록 가운데 정렬
  monthGrass: { gap: T.space.sm, marginTop: T.space.xs, alignSelf: 'center' },
  monthGrassRow: { flexDirection: 'row', gap: T.space.sm },
  monthGrassCell: { width: 24, height: 24, borderRadius: 6 },
  // 탭한 잔디 칸 강조·정보줄(GROMO-849)
  grassCellOn: { borderWidth: 2, borderColor: T.ink },
  grassPickInfo: { ...T.text.caption, color: T.ink, alignSelf: 'center', marginTop: T.space.sm },
  grassHint: { ...T.text.caption, color: T.inkMuted, marginTop: T.space.md },
});
