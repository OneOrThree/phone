// localDate.ts
// 로컬(기기 시간대) 기준 날짜 문자열 유틸
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

// ── KST(Asia/Seoul) 고정 버전 ──────────────────────────────────────────
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
// 알려진 한계: 서버 버킷 존은 country_code 파생(CountryZoneResolver — KR/JP/GB만 매핑, 그 외
// UTC 폴백)이라 country_code가 KR이 아닌 유저는 서버 버킷이 KST가 아닐 수 있다. 클라는 KST를
// 정본 축으로 보내는 것으로 통일한다(주 사용층 KR 기준 — 완전 해소는 서버 존 협상 필요).
// Intl 미지원/오류 시 로컬 폴백 — challengeTime.nowSecondsInZone과 같은 관례다.
// 날짜 이동은 setDate가 아니라 절대 ms 가산이다: Date는 절대 시각이라 +86_400_000ms 후를 KST로
// 포맷하면 정확히 KST 다음 날이 된다(KST는 DST가 없다).

// KST 포매터는 모듈 스코프 1회 생성 캐시 — Intl.DateTimeFormat 생성은 로케일 데이터를 물어
// 비싸서, 레코드당 생성하면(kstDateStr를 세션 수백 건에 맵핑) JS 스레드가 눈에 띄게 멈춘다
// (PR #531 P2). 생성 실패(Intl/타임존 미지원)도 1회만 판정해 null로 캐시 — 이후 호출은 곧장
// 로컬 폴백을 탄다.
let kstDateFormat: Intl.DateTimeFormat | null | undefined;
function getKstDateFormat(): Intl.DateTimeFormat | null {
  if (kstDateFormat === undefined) {
    try {
      kstDateFormat = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      kstDateFormat = null;
    }
  }
  return kstDateFormat;
}

function dateStrKstAfter(days: number, base: number = Date.now()): string {
  const target = new Date(base + days * 86_400_000);
  const fmt = getKstDateFormat();
  if (fmt == null) return localDateStr(target);
  try {
    const parts = fmt.formatToParts(target);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const y = get('year');
    const m = get('month');
    const d = get('day');
    if (y && m && d) return `${y}-${m}-${d}`;
    return localDateStr(target);
  } catch {
    return localDateStr(target);
  }
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
