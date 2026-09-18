# 날짜 축(date axis) 규약

> ⚠️ **2026-09-18 재영님 결정(D8)으로 UTC 전환 예정** — 모든 시간 UTC · 하루 리셋 UTC 00:00 · 글로벌 출시 전제.
> §2 의 「서버 축 = KST 고정」과 정면 충돌하므로 영향 조사를 마쳤고(≈272 파일 — 요약은 [Fishcat 결정 로그](../prd/fishcat/decision-log.md) D8) 전환 계획을 **§7 에 세웠다(GROMO-1930)**.
> **실제 컷오버 전까지 현재 KST 가 authoritative 하다 — 이 문서의 KST 규약이 현행이며 코드·마이그레이션을 지금 고치지 않는다.**

앱이 "오늘"이라고 부르는 날짜에는 **축이 세 개** 있다. 어떤 값을 어느 축에서 뽑느냐를
틀리면 **비KST 기기**에서 하루씩 어긋난 화면이 나온다 — 오늘 칸을 비켜 찍힌 마커,
빈 캘린더, 두 번 뜨는 축하 모달, 매번 1일로 리셋되는 연속 달성일.

이 문서가 **앱 쪽 정본**이다. 종전엔 `app/legacy/app-dev/src/utils/localDate.ts` 주석 하나가 정본 노릇을 했고
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
어긋난다 — 한국 타깃 서비스라 수용 (`docs/prd/gromo/challenge/prd.md` L5 · `policy.md` B3).

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

### `app/legacy/app-dev/src/utils/localDate.ts`

| 함수 | 축 | 용도 |
| --- | --- | --- |
| `localDateStr(date)` | 로컬 | `Date → 'YYYY-MM-DD'`. **로컬 축의 단일 주입점.** ⚠️ 아래 "달력 포매팅" 참고 |
| `todayStr()` · `tomorrowStr()` · `yesterdayStr()` | 로컬 | 로컬 오늘/내일/어제 |
| `todayOverlapSeconds(startISO, endISO)` | 로컬 | 자정 걸친 세션의 '오늘 몫' 초 |
| `zoneDateStr(date, tz)` | 임의 존 | `Date → 지정 IANA 존의 'YYYY-MM-DD'`. 존 미지원·Intl 오류면 로컬 폴백 |
| `zoneSameWallClock(tz, date?)` | — | 그 존과 기기 로컬의 **자정 경계가 겹치는가** (날짜 라벨이 아니라 '날짜+시:분' 비교) |
| `todayStrKst()` · `tomorrowStrKst()` · `yesterdayStrKst()` · `kstDateStr(date)` | KST | **서버 축**(§2) |
| `kstLocalSameDay()` | — | 기기가 지금 UTC+9 인가 — 로컬 누적을 서버 KST 집계와 합쳐도 되는지의 게이트 |

### `app/legacy/app-dev/src/utils/serverZone.ts` (GROMO-1252) — ⚠️ 1259 이전 잔재

서버가 `timeZone` 으로 **상수 `Asia/Seoul`** 만 내려주므로(§2) 이 계열은 더 이상 정확도를
더하지 않는다. **새 코드에서 쓰지 않는다.** 기존 소비처 3곳의 위상은 §6 G1 참고.

| 함수 | 용도 |
| --- | --- |
| `setServerZone(zone)` / `resetServerZone()` / `getServerZone()` | 프로필 응답·**캐시**에서 받은 존 보관. 로그아웃·계정 전환 시 폴백(`Asia/Seoul`)으로 리셋 |
| `serverTodayStr()` | 보관된 존 기준 오늘 |
| `serverZoneAlignedWithLocal()` | 보관된 존의 하루 경계와 로컬 하루 경계가 지금 겹치는가 |

### `app/legacy/app-dev/src/screens/stats/format.ts` (통계 그리드 앵커)

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

