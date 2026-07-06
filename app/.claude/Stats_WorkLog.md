# 통계(Stats) WorkLog — GROMO-558

통계 화면 구현 작업 로그. 아키텍처 결정(+why)·코드 변경·백엔드 갭·트러블슈팅·체크리스트를 계속 갱신한다.

- **브랜치**: `afeat/GROMO-558-stats` (off `main`)
- **상세 지표 계획**(지표 × 데이터소스 매트릭스): [`app/.docs/통계-3화면-지표-계획.md`](../.docs/통계-3화면-지표-계획.md) — 스펙은 여기, 이 문서는 구현 기록.
- **진행 상황**: 604 내 통계 화면 1차 구현 완료 (2026-07-06). 603·605 미착수.

---

## 개요 — "통계"는 3개 화면

성격이 다른 3개 화면으로 나뉘며 각각 하위작업 티켓 1개. 진입점·대상이 다름.

| 티켓 | 화면 | 진입점 | 대상 |
| --- | --- | --- | --- |
| GROMO-603 | 집중 결과 | 집중 세션 종료 직후 | 방금 세션 + 이번 주 요약 |
| **GROMO-604** | 내 통계(허브) | 홈 "자세히" | 내 전체 통계(기간·과목 필터) |
| GROMO-605 | 다른 사람 통계 | 리그·친구 프로필 탭 | 타 유저(공개 설정 게이팅) |

---

## 핵심 아키텍처 결정 (+why)

1. **비교(나 vs 평균) = 리그 랭킹 + 친구 통계로 FE 계산.** 비교 축은 **친구 / 전체 / 같은 카테고리** 3개(“또래”는 없음).
   - 전체 = `GET /league/ranking?scope=total`, 같은 카테고리 = `GET /league/me/ranking?category=`, 친구 = `/friends` + `/stats/focus?friends=`. member `totalFocusMinutes` 평균을 FE가 계산.
   - **`/stats/comparison`(GROMO-525)는 서버 편의 집계 스텁이며 main 미머지 → 사용 안 함.** 스텁 하나 보고 "비교 데이터 없음"으로 오판했다가 정정한 이력 있음. (제약: 리그는 **주간·총합** 기준 → 일/월 비교·과목별 남 비교는 소스 없음.)
2. **`?friends={uuid}` = 특정 친구(ACCEPTED) 1명 조회.** "친구 평균"이 아님. today·streak·focus·screen-time 4개 엔드포인트만 지원. `by-category`·`heatmap`은 미노출(→ BE 요청 GROMO-624).
3. **데이터 페칭 = `useFocusEffect` + `Promise.all` + 개별 `.catch`.** React Query 미사용(리그 화면 패턴과 통일). 개별 호출 실패는 해당 항목만 null/[]로 격리하고 나머지는 렌더.
4. **차트는 라이브러리 없이 View 기반.** 프로젝트에 차트 lib 없음(`react-native-svg`만 있음). 막대=정규화 높이 View, 잔디=색 버킷 View 그리드. `league/components/DuoDayChart.tsx` 패턴 재사용.
5. **소스 없는 지표는 "준비 중" 티저(오스카 결정: 텍스트만 있는 빈 스텁 금지).** **실그래프를 그려두고 블러 + "준비 중" 오버레이**(`stats/ComingSoon.tsx`, expo-blur — 비친구 프로필 잠금 티저와 같은 패턴). 적용: 604 ST1 비교·ST3 합격자·ST4 주별 누적, 집중 결과 오늘 비교(전체·카테고리), 605 과목별 비교(`SubjectCompareCard` 티저 재활용). 데이터 붙으면 블러만 걷어냄. 로딩·"친구 없음"(액션 유도)은 텍스트 유지.
6. **화면 파일은 기존 경로 유지**(`v2/screens/StatsScreen.tsx`) — `RootNavigator`가 그 경로를 import하므로 네비 변경 없이 in-place 재작성. 보조 파일은 `v2/screens/stats/`.

### 605 공개 게이팅 (statVisibility)

- 타 유저 통계 공개 범위는 **관계(친구/비친구)가 아니라 대상의 설정** `statVisibility` = **`PUBLIC`(전체공개) / `FRIENDS`(친구공개, 기본)**.
- **공개 프로필**(닉네임·캐릭터·랭킹·친구수·티어)은 설정 무관 항상 공개.
- **상세 통계**(today/heatmap): PUBLIC이면 누구나, FRIENDS면 친구·본인만.
- ⚠️ **현재 BE `ProfileService.getUserStats`는 statVisibility를 안 보고 친구/본인만 통과** → PUBLIC 유저도 비친구엔 안 보임. → BE 버그 **GROMO-623**.

