// localDate.ts
// 로컬(기기 시간대) 기준 날짜 문자열 유틸 + KST 짝
//
// 📖 **축 규약의 정본은 `docs/date-axis.md`다** (GROMO-1254). 어떤 값이 서버 축인지·측정
//    축인지, 새 지점을 어느 축에 놓아야 하는지, 축 테스트를 어떻게 쓰는지는 전부 거기 있다.
//    이 파일 주석은 각 함수의 국소 계약만 다룬다 — 분류가 애매하면 문서의 전수 분류표를 본다.
//
// toISOString()은 UTC 기준이라 KST(UTC+9)에서 날짜가 하루 어긋날 수 있음.
// 목표/측정대상의 "다음날 적용" 판정은 반드시 로컬 날짜 기준이어야 하므로 직접 포맷한다.

// Date → "YYYY-MM-DD" (로컬 기준)
export function localDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 오늘 날짜 "YYYY-MM-DD"
export function todayStr(): string {
  return localDateStr(new Date());
}

// 내일 날짜 "YYYY-MM-DD"
export function tomorrowStr(): string {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return localDateStr(t);
}

// 어제 날짜 "YYYY-MM-DD"
export function yesterdayStr(): string {
  const t = new Date();
  t.setDate(t.getDate() - 1);
  return localDateStr(t);
}

// 구간 [startISO, endISO] 중 '오늘'(로컬 자정~다음 자정) 몫 초 — 자정을 걸친 집중 세션을
// 날짜별로 나눠 적립하기 위한 교집합(GROMO-1252). 종료 시각만 보고 세션 전체를 오늘에 꽂으면
// 전날 몫까지 오늘로 들어온다. 서버도 같은 규칙(자정 경계 분할)으로 날짜 버킷을 나눈다.
// 다음 자정은 setDate로 구한다 — DST 전환일은 하루가 23/25시간이라 +24h 고정 더하기는
// 어긋난다(stats/format.tenMinuteFocusSlots와 같은 취지).
// 축은 기기 로컬이다 — 이 값의 소비처(홈 '오늘 집중'·과목별 누적)가 로컬 자정 리셋 스토어라,
// 저장 축과 분할 축이 같아야 한다(위 KST 주석의 ② 측정/저장 부류).
// 파싱 실패(NaN)·역전 구간은 비교가 전부 false가 되어 0.
export function todayOverlapSeconds(startISO: string, endISO: string): number {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayStart.getDate() + 1);
  const from = Math.max(Date.parse(startISO), dayStart.getTime());
  const to = Math.min(Date.parse(endISO), dayEnd.getTime());
  return to > from ? Math.floor((to - from) / 1000) : 0;
}

// ── KST(Asia/Seoul) 고정 버전 ──────────────────────────────────────────
// ✅ **이 계열이 '서버 축'의 정확한 표현이다** (docs/date-axis.md §2). 서버는 판정·저장·조회의
// 날짜 버킷이 전부 KST 고정이다 — 정본은 백엔드 ZonePolicy.KST 상수 하나이고, GROMO-1259가
// country_code 파생 존(CountryZoneResolver)을 **폐지**하면서 저장축까지 KST로 통일했다.
// 해외 유저가 "내 하루"와 어긋나는 것은 수용된 한계다(챌린지 정책 L5 — 한국 타깃 서비스).
// **서버 결합 지점은 이 계열을 쓴다.** utils/serverZone은 1259 이전 잔재라 새로 쓰지 않는다
// (서버가 상수를 내려주므로 얻는 것이 없고, 낡은 프로필 캐시라는 오염 경로만 남는다 — 문서 §6 G1).
//
// 서버는 내기·챌린지·창 사용분 보고의 날짜 판정이 전부 KST 고정이다(내기 계약 §1·§3) — 기기
// 로컬 날짜를 보내면 비KST 기기에서 하루 어긋난 날짜로 나가 BET_CLOSED·오귀속을 맞는다.
// "서버의 오늘/어제/내일"이 필요한 자리는 전부 이 버전을 쓴다: 내기·챌린지 조회 기준일·창 보고
// (GROMO-1219)에 이어 통계·친구·리그 API의 date 파라미터와 히트맵 from/to도 이전 완료
// (GROMO-1236 — statsApi·userApi.getUserStats·friendsApi·leagueApi.getMyRanking·
// stats/format.heatmapRange·rollingWeekRange). 통계 화면의 **데이터 결합 그리드/마커**(캘린더
// 페이지·주 키·current/future 플래그·오늘 하이라이트 — stats/format.kstTodayDate 앵커)도 KST다
// (PR #531 P2: 데이터가 KST 버킷이면 그리는 축도 같아야 셀·마커가 제 칸에 붙는다).
// 남은 todayStr(로컬) 사용처는 두 부류뿐이다: ① 진짜 코스메틱(공유 파일명·dev fixture —
// 서버로 안 나가고 데이터와 비교되지 않는 값) ② 측정/저장(dayChange·FocusContext·
// SubjectContext 등 — 기기 로컬이 정본 축).
// 종전 주석의 "서버 버킷 존은 country_code 파생이라 KR이 아닌 유저는 KST가 아닐 수 있다"는
// **더는 사실이 아니다** — GROMO-1259가 리졸버를 제거하고 서버 저장축을 KST로 고정했다.
// 남은 어긋남은 서버 축이 아니라 **기기 축**이다: 비KST 기기의 사용자 체감 하루가 앱의 하루와
// 다르다(수용 한계 L5). 그래서 로컬 누적을 서버 집계와 합칠 때는 kstLocalSameDay 게이트를 쓴다.
// Intl 미지원/오류 시 로컬 폴백 — challengeTime.nowSecondsInZone과 같은 관례다.
// 날짜 이동은 setDate가 아니라 절대 ms 가산이다: Date는 절대 시각이라 +86_400_000ms 후를 KST로
// 포맷하면 정확히 KST 다음 날이 된다(KST는 DST가 없다).