`app/legacy/app-dev/src/legacy/**`(동결)·`app/legacy/app-dev/src/mocks/fixtures/**` 는 제외.

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
| `services/screentimeSync.ts:237,337-338` | `todayStr()` / `yesterdayStr()` | 측정 시작일 앵커·마감 대상일 — 익스텐션이 로컬 하루로 버킷을 자른다 |
| `services/screentimeSync.ts:162` `localNoonInstant` | 로컬 정오 | 로컬 측정일을 KST 저장 축으로 잇는 보고 instant. 자정 경계 오귀속을 막지만 **`UTC−3` 이하는 하루 밀린다**(§6 G2) |
| `services/screentimeSync.ts:257,263,637,776` | `localDateStr` | 네이티브 dayKey 축 — **`todayStr`/`yesterdayStr` 금지**(주입점을 `localDateStr` 하나로) |
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
| **G2** | **`screentimeSync` 의 `reportedAt = localNoonInstant(대상일)` 이 미주 전역에서 하루 밀린다.** 오프셋 `X` 의 로컬 정오는 KST 로 `21 − X` 시라, 같은 날짜 조건은 `0 ≤ 21 − X < 24` → **`X > UTC−3`**. 검산: UTC+14 → KST 같은 날 07:00 ✅ · UTC−2 → 같은 날 23:00 ✅ · **UTC−3 → 다음 날 00:00 ❌** · **UTC−8(LA) → 다음 날 05:00 ❌**. 즉 **UTC−3 이하(미주 대부분·Newfoundland −3:30 포함)** 는 로컬 측정일 `D` 의 보고가 KST `D+1` 버킷에 앉는다.<br>**오프셋이 고정인 동안은 시프트지 손상이 아니다** — 쓰기 경로 3곳(`:450` 어제 마감 · `:549` 마이그레이션 · `:577` 오늘 중간)이 전부 같은 `localNoonInstant` 를 쓰므로 시프트가 균일하고, 시리즈 전체가 KST 축에서 하루씩 밀릴 뿐이다. `kstBucketDateOf` 는 **같은 시프트를 그대로 재현**하므로 연속 달성일 앵커도 그 조건에서는 맞는다.<br>⚠️ **그러나 오프셋이 바뀌는 날에는 버킷 키가 단사(injective)가 아니다 — 하루가 사라진다.** DST 전환·여행으로 이웃한 두 날의 오프셋이 `UTC−3` 경계를 사이에 두면 **두 로컬 날짜가 같은 KST 버킷으로 접힌다**. 예: `America/St_Johns` — 2026-03-07 정오(UTC−3:30) → KST **03-08** 00:30, 2026-03-08 정오(UTC−2:30) → KST **03-08** 23:30. 서버는 `(user, 날짜)` upsert 라 **나중 보고가 앞 보고를 덮어쓴다**. `kstBucketDateOf` 는 같은 접힘을 재현할 뿐 **이미 덮인 셀을 되살리지 못한다** — 그 지점에서 스트릭이 끊기는 것은 조회 축 문제가 아니라 **저장이 유실된** 결과다(2026-08-12 codex 리뷰, PR #638). 고치려면 `reportedAt` 이 로컬 날짜를 잃지 않아야 한다(예: 날짜를 별도 필드로 전송) — 정오 instant 하나로는 원리적으로 불가능하다.<br>**우선순위**: 영향 범위가 "오프셋 12h 초과"에서 **미주 전역**으로 넓어졌으나, 성격은 이미 수용된 한계 **L5**("기기의 그날 UTC 오프셋이 +09:00 이 아니면 내 하루와 앱의 하루가 어긋난다")의 앱 쪽 그림자다. 한국 타깃 서비스인 한 **수용이 타당**하고, 해외 확장 시 L5 재검토와 **함께** 다뤄야 할 항목이다(단독 수정은 서버 KST 고정과 어긋나 오히려 위험). `reportedAt` 은 계약상 미접촉 |
| G3 | `screentimeSync` 스크린타임 축하의 **판정 축(로컬)과 표시 데이터 축(KST)** 이 구조적으로 다르다 — 로컬로 마감한 어제가 서버에서는 다른 셀에 앉을 수 있다(L5 의 앱 쪽 그림자). 서버가 클라 판정(`achieved`)을 신뢰하는 현 프로토콜에서는 값이 어긋나지 않지만, 서버가 자체 판정으로 바뀌면 재검토가 필요하다 |

---

## 7. UTC 전환 계획 (GROMO-1930)

> ⚠️ **이 절은 계획이다 — 코드·마이그레이션을 지금 바꾸지 않는다.**
> 실제 컷오버(§7.7 Phase 2) 전까지 **현재 KST 가 authoritative** 하고 §2 규약이 현행이다.
> 이 절의 수치는 2026-09-18 에 재측정했다 — 티켓 인용치(호출자 7 · 자체 리터럴 24 · 크론 24 · 앱 리터럴 3곳)와
> 실측이 다르다. 호출부는 실제 코드 호출 기준 티켓과 같은 7파일이며, `ZonePolicy.KST` 를 javadoc 에서만
> 언급하는 2파일까지 합한 언급 파일이 9개다(7→9 로 늘어난 게 아니라 집계 기준 차이 — §7.1). 그 외 실측은
> 자체 리터럴 21클래스+정본 · 크론 25 · 앱 `+09:00` 4곳+자체 KST 상수 6곳+`'Asia/Seoul'` 인라인 잔여+앱 2.0
> `kstClock` 자체 오프셋 1곳(§7.1 표)다.

### 7.1 KST 침투 인벤토리 — 상수 하나로 안 바뀌는 지점들

축은 `ZonePolicy.KST` 한 군데가 아니라 **네 층**에 흩어져 있다. 전부 같은 날 바꿔야
"반쪽 이전"(§1 명제 2)이 안 생긴다.

**서버 (`server/data-api`)**

| 층 | 위치 | 수 |
| --- | --- | --- |
| 정본 상수 | `common/util/ZonePolicy.java:20` — `ZonePolicy.KST` | 1 |
| `ZonePolicy.KST` 코드 호출부 | `bot/service/BotSimulator` · `focus/service/FocusService` · `internal/service/FocusSessionLifecycleService` · `league/repository/LeagueRankingQueryRepository` · `screentime/service/ScreenTimeService` · `stats/service/StatsService` · `user/service/UserService` | 7 파일 |
| `ZonePolicy.KST` javadoc 언급(코드 호출 없음) | `config/ClockConfig.java:15` · `user/dto/UserProfileResponse.java:9` | 2 파일 |
| 자체 `ZoneId.of("Asia/Seoul")` 리터럴 | `group/` 8 — GroupBetScheduler:47 · GroupBetSessionFactory:42 · GroupBetFreezeMonitor:34 · WindowFocusAggregator:47 · GroupBetWindowUsageService:89 · GroupChallengeService:93 · GroupBetService:121 · GroupBetSettlementService:41<br>`notification/` 12 — SlotGranularity:49 · Expiry:15 · EndPushDispatcher:62 · SessionOpen:96 · WindowEnd:57 · LeagueReengagement:53 · RankOvertake:48 · DurationEnd:55 · Push:36 · InactiveReturn:56 · ExportService:734 · internal/RetentionEligibility:26<br>`league/` 1 — LeagueWeek:24 | 21 클래스 |
| `@Scheduled(zone="Asia/Seoul")` 크론 | NotificationScheduler 17개 · GroupBetScheduler 3개 · LeagueScheduler:25 · FocusPresenceReconciler:199 · FocusSessionOrphanScheduler:34 · IslandConstructionScheduler:36 · BotScheduler:35 | 25 개 / 7 파일 |
| Hibernate 존 | `application-prod.yml:16` — `hibernate.jdbc.time_zone: Asia/Seoul` (dev·staging 은 미설정 — 컷오버 때 프로파일 정렬 필요) | 1 |
| 계약 검증 | `internal/service/FocusSessionLifecycleService.java:643` — `validateTimezone` 이 `"Asia/Seoul"` 만 허용 (§7.5) | 1 |

realtime 은 `Asia/Seoul` 참조가 없다. business-api 도 main 코드에는 없다 — `FocusSessionController.java:119`
javadoc 예시 문자열 1건뿐이고, 테스트 `FocusSessionContractTest.java:106,109,124-126` 의 `"Asia/Seoul"` 은
프록시 통과 검증용 값(쿼리가 상류에 그대로 전달되는지·중복 파라미터가 400 인지 확인)이라 전환 영향이 없다.

**앱 2.0 (`app/app-dev`)**

> **집계 기준** — 이 표는 파일 안의 **전수 라인 열거가 아니라 「파일 × 전환 단위」 대표 인용**이다.
> 같은 헬퍼의 반복 호출은 용도별로 묶어 대표 위치만 적고, 코드 침투가 없이 문자열·주석만 남은
> 파일은 「주석만」행에 모은다. 컷오버 작업 시의 전수 기준은 이 표가 아니라
> `dayKey\|kst\|Asia/Seoul\|3600000` 재검색이다(라인 번호는 측정일 기준 — drift 가능).

| 위치 | 내용 |
| --- | --- |
| `services/model.ts:326-327` | `KST_OFFSET_MS` + `kstDate` — 소비처 `:328`(dayKey) · `:334`(kstMonthDay — "M/D") · `:338`(kstHourMinute — "HH:MM") · `:343`(kstDayStart) · `:705`(weekStart — **일요일** 00:00 앵커) · `:854`·`:864`·`:868`(periodBounds) |
| `screens/island/Screens.tsx:44-47,116-117,1835` | model.ts KST 계열 실사용 — `dayKey`+`kstDayStart`(:1835 오늘 경계 합산) · `kstMonthDay`/`kstHourMinute` 를 `md`/`hm` 으로 바인딩해 기록·공지·구매내역 시각 표시(`:2310,:2328,:2970,:3323,:3334,:3973-3976`) |
| `screens/island/Hall.tsx` | `dayKey`(:25 import) 실사용 — 가계부 월 필터 `:146,:153` · 내역 날짜 라벨 `:548` |
| `screens/island/Library.tsx` | `dayKey`·`kstDayStart`·`periodBounds`(:9,:11,:12 import) 실사용 — `md` 헬퍼 `:20` · 기간 경계 `:236` · 스크린타임 일 경계 `:245,:272` · 라벨 `:251,:256` |
| `screens/island/WorldMap.tsx` | `dayKey`·`kstDayStart`(:25,:26 import) 실사용 — 오늘 집계 창 `:550` |
| `screens/island/CurrentScreens.tsx:18-19,89,536` | `dayKey`(:18 import) 실사용 — 결과창 퀘스트 회차 키 `:536` · `toLocaleDateString` 의 `timeZone: 'Asia/Seoul'` 리터럴 `:89` |
| `screens/interiors/BuildingInteriors.tsx:35,38` | model.ts KST 계열 실사용 — `dayKey`·`kstDayStart` import → 공지 작성일 `:3655,:3658`(:3652 주석의 「Asia/Seoul」은 이 코드를 가리킴) · 퀘스트 라운드 키 `:3705` · 이펙트 deps `:3789` · 편지 시각 `:6207,:6210` · 채팅 시각 `:6220` |
| `screens/interiors/BuildingInteriors.tsx:6201-6203` | **`kstClock` — model.ts 를 안 거치는 자체 인라인 KST 오프셋**: `new Date(at + 9 * 3600000)`(:6202) + `getUTCHours`/`getUTCMinutes`. 헬퍼 교체와 별도로 고쳐야 하는 독립 전환 지점 |
| `services/model.test.ts:1134,1153` | KST 동작을 단언하는 테스트 — 전환 시 함께 갱신 |
| 주석만 | `screens/island/Screens.tsx:115,1834` |
| `jest.config.js:2` | `process.env.TZ = 'Asia/Seoul'` — 러너 고정(§5 층1) |

**앱 1.x (`app/legacy/app-dev`, 동결)**

| 위치 | 내용 |
| --- | --- |
| `utils/localDate.ts` | KST 유틸 계열 전체(`todayStrKst` 등) — §3 카탈로그. 동결 앱이라 전환 시 **미수정 잔류** |
| `+09:00` 리터럴 4곳 | `screens/stats/WeeklyTimetableCard.tsx:128` · `screens/stats/charts.tsx:309` · `screens/stats/LongestSessionStat.tsx:45` · `services/screentimeSync.ts:669` |
| 자체 KST 상수 6곳 | `KST_ZONE` — `screens/group/components/ChallengeCard.tsx:115` · `KST` — `screens/focus/blockToday.ts:36` · `KST_OFFSET_MS` — `screens/league/useLeagueRanking.ts:56` · `screens/group/groupFocusStatus.ts:167` · `screens/group/challengeSchedule.ts:40` · `screens/group/components/ChallengeComposeSheet.tsx:281` |
| `'Asia/Seoul'` 인라인 리터럴·잔여 | `screens/group/components/BetSheet.tsx:203,263` · `screens/group/components/ChallengeComposeSheet.tsx:386`(이상 `nowSecondsInZone`) · `screens/stats/format.ts:358`(`Intl` `timeZone`) · `utils/serverZone.ts:15` `FALLBACK_ZONE`(프로필 존 폴백 — §6 G1) · 테스트 픽스처 `mocks/fixtures/session.ts:17,31` |
| `services/screentimeSync.ts:162` | `localNoonInstant` — 서버 환산과 쌍 (§7.6) |
| `jest.config.js:3` | `process.env.TZ = 'Asia/Seoul'` |

### 7.2 컬럼별 처리표 — 무엇을 재계산하고 무엇을 봉인하는가

| 컬럼 | 원본 instant 컬럼 유무 | 재계산 가능 | 처리 |
| --- | --- | --- | --- |
| `daily_focus_stats.date` | ✅ `focus_sessions.started_at`·`ended_at`(+ jsonb 분포) | 가능 | UTC 재버킷 — 행 UPDATE 가 아니라 세션 원본에서 통째 재생성 권장. 전환일 행은 양축 혼재 가능 |
| `focus_sessions.focus_seconds_by_date` (jsonb 키) | ✅ `started_at`·`ended_at` | 가능 | UTC 재분배. 조회측 벽시계 클리핑 폴백(schema.dbml:631)이 있어 미재계산 행도 읽기는 유지 |
| `user_streaks.last_session_date` | ✅ 세션 원본 경유 | 가능 | 날짜만 바꾸면 연속 판정이 어긋난다 — 재계산 후 `UserStreakService` 로직으로 streakCount·longest 재산정 |
| `daily_screen_time_stats.date` | ❌ 원본 instant 없음 (`V38__screen_time_nullable_kst.sql:13-16` — 일 집계만 남아 재버킷 불가) | 불가 | **전환일 이전 행은 KST 버킷으로 그대로 둔다** — forward-only |
| `group_challenge_members.usage_date` | ❌ (date 라벨만, KST) | 불가 | **전환일 이전 행은 KST 버킷으로 그대로 둔다** |
| `league_rank_snapshots.created_at` | ❌ (date 타입 — 「스냅샷 KST 날짜」 라벨) | 불가 | **전환일 이전 행은 KST 버킷으로 그대로 둔다** — 어제↔오늘 비교 키라 전환 직후 1회 비교 어긋남 수용 |
| `user_focus_time_settings.goal_effective_from` | ❌ | 불가 | **전환일 이전 행은 KST 버킷으로 그대로 둔다** — previous 유효창이 발효일±1일이라 경계 하루 오판정 가능 |
| `user_screen_time_settings.goal_effective_from` | ❌ | 불가 | **전환일 이전 행은 KST 버킷으로 그대로 둔다** — 〃 |
| `league_weekly_results.week_start_at` | instant 는 있으나 **유니크 키·정산 라벨** | 불가(재생성 = 이중 정산) | **전환일 이전 행은 KST 버킷으로 그대로 둔다** — 신구 인계는 §7.3 절차로만 |
| `league_arenas.started_at` | 〃 (주차 anchor 유니크) | 불가 | **전환일 이전 행은 KST 버킷으로 그대로 둔다** — 〃 |

「불가」는 기술적 불능이 아니라 **원본이 없어 재계산 자체가 성립하지 않는다**는 뜻이다.
이 행들은 KST 라벨로 봉인되고, 조회측이 전환일을 기준으로 해석 축을 나누는 비용은 §7.7 에서 다룬다.

「가능」행의 재버킷·재분배·스트릭 재산정은 **실행 시점을 §7.7 Phase 에 배치하지 않았다** —
Phase 2 컷오버는 라벨의 의미만 바꾸고 기존 행은 건드리지 않는다. 재계산은 컷오버와 독립인 후속
일괄 작업이라 **별도 결정·선택사항**이다(전환일 혼재 행까지 정리하고 싶을 때 Phase 3 이후 수행).

### 7.3 주간 리그 — 이중 정산과 누락을 둘 다 막는 순서

**현재 기구** (전부 KST): `LeagueScheduler.java:25` cron `0 0 0 * * MON` zone=Asia/Seoul →
`runWeeklyBatch` → `LeagueWeek`(LeagueWeek.java:24,31 — 월요일 00:00 **KST** instant) →
`LeagueAnchorRotator.rotate` 가 ACTIVE 아레나를 `started_at < newWeekStart` 로 전부 마감하고 신규 anchor 생성 →
`settleAll(previousWeekStart)` — 집계는 **instant 가 아니라 `daily_focus_stats.date` 라벨 BETWEEN(양끝 포함)**
(`LeagueRankingQueryRepository.java:56,135`) → 결과는 `league_weekly_results.(user_id, week_start_at)` 유니크
(schema.dbml:1064) + 보상 멱등키 `league:{weekStartAt}:{userId}` (`LeagueUserSettler.java:164`).

**위험의 정확한 형태** — 집계 대상이 instant 구간이 아니라 **날짜 라벨 집합**이라, KST 주차의 {월~일
7개 라벨}과 UTC 주차의 {Mon..Sun 7개 라벨}이 **같은 라벨 집합**이다. 첫 UTC 배치가 `previousWeekStart`
(UTC 월요일)를 정산하면 **마지막 KST 배치가 이미 정산한 같은 7개 date 행**이 `week_start_at` 이 다른
새 키(UTC 월요일 instant)로 다시 들어간다 — 유니크 키는 instant 라벨이라 이를 못 막고, 승강·
`league:` 보상이 이중 적용된다. 반대로 anchor 를 안 맞추면 `existsByStartedAt` 가드
(`LeagueBatchService.java:133`)가 KST instant 앵커를 찾지 못해 구주차 참조가 끊긴다.

**권장 절차** — 「이번 주차 anchor 가 이미 있으면 BATCH_ALREADY_RUN」계약(LeagueBatchService javadoc)으로
첫 배치를 무력화한다. 신규 코드·플래그가 필요 없다:

1. **전환 월요일 `M_utc`(UTC 월요일 00:00 = KST 월요일 09:00)를 지정**한다.
   `A_k = M_utc − 9h` = 마지막 KST 월요일 00:00(UTC 일요일 15:00).
2. **A_k 에 마지막 KST 배치가 정상 커밋됐는지 확인**한다(arena A_k 생성 + 직전 주 정산 완료).
3. **M_utc 이전에 SQL 로 UTC anchor 를 선삽입**한다 — `league_arenas` 에 `started_at = M_utc,
   status='ACTIVE'` 행을 넣고 기존 ACTIVE(anchor A_k)를 `ENDED` 로 마감한다. 이때 `ended_at` 도
   채운다(= M_utc) — `rotate` 가 `arena.end(now)` 로 status 와 `ended_at` 을 함께 쓰므로
   (`LeagueAnchorRotator.java:43` → `LeagueArena.java:68-74`) 둘 다 맞춰야 런타임과 동일한 최종 상태다.
4. **M_utc 의 첫 UTC 자동 배치는 BATCH_ALREADY_RUN 으로 자동 스킵된다** — anchor 가 이미 있으면
   settleAll 에 진입하지 않으므로 이중 정산·`league:` 이중 보상이 원천 차단된다.
5. **M_utc+7d 부터 자동 배치 정상 재개** — 정산 대상이 첫 UTC 주차(전환 주)라 라벨 겹침이 없다.
   비용(홀)은 고정 9h 가 아니다. `[A_k, M_utc)` 의 instant 는 KST 빌드에서는 KST 월요일 라벨로
   떨어져 첫 UTC 주차 라벨 집합 **안**에 들고, UTC 빌드에서는 UTC 일요일 라벨로 떨어져 이미
   정산된 직전 주 라벨 집합에 속해 어느 주차에도 안 들어간다. 그래서 실제 홀은
   **[UTC 빌드 배포 시점, M_utc)** = 0~9h 이고, M_utc 이후에 배포하면 0 이다
   (이 경우의 KST 라벨 귀속 어긋남은 §7.2 의 「전환일 양축 혼재」 범주 — 1회성, 수용).
   UTC 빌드 배포는 A_k 이후 그 주 중 아무 때나 — 첫 UTC 경계는 어차피 M_utc 뿐이다.
6. **복구 경로**: `resumeWeeklyBatch` 는 `weekStartAt` 을 명시 받지만 검증이 UTC 월요일 경계만
   허용한다(:126-127 `INVALID_WEEK_START`) — KST instant 앵커는 지정할 수 없다. 유실이 나면
   UTC-aligned 주차로만 표적 복구한다.

**검증**: ① `league_arenas` 의 ACTIVE 가 정확히 1행·`started_at = M_utc` ② `league_weekly_results` 에
KST-aligned `week_start_at`(시분초가 UTC 15:00 인 일요일 instant) 신규 행 0건
③ `currency_transactions` 의 `league:%` 멱등키가 유저당 주차당 1건 ④ 라이브 랭킹(`getMyRanking`)은
arena 를 읽지 않는다 — `leagueWeek.currentWeekStartDate(now)`~`currentDate(now)` 기준
`daily_focus_stats.date BETWEEN` 조회라(`LeagueService.java:102-105`, `findByStatus` 호출부 없음)
anchor 선삽입과 무관하게 동작한다. UTC 빌드의 `[A_k, M_utc)` 창에는 「현재 주」가 직전 UTC 주로
계산돼 당일 누적(KST 월요일 라벨)이 잠시 안 잡힐 수 있으나, 빈 화면이 아니라 직전 주 집계가
보이고 M_utc 이후 정상화된다.

### 7.4 날짜 문자열 멱등키·알림 dedup — 전환 창 이중 지급/이중 발송 방지

**멱등키 3종(+1)** — 전부 날짜 **라벨**을 포함하므로 축이 바뀌면 같은 실적이 두 키로 갈린다:

| 키 | 발급 지점 | 비고 |
| --- | --- | --- |
| `focusGoal:{userId}:{statDate}` | `FocusService.java:1349` — statDate 는 KST 버킷 | 지급 창 [어제,오늘](:1338) 이라 노출은 전환일 ±1일 |
| `stGoal:{userId}:{date}` | `ScreenTimeService.java:206-207` — date = `resolveLocalDate`(KST) | 〃 (:195 창) |
| `streak:{userId}:{yyyy-mm-dd}` | **리터럴 키는 없다** — `user_streaks.last_session_date` 비교가 멱등 역할 (`UserStreakService.java:66`: `sessionDate == lastSessionDate` → 무변화) | 키 충돌은 없지만, 경계일 같은 실적이 다른 라벨로 들어오면 스트릭이 하루 중복 연장될 수 있다 — **수용**(아래) |
| `league:{weekStartAt}:{userId}` | `LeagueUserSettler.java:164` | §7.3 의 이중 정산과 같은 그림 — 주차 축 변형 |

**방지책(권장)**: `currency_transactions.idempotency_key` 유니크는 문자열 일치라 축 변환을 모른다.
컷오버 빌드에 **전환 후 48시간 한정 임시 가드**를 둔다 — `alreadyApplied`(`CurrencyLedgerService.java:147`)
가 UTC 키와 함께 KST 환산 키도 조회해 둘 중 하나라도 있으면 스킵한다. 지급 창이 지나면 제거한다.
가드를 넣지 않는 대안은 **전환일 당일 목표 보상 지급 스킵**(구현은 단순, 유저 하루 보상 유실)이다.

**스트릭 중복 연장은 수용한다** — `sessionDate == lastSessionDate` 무변화 규칙상 경계일 같은 실적이
KST·UTC 라벨로 두 번 들어오면 `+1일` 연장이 두 번 성립해 streakCount 가 하루 초과될 수 있다.
피해는 1회성 +1 에 그치고 스트릭 연장은 보상 트랜잭션을 발행하지 않아(`STREAK_BONUS` 타입은 있으나
지급 경로 없음) 이중 지급으로 번지지 않는다. 막으려면 통화 멱등키와 달리 상태 비교라
`UserStreakService` 에 별도 48h 양축 라벨 비교 가드를 새로 넣어야 해 비용 대비 이득이 없다.

**알림 dedup 버킷** — `NotificationSlotGranularity.java:42-49` 의 DAY(KST `yyyyMMdd`)·WEEK(KST 월 시작):
DAY 는 자정 경계 9h 어긋남, WEEK 은 UTC 일요일 15:00~24:00 구간에서 주 라벨이 갈린다. 같은 사건이
전환 전후 다른 버킷 라벨로 재판정되면 이중 발송된다. 방향은 DAY·WEEK 조회(`lookupBucketsOf`)를 전환 후
한정 기간(DAY ±2일, WEEK ±1주) **양쪽 축 버킷으로 확장 조회**하는 임시 처리다 — `MINUTE_WIDTH` 의
「넓게 찾고 정확히 거르기」와 같은 구조라 침투가 작다.

### 7.5 `timezone` 요청 계약 — 결정 항목

현재 계약: `docs/prd/fishcat/api-platform/policy.md:136` — 생략 시 `Asia/Seoul` 정규화, 명시는
정확히 `Asia/Seoul` 만 허용, UTC 포함 다른 값은 400 `INVALID_PARAMETER`. 코드는
`FocusSessionLifecycleService.java:643-645` `validateTimezone` 이 `ZonePolicy.KST.getId()` 와 비교해
`INVALID_SUMMARY_TIMEZONE` 을 던진다. **버킷팅은 이 값과 무관하게 항상 서버 축**이다.

**결정 항목(권장안)**: 전환 후 허용값을 `{"Asia/Seoul","UTC"}` 로 넓히고, 값은 계약 검증에만 쓰고
버킷은 UTC 고정으로 둔다 — 구앱(Asia/Seoul 명시·생략)이 깨지지 않고, 신앱은 `UTC` 를 명시할 수 있다.
`UTC` 만 허용으로 바꾸면 구앱 전부가 400 이라 **반려**. `Asia/Seoul` 만 유지하면 신앱이 명시할
방법이 없어 **반려**. 레거시 종료·롤아웃 완료 후 `Asia/Seoul` 값 폐기는 별도 결정으로 남긴다.

함께 개정할 계약 문서(decision-log D8 열거): `api-platform/policy.md` P15 · `focus-rest-session/policy.md`
날짜 입력 · `island-quests/policy.md` Q02 · `island-records/policy.md` RC-P02 ·
`island-rankings/policy.md` RK-P01(「주 = KST 월요일」→ UTC 월요일 재정의 — ticket 1777 과 연동).

### 7.6 스크린타임 정오 앵커 — 서버만 바꾸면 깨지는 지역이 통째로 바뀐다

`screentimeSync.ts:162` `localNoonInstant`(측정일의 **기기 로컬 정오** instant)와 서버
`ScreenTimeService.java:245` `resolveLocalDate`(`reportedAt.atZone(ZonePolicy.KST)`)는 **한 쌍**이다.
서버 해석 축을 UTC 로 바꾸면 같은-날 조건이 §6 G2 의 `X > −3` 에서 **`−12 < X ≤ 12`** 로 바뀐다 —
오프셋 `X` 의 로컬 정오는 UTC 로 `12 − X` 시라 같은 날 조건이 `0 ≤ 12 − X < 24` 이다.
깨지는 지역이 `X ≤ −3`(미주 대부분)에서 **`X > 12`(UTC+13/+14) 또는 `X ≤ −12`(UTC−12)**
극단 태평양으로 이동한다. 검산: UTC+12 → 같은 날 00:00 ✅ · **UTC+13 → 전날 23:00 ❌** ·
**UTC−12 → 다음 날 00:00 ❌** · UTC−11 → 같은 날 23:00 ✅.
미주가 조용히 고쳐지는 대가로 극단 태평양이 새로 깨지는, **지역 집합의 교체**다.

앱 쪽은 이 쌍에서 바꿀 게 없다 — `localNoonInstant` 는 로컬 정오를 계속 보낸다. 바뀌는 건 서버
해석 축뿐이라 **배포 동시성 문제가 아니라 의미 변화**다. 근본 해법(측정일을 instant 가 아니라
날짜 필드로 전송 — §6 G2·G3)은 UTC 전환과 독립으로 유효하며, 전환 작업에 포함할지 결정 항목이다.

### 7.7 배포·롤백 순서와 검증

**원칙 — 동시 배포는 불가능하다.** iOS 심사·단계 롤아웃 때문에 서버 컷오버 시점에 구버전 앱이
남는다. 서버가 전환 창에 양 세대를 수용하는 쪽으로 순서를 잡는다.

| Phase | 내용 | 축 |
| --- | --- | --- |
| 0 (이 티켓) | 이 문서 + schema.dbml 노트 정정 3건. **코드·마이그레이션 변경 없음 — KST authoritative 유지** | KST |
| 1 (전환 전) | 앱 2.0: UTC 축 읽기 출시 — 서버가 `UserService.java:326` 으로 내려주는 profile `timeZone` 이 전환 후 `"UTC"` 가 되므로 이 값으로 축을 고른다(서버는 아직 KST 라 동작 무변경). 서버: `validateTimezone` 허용값 확장만 선배포 가능 | KST |
| 2 (컷오버 T) | 서버 일괄 — `ZonePolicy` UTC 화 + 자체 리터럴 21클래스 + 크론 25개 `zone` 정리 + `application-prod.yml:16` `time_zone` UTC(dev·staging 정렬 포함) + §7.3 리그 절차 + §7.4 멱등 가드 + profile `timeZone` → `"UTC"` | KST→UTC |
| 3 (정리) | 전환 가드(이중키 조회·양쪽 허용값) 제거 — 롤아웃 완료·레거시 종료 후 | UTC |

**스키마 마이그레이션이 없다** — 컬럼 타입은 그대로고 라벨의 의미만 바뀌므로 롤백은
`prod-rollback.yml` 이미지 롤백으로 완결된다. 단 롤백하면 전환 후 UTC 로 쓰인 행이 KST 로
재해석되므로 **롤백은 전환 직후일수록 안전하다** — 시간이 갈수록 혼재 행이 쌓인다.

**검증 체크**(컷오버 당일, KST 00:00–09:00 = 두 축이 갈리는 유일한 창에서 관측):

- `GET /users/me → timeZone` 이 `"UTC"` 를 돌려준다.
- `timezone="UTC"` 요청 200 · `timezone="Europe/London"` 여전히 400.
- 경계 instant 의 `daily_focus_stats.date` 가 UTC 날짜로 귀속된다.
- §7.3 의 리그 검증 4항목.
- 비KST 기기(시뮬레이션) 스크린타임 업로드가 UTC 버킷에 앉는다.
- `currency_transactions` 에 동일 유저 `focusGoal:`·`stGoal:` 이중 지급 0건.

**이 티켓에서 함께 정정한 schema.dbml 드리프트 3건** — `daily_focus_stats.date` 노트의 「UTC 기준」,
`goal_effective_from` 노트의 「유저 로컬」×2(실제는 `UserService.todayOf()` = KST,
UserService.java:239-240), `league_weekly_results.week_start_at` 노트의 「(UTC)」 — 전부 실제 코드
축(KST)으로 정정했다. 잔존 유사 드리프트: `league_arenas.started_at`(schema.dbml:1017 「(UTC)」)과
`focus_seconds_by_date` 노트(schema.dbml:631 「유저 존 로컬 날짜」)는 같은 종류이지만 티켓 범위
밖이라 이번에 고치지 않았다 — 다음 정정 대상.
