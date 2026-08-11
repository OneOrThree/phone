# 날짜 축(date axis) 규약

앱이 "오늘"이라고 부르는 날짜에는 **축이 세 개** 있다. 어떤 값을 어느 축에서 뽑느냐를
틀리면 비KST 기기·비KR 계정에서 **하루씩 어긋난 화면**이 나온다 — 오늘 칸을 비켜 찍힌 마커,
빈 캘린더, 두 번 뜨는 축하 모달, 매번 1일로 리셋되는 연속 달성일.

이 문서가 **정본**이다. 종전엔 `app/src/utils/localDate.ts` 주석 하나가 정본 노릇을 했고
분류표는 PR #531 본문에만 있어 저장소 어디에도 없었다(GROMO-1236 → GROMO-1254).
날짜 축은 stats·focus·group·league·screentime 을 가로지르므로 `docs/prd/<기능>/` 에 담을 수
없다 — `docs/README.md` 의 "기능 문서가 아닌 팀 전체 규약은 `docs/` 최상위" 규정을 따른다.

관련 티켓: GROMO-1219(내기·챌린지 KST) → GROMO-1236(전수 1차 이전) →
GROMO-1252(서버 존 도입) → **GROMO-1254(전수 감사·정본화)**.

---

## 1. 원리 — 세 부류

| 부류 | 축 | 규칙 |
| --- | --- | --- |
| ① **서버 결합** | **서버 축** | 서버로 나가는 `date` 파라미터, 서버가 내려준 날짜 키(heatmap 셀 등)와 **비교·인덱싱**되는 값, 그 위에 찍는 그리드·마커 |
| ② **측정 / 저장** | **기기 로컬** | 기기가 직접 측정하고 로컬에 적립하는 값의 하루 경계 — 로컬 자정 리셋 스토어, 네이티브 익스텐션 dayKey, 사용자가 체감하는 "내일부터" |
| ③ **코스메틱** | 자유(로컬) | 서버로 나가지 않고 데이터와 비교되지도 않는 값 — 공유 파일명, dev fixture |

핵심 명제 두 개:

- **데이터와 다른 축의 마커는 오늘 칸을 비켜 찍힌다.** 그리는 축은 그려지는 데이터의 축을 따라간다.
- **반쪽 이전은 dedup 을 반대로 깨뜨린다.** 한 체인(발행 → 저장 → 조회 → 소비 → 완료 기록)은
  통째로 한 축이어야 한다. 절반만 옮기면 옮기기 전보다 나빠진다.

### 부류를 가르는 질문

"이 값이 **누구와 비교되는가**"를 묻는다. 값의 출처가 아니다.

- 서버가 내려준 키(heatmap 셀 `date`)와 `Map.get()` 으로 대조된다 → ①
- 서버에 `params.date` 로 실려 나간다 → ①
- 로컬 스토어의 `savedDate === ?` 로 대조된다 → ②
- 네이티브 익스텐션이 만든 dayKey 와 대조된다 → ②
- 아무와도 대조되지 않고 화면에만 찍힌다 → ③

⚠️ **한 함수 안에 축이 둘 있을 수 있다.** `screentimeSync.scheduleYesterdayScreenTimeCelebration`
이 그렇다 — 하루 1회 가드는 ②(로컬), 연속 달성일 카운트는 ①(서버). "이 파일/이 기능은
로컬"이라는 식의 파일 단위 판정이 GROMO-1254 가 찾아낸 결함의 원인이었다.

---

## 2. "서버 축"이란 무엇인가 — KST 하드코딩 vs serverZone

**서버는 `country_code` 에서 존을 파생해 날짜 버킷을 자른다**(`CountryZoneResolver` —
KR/JP/GB 매핑 + `Asia/Seoul` 폴백). 앱은 그 존을 두 가지 방식으로 표현한다:

| 표현 | 유틸 | 도입 |
| --- | --- | --- |
| **KST 하드코딩** | `todayStrKst()` · `tomorrowStrKst()` · `yesterdayStrKst()` · `kstDateStr()` · `kstTodayDate()` · `kstLocalSameDay()` | GROMO-1219 / 1236 |
| **서버가 내려준 존** | `serverTodayStr()` · `serverZoneAlignedWithLocal()` (`utils/serverZone.ts`, `GET /users/me → timeZone`) | GROMO-1252 |

