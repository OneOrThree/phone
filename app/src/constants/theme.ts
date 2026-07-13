// v2 디자인 토큰 — Claude Design 인디고 팔레트(Palette_Indigo) 기준.
// 기존 src/constants/theme.ts(T)는 옛 디자인용으로 보존하고, v2 화면은 이걸 쓴다.
// import { T } from '@/constants/theme';
// 팔레트 원본 6색: accent #5E6AD2 · accent2 #AFB5E9 · ink #1C1E22 · sub #9AA0A8 · line #EAEBEE · bg(표면) #FFFFFF
export const T = {
  // 배경 — 쿨 화이트/뉴트럴 표면
  bg: '#F4F5F8', // 가장 바깥(페이지) 배경 — 쿨 뉴트럴
  paper: '#FFFFFF', // 화면 기본 배경(카드·표면)
  paperLight: '#FFFFFF', // 밝은 카드/표면
  paperAlt: '#F5F6F9', // 보조 표면(카드 테두리로도 사용)
  sandLight: '#EEF0FB', // 세그먼트 트랙·아이콘 배경(인디고 틴트)
  caramel: '#EEF0FB', // 아이콘 박스·진행 트랙(인디고 틴트)
  chipBg: '#F1F2F8', // 칩·스텝퍼 버튼 배경
  chipBorder: '#E3E5EE', // 칩 테두리
  track: '#F1F2F6', // 진행 트랙·중립 행 배경(회색 계열)

  // 텍스트 — 쿨 그레이
  ink: '#1C1E22', // 진한 텍스트(제목)
  inkSub: '#667085', // 보조 텍스트
  inkMuted: '#9AA0A8', // 흐린 텍스트/캡션(팔레트 sub)
  inkFaint: '#AEB4BF', // 가장 옅은 텍스트(카드 제목 영문 병기 등)
  link: '#5E6AD2', // 링크/밑줄

  // 선·포인트
  border: '#EAEBEE', // 카드 테두리(팔레트 line)
  borderDark: '#D8DAE2', // 진한 테두리(점선 추가 버튼 등)
  divider: '#F1F2F5', // 카드 내부 구분선
  shadow: '#1E2340', // 그림자(쿨 인디고-잉크)
  accent: '#5E6AD2', // 메인 포인트(인디고)
  accentLight: '#AFB5E9', // 포인트 그라데이션 밝은 쪽(FAB·팔레트 accent2)
  accentAlt: '#C2705A', // 보조 포인트(레드·경고·로그아웃)
  accentDeep: '#4A53B8', // 더 진한 인디고(아이콘·강조 수치)
  green: '#5EA269', // 성공/허용 표시(체크·점)
  greenDeep: '#4E9B5C', // 진한 초록(집중 지표 아이콘·차트)
  sand: '#DDE0F3', // 밝은 인디고(아이콘 배경 등)
  blue: '#4C5DE6', // 순위 배지(밝은 인디고)
  blueBg: '#ECEEFD', // 순위 배지 배경

  // 상태 틴트 — 아이콘 배경·안내/경고 박스·비교 카드
  accentBg: '#EEF0FB', // 인디고 지표 아이콘 배경
  accentAltBg: '#FBEEEB', // 레드 아이콘 배경(로그아웃 등)
  greenBg: '#ECF5EE', // 초록 지표 아이콘 배경
  successInk: '#4A7A54', // 긍정 수치 텍스트
  successBg: '#F0F7F1', // 긍정 카드 배경
  successBorder: '#D6E9DA',
  dangerInk: '#C25F52', // 경고 텍스트
  dangerBg: '#FBEFEC', // 경고 카드 배경
  dangerBorder: '#F3D9D4',
  flame: '#E8452C', // 스트릭 불꽃 아이콘(연속 공부, GROMO-630)
  noteBg: '#EEF0FB', // 안내(인포) 박스 배경(인디고 틴트)
  noteBorder: '#DDE0F3',

  // 과목 대표색 팔레트 — 과목 팝오버에서 선택. 6색: 비율 바에서 구분 가능한 상한. index0은 accent와 동일.
  subjectPalette: [
    '#5E6AD2', // 인디고(accent)
    '#C2705A', // 코랄
    '#6FA15A', // 올리브 그린
    '#5E9C8D', // 틸
    '#6C86B3', // 더스티 블루
    '#9A7FAE', // 라벤더
  ],

  // 순위 메달 — 금/은/동(의미색, 인디고화하지 않음)
  medal: { gold: '#E0A83F', silver: '#B8B0A3', bronze: '#C58F5A' },
  // 포디움 메달 그라데이션 — 밝은 쪽→진한 쪽(입체감). medal과 같은 금/은/동 계열 (GROMO-655)
  medalGrad: {
    gold: ['#F7D97E', '#D9962A'],
    silver: ['#DCD6CC', '#A69D90'],
    bronze: ['#E2AE7E', '#B37845'],
  },

  // 비교 지표 색 — 나(accent) vs 상대(퍼플)·평균(중립). 겹침 비교 바에서 구분용.
  compare: { theirs: '#9A6FB0', theirsPhone: '#B08FC4', avg: '#C4C8D4' },

  // 잔디 히트맵 램프 — 빈칸(인디고 틴트) → 진한 초록. 집중량 강도별.
  grass: ['#EEF0FB', '#DCE8CE', '#B9D3A0', '#8FB86F', '#4E9B5C'],

  // 아바타 배경 팔레트 — 친구 그리드 로테이션(6색, 구분용).
  avatarPalette: ['#5E6AD2', '#9A6FB0', '#5B8A6A', '#7A8AA0', '#6A9AA0', '#B0607A'],

  // 앱 아이콘 대표색 — 집중 앱 목록(4색, 구분용).
  appPalette: ['#7FA06A', '#6E8FB0', '#5E6AD2', '#9C7BB0'],

  // 브랜드(소셜 로그인)
  kakao: '#FEE500',
  kakaoInk: '#3C1E1E',
  grayInk: '#3C3C3C', // 흰 버튼 위 텍스트(구글·메타)

  // 집중 세션(다크) 팔레트 — 세션 화면·친구 그리드(인디고 다크)
  night: {
    top: '#2A2E45', // 배경 그라데이션 위
    bottom: '#1A1D2E', // 배경 그라데이션 아래·베이스
    cream: '#D9DCF0', // 크림 텍스트(과목명) — 쿨 라이트
    muted: '#8B90A8', // 보조 텍스트
    gold: '#B7BCF0', // 포인트(도트·세트 배지) — 라이트 인디고
    green: '#7FCB8E', // 친구 집중중 표시(의미색 유지)
    greenSoft: '#9FE0AC', // 배너 텍스트
    face: '#2E3250', // 별사탕 아바타 얼굴
  },

  // 기타
  white: '#FFFFFF',
  black: '#000000',
  dark: '#171826', // 베젤/강조 어두운 면(쿨)

  // 타이포 스케일 (중요도별 고정) — body 16 기준(모바일 국룰). 색은 따로 준다.
  // 사용: <Text style={[T.text.title, { color: T.ink }]}>
  text: {
    timer: { fontSize: 52, fontWeight: '800', letterSpacing: -2 }, // 타이머·온보딩 초대형 숫자
    display: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 }, // 큰 숫자/타이틀
    title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }, // 화면 제목/큰 지표값
    stat: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 }, // 홈 지표값 — 네이티브 HomeUsageView(size 22 heavy)와 크기 계약
    heading: { fontSize: 21, fontWeight: '700' }, // 섹션/카드 헤더
    subtitle: { fontSize: 19, fontWeight: '700' }, // 닉네임·버튼·강조
    body: { fontSize: 17, fontWeight: '500', lineHeight: 25 }, // 본문
    label: { fontSize: 15, fontWeight: '600' }, // 라벨·소제목
    caption: { fontSize: 13, fontWeight: '600' }, // 배지·캡션·보조 (최소 가독선)
  },
} as const;

// #RRGGBB 팔레트 토큰 → rgba 문자열. 반투명 색을 하드코딩하지 말고 토큰에서 파생시킬 때 사용.
// 예: backgroundColor: withAlpha(T.accent, 0.2)
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
