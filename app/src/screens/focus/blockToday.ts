// blockToday.ts
// 미정산 집중 블록의 **날짜별 집중초** — 집중 tick 1개를 '그 tick이 덮은 1초의 시작 시각'의
// 날짜에 센다(GROMO-1252).
//
// 왜 벽시계 겹침(todayOverlapSeconds)이 아니라 tick인가:
// 블록 구간 [settleAt, endedAt]에는 tick이 멈춘 공백(일시정지)이 섞인다. 그래서 겹침으로
// 클램프하면 "가용 집중초가 전부 오늘 발생했다"고 가정하게 된다 —
//   23:50~23:55 집중 → 일시정지 → 00:10~00:15 집중
//   집중초 600, 벽시계 겹침 900 → min이 600을 골라 600 전부 오늘로 들어온다(실제 오늘 몫 300).
// tick을 세면 일시정지·뽀모도로 휴식은 tick이 안 돌아 자연히 빠진다. 백그라운드 복귀 리플레이도
// 지난 벽시계 시각으로 tick을 되돌리므로 같은 규칙이 그대로 적용된다.
//
// 왜 '오늘' 하나가 아니라 날짜별 맵인가(코드리뷰 2차 ①):
// 서버는 업로드 구간을 벽시계 자정으로 쪼개는데, 위 예시처럼 일시정지가 자정을 걸치면 그 분할이
// 틀린다(600/900). 날짜별 분포를 아는 건 앱뿐이라 업로드 페이로드(focusSecondsByDate)에 이 맵을
// 그대로 실어 보낸다. 서버는 날짜별 벽시계 몫을 상한으로 클램프해 받는다.
//
// 왜 축이 둘인가(코드리뷰 3차 ②·4차 ②):
// 같은 tick이라도 '어느 날'인지는 축마다 다르다.
//   local  — 기기 로컬 날짜. 유저가 보는 '오늘'이고, 로컬 적립 스토어(FocusContext·SubjectContext·
//            내 그리드 셀)의 정본 축이다. 표시/로컬 적립은 반드시 이쪽.
//   server — 서버가 귀속에 쓰는 존(프로필 응답의 timeZone — utils/serverZone)의 날짜. 업로드 전용.
// 로컬 축만 보내면 PDT 지역에 있는 KR 유저처럼 기기 존 ≠ 서버 존인 경우 서버가 못 알아보는 날짜
// 키가 나가고, 그 몫이 조용히 버려진다(검증 맵이 비어 있지 않아 벽시계 폴백도 안 탄다).
// 3차엔 이 축을 KST로 하드코딩해 GB(Europe/London) 유저가 그대로 어긋났다 — 이제 서버가 내려준
// 존을 쓴다. 매핑 정본은 서버 CountryZoneResolver 한 곳.
//
// 경계 규약: tick은 '지나간 1초의 끝'에 발생하므로 귀속 시각은 tick 시각 − 1초다. 23:59:59→00:00:00
// 초는 [23:59:59, 00:00:00)이라 전날 몫 — 서버의 반열림 분할·todayOverlapSeconds와 같은 경계다
// (안 맞추면 23:00~00:05 세션이 앱 301초·서버 300초로 갈린다).
import { localDateStr, todayStr, zoneDateStr } from '@/utils/localDate';
import { getServerZone } from '@/utils/serverZone';

// 날짜 "YYYY-MM-DD" → 그 날짜에 발생한 이 블록의 집중 초.
export type SecondsByDate = Record<string, number>;

export interface BlockToday {
  local: SecondsByDate; // 기기 로컬 날짜 축 — 표시·로컬 적립용
  server: SecondsByDate; // 서버 존 날짜 축 — 서버 업로드용
}

// 정산 직후(새 블록 시작) 상태.
export function newBlockToday(): BlockToday {
  return { local: {}, server: {} };
}

// 집중 tick 1초 적립. at은 tick이 발생한 시각(1초의 끝).
export function creditTick(state: BlockToday, at: Date = new Date()): BlockToday {
  const covered = new Date(at.getTime() - 1000);
  const localDay = localDateStr(covered);
  const serverDay = zoneDateStr(covered, getServerZone());
  return {
    local: { ...state.local, [localDay]: (state.local[localDay] ?? 0) + 1 },
    server: { ...state.server, [serverDay]: (state.server[serverDay] ?? 0) + 1 },
  };
}

// 오늘(기기 로컬) 몫 — 로컬 스토어(FocusContext·SubjectContext)가 '오늘' 하나만 보관하므로.
export function blockTodaySeconds(state: BlockToday): number {
  return state.local[todayStr()] ?? 0;
}

// 서버가 이 업로드의 판정(그날 누적·스트릭)을 매긴 날짜 = 분포 맵의 마지막 비어있지 않은 날짜
// (FocusService: secondsByDate.lastKey()). 맵이 비었으면 null — 서버가 벽시계 분할로 폴백한다.
export function attributedDate(byDate: SecondsByDate | undefined): string | null {
  if (!byDate) return null;
  const dates = Object.keys(byDate).filter((date) => (byDate[date] ?? 0) > 0);
  return dates.length > 0 ? dates.sort()[dates.length - 1] : null;
}