### 판정 (GROMO-1254)

> **`serverZone` 이 서버 축의 정의다. `todayStrKst()` 계열은 그것의 근사치이며,
> 폴백 존이 `Asia/Seoul` 이라 KR 계정에서는 정확히 같은 값이다.**

근거:

1. **두 축은 `serverZone !== 'Asia/Seoul'` 일 때만 갈린다.** 그리고 그 경우는 정의상
   **서버 버킷이 KST가 아닌** 경우다 — 즉 갈리는 순간 KST 쪽이 틀렸다는 뜻이다.
   `serverZone ≥ KST` 가 모든 지점에서 성립하고, 갈리는 곳에서는 **엄격히 더 정확하다.**
2. **1236 이 KST 하드코딩을 고른 이유가 이미 해소됐다.** 당시 주석은 *"완전 해소는 서버 존
   협상 필요"* 라고 적었는데, GROMO-1252 가 그 협상을 마쳤다(서버가 프로필로 `timeZone` 을
   내려준다). 존 매핑을 앱이 복제하지 않고 받은 문자열을 그대로 쓴다.
3. **폴백이 서버와 같다.** 프로필 미수신 구간(온보딩 첫 세션·오프라인 첫 실행·구버전 서버)의
   `serverZone` 폴백은 `Asia/Seoul` 이고, 서버도 `country_code` 가 null 이면 같은 폴백을 쓴다.
   그 구간에서도 축이 일치한다.

### 그래서 지금 무엇을 쓰는가

- **새로 고치는 서버 결합 지점**은 `serverZone` 을 쓴다. 이미 손대는 줄에 알려진 근사치를
  새로 박아 넣지 않는다.
- **기존 `todayStrKst()` 함대는 이번 티켓에서 옮기지 않는다.** 모든 `*Api.ts` 의 `date`
  기본값 + 통계 그리드 앵커(`kstTodayDate`)를 한꺼번에 갈아엎는 대형 변경이고,
  `serverZone` 은 프로필 수신 시점에 따라 값이 변하는 **모듈 전역 가변 상태**라
  기본 인자에서 부르는 것과 렌더 중 부르는 것의 타이밍 계약을 따로 검토해야 한다.
  → **후속 티켓 후보**(§6).
- **절대 하지 말 것: 한 체인 안에서 두 표현을 섞는 것.** 같은 체인의 발행·조회·비교가
  `todayStrKst()` 와 `serverTodayStr()` 로 갈리면 **세 번째 축**이 생긴다.

현재 `serverZone` 축에 있는 지점: `focusRestore.todayRestoreSeconds` ·
`sessionSaveVerdict.isTodayVerdict` · `blockToday`(서버 키 맵) ·
`screentimeSync.serverBucketDateOf`(연속 달성일 앵커).

---

## 3. 유틸 카탈로그

### `app/src/utils/localDate.ts`

| 함수 | 축 | 용도 |
| --- | --- | --- |
| `localDateStr(date)` | 로컬 | `Date → 'YYYY-MM-DD'`. **로컬 축의 단일 주입점.** ⚠️ 아래 "달력 포매팅" 참고 |
| `todayStr()` · `tomorrowStr()` · `yesterdayStr()` | 로컬 | 로컬 오늘/내일/어제 |
| `todayOverlapSeconds(startISO, endISO)` | 로컬 | 자정 걸친 세션의 '오늘 몫' 초 |
| `zoneDateStr(date, tz)` | 임의 존 | `Date → 지정 IANA 존의 'YYYY-MM-DD'`. 존 미지원·Intl 오류면 로컬 폴백 |
| `zoneSameWallClock(tz, date?)` | — | 그 존과 기기 로컬의 **자정 경계가 겹치는가** (날짜 라벨이 아니라 '날짜+시:분' 비교) |
| `todayStrKst()` · `tomorrowStrKst()` · `yesterdayStrKst()` · `kstDateStr(date)` | KST | 서버 축(근사) |
| `kstLocalSameDay()` | — | 기기가 지금 UTC+9 인가 — 로컬 누적을 서버 KST 집계와 합쳐도 되는지의 게이트 |