---

## 코드 변경 — GROMO-604 (1차)

**데이터 계층**
- `src/types/dto/stats.ts` — `CategoryFocusStatsResponse`(+`CategoryFocusItem`), `ScreenTimePeriodStatsResponse` DTO 미러 추가.
- `src/services/statsApi.ts` — `getFocusStatsByCategory(period)`, `getScreenTimePeriodStats(period)` 래퍼 추가.
- `src/services/analyticsEvents.ts` — `logStatsViewed` / `logStatsPeriodChanged` / `logStatsTagFilterSelected` (이벤트 `stats_viewed`·`stats_period_changed{period}`·`stats_tag_filter_selected{is_all}`) 추가.

**화면**
- `src/v2/screens/stats/format.ts` (신규) — 순수 헬퍼: `hm`, `PERIOD_TABS`, `periodLabel`, `prevLabel`, `periodKey`, `weekdayKo`, `heatmapRange`, `heatmapBars`, `focusGoalRate`, `grassLevel`.
- `src/v2/screens/stats/useStatsData.ts` (신규) — 기간별 병렬 조회 훅(focus·category·screenTime·today·streak·heatmap·tags).
- `src/v2/screens/StatsScreen.tsx` (재작성) — 플레이스홀더(mock) → 실 API. 필터(기간 일/주/월 + 과목 칩) + ST1~ST9. 서브컴포넌트 인라인(TagChip/SectionCard/StubCard/CompareStub/BarChart/CategoryBars/DeltaRow/GoalBlock/GrassGrid).

**실데이터**: ST1 총공부량(나)·ST2 과목별(나)·ST5 집중시간 막대·ST6 폰사용·ST7 전대비·ST8 목표달성·ST9 스트릭+잔디.
**준비 중 스텁**: ST1 비교 3축 셀렉터·ST3 합격자·ST4 주별 누적.

### 604 정직한 한계 (후속 처리)
- **ST1 비교 3축 배선 미완** — `leagueApi` 존재하나 전체/카테고리 평균 계산 + 친구 병합은 다음 증분. 현재 셀렉터 UI만.
- **ST7 전 대비** — 디자인은 전일/전주/전월 3개 동시, 백엔드는 선택 기간 1개 delta만 제공 → **선택 기간 기준** 표시.
- **과목 필터** — 백엔드가 태그 필터를 by-category만 지원 → 칩 선택은 ST2 강조 + 애널리틱스에만 반영, 나머지 섹션은 전체 기준.

---

## 코드 변경 — GROMO-598 (집중 완료 결과 화면)

집중 완료 결과 화면은 **전용 티켓 598**(작업, 진행 중). 화면·진입·로컬 데이터·CTA가 598, 결과 화면에 얹는 서버 통계(이번 주·스트릭·잔디)는 아래 **603**으로 분리.

- `src/navigation/types.ts` — `FocusResult` 라우트 추가 `{ focusSeconds, subjectId, subjectName }`.
- `src/navigation/RootNavigator.tsx` — `FocusResultScreen` 등록(`animation: 'fade'`, `gestureEnabled: false`).
- `src/types/storage.ts` — `focusFirstDone` 키 추가(첫 완료 변형 분기용 로컬 플래그).
- `src/v2/screens/focus/FocusSessionScreen.tsx` — `finish()` 종료 시 `popToTop` → **집중 ≥1분이면 `FocusResult`로 `replace`**(짧은 중도 이탈은 그대로 홈).
- `src/v2/screens/focus/FocusResultScreen.tsx` (신규) — 결과 화면. **첫 완료/이후 세션 2변형**. **로컬 데이터만**: 이번 집중(param). **코인 표기 제외**(설계 결정). CTA **홈으로 / 다시 집중**(다시 집중 = `FocusCategory`로 replace).

**주의**:
- 집중 흐름은 PATCH end API가 아니라 `saveFocusSession`(블록별 POST) + 로컬 `elapsed` 정산 모델 → 결과 화면 "이번 집중"은 `session.elapsed`(param) 기준. `FocusSessionEndResponse`는 앱 미사용.
- `finish()`의 정산·고아 방지 로직은 무변경, **마지막 navigation만 교체**.
- 첫 완료 판별은 로컬 플래그(`focusFirstDone`) — 서버 신호 없이 클라 판정.

---

## 코드 변경 — GROMO-603 (집중 완료 통계)

