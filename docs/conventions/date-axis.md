# 날짜 축(date axis) 규약

앱이 "오늘"이라고 부르는 날짜에는 **축이 세 개** 있다. 어떤 값을 어느 축에서 뽑느냐를
틀리면 **비KST 기기**에서 하루씩 어긋난 화면이 나온다 — 오늘 칸을 비켜 찍힌 마커,
빈 캘린더, 두 번 뜨는 축하 모달, 매번 1일로 리셋되는 연속 달성일.

이 문서가 **앱 쪽 정본**이다. 종전엔 `app/app-dev/src/utils/localDate.ts` 주석 하나가 정본 노릇을 했고
분류표는 PR #531 본문에만 있어 저장소 어디에도 없었다(GROMO-1236 → GROMO-1254).
날짜 축은 stats·focus·group·league·screentime 을 가로지르므로 `docs/prd/<기능>/` 에 담을 수
없다 — `docs/README.md` 의 "기능 문서가 아닌 팀 전체 규약은 `docs/conventions/`" 규정을 따른다.

> **서버 축 자체의 정본은 백엔드 `server/data-api/src/main/java/com/oneorthree/phone/common/util/ZonePolicy.java`
> 다**(§2). 앱 문서·주석과 어긋나면 그쪽이 맞다.

관련 티켓: GROMO-1219(내기·챌린지 KST) → GROMO-1236(앱 전수 1차 이전) →
GROMO-1252(서버 존 문자열 도입) → **GROMO-1259(서버 저장축까지 KST 고정·리졸버 제거)** →
**GROMO-1254(앱 전수 감사·정본화)**.

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

## 2. "서버 축"이란 무엇인가 — **KST 고정이다**

> **서버의 판정·저장·조회 날짜 버킷은 전부 KST(`Asia/Seoul`) 고정이다.**
> 정본은 백엔드 `common/util/ZonePolicy.java` 의 `ZonePolicy.KST` 한 상수다.

```java
/** 모든 날짜 버킷·판정의 단일 기준 존. */
public static final ZoneId KST = ZoneId.of("Asia/Seoul");
```

`GROMO-1259` 가 이렇게 통일했다. 종전엔 통계 **저장** 일자만 유저 `country_code` 파생 존
(`CountryZoneResolver`, GROMO-561)으로 갈렸는데, 챌린지 판정·카드·정산은 처음부터 KST 고정이라
저장축이 갈리면 판정 경로와 저장 버킷이 어긋났다(챌린지 정책 B3 — 구 D6 갭.
**JP 가 UTC+9 라 우연히 무해해 드러나지 않았다**). 그래서 저장축까지 KST 로 통일하고
**리졸버를 제거했다.** 지금 `server/data-api/` 에 `CountryZoneResolver` 클래스는 존재하지 않는다.

수용된 한계 **L5**: **기기의 그날 UTC 오프셋이 `+09:00` 이 아니면** "내 하루"와 앱의 하루가
어긋난다 — 한국 타깃 서비스라 수용 (`docs/prd/challenge/prd.md` L5 · `policy.md` B3).

> ⚠️ **「해외 유저」가 아니라 「오프셋이 다른 기기」다.** 바로 위 문단이 *"JP 가 UTC+9 라 우연히
> 무해"* 라고 적어 놓고 이 줄은 지역으로 일반화하고 있었다(GROMO-1497 codex 리뷰가 잡았다).
> `Asia/Tokyo` 사용자는 해외지만 하루 경계가 KST 와 **일치해 대상이 아니고**, 국내 사용자라도
> **기기 타임존을 바꾸면 대상이 된다.** DST 를 쓰는 존은 같은 존에서도 **날짜에 따라 갈린다** —
> 이 문서가 아래에서 오프셋 범위를 다룰 때와 같은 축이다.

### 판정 (GROMO-1254)

> **`todayStrKst()` 계열이 서버 축의 정확한 표현이다.**
> **`utils/serverZone.ts` 계열은 1259 이전 세계관의 잔재다.**

| 표현 | 유틸 | 위상 |
| --- | --- | --- |
| **KST 고정** | `todayStrKst()` · `tomorrowStrKst()` · `yesterdayStrKst()` · `kstDateStr()` · `kstTodayDate()` · `kstLocalSameDay()` | ✅ **정확** — 서버 `ZonePolicy.KST` 와 정의상 같다 |
| 서버가 내려준 존 | `serverTodayStr()` · `serverZoneAlignedWithLocal()` (`utils/serverZone.ts`) | ⚠️ **잔재** — 아래 참고 |