### `app/src/utils/serverZone.ts` (GROMO-1252)

| 함수 | 용도 |
| --- | --- |
| `setServerZone(zone)` / `resetServerZone()` / `getServerZone()` | 프로필 응답·캐시에서 받은 존 보관. 로그아웃·계정 전환 시 폴백으로 리셋 |
| `serverTodayStr()` | 서버 존 기준 오늘 |
| `serverZoneAlignedWithLocal()` | 서버 버킷 경계와 로컬 하루 경계가 지금 겹치는가 |

### `app/src/screens/stats/format.ts` (통계 그리드 앵커)

| 함수 | 용도 |
| --- | --- |
| `kstTodayDate()` | KST '오늘'의 **달력 날짜 Date**. 통계 그리드·마커의 공용 앵커 |
| `kstTodayWeekdayIndex()` | 주(월~일) 배열의 '오늘' 칸 인덱스(월=0..일=6) |
| `heatmapRange(period)` · `rollingWeekRange()` | 히트맵 조회 범위 — from/to 둘 다 KST |
| `calendarPage()` · `weekDateKeys()` · `heatmapBars()` · `firstStartPoints()` | 그리드·마커 |

### ⚠️ `localDateStr` 의 두 얼굴

`localDateStr` 은 **두 가지 목적**으로 쓰인다. 리뷰에서 자주 오판되는 지점이다.

1. **로컬 축 읽기** — `localDateStr(new Date())`. 지금 시각을 기기 존으로 자른다. 축이 있다.
2. **달력 포매팅** — parts 생성자(`new Date(y, m-1, d)`)로 만든 **달력 Date** 를 다시
   문자열로 되돌린다. 시간대 변환이 끼지 않으므로 **축이 없다.**

`heatmapRange` 는 `dateFromStr(todayStrKst())` 로 앵커를 잡고 `localDateStr(monday)` 로
포매팅한다 — 이건 (2)라서 KST 축이 유지된다. **앵커만 옳으면 이후 산술은 순수 달력 산술이다.**
축 회귀를 찾을 때는 `localDateStr` 호출이 아니라 **그 Date 가 어디서 왔는지**를 본다.

---

## 4. 전수 분류표

`app/src/legacy/**`(동결)·`app/src/mocks/fixtures/**` 는 제외.

### ① 서버 결합 — 서버 축