집중 완료 결과 화면(598) 위에 **서버 통계**를 얹는다.

- `src/v2/screens/focus/FocusResultScreen.tsx` — Claude Design **Gromo.dc.html 14번(첫 집중 완료)** 레이아웃 기준 재구성:
  - **이번 집중 카드**: **과목명이 주인공(큰 글씨)** + 시간 **디지털 표기 00:00:00**(`hms`), 하단에 **과목별 누적 집중**(로컬 `SubjectContext` — 방금 세션 즉시 반영·과목 색 사용, `hmsCompact`).
    - ⚠️ 처음엔 서버 by-category(WEEK)로 붙였다가 **안 뜨는 문제** 발견 → 원인: ① 앱이 세션을 전부 `focusTagId:null`로 업로드(서버 집계 전부 '미분류') ② 초 단위 테스트 세션은 분 집계 0 → items 빈 배열. → 결과 화면은 **로컬 과목 데이터로 전환**(항상 즉시 표시).
  - **세션 업로드 태그 동기화**(`focus/tagSync.ts` 신규): 업로드 직전 과목명→서버 FocusTag 매칭/생성(`ensureFocusTagId`, 모듈 캐시) 후 `focusTagId` 실어 보냄 → **서버 과목별 통계(604 ST2 등)가 앞으로 실제 과목으로 집계**. 실패 시 null(기존 동작).
  - **이번 주 스트릭 채우기**: **첫 완료 변형에만**(시안 14번 전용). **출석 체크** — 그날 집중 기록 있으면(월~일) ✓ (`sessionCount>0 || totalFocusMinutes>0`; 목표 달성 아님). 방금 끝낸 세션은 서버 집계 반영 전일 수 있어 **오늘 칸은 로컬로 즉시 채움**. + 연속일 배지.
  - **이번 주 집중시간**: 총합 + 요일별 막대(나, 오늘 강조).
  - **나 vs 3축 비교(친구/전체/같은 카테고리, 주간)**: `stats/compareAverages.ts`(신규 공용 헬퍼 — 604 ST1 재사용 가능)로 축별 평균 FE 계산 + 칩 셀렉터. 수평 바 2개 + ▲▼ 배지 + 격려체 캡션. 축별 미확보 시 폴백 문구(친구 없음/준비 중).
    - **축별 독립 로딩**: 처음엔 한 Promise.all에 묶여 제일 느린 친구 N+1이 화면 전체를 지연 → 축별 독립 함수(`fetchGlobalAverage`/`fetchCategoryAverage`/`fetchFriendsAverage`)로 분리, 비교 카드는 **즉시 렌더**("불러오는 중…")하고 도착한 축부터 채움. 친구 상한 30→**10명**.
    - **비교는 오늘(DAY) 단위로 확정**(이번 주 토글 제거 — 오스카 결정): 친구 = `/stats/focus?period=DAY&friends=` 평균 **실데이터**(기본 축). **전체·같은 카테고리는 리그가 주간 집계뿐이라 오늘 불가** → "준비 중" 안내. 오늘 내 값 = heatmap 오늘 셀 vs 방금 세션 분 중 큰 값. `fetchGlobalAverage`/`fetchCategoryAverage`(주간)는 604 ST1용으로 유지. → **BE 요청 후보**: 일 단위 전체/카테고리 평균 집계(525 비교 실집계 스코프에 period 파라미터 포함 제안).
    - 전체 = `getGlobalRanking()`(신규 래퍼, `/league/ranking?scope=total&limit=100`) 평균.
    - 친구 = `fetchFriends()` + 친구별 `getFocusPeriodStats('WEEK', friendId)`(래퍼에 `friends` 파라미터 추가) 평균. **N+1 상한 30명**.
    - 같은 카테고리 = `getMyRanking(occupation)` 평균. **focusCategory↔Occupation 부분 매핑 4종만**(노무사·변리사·중학생·대학생, `constants/focusCategories.CATEGORY_TO_OCCUPATION`) — 그 외 카테고리는 "준비 중" 폴백. TODO: 매핑 확정 시 확장.
    - ⚠️ **발견·수정한 근본 갭**: 앱이 occupation을 서버에 **한 번도 안 보내고 있었음**(온보딩 body는 nickname·목표뿐, 설정 updateOccupation 미호출) → 서버 유저 occupation이 비어 카테고리 랭킹이 빈 리스트. **수정**: 온보딩 완료(`App.tsx syncOnboardingToServer`)·설정 변경(`OccupationScreen`) 시 매핑되는 카테고리면 `PATCH /users/me/occupation` 동기화 → 유저가 쌓이면서 같은 카테고리 비교가 실동작. 기존 유저는 설정에서 재저장 시 반영.

