# Gromo 스크린타임 보상 모듈 Work Log

> 스크린타임 표시 기능은 [ScreenTime_WorkLog.md](./ScreenTime_WorkLog.md) 참고

---

## 개요

스크린타임 목표 달성 여부를 판정하고 보상(코인 지급)을 주는 기능.
사용자가 "측정 대상 앱/카테고리"를 선택하면, 그 앱들의 하루 총 사용시간이
목표시간을 넘었는지 자정에 판정하고, 다음날 앱 진입 시 보상/실패 모달을 표시한다.

목표시간·측정대상 변경은 **다음날부터 적용**(날짜 기반)된다.

---

## 1. 최종 아키텍처 (현재 구현)

```
[설정 — 마이페이지]
  측정 대상 선택(FamilyActivityPicker) → App Group "대기" 키 저장
  목표시간 변경 → AsyncStorage "대기" 키 저장 (gromo:goal:pending)
  ※ 둘 다 당일엔 반영 안 됨 (대기 상태)

[앱 실행 — Homescreen 마운트]
  오늘 ≥ 적용예정일 이면 대기 → 활성 승격
  → 활성 측정대상 + 활성 목표로 startGoalMonitoring() (자정 모니터링 등록)

[하루 중]
  선택한 앱 누적 사용시간이 목표(threshold) 도달
  → Monitor 익스텐션 eventDidReachThreshold 발화 → goalExceededToday = true

[자정 23:59] DeviceActivityMonitorExtension.intervalDidEnd()
  → goalExceededToday true면 "fail", false면 "success" 기록 (+ 날짜)
  → goalExceededToday 초기화

[다음날 앱 실행] Homescreen
  → getYesterdayResult() → "success"면 코인+성공모달, "fail"이면 실패모달
```

핵심: **수치 비교를 우리가 하지 않는다.** "목표 초과" 사실 자체를 OS(threshold 이벤트)가
Monitor 익스텐션(App Group 쓰기 가능)에 직접 알려주므로, Report 익스텐션의
App Group 쓰기 차단 문제를 통째로 우회한다.

---

## 2. 핵심 발견 (이전 분석 뒤집힘)

### ✅ FamilyActivityPicker는 "전체 선택"을 제공한다 → 카테고리 토큰 발급 가능

- 이전 WorkLog는 "전체 앱에 해당하는 토큰을 프로그래밍 방식으로 얻을 수 없다"(Option B 불가)고
  결론냈으나, **시스템 picker UI 자체에 전체 선택 기능이 있음**을 실기기에서 확인.
- 전체 선택 후 완료 시 결과: **카테고리 13개 토큰** (앱/웹 토큰은 0).
  - 카테고리 토큰 하나가 그 카테고리의 모든 앱 + 앞으로 설치될 앱까지 포함.
- 즉, 우리가 직접 "전체 선택" 버튼을 만들 수는 없지만(토큰을 코드로 못 만듦),
  **시스템 picker를 통하면 사용자가 전체를 선택 → 유효한 토큰 집합을 얻을 수 있다.**
- 이 토큰을 `DeviceActivityEvent`에 넣으면 threshold 이벤트가 **실제로 발화**한다.

→ 이 발견으로 "threshold 경로로 보상 판정"이 가능해졌고, 미검증이던 FileManager 우회
(이전 Option C)는 **불필요**해졌다.

---

## 3. (히스토리) 기존 버그: 실패해도 항상 성공 보상

**증상**: "남은" 칸에 "달성 실패"가 떠도 보상 모달은 항상 "목표 달성!"

**원인 — `eventDidReachThreshold` 미발화:**
`startGoalMonitoring()`의 `DeviceActivityEvent`가 `applications: []`, `categories: []`,
`webDomains: []` (빈 배열)로 생성되어 **모니터링 대상이 없어 threshold가 절대 발화 안 함**.
→ `goalExceededToday`는 항상 false → `intervalDidEnd`에서 항상 "success".
(보조로 둔 `totalDuration` 직접 비교도, Report 익스텐션의 App Group 쓰기 차단으로 항상 0이라 무용.)

