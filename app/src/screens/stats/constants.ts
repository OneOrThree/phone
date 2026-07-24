// 통계 화면 공용 상수 — 지표 색·잔디 팔레트·요일 라벨. 카드 파일들이 공유한다.
import { T } from '@/constants/theme';

// 잔디 강도 0..4 색(빈 칸 → 진한 초록).
export const GRASS = T.grass;
export const FOCUS_COLOR = T.greenDeep;
// 폰 사용 지표는 경고 계열(테라코타) — 메인 액센트를 쓰면 '줄여야 할 지표'가 브랜드색으로
// 강조되는 의미 역전이 생긴다. 집중(초록)과 대비되는 시안의 색 의미 복원(GROMO-849)
export const PHONE_COLOR = T.accentAlt;
// 요일 라벨(월~일) — 잔디·목표 달성·주간 타임라인 카드 공용
export const WEEK_DAYS = ['월', '화', '수', '목', '금', '토', '일'];