| 지점 | 값 | 축 | 왜 |
| --- | --- | --- | --- |
| `services/statsApi.ts` (6곳 `date` 기본값) | `todayStrKst()` | KST | 서버 `date` 파라미터 |
| `services/userApi.ts:151` `getUserStats` | `todayStrKst()` | KST | 〃 |
| `services/friendsApi.ts:18,68` | `todayStrKst()` | KST | 〃 |
| `services/leagueApi.ts:30` `getMyRanking` | `todayStrKst()` | KST | 〃 |
| `services/groupApi.ts:126` `getGroupDetail` | `todayStrKst()` | KST | 멤버 진행률 기준일 (GROMO-1219) |
| `components/BetSheet.tsx:345,373` | `todayStrKst()` / `tomorrowStrKst()` | KST | 내기 기준일 — 서버가 KST로 판정 |
| `components/ChallengeCard.tsx:360,361,423,473` | `todayStrKst()` | KST | 내기 date 비교(오늘/내일/과거) |
| `components/GroupCardBack.tsx:173` | `todayStrKst()` | KST | 반복 요일 판정 |
| `components/JoinNextSheet.tsx:81,111` | `todayStrKst()` | KST | 시트 열린 날 고정 + 자정 넘김 감지 |
| `group/GroupRoomScreen.tsx:141,343,596` | `todayStrKst()` | KST | 회차 조회 기준일 |
| `group/useGroupCardData.ts:43,90,108` | `todayStrKst()` | KST | 카드 조회 기준일 |
| `group/groupFocusStatus.ts:197` | `todayStrKst` | KST | 상태 판정 기준일(시임 기본값) |
| `group/challengeResult.ts:160` | `kstDateStr()` | KST | seen 마커 컷오프 — 마커 값(sessionDate)이 KST |
| `focus/useSessionGroups.ts:46` | `todayStrKst()` | KST | `getGroupDetail` 기본값과 동일 축 |
| `focus/FocusResultScreen.tsx:180,~215` | `todayStrKst()` / `thisWeekDates()` | KST | heatmap 조회 상한·주 키 |
| `focus/format.ts thisWeekDates` | `kstTodayDate()` 앵커 | KST | 주간 막대·스트릭 칸 키 |
| `focus/goalCelebrationVerdict.ts` | `celebrationDayKey()` + `kstTodayDate()` | KST | 축하 dedup 키 + 연속 달성일 커서 |
| `services/goalCelebration.ts:20` `celebrationDayKey` | `todayStrKst()` | KST | 집중 목표 달성 **판정이 서버 KST 버킷** |
| `screens/HomeScreen.tsx:~381` | `celebrationDayKey()` | KST | 위 체인의 소비 측 |
| `screens/HomeScreen.tsx:~528` `focusGoalCelebratedDate` | 예약의 `date` | KST | 위 체인의 완료 기록 |
| `stats/format.ts` `heatmapRange`·`rollingWeekRange`·`weekDateKeys`·`calendarPage`·`heatmapBars`·`firstStartPoints`·`kstTodayWeekdayIndex` | `todayStrKst()` / `kstTodayDate()` | KST | 그리드·마커가 KST 셀 위에 찍힌다 |
| `stats/CalendarCard.tsx:72,143` · `charts.tsx:301` · `MonthWeeklyChart.tsx:37,44` · `LongestSessionStat.tsx:34` · `WeeklyTimetableCard.tsx:123` | `kstTodayDate()` / `todayStrKst()` | KST | 〃 |
| `StatsScreen.tsx:134` | `kstTodayDate()` | KST | 표시 월 라벨이 그리드와 같은 축 |
| **`league/components/DuoDayChart.tsx:38`** | **`kstTodayWeekdayIndex()`** | **KST** | **GROMO-1254 수정.** 배열이 `heatmapRange('WEEK')`(KST) 셀을 요일별로 접은 값인데 마커만 로컬 요일이었다 |
| **`services/screentimeSync.ts` 연속 달성일 커서·조회 창** | **`serverBucketDateOf()`** | **serverZone** | **GROMO-1254 수정.** 서버 heatmap 셀을 뒤로 세는 계산인데 로컬 측정일에서 후진했다 |
| `focus/focusRestore.ts:64-65` | `serverTodayStr()` + `serverZoneAlignedWithLocal()` | serverZone | 서버 `focusSecondsByDate` 인덱싱 (GROMO-1252) |
| `focus/sessionSaveVerdict.ts:29` | `serverTodayStr()` | serverZone | 서버가 귀속시킨 날짜와 비교 |
| `focus/blockToday.ts:65` | `zoneDateStr(ms, zone)` | serverZone | 서버 키 맵 |

### ② 측정 / 저장 — 기기 로컬 (정본)