`GET /users/me → timeZone` 은 **GROMO-1259 부터 항상 `ZonePolicy.KST.getId()`**, 즉 상수
`"Asia/Seoul"` 을 돌려준다(`UserProfileResponse` javadoc · `UserService:311` 확인). 그러니
`serverZone` 은 *살아 있는 서버에 대해서는* 틀리지 않는다 — 상수를 한 바퀴 돌려받을 뿐이다.

**문제는 그게 캐시라는 점이다.** `getServerZone()` 이 `Asia/Seoul` 이 아닌 값을 돌려주는
경로는 하나뿐이고, 그건 전부 오염이다:

- `App.tsx:177` 이 캐시된 프로필(`gromo:user`)로 **먼저** 존을 세운다
- 그 캐시가 **1259 배포 이전**에 저장됐으면 `Europe/London` 같은 값이 들어 있다
- 콜드 스타트의 `getMyProfile()` 이 실패(오프라인)하면 그 과거 값이 **세션 내내 유지된다**

즉 `serverZone` 은 이제 **정확도를 더해 주지 않고, 낡은 캐시라는 오염 경로만 남긴다.**
GROMO-1254 의 스크린타임 연속 달성일 수정 초안이 실제로 여기 걸렸다 — 앵커를
`getServerZone()` 으로 잘랐더니 낡은 캐시에서 커서가 엉뚱한 셀에 앉아,
고치려던 "스트릭이 1일로 끊김"이 **다른 원인으로 재현**됐다(codex pre-PR 게이트 P2).

### 그래서 지금 무엇을 쓰는가

- **서버 결합 지점은 KST 계열(`todayStrKst()` · `kstDateStr()` · `kstTodayDate()`)을 쓴다.**
  새 지점도, 고치는 지점도 마찬가지다.
- **`getServerZone()` 을 새로 끌어다 쓰지 않는다.** 서버가 상수를 내려주므로 얻는 것이 없고,
  낡은 캐시 오염만 받는다.
- **절대 하지 말 것: 한 체인 안에서 두 표현을 섞는 것.** 같은 체인의 발행·조회·비교가
  `todayStrKst()` 와 `serverTodayStr()` 로 갈리면 **세 번째 축**이 생긴다.

### ⚠️ 이 문서가 틀렸던 기록 — 둘 다 "그럴듯해서 검산 없이 통과한" 유형이다

1. **전제를 확인하지 않았다.** GROMO-1254 초안은 *"`serverZone` 이 서버 축의 정의이고
   `todayStrKst` 는 근사치"* 라고 판정했는데, 근거로 삼은 `CountryZoneResolver` 는 **1259 에서
   이미 삭제된 클래스**였다. 1252(serverZone 도입)보다 **1259 가 나중**이다. 앱 주석
   (`serverZone.ts:4`)이 그 클래스를 아직 정본처럼 서술하고 있었고, 서버를 열어 보지 않았다.
   → **축 판정의 정본은 `server/data-api/.../ZonePolicy.java` 다. 앱 주석은 정본이 아니다.**
2. **산수를 하지 않았다.** §6 G2 의 "로컬 정오가 KST 와 같은 날인 범위"를 `−11~+12` 로 적었는데,
   실제 조건은 `X > −3` 이라 **양끝이 다 반대**였다 — 서쪽(미주)을 통째로 안전하다고 했고,
   실제로 안전한 `+13/+14` 를 예외로 들었다. 한 줄만 계산해 보면 드러나는 오류였다.
   → **날짜 축 문서는 계산이 근거다. 계산을 안 하고 쓰면 정본이 오히려 위험해진다** —
   범위·경계를 적을 때는 반드시 양끝을 검산해 예시로 남긴다(G2 처럼).

두 건 모두 **런타임 동작이 아니라 서술**에서 났고, 테스트로는 잡히지 않았다. 이 문서를 고칠 때는
근거(서버 상수·계산)를 함께 인용하고, 리뷰어가 재검산할 수 있게 검산 예시를 붙인다.

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
| `todayStrKst()` · `tomorrowStrKst()` · `yesterdayStrKst()` · `kstDateStr(date)` | KST | **서버 축**(§2) |
| `kstLocalSameDay()` | — | 기기가 지금 UTC+9 인가 — 로컬 누적을 서버 KST 집계와 합쳐도 되는지의 게이트 |