**해결**: picker로 받은 실제 토큰(selection)을 이벤트에 넣어 발화시키고,
`intervalDidEnd`의 죽은 `totalDuration` 비교 경로는 제거.

---

## 4. 구조적 제약 (변함없음)

| 익스텐션 종류                                             | App Group 읽기 | App Group 쓰기      | 스크린타임 수치 접근             |
| --------------------------------------------------------- | -------------- | ------------------- | -------------------------------- |
| `DeviceActivityReportExtension` (screentimereport)        | ✅             | ❌ OS 샌드박스 차단 | ✅                               |
| `DeviceActivityMonitorExtension` (GromoScreenTimeMonitor) | ✅             | ✅                  | ❌ threshold 콜백만              |
| 메인 앱 (gromo)                                           | ✅             | ✅                  | ❌ DeviceActivity 직접 조회 불가 |

이번 설계는 "수치를 아는 Report 익스텐션"을 판정에서 **배제**하고,
"초과 사실을 콜백으로 받는 + 쓰기 가능한 Monitor 익스텐션"만으로 판정을 완결한다.

---

## 5. 날짜 기반 "다음날 적용" 설계

목표시간·측정대상 모두 동일 패턴. 모든 승격(promote) 판정은 **앱 실행 시 Homescreen 마운트**
한 곳에서 로컬 날짜 비교로 처리한다.

> ⚠️ "내일 00:00 정각"이 아니라 **"내일 이후 앱을 처음 여는 순간"** 적용이다.
> DeviceActivity 모니터의 토큰/threshold는 메인 앱이 실행될 때만 (재)등록 가능하고,
> iOS가 자정에 앱 코드를 자동 실행해주지 않기 때문. (기존 목표시간도 사실 자정 적용이
> 아니었고 "다음 실행" 방식이었음 — 이번에 날짜 비교를 추가해 정확히 "다음날"로 통일)

### 저장 키

**AsyncStorage**

| 키                                      | 용도                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `gromo:goal:pending`                    | 대기 목표 `{ minutes, applyDate }` (applyDate = 내일)                        |
| `gromo:selection:applyDate`             | 측정대상 대기 적용예정일 ("YYYY-MM-DD")                                      |
| `gromo:selection:counts`                | **오늘(활성)** 측정대상 선택 개수 `{ applications, categories, webDomains }` |
| `gromo:selection:pendingCounts`         | **내일(대기)** 측정대상 선택 개수 (변경 시 저장, 승격 시 counts로 이동)      |
| `gromo:selection:configured`            | 측정대상 최초 설정 완료 플래그 ("1")                                         |
| `gromo:user.dailyScreenTimeGoalMinutes` | **활성** 목표 (승격 시점에 갱신, App.js가 로드)                              |
| `gromo:screentime:lastRewardedDate`     | 보상 모달/코인 중복 지급 방지 (하루 1회)                                     |
| `gromo:screentime:lastSyncedDate`       | 서버 전송 중복 방지 (보상 가드와 별개 → 전송 실패 시 재시도)                 |
| `gromo:screentime:authGranted`          | 권한 승인 이력 캐시 ("1") — 콜드런치 quirk 대응                              |

**App Group UserDefaults (`group.com.oneorthree.gromo`)**

| 키                                               | 용도                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `gromo:goal:selection`                           | **활성** 측정대상 (FamilyActivitySelection, startGoalMonitoring이 사용) |
| `gromo:goal:selectionPending`                    | **대기** 측정대상 (picker가 저장, 승격 시 active로 이동)                |
| `gromo:user:goalSeconds`                         | "남은" 표시용 목표 (메인 앱이 기록, Report 익스텐션이 읽음)             |
| `gromo:screentime:goalExceededToday`             | threshold 초과 플래그 (Monitor 익스텐션)                                |
| `gromo:screentime:lastResult` / `lastResultDate` | 어제 판정 결과                                                          |

### 승격 로직 (Homescreen 마운트, 앱 실행 시 1회)