| 지점 | 값 | 왜 로컬인가 |
| --- | --- | --- |
| `utils/dayChange.ts:21,26,27,43` | `todayStr()` | 로컬 자정 넘김 감지 — 하루 리셋의 트리거 |
| `store/FocusContext.tsx` (6곳) | `todayStr()` | 로컬 자정 리셋 스토어의 하루 키 |
| `store/SubjectContext.tsx` (6곳) | `todayStr()` | 〃 (과목 합 == 홈 총합 유지) |
| `utils/localDate.todayOverlapSeconds` | 로컬 자정~다음 자정 | 소비처가 로컬 자정 리셋 스토어라 분할 축도 로컬 |
| `focus/OrphanFocusSettler.tsx:85-86` | `todayStr()` / `todayOverlapSeconds` | 로컬 누적 적립 |
| `focus/FocusSessionScreen.tsx:341,342,676,1243` | `todayStr()` | 그리드 프리세션 base·정산 누적 — 로컬 측정값 |
| `focus/blockToday.ts:64,100` | `localDateStr` / `todayStr()` | 표시 축(로컬 누적) — 같은 파일의 `server` 맵과 **의도적으로 두 축** |
| `focus/sessionSaveVerdict.ts:30,71` | `todayStr()` | 판정 발행 시점 날짜(로컬) — 소비처 `FocusResultScreen:272` 도 로컬 |
| `focus/FocusResultScreen.tsx:~215` `todayLocal` | `todayStr()` | verdict 유효성 비교 — **강제 이전 금지**(같은 축끼리 비교) |
| `services/screentimeSync.ts:116,282,283` | `todayStr()` / `yesterdayStr()` | 측정 시작일 앵커·마감 대상일 — 익스텐션이 로컬 하루로 버킷을 자른다 |
| `services/screentimeSync.ts:137` `localNoonInstant` | 로컬 정오 | 기기 오프셋 −11~+12 전 범위에서 날짜 오귀속을 막는 보고 instant |
| `services/screentimeSync.ts:549,688` | `localDateStr` | 네이티브 dayKey 축 — **`todayStr`/`yesterdayStr` 금지**(주입점을 `localDateStr` 하나로) |
| `services/screentimeSync.ts` 축하 하루 1회 가드(`today`) | `todayStr()` | 달성 **판정 자체가 로컬**(네이티브 버킷 분값 ≤ 로컬 목표) + 트리거도 로컬 자정 넘김 |
| `HomeScreen.tsx:~397` 스크린타임 축하 비교 | `todayStr()` | 위 체인의 소비 측 |
| `HomeScreen.tsx:~542` `screentimeLastRewardedDate` | 예약의 `date` | 위 체인의 완료 기록 |
| `settings/GoalsScreen.tsx` `effectiveDate` | `localDateStr(tomorrow)` | 사용자가 체감하는 "내일부터" |
| `components/PendingGoalApplier.tsx` 발효 판정 | `todayStr()` | 위 예약과 같은 축 |
| `settings/ScreenTimePermissionScreen.tsx` `selectionApplyDate`·`syncLabel` | `tomorrowStr()` / `todayStr()` / `yesterdayStr()` | 로컬로 예약한 값의 대조 |
| `services/storeReview.ts:33` | `todayStr()` | 접속일 카운트 — 순수 로컬 상태 |
| `App.tsx:414` 온보딩 과목 저장 | `todayStr()` | `SubjectContext` 스토어 형식과 동일해야 첫 로드가 읽는다 |
| `HomeScreen.tsx:~515` · `StatsScreen.tsx:222,236` · `FocusResultScreen.tsx:~285` | `kstLocalSameDay()` | 로컬 누적을 서버 KST 집계와 **합칠지**의 게이트 |

### ③ 코스메틱 — 자유

| 지점 | 값 | 왜 |
| --- | --- | --- |
| `stats/FocusTimetableCard.tsx:29` | `todayStr()` | 공유 이미지 파일명 |
| `stats/WeeklyTimetableCard.tsx:66` | `todayStr()` | 〃 |
| `MenuScreen.tsx:79` | `yesterdayStr()` | dev fixture(챌린지 결과 미리보기) — 서버로 안 나간다 |
| `mocks/fixtures/**` · `legacy/**` | — | 동결 |

---

## 5. 테스트 관행 — 3층

러너 TZ 가 `Asia/Seoul` 고정(`app/jest.config.js:3`)이라 **값만으로는 로컬과 KST 가 안 갈린다.**
그래서 축 테스트는 세 층을 겹쳐 쓴다.

### 층 1 — 러너 TZ 고정

`jest.config.js` 가 `process.env.TZ = 'Asia/Seoul'` 을 세운다. 자정 경계 로직이 러너 환경에
흔들리지 않게 하는 **전제**이지, 축 검증 수단이 아니다.

### 층 2 — fake timers

```ts
const NOW = new Date('2026-07-15T09:00:00+09:00');
beforeAll(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
afterAll(() => jest.useRealTimers());
```

자정 넘김·날짜 경계를 테스트가 직접 옮긴다.

### 층 3 — **독극물 / 센티널** 목-축-분리 ★

축 회귀를 실제로 잡는 층이다. 로컬 유틸을 **일부러 엉뚱한 날짜**로 목킹하고(독극물),
서버 축 유틸을 **시스템 시계와 다른 날짜**로 목킹한다(센티널).