// 포매터는 존별로 모듈 스코프 캐시 — Intl.DateTimeFormat 생성은 로케일 데이터를 물어 비싸서,
// 레코드당 생성하면(kstDateStr를 세션 수백 건에 맵핑) JS 스레드가 눈에 띄게 멈춘다
// (PR #531 P2). 생성 실패(Intl/타임존 미지원)도 1회만 판정해 null로 캐시 — 이후 호출은 곧장
// 로컬 폴백을 탄다. 존은 몇 개 안 되므로(KST + 서버가 내려주는 유저 존) 맵이 커지지 않는다.
const dateFormatByZone = new Map<string, Intl.DateTimeFormat | null>();
function getZoneDateFormat(timeZone: string): Intl.DateTimeFormat | null {
  const cached = dateFormatByZone.get(timeZone);
  if (cached !== undefined) return cached;
  let fmt: Intl.DateTimeFormat | null;
  try {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    fmt = null;
  }
  dateFormatByZone.set(timeZone, fmt);
  return fmt;
}

// 임의 Date → 지정 IANA 존의 "YYYY-MM-DD". 존 미지원·Intl 오류면 기기 로컬 폴백(위 관례와 동일).
export function zoneDateStr(date: Date, timeZone: string): string {
  const fmt = getZoneDateFormat(timeZone);
  if (fmt == null) return localDateStr(date);
  try {
    const parts = fmt.formatToParts(date);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const y = get('year');
    const m = get('month');
    const d = get('day');
    if (y && m && d) return `${y}-${m}-${d}`;
    return localDateStr(date);
  } catch {
    return localDateStr(date);
  }
}

// 존별 '날짜+시:분' 포매터 캐시 — 두 축의 벽시계 비교용(zoneSameWallClock). 키 ''는 기기 로컬.
const wallClockFormatByZone = new Map<string, Intl.DateTimeFormat | null>();
function getWallClockFormat(timeZone?: string): Intl.DateTimeFormat | null {
  const key = timeZone ?? '';
  const cached = wallClockFormatByZone.get(key);
  if (cached !== undefined) return cached;
  let fmt: Intl.DateTimeFormat | null;
  try {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone, // undefined = 기기 로컬 존
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    fmt = null;
  }
  wallClockFormatByZone.set(key, fmt);
  return fmt;
}

// 지정 존의 벽시계가 기기 로컬 벽시계와 같은가 = 두 축의 **자정 경계가 겹치는가**
// (GROMO-1252 5차 ① — kstLocalSameDay의 임의 존 일반화).
// 날짜 라벨만 비교하면 라벨이 같아도 경계가 다른 축을 못 거른다(위 kstLocalSameDay 주석의 시드니 예) —
// 그래서 '날짜+시:분'을 통째로 비교한다(오프셋이 30·45분 단위인 존까지 구분).
// Intl 미지원·존 오류면 false(보수적) — 그 환경에선 zoneDateStr이 로컬로 폴백해 존 축 자체가 없다.
export function zoneSameWallClock(timeZone: string, date: Date = new Date()): boolean {
  const zoned = getWallClockFormat(timeZone);
  const local = getWallClockFormat();
  if (zoned == null || local == null) return false;
  try {
    return zoned.format(date) === local.format(date);
  } catch {
    return false;
  }
}

function dateStrKstAfter(days: number, base: number = Date.now()): string {
  return zoneDateStr(new Date(base + days * 86_400_000), 'Asia/Seoul');
}

// KST 기준 오늘 "YYYY-MM-DD"
export function todayStrKst(): string {
  return dateStrKstAfter(0);
}

// KST 기준 내일 "YYYY-MM-DD"
export function tomorrowStrKst(): string {
  return dateStrKstAfter(1);
}

// KST 기준 어제 "YYYY-MM-DD"
export function yesterdayStrKst(): string {
  return dateStrKstAfter(-1);
}

// 임의 Date → KST "YYYY-MM-DD" — localDateStr의 KST 짝.
export function kstDateStr(date: Date): string {
  return dateStrKstAfter(0, date.getTime());
}

// 기기가 지금 KST 축 위에 있는가(UTC+9) — 서버(KST 버킷) 값과 로컬 누적을 병합하는 지점들의
// 공용 동축 게이트(GROMO-1236 P2 6라운드: 결과 화면·홈·통계 4곳).
// 측정 축은 로컬 소유(FocusContext 하루 누적 등) — 동축이 아니면 로컬 누적을 서버 KST 버킷
// 값과 합치지 않는다.
// 조건은 날짜 라벨 비교가 아니라 **오프셋 일치**다(P2 7라운드): 라벨이 같아도 경계가 다르면
// 인접 버킷 시간이 섞인다 — 예: 시드니 월요일 02:00 = KST 월요일 00:00, 두 축 모두 '월요일'이라
// 라벨은 같지만 로컬 누적엔 로컬 월요일 00~02시(=KST 일요일 몫)가 이미 들어 있다. 오프셋이
// 일치하면 두 자정이 정확히 겹쳐 누적 경계 == 서버 버킷 경계(라벨 비교는 불필요해진다).
// KST는 DST 없음 — KR 기기는 항상 -540이라 행동 불변.
export function kstLocalSameDay(): boolean {
  return new Date().getTimezoneOffset() === -540;
}
