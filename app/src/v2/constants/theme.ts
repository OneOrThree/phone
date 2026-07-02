// v2 디자인 토큰 — Claude Design 시안(Gromo) 팔레트 기준.
// 기존 src/constants/theme.ts(T)는 옛 디자인용으로 보존하고, v2 화면은 이걸 쓴다.
// import { T } from '@/v2/constants/theme';
export const T = {
  // 배경
  bg: '#E7E0D4', // 가장 바깥(페이지) 배경
  paper: '#EFE3CE', // 화면 기본 배경
  paperLight: '#F6F1E9', // 밝은 카드/표면
  paperAlt: '#ECE2D1', // 보조 표면(카드 테두리로도 사용)
  sandLight: '#F1E9DA', // 세그먼트 트랙·아이콘 배경(모래)
  caramel: '#F0E7D7', // 아이콘 박스·진행 트랙(밝은 카라멜)
  chipBg: '#F1EADD', // 칩·스텝퍼 버튼 배경
  chipBorder: '#E2D7C4', // 칩 테두리

  // 텍스트
  ink: '#2C2421', // 진한 텍스트(제목)
  inkSub: '#8A7B68', // 보조 텍스트
  inkMuted: '#A89B89', // 흐린 텍스트/캡션
  inkFaint: '#B3A695', // 가장 옅은 텍스트(카드 제목 영문 병기 등)
  link: '#7A6B58', // 링크/밑줄

  // 선·포인트
  border: '#E4DBCB', // 카드 테두리
  borderDark: '#D6C9B4', // 진한 테두리(점선 추가 버튼 등)
  divider: '#F0E9DC', // 카드 내부 구분선
  shadow: '#50371E', // 그림자(브라운)
  accent: '#C8893F', // 메인 포인트(브라운)
  accentLight: '#E0AA5A', // 포인트 그라데이션 밝은 쪽(FAB)
  accentAlt: '#C2705A', // 보조 포인트(레드)
  accentDeep: '#A86B2C', // 더 진한 브라운(아이콘·강조 수치)
  green: '#7FA06A', // 성공/허용 표시(체크·점)
  greenDeep: '#6FA15A', // 진한 초록(집중 지표 아이콘·차트)
  sand: '#EBD7B5', // 밝은 모래색(아이콘 배경 등)
  blue: '#4C5DE6', // 순위 배지
  blueBg: '#ECEEFD', // 순위 배지 배경

  // 상태 틴트 — 아이콘 배경·안내/경고 박스·비교 카드
  accentBg: '#F6ECE0', // 브라운 지표 아이콘 배경
  accentAltBg: '#F6E7E2', // 레드 아이콘 배경(로그아웃 등)
  greenBg: '#EEF4E9', // 초록 지표 아이콘 배경
  successInk: '#5B7A48', // 긍정 수치 텍스트
  successBg: '#F2F6EE', // 긍정 카드 배경
  successBorder: '#DEE9D3',
  dangerInk: '#B3705E', // 경고 텍스트
  dangerBg: '#FBEFEC', // 경고 카드 배경
  dangerBorder: '#EFD9D2',
  noteBg: '#FBF3E8', // 안내(인포) 박스 배경
  noteBorder: '#EBDCC2',

  // 과목 대표색 팔레트 — 과목 팝오버에서 선택. 6색: 비율 바에서 구분 가능한 상한 + 웜톤 유지.
  subjectPalette: [
    '#C8893F', // 브라운(accent)
    '#C2705A', // 코랄(accentAlt)
    '#6FA15A', // 올리브 그린(greenDeep)
    '#5E9C8D', // 틸
    '#6C86B3', // 더스티 블루
    '#9A7FAE', // 라벤더
  ],

  // 브랜드(소셜 로그인)
  kakao: '#FEE500',
  kakaoInk: '#3C1E1E',
  grayInk: '#3C3C3C', // 흰 버튼 위 텍스트(구글·메타)

  // 집중 세션(다크) 팔레트 — 세션 화면·친구 그리드
  night: {
    top: '#3A2C22', // 배경 그라데이션 위
    bottom: '#241A14', // 배경 그라데이션 아래·베이스
    cream: '#E6D3B4', // 크림 텍스트(과목명)
    muted: '#9A8472', // 보조 텍스트
    gold: '#F0C76A', // 포인트(도트·세트 배지)
    green: '#7FCB8E', // 친구 집중중 표시
    greenSoft: '#9FE0AC', // 배너 텍스트
    face: '#3A2A1E', // 별사탕 아바타 얼굴
  },

  // 기타
  white: '#FFFFFF',
  black: '#000000',
  dark: '#1B1613', // 베젤/강조 어두운 면

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