```ts
jest.mock('@/utils/localDate', () => ({
  ...jest.requireActual('@/utils/localDate'),   // 나머지는 실물 — 시임 오버라이드 금지
  todayStr: jest.fn(() => '2000-01-02'),        // 독극물(로컬) — 결과에 섞이면 축 위반
  todayStrKst: jest.fn(() => '2026-03-04'),     // 센티널(KST) — 시스템 시계(7월)와 다른 달
}));
```

- 코드가 **로컬 축을 부르면** 독극물 `2000-01-02` 가 결과에 드러난다.
- 코드가 **시계를 직접 보면**(`new Date()`) 7월 값이 나와 센티널(3월)과 갈린다.
- `jest.requireActual` 스프레드는 필수다 — `localDateStr` 같은 달력 포매터까지 목으로 덮으면
  산법 자체가 테스트에서 사라진다(계약 §6: 시임이 있으면 진짜 데이터를 흘려보낸다).

원형 / 적용 사례:

| 파일 | 잠그는 것 |
| --- | --- |
| `services/goalCelebration.test.ts` | dedup 키 체인 |
| `services/statsApi.test.ts` · `userApi.test.ts` · `friendsApi.test.ts` · `leagueApi.test.ts` | `date` 파라미터 |
| `stats/format.axis.test.ts` · `format.gridAxis.test.ts` | 조회 범위·그리드·마커 |
| `focus/format.axis.test.ts` | 주 키 |
| **`focus/goalCelebrationVerdict.axis.test.ts`** | **축하 판정 전체(GROMO-1254 신규)** |
| `services/screentimeSync.windowUsage.test.ts` | 로컬 주입점(`localDateStr`) 치환으로 비KST 기기 시뮬레이션 |
| `focus/blockToday.zone.test.ts` | 표시 축만 PDT 로 치환 — 두 축이 갈린 기기 |

### 화면 레벨 하니스의 함정

⚠️ `HomeScreen.test.tsx:22-25` — **navigation 객체는 모듈 스코프에 한 번만** 만든다.
렌더마다 새 객체를 돌려주면 `checkGoalCelebration` 이 매번 새로 생겨 포커스 이펙트가 다시
돌고, 그 안의 `setReportRefresh` 가 또 렌더를 부른다 → **무한 루프**.

이 함정 때문에라도, 축 로직은 화면에 인라인하지 말고 **부를 수 있는 단위로 뽑는다**
(`focus/format.ts` · `focus/goalCelebrationVerdict.ts` 선례).
익명 async IIFE effect 는 진입점이 없어 회귀 그물을 칠 수 없다.

---

## 6. 알려진 갭 / 후속 후보

| # | 내용 |
| --- | --- |
| G1 | **`todayStrKst()` 함대의 `serverZone` 이전** — 모든 `*Api.ts` 의 `date` 기본값 + 통계 그리드 앵커(`kstTodayDate`). §2 판정상 옳은 방향이지만 대형 변경이라 GROMO-1254 범위 밖. `serverZone` 이 가변 모듈 전역이라 **기본 인자 평가 시점**(프로필 수신 전/후) 계약을 함께 정해야 한다 |
| G2 | `screentimeSync` 의 `reportedAt = localNoonInstant(어제)` — 로컬 정오는 오프셋 −11~+12 에서만 같은 날짜다. 서버 존 차이가 12h 를 넘으면 보고가 인접 버킷에 앉는다. GROMO-1254 는 그 사실을 **인정하고**(`serverBucketDateOf` 가 같은 instant 를 서버 존으로 잘라 연속 달성일 앵커를 맞춘다) 보고 instant 자체는 건드리지 않았다 |
| G3 | `screentimeSync` 스크린타임 축하의 **판정 축(로컬)과 표시 데이터 축(서버)** 이 구조적으로 다르다 — 로컬로 마감한 어제가 서버에서는 다른 셀에 앉을 수 있다. 서버가 클라 판정(`achieved`)을 신뢰하는 현 프로토콜에서는 값이 어긋나지 않지만, 서버가 자체 판정으로 바뀌면 재검토가 필요하다 |