### `app/src/utils/serverZone.ts` (GROMO-1252) — ⚠️ 1259 이전 잔재

서버가 `timeZone` 으로 **상수 `Asia/Seoul`** 만 내려주므로(§2) 이 계열은 더 이상 정확도를
더하지 않는다. **새 코드에서 쓰지 않는다.** 기존 소비처 3곳의 위상은 §6 G1 참고.

| 함수 | 용도 |
| --- | --- |
| `setServerZone(zone)` / `resetServerZone()` / `getServerZone()` | 프로필 응답·**캐시**에서 받은 존 보관. 로그아웃·계정 전환 시 폴백(`Asia/Seoul`)으로 리셋 |
| `serverTodayStr()` | 보관된 존 기준 오늘 |
| `serverZoneAlignedWithLocal()` | 보관된 존의 하루 경계와 로컬 하루 경계가 지금 겹치는가 |

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
| `focus/useSessionGroups.ts` `myFocus.day` | `todayStrKst()` | KST | 내 행 스냅샷의 기준일 — 자정 넘겨 낡으면 소비처가 폐기(GROMO-1246) |
| `focus/blockToday.ts` `blockKstTodaySeconds` | `todayStrKst()` | KST | 라이브 그리드 내 타일의 **진행 델타** — 서버 스냅샷과 같은 축이어야 얹을 수 있다(GROMO-1246) |
| `focus/FocusSessionScreen.tsx` 그리드 셀 결합 | `todayStrKst()` + `kstLocalSameDay()` | KST | 내 타일 = `max(서버+델타, 정산기준점+델타, 동축이면 로컬)`. 멤버 타일과 원천·축을 맞춘다(GROMO-1246) |
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
| **`services/screentimeSync.ts` 연속 달성일 커서·조회 창** | **`kstBucketDateOf()`** | **KST** | **GROMO-1254 수정.** 서버 heatmap 셀을 뒤로 세는 계산인데 로컬 측정일에서 후진했다 |
| `focus/focusRestore.ts:64-65` | `serverTodayStr()` + `serverZoneAlignedWithLocal()` | serverZone ⚠️ | 서버 `focusSecondsByDate` 인덱싱 (GROMO-1252). **1259 이후 사실상 KST** — §6 G1 |
| `focus/sessionSaveVerdict.ts:29` | `serverTodayStr()` | serverZone ⚠️ | 서버가 귀속시킨 날짜와 비교. 〃 |
| `focus/blockToday.ts:65` | `zoneDateStr(ms, getServerZone())` | serverZone ⚠️ | 서버 키 맵. 〃 |

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
| `services/screentimeSync.ts:137` `localNoonInstant` | 로컬 정오 | 로컬 측정일을 KST 저장 축으로 잇는 보고 instant. 자정 경계 오귀속을 막지만 **`UTC−3` 이하는 하루 밀린다**(§6 G2) |
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
| **G1** | **`utils/serverZone.ts` 소비처 3곳을 KST 로 되돌리기** — `focusRestore.todayRestoreSeconds` · `sessionSaveVerdict.isTodayVerdict` · `blockToday`(서버 키 맵). §2 판정상 `serverZone` 은 상수를 돌려받는 우회로일 뿐이고 **낡은 캐시 오염 경로**만 추가한다. 되돌리면 `serverTodayStr()`→`todayStrKst()`, `serverZoneAlignedWithLocal()`→`kstLocalSameDay()`, `zoneDateStr(ms, getServerZone())`→`kstDateStr(ms)` 이고 `serverZone.ts` 와 `App.tsx`·`auth.ts`·`userApi.ts` 의 배선까지 제거 가능하다. **이 티켓 범위 밖 — 판정만 기록한다.** ⚠️ 되돌리기 전에 확인할 것: 서버 `UserProfileResponse.timeZone` 이 계속 상수인가(향후 유저별 존이 부활하면 이 판정이 다시 뒤집힌다), 그리고 `blockToday` 의 local/server 이중 맵이 두 축을 모두 필요로 하는지<br>**갱신(GROMO-1246)**: `blockToday` 는 이제 **삼중 맵**(`local`·`server`·`kst`)이다. 그리드 표시 델타가 서버 스냅샷과 같은 축이어야 해서 `kst` 를 추가했다 — `server` 맵을 KST 키로 읽는 방식은 낡은 캐시가 비KST 일 때 조회가 계속 0 이 되어 세션 중 타일이 멈춘다. **G1 을 실행하면 `server` 와 `kst` 가 같은 값이 되므로 두 맵을 하나로 합칠 수 있다** — G1 의 이득에 이 정리를 더해서 계산할 것 |
| ~~G1(폐기)~~ | ~~`todayStrKst()` 함대의 `serverZone` 이전~~ — GROMO-1254 초안의 판정이었으나 **전제가 틀렸다**(`CountryZoneResolver` 는 1259 에서 삭제됨). 방향이 정반대다 → 위 G1 |
| **G2** | **`screentimeSync` 의 `reportedAt = localNoonInstant(대상일)` 이 미주 전역에서 하루 밀린다.** 오프셋 `X` 의 로컬 정오는 KST 로 `21 − X` 시라, 같은 날짜 조건은 `0 ≤ 21 − X < 24` → **`X > UTC−3`**. 검산: UTC+14 → KST 같은 날 07:00 ✅ · UTC−2 → 같은 날 23:00 ✅ · **UTC−3 → 다음 날 00:00 ❌** · **UTC−8(LA) → 다음 날 05:00 ❌**. 즉 **UTC−3 이하(미주 대부분·Newfoundland −3:30 포함)** 는 로컬 측정일 `D` 의 보고가 KST `D+1` 버킷에 앉는다.<br>**오프셋이 고정인 동안은 시프트지 손상이 아니다** — 쓰기 경로 3곳(`:431` 어제 마감 · `:515` 마이그레이션 · `:532` 오늘 중간)이 전부 같은 `localNoonInstant` 를 쓰므로 시프트가 균일하고, 시리즈 전체가 KST 축에서 하루씩 밀릴 뿐이다. `kstBucketDateOf` 는 **같은 시프트를 그대로 재현**하므로 연속 달성일 앵커도 그 조건에서는 맞는다.<br>⚠️ **그러나 오프셋이 바뀌는 날에는 버킷 키가 단사(injective)가 아니다 — 하루가 사라진다.** DST 전환·여행으로 이웃한 두 날의 오프셋이 `UTC−3` 경계를 사이에 두면 **두 로컬 날짜가 같은 KST 버킷으로 접힌다**. 예: `America/St_Johns` — 2026-03-07 정오(UTC−3:30) → KST **03-08** 00:30, 2026-03-08 정오(UTC−2:30) → KST **03-08** 23:30. 서버는 `(user, 날짜)` upsert 라 **나중 보고가 앞 보고를 덮어쓴다**. `kstBucketDateOf` 는 같은 접힘을 재현할 뿐 **이미 덮인 셀을 되살리지 못한다** — 그 지점에서 스트릭이 끊기는 것은 조회 축 문제가 아니라 **저장이 유실된** 결과다(2026-08-12 codex 리뷰, PR #638). 고치려면 `reportedAt` 이 로컬 날짜를 잃지 않아야 한다(예: 날짜를 별도 필드로 전송) — 정오 instant 하나로는 원리적으로 불가능하다.<br>**우선순위**: 영향 범위가 "오프셋 12h 초과"에서 **미주 전역**으로 넓어졌으나, 성격은 이미 수용된 한계 **L5**("기기의 그날 UTC 오프셋이 +09:00 이 아니면 내 하루와 앱의 하루가 어긋난다")의 앱 쪽 그림자다. 한국 타깃 서비스인 한 **수용이 타당**하고, 해외 확장 시 L5 재검토와 **함께** 다뤄야 할 항목이다(단독 수정은 서버 KST 고정과 어긋나 오히려 위험). `reportedAt` 은 계약상 미접촉 |
| G3 | `screentimeSync` 스크린타임 축하의 **판정 축(로컬)과 표시 데이터 축(KST)** 이 구조적으로 다르다 — 로컬로 마감한 어제가 서버에서는 다른 셀에 앉을 수 있다(L5 의 앱 쪽 그림자). 서버가 클라 판정(`achieved`)을 신뢰하는 현 프로토콜에서는 값이 어긋나지 않지만, 서버가 자체 판정으로 바뀌면 재검토가 필요하다 |