```
today = todayStr()
1) selection: gromo:selection:applyDate 존재 && today >= applyDate
   → ScreenTimeModule.promoteSelection()  (selectionPending → selection)
   → applyDate 삭제
2) goal: gromo:goal:pending 존재 && today >= applyDate
   → effectiveGoal = minutes*60, setGoalSeconds(), gromo:user 갱신, pending 삭제
3) startGoalMonitoring(effectiveGoal)  (활성 측정대상 + 활성 목표로 등록)
```

### 측정대상 첫 설정 예외

마이페이지 `openPicker`에서 `gromo:selection:configured`가 없으면(최초)
→ 즉시 `promoteSelection()` + `startGoalMonitoring()` (오늘부터 측정).
이후 변경은 `applyDate=내일`로 저장 → 다음날 승격.

---

## 6. 네이티브 메서드 (ScreenTimeModule)

| 메서드                                            | 역할                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `requestAuthorization` / `getAuthorizationStatus` | FamilyControls 권한                                                     |
| `presentAppPicker`                                | FamilyActivityPicker 표시 → 선택을 `selectionPending`에 저장, 개수 반환 |
| `promoteSelection`                                | `selectionPending` → `selection` 승격 (true/false)                      |
| `startGoalMonitoring(goalSeconds)`                | 저장된 활성 selection + threshold로 모니터링 등록 (선택 없으면 false)   |
| `getYesterdayResult`                              | 어제 판정 결과("success"/"fail"/null)                                   |
| `setGoalSeconds` / `getTotalScreenTime`           | (표시용 legacy)                                                         |

`GoalAppPickerView`(SwiftUI): `FamilyActivityPicker` + 취소/완료 툴바를 감싼 시트.

---

## 7. 관련 파일

