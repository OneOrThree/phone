// v2 디자인 토큰 — Claude Design 시안(Gromo) 팔레트 기준.
// 기존 src/constants/theme.ts(T)는 옛 디자인용으로 보존하고, v2 화면은 이걸 쓴다.
// import { T } from '@/v2/constants/theme';
export const T = {
  // 배경
  bg: '#E7E0D4', // 가장 바깥(페이지) 배경
  paper: '#EFE3CE', // 화면 기본 배경
  paperLight: '#F6F1E9', // 밝은 카드/표면
  paperAlt: '#ECE2D1', // 보조 표면

  // 텍스트
  ink: '#2C2421', // 진한 텍스트(제목)
  inkSub: '#8A7B68', // 보조 텍스트
  inkMuted: '#A89B89', // 흐린 텍스트/캡션
  link: '#7A6B58', // 링크/밑줄

  // 선·포인트
  border: '#E4DBCB', // 카드 테두리
  accent: '#C8893F', // 메인 포인트(브라운)
  accentAlt: '#C2705A', // 보조 포인트(레드)

  // 기타
  white: '#FFFFFF',
  dark: '#1B1613', // 베젤/강조 어두운 면

  // 타이포 스케일 (중요도별 고정) — body 16 기준(모바일 국룰). 색은 따로 준다.
  // 사용: <Text style={[T.text.title, { color: T.ink }]}>
  text: {
    display: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 }, // 큰 숫자/타이틀
    title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }, // 화면 제목/큰 지표값
    heading: { fontSize: 21, fontWeight: '700' }, // 섹션/카드 헤더
    subtitle: { fontSize: 19, fontWeight: '700' }, // 닉네임·버튼·강조
    body: { fontSize: 17, fontWeight: '500', lineHeight: 25 }, // 본문
    label: { fontSize: 15, fontWeight: '600' }, // 라벨·소제목
    caption: { fontSize: 13, fontWeight: '600' }, // 배지·캡션·보조 (최소 가독선)
  },
} as const;
