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
  // 카드 하단 안내 문구(타임테이블·최장 세션·첫 시작 차트 공용)
  grassHint: { ...T.text.caption, color: T.inkMuted, marginTop: T.space.md },
  // 공유 캡처 전용 브랜드 밴드 — 캡처 순간에만 shotRef 본문 아래에 렌더(GROMO-1070, 구 shareWatermark 대체).
  // 흰 배경은 ttShot과 연속(marginHorizontal:-16으로 이미지 좌우 끝까지). 얇은 상단 구분선 + 여백으로
  // 본문과 자연스럽게 분리하고, 캐릭터 + gromo 워드마크를 한 세트로 가운데 정렬해 브랜드 스탬프처럼 보이게.
  shareBrandBand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.md,
    marginTop: T.space.lg,
    paddingTop: T.space.md,
    paddingBottom: T.space.sm,
    borderTopWidth: 1,
    borderTopColor: T.divider,
  },
  // 워드마크·태그라인 칼럼 — 내용 크기만큼(밴드가 캐릭터+텍스트를 가운데 정렬)
  shareBrandTextCol: { alignItems: 'flex-start' },
  // "gromo" 워드마크 — 회색 캡션이던 기존 워터마크를 브랜드 컬러·굵기·자간으로 강조(GROMO-1070)
  shareWordmark: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1,
    color: T.accent,
  },
  // 태그라인 — 워드마크와 한 세트. 흐린 보조 텍스트.
  shareTagline: {
    ...T.text.caption,
    color: T.inkMuted,
    marginTop: 2,
  },

  // ── 일 카드 공유 캡처 레이아웃(GROMO-1070) — 상단 날짜 / 격자(전체 폭) / 왼쪽 하단 브랜드 마크.
  //    평소엔 chrome를 display:'none'으로 숨겨 화면 카드엔 격자만 보이고, 캡처 순간에만 드러난다.
  hidden: { display: 'none' },
  // 날짜 헤더 — 캡처 이미지 상단(예: "2026년 7월 30일 (목)")
  shareDateHeader: { ...T.text.heading, color: T.ink, marginBottom: T.space.md },
  // 격자 컨테이너 — 브랜드 마크를 absolute로 겹치기 위한 기준(relative).
  shareDayBody: { position: 'relative' },
  // 왼쪽 하단 브랜드 마크 — 범례(과목명) 열의 빈 아래 공간에 겹쳐 놓는다. 캐릭터 + gromo +
  // 총집중시간, 왼쪽 정렬. absolute라 격자 높이를 늘리지 않아 '덧붙인 블록' 느낌이 없다.
  shareDayBrand: { position: 'absolute', left: 0, bottom: 0, alignItems: 'flex-start' },
  // 오늘 총 집중시간 — gromo 아래 작은 디지털 숫자(HH:MM:SS). tabular-nums로 자릿수 정렬.
  shareDayTime: {
    ...T.text.caption,
    fontSize: 15,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
});
