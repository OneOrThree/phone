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
import { localDateStr, todayStr, todayStrKst, zoneDateStr } from '@/utils/localDate';
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
  return creditTicks(state, at, 1);
}

// 연속 tick n개(1초 간격) 일괄 적립 — 백그라운드 복귀 리플레이 전용(GROMO-1252 코드리뷰 6차 ④).
// firstAt은 첫 tick의 시각, 이후 tick은 +1초씩이라 덮은 초는 [firstAt−1s, firstAt−1s+n초).
// 실드 세션이 8시간 백그라운드에 있다 복귀하면 tick이 28,800개다. tick마다 이걸 부르면
// Intl.DateTimeFormat.formatToParts(zoneDateStr) 28,800회 + 객체 스프레드 57,600회가 setSession
// 전에 JS 스레드에서 돌아 앱이 눈에 띄게 멈춘다.
// 날짜는 시간순 단조라 런(run) 단위로 묶는다 — 8시간이면 날짜가 많아야 두 개라 포맷 호출이
// 수만 회에서 수십 회로 준다. 귀속 결과(어느 날짜에 몇 초)는 per-tick과 정확히 같다.
export function creditTicks(state: BlockToday, firstAt: Date, count: number): BlockToday {
  if (count <= 0) return state;
  const firstCoveredMs = firstAt.getTime() - 1000;
  const zone = getServerZone();
  return {
    local: addRuns(state.local, firstCoveredMs, count, (ms) => localDateStr(new Date(ms))),
    server: addRuns(state.server, firstCoveredMs, count, (ms) => zoneDateStr(new Date(ms), zone)),
  };
}

// 연속 초 구간을 날짜별로 쪼개 누적. 날짜가 바뀌는 지점은 이분탐색으로 찾는다 —
// 같은 날짜인지는 시각에 대해 단조(앞이 같으면 그 앞도 전부 같다)라 성립한다.
function addRuns(
  base: SecondsByDate,
  firstMs: number,
  count: number,
  dayOf: (ms: number) => string,
): SecondsByDate {
  const out = { ...base };
  let i = 0;
  while (i < count) {
    const day = dayOf(firstMs + i * 1000);
    let last = count - 1; // day와 같은 날짜인 마지막 인덱스
    if (dayOf(firstMs + last * 1000) !== day) {
      let lo = i; // day와 같음(확정)
      let hi = last; // day와 다름(확정)
      while (lo + 1 < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (dayOf(firstMs + mid * 1000) === day) lo = mid;
        else hi = mid;
      }
      last = lo;
    }
    out[day] = (out[day] ?? 0) + (last - i + 1);
    i = last + 1;
  }
  return out;
}

// 오늘(기기 로컬) 몫 — 로컬 스토어(FocusContext·SubjectContext)가 '오늘' 하나만 보관하므로.
export function blockTodaySeconds(state: BlockToday): number {
  return state.local[todayStr()] ?? 0;
}

// 서버 버킷(KST) 오늘 몫 — 서버 날짜 버킷 값 위에 얹을 '아직 서버에 없는 진행 중 몫'(GROMO-1246).
// blockTodaySeconds의 server 축 짝이다. 축이 다르면 자정 경계에서 같은 tick의 귀속 날짜가 갈린다.
// 키를 serverTodayStr()가 아니라 todayStrKst()로 잡는 이유(코덱스 리뷰 ①): 서버는 GROMO-1259
// (ZonePolicy)부터 판정·저장·조회 버킷이 전부 KST 고정이고, 이 값을 얹을 서버 스냅샷도 KST
// 기준일로 조회한다. serverZone은 프로필이 내려준 문자열이라(지금은 항상 Asia/Seoul) 구버전
// 서버·미갱신 프로필에서 KST가 아닐 수 있는데, 그러면 스냅샷과 델타의 축이 갈린다.
export function blockKstTodaySeconds(state: BlockToday): number {
  return state.server[todayStrKst()] ?? 0;
}

// 서버가 이 업로드의 판정(그날 누적·스트릭)을 매긴 날짜 = 분포 맵의 마지막 비어있지 않은 날짜
// (FocusService: secondsByDate.lastKey()). 맵이 비었으면 null — 서버가 벽시계 분할로 폴백한다.
export function attributedDate(byDate: SecondsByDate | undefined): string | null {
  if (!byDate) return null;
  const dates = Object.keys(byDate).filter((date) => (byDate[date] ?? 0) > 0);
  return dates.length > 0 ? dates.sort()[dates.length - 1] : null;
}