**주의**:
- 스트릭 채우기 = **출석 체크**(그날 집중했는지), 목표 달성/분/잔디 아님. **첫 완료에만 표시**(이후 세션 변형(15번)엔 없음).
- 시간대별("이 시간대") 비교·합격자는 소스 없음 → 후속.
- 종료 시 결과 화면은 **길이 무관 항상 표시**(1분 미만은 "N초"). 초기 ≥1분 임계값 제거(598 후속 수정).
- CTA는 홈/다시집중 2개 유지(598 스펙) — 디자인 14번은 단일 "확인하고 홈으로"지만 티켓 스펙 우선.

---

## 코드 변경 — GROMO-605 (다른 사람 통계)

`FriendProfileScreen`(league)을 mock → 실 API로 전면 교체.

- `src/v2/screens/league/FriendProfileScreen.tsx` — `getPublicProfile` + `getUserStats` + 내 `getHeatmap` 조회. mock(RANKING·PROFILE_COMPARE·TEASER·SubjectCompareCard·BlurView) 제거.
  - **공개 프로필**(항상): 아바타·닉네임·친구 수·티어·전체 랭킹.
  - **상세 통계 게이팅**: `stats.today != null` = 공개(친구 또는 대상 전체공개) → 목표달성·이번 주 집중 + 요일별 집중·폰 사용 비교. `null` = 잠금 UI("친구만 볼 수 있어요") + 친구 신청 CTA. **스트릭은 항상 표시**.
  - **요일별 비교 실데이터**: 내 heatmap + 상대 heatmap(`getUserStats.heatmap`)을 **월~일로 재배치**해 `DuoDayChart` 2종(집중·폰 사용).
  - **과목별 비교**: 준비 중(친구 by-category 대기, GROMO-624).
  - 친구 신청/끊기·핀 토글은 기존 실 API 유지 — **관계(isFriend)와 통계 공개(statsVisible)는 별개**로 분리.

**주의**: 전체공개(PUBLIC) 대상의 비친구 조회는 BE `getUserStats` PUBLIC 분기(GROMO-623) 머지 후 자동 공개 — FE는 `today != null` 게이트로 이미 대응(무수정 점등).

---

## 백엔드 갭 / BE 티켓

- **GROMO-623** [버그] 타 유저 통계 전체공개(statVisibility PUBLIC) 미반영 — `getUserStats` 게이트에 PUBLIC 분기 추가. (조재영)
- **GROMO-624** [버그] `by-category` 친구 조회 미지원 — 컨트롤러에 `?friends=` + `resolveTargetUserId` 추가(서비스는 이미 임의 userId 지원). → 604 ST2 친구 과목별·605. (조재영)
- (미티켓) 타 유저 리그 내 순위(examRank) 조회 수단 — 605.
- **소스 자체 없음(준비 중 유지)**: 합격자, 전체/카테고리 평균의 과목별, 일/월 단위 비교.

---

## 검증

- `npm run typecheck` ✅ (clean)
- `npm run lint` ✅ (0 errors; 동적 opacity/fontWeight 인라인 경고 2건 — 기존 코드 패턴과 동일)
- `npm run format:check` ✅
- **시뮬레이터 런타임 확인**: TODO (아직 안 함)

---

## 체크리스트 / 다음 증분

- [x] 604 데이터 계층(DTO·래퍼·애널리틱스)
- [x] 604 화면 — 필터 + ST1(나)·ST2(나)·ST5~ST9 실데이터 + 준비중 스텁
- [ ] 604 ST1 3축 비교 배선 (`leagueApi` 전체/카테고리 + 친구 평균)
- [ ] 604 시뮬레이터 렌더 확인
- [x] 598 집중 완료 결과 화면 (진입 배선 + 로컬 이번 집중 + 홈/다시집중 CTA)
- [x] 603 집중 완료 통계 (결과 화면에 이번 주·스트릭·잔디)
- [x] 605 다른 사람 통계 (FriendProfileScreen 실 API + statVisibility 게이팅 + 요일 비교 실데이터)
- [ ] BE 623/624 머지 후 → 전체공개·친구 과목별 연동
- [ ] 시뮬레이터 렌더 확인 (604·598·603·605)

---

**최근 갱신**: 2026-07-06 — 604 내 통계 + 598 집중 완료 결과 화면 + 603 집중 완료 통계 + 605 다른 사람 통계 구현.
