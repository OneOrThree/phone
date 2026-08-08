// blockToday.ts
// 미정산 집중 블록의 '오늘'(로컬 날짜) 몫 집중초 — 집중 tick을 그 tick이 끝난 시각의
// 로컬 날짜에 센다(GROMO-1252 코드리뷰).
//
// 왜 벽시계 겹침(todayOverlapSeconds)이 아니라 tick인가:
// 블록 구간 [settleAt, endedAt]에는 tick이 멈춘 공백(일시정지)이 섞인다. 그래서 겹침으로
// 클램프하면 "가용 집중초가 전부 오늘 발생했다"고 가정하게 된다 —
//   23:50~23:55 집중 → 일시정지 → 00:10~00:15 집중
//   집중초 600, 벽시계 겹침 900 → min이 600을 골라 600 전부 오늘로 들어온다(실제 오늘 몫 300).
// tick을 세면 일시정지·뽀모도로 휴식은 tick이 안 돌아 자연히 빠진다. 백그라운드 복귀 리플레이도
// 지난 벽시계 시각으로 tick을 되돌리므로 같은 규칙이 그대로 적용된다.
//
// 경계 1초: tick은 '지나간 1초의 끝'에 발생하므로 23:59:59→00:00:00 초는 새 날짜로 센다.
// 규칙만 일관되면 되는 자리라 그대로 둔다.
import { localDateStr, todayStr } from '@/utils/localDate';

export interface BlockToday {
  day: string; // seconds가 속한 로컬 날짜 "YYYY-MM-DD"
  seconds: number; // 그 날짜에 발생한 이 블록의 집중 초
}

// 정산 직후(새 블록 시작) 상태 — at은 블록 시작 시각(생략 시 지금).
export function newBlockToday(at: Date = new Date()): BlockToday {
  return { day: localDateStr(at), seconds: 0 };
}

// 집중 tick 1초 적립. 날짜가 바뀌면 이전 날짜분은 버리고 새 날짜로 다시 센다 —
// 로컬 스토어(FocusContext·SubjectContext)가 보관하는 값이 '오늘' 하나뿐이라 어제 몫은
// 쓸 곳이 없다(서버는 업로드 구간을 날짜 버킷으로 직접 쪼갠다).
export function creditTick(state: BlockToday, at: Date = new Date()): BlockToday {
  const day = localDateStr(at);
  return day === state.day ? { day, seconds: state.seconds + 1 } : { day, seconds: 1 };
}

// 오늘 몫 — 날짜가 지났으면 0.
export function blockTodaySeconds(state: BlockToday): number {
  return state.day === todayStr() ? state.seconds : 0;
}