| 파일                                                              | 역할                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ios/gromo/ScreenTimeModule.swift`                                | picker 표시 / promoteSelection / startGoalMonitoring                                |
| `ios/gromo/ScreenTimeModule.m`                                    | 브릿지 등록                                                                         |
| `ios/gromo/ScreenTimeReportUIView.swift`                          | DeviceActivityReport 브릿지 — **필터에 활성 selection 적용**(선택 앱만 집계)        |
| `ios/GromoScreenTimeMonitor/DeviceActivityMonitorExtension.swift` | intervalDidEnd 판정 / eventDidReachThreshold                                        |
| `ios/screentimereport/TotalActivityReport.swift`                  | buildActivityReport — 앱/카테고리 집계 (`ActivityReport`에 `categories` 포함)       |
| `ios/screentimereport/TotalActivityView.swift`                    | 총합 + 카테고리별 + 앱별 목록 표시                                                  |
| `utils/ScreenTimeModule.js`                                       | JS 래퍼                                                                             |
| `utils/localDate.js`                                              | 로컬 날짜 헬퍼 (todayStr/tomorrowStr/localDateStr)                                  |
| `screens/MyPageScreen.js`                                         | 측정대상 선택 UI / 목표·측정대상 대기 저장 / 오늘·내일 측정대상 표시                |
| `screens/Homescreen.js`                                           | 마운트 승격 오케스트레이터 / 보상 모달 / 서버 전송 / 권한 캐시 / 사용 상세 오버레이 |

---

## 8. 실기기 확인 필요 (구현됐으나 미검증)

- [x] picker 전체선택 → 카테고리 13개 토큰 발급 (확인됨)
- [x] 선택 결과 App Group 인코딩/저장 (확인됨)
- [ ] threshold 토큰 주입 후 `eventDidReachThreshold` 실제 발화 (Console.app `GromoScreenTimeMonitor`)
- [ ] `intervalDidEnd`에서 success/fail 정확히 기록 → 다음날 모달 분기
- [ ] 날짜 기반 승격: 오늘 변경 → 당일 미반영 → 다음날 실행 시 승격
- [ ] **재등록 부작용**: 홈 마운트마다 `startGoalMonitoring` 재등록 시, DeviceActivity가
      당일 누적 카운트를 리셋하는지 확인. (앱을 자주 켜도 threshold 정상 발화하는지)
      → 문제 시 "이미 등록돼 있으면 스킵" 로직 추가

---

## 9. 알려진 한계 / 메모

- threshold는 **선택한 카테고리 전체**(gromo 앱 포함)를 카운트. 반면 홈 "사용" 표시는
  gromo를 제외 → 판정값과 표시값이 gromo 사용량만큼 미세하게 다를 수 있음 (무시 수준).
- "다음날 적용"은 "다음 실행 시 적용"의 날짜 게이트 버전 (자정 정각 아님, 위 5절 참고).
- 서버에는 목표 변경값을 즉시 PATCH. 재설치/재로그인 시 서버값이 즉시 활성으로 로드될 수 있음(엣지).

---

## 10. 추가 구현 (GROMO-349 커밋 이후, 미커밋)

### 10.1 홈 표시를 "선택한 앱만"으로 필터

`ScreenTimeReportUIView.setupHostingController`의 `DeviceActivityFilter`에 App Group의
활성 selection(`gromo:goal:selection`) 토큰을 적용 → "사용"·"남은"·상세 모두 **선택 앱만 집계**.
선택이 비어있으면 전체 앱으로 fallback. (판정 threshold와 동일 기준)

### 10.2 "사용" 칸 탭 → 측정 앱별 사용 상세

- 홈 "사용" 칸 탭 → **총 사용시간 + 카테고리별 + 앱별 목록** 표시 (Total Activity 리포트)
- `TotalActivityReport`에 `CategoryUsage`/`categories` 추가 — 앱 합산 시 카테고리별로도 누적
  (gromo 제외 앱 기준이라 총합과 일관). 카테고리명은 `categoryActivity.category.localizedDisplayName`
- ⚠️ **RN `Modal`은 사용 불가**: 별도 윈도우에 렌더돼 `DeviceActivityReport` scene이 활성화 안 됨
  → **같은 화면 계층의 absolute 오버레이**(`s.usageOverlay`)로 띄워야 정상 호스팅됨
- 리포트 콜드스타트가 느려서 **뒤에 로딩 스피너**를 깔아 체감 개선 (리포트가 뜨면 덮음)

### 10.3 달성 결과 서버 전송 (GROMO-273 연동)

- 백엔드 `POST /api/v1/screen-time` (PR #29). 요청: `{ screenTimeGoalAchieved: Boolean,
actualScreenTimeMinutes: Integer?(현재 null), reportedAt: Instant, timeZone: String }`
- 서버가 `reportedAt`+`timeZone` → LocalDate 환산해 `daily_focus_stats` upsert
- Homescreen 보상 useEffect에서 어제 결과 전송. **reportedAt = 어제 정오**(타임존 환산 시 날짜 안전)
- `lastSyncedDate` 가드로 보상 모달과 분리 → 전송 실패 시 다음 진입에 재시도

### 10.4 권한 상태 캐시 (콜드런치 quirk 대응)

- `AuthorizationCenter.authorizationStatus`가 콜드런치 직후 `notDetermined`를 잘못 주는 quirk로
  "사용" 칸이 매 실행 "권한 허용"에 멈추던 문제
- `authGranted` 캐시로 낙관적 표시 + **확정 답('approved'/'denied')만 신뢰**.
  `notDetermined`인데 캐시 있으면 quirk로 보고 승인 유지. 설정에서 진짜 끄면 'denied'로 와서 해제

### 10.5 마이페이지 오늘/내일 측정대상 분리 표시

- "오늘 측정 대상"(활성 `counts`) + "내일부터 측정"(대기 `pendingCounts`) 분리 표시
- 변경 시 오늘 것을 덮지 않고 내일 칸에만 저장 → 다음날 승격 시 counts로 이동
- ⚠️ 표시는 **개수만**("카테고리 13개"). 실제 앱/카테고리 **이름**은 토큰이 opaque라 불가
  (보여주려면 SwiftUI `Label(token)` 네이티브 뷰 별도 작업 필요)

---

**최종 업데이트**: 2026-06-17
