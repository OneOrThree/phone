# 📊 Analytics (GA4 / Track 1) WorkLog

이벤트 로깅 설계(`event-logging-design.md`)의 **프론트 Track 1(GA4 사용자 분석)** 구현 기록.
범위 결정: **GA4만 / 핵심 퍼널 먼저 / JS 먼저, 네이티브 분리.** (Crashlytics·Perf·Sentry는 범위 밖.)

---

## 아키텍처

```
화면/스토어
  └─ analyticsEvents.ts (타입드 헬퍼 — 이벤트명·파라미터 계약 단일 출처)
       └─ analytics.ts (단일 래퍼 — 공통 파라미터 부착 + GA4 sanitize + no-op fallback)
            └─ (Phase 2) @react-native-firebase/analytics → GA4
```

- **`src/services/analytics.ts`** — 모듈 싱글톤 래퍼(`api.ts`와 동일 패턴).
  `track / logScreenView / setUserId / setUserProperty / initAnalytics`. 공통 파라미터
  (`platform·source·app_version·env`)를 모든 이벤트에 자동 부착하고 GA4 한도로 sanitize
  (이벤트명 ≤40 / 파라미터 값 ≤100 / bool→`'true'|'false'` / Date→epoch ms). 항상 fire-and-forget.
- **`src/services/analyticsEvents.ts`** — 이벤트당 얇은 헬퍼 1개 + `setIdentityProps`. 화면은 이 헬퍼만 import.
- 공통 파라미터의 `app_version`은 `expo-constants`의 `Constants.expoConfig.version`에서 읽는다.

### 계측 지점 (Phase 1)

| 위치                           | 이벤트                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigation/RootNavigator.tsx` | `screen_view` 자동추적(라우트 변경 시) + `initAnalytics()` 1회. `SCREEN_NAME_MAP`으로 한글 라우트→snake_case                                          |
| `store/UserContext.tsx`        | `setUserId(userId\|null)` + `is_guest` (분석 식별 단일 지점, `userId` 변경 시)                                                                        |
| `screens/LoginScreen.tsx`      | `login`/`sign_up`(method) + `signup_method` 유저속성 (kakao/apple)                                                                                    |
| `App.tsx`                      | 게스트 시작 시 `login(method=guest)`                                                                                                                  |
| `screens/OnboardingScreen.tsx` | `onboarding_started`(+`tutorial_begin`) / `onboarding_profile_submitted` / `onboarding_goal_submitted` / `onboarding_completed`(+`tutorial_complete`) |
| `screens/FocusModeScreen.tsx`  | `focus_session_started` (started만 — 아래 결정 참고)                                                                                                  |

---

## 주요 결정 (왜)

- **JS 먼저 / 네이티브 분리.** `ios/`·`android/`가 커밋·수작업 커스터마이즈(Screen Time 확장, Podfile 패치,
  entitlements)되어 있어 `expo prebuild --clean`이 위험. 그래서 분석 JS 레이어를 먼저 머지하고
  네이티브 wiring(아래 Phase 2)을 분리.
- **Phase 1은 firebase 패키지를 설치하지 않는다.** Metro는 `require('@react-native-firebase/analytics')`
  같은 리터럴 require를 **빌드 타임에 정적 해석**하므로, 패키지가 없으면 try/catch로도 못 막고 번들이 깨진다.
  → `analytics.ts`의 `getAnalytics()`가 Phase 1에서 항상 `null`(no-op). dev 빌드에서는 `[analytics]` 콘솔
  로그만 출력. Phase 2에서 패키지 설치 후 `getAnalytics()`의 **주석 한 줄**만 활성화하면 GA4로 전송 시작.
- **`focus_session_completed`는 클라가 발행하지 않는다.** 설계서에서 [S](서버 검증, MP 소유) 이벤트.
  세션 시간은 anti-cheat 위해 서버 검증이 신뢰원 → 클라가 함께 보내면 GA4 이중 집계.
  클라는 `focus_session_started`(C)만 발행. (설계서 §1·§5.C, `FocusModeScreen.handleStop` 주석)
  > ⚠️ 백엔드 MP가 아직 미구현이면 완료 이벤트는 백엔드 작업 전까지 GA4에 들어오지 않는다.
- **PII 금지.** 닉네임/생년월일/원본 성별을 이벤트·유저속성으로 보내지 않음. 온보딩은 `gender`(MALE/FEMALE/UNKNOWN),
  `age_band`(10s/20s…)로 **파생 비식별값**만 전송. `user_id`는 opaque UUID(JWT `sub`)만 허용.
- **단일 화면 온보딩.** 실제 온보딩은 O1~O8 멀티스텝이 아니라 단일 폼 → 진입(started)·완료(completed)
  경계와 폼이 수집한 profile/goal submit만 계측(설계서의 멀티스텝 funnel을 현실에 맞게 축약).

---

## 검증 (Phase 1, 네이티브 전)

```bash
cd app && npm run typecheck && npm run lint && npm run format:check
```

dev 빌드 실행 후 콘솔에서 `[analytics] <event> {…}` 확인:

- 로그인/가입 → `login`/`sign_up`(method) + `setUserId`
- 온보딩 → `onboarding_started` → `onboarding_*_submitted` → `onboarding_completed`
- 화면 전환 → `screen_view`(screen_name snake_case)
- 집중 시작 → `focus_session_started`(has_tag)
- 공통 파라미터(platform/source/app_version/env) 부착, bool='true'/'false' 확인.

---

## Phase 2 — 네이티브 wiring (별도 작업, 미완)

> ⚠️ `expo prebuild --clean` 금지(네이티브 커스터마이즈 삭제됨). 스크래치에서 prebuild → diff만 손반영.

1. `npx expo install @react-native-firebase/app @react-native-firebase/analytics expo-build-properties`
   (Expo 54/RN 0.81: 첫 통합은 `~23.x` 권장, 그린 빌드 후 상향). `package.json` 버전 핀.
2. `analytics.ts`의 `getAnalytics()` 주석 한 줄 활성화:
   `cached = require('@react-native-firebase/analytics').default();`
3. `app.config.js` `plugins`에 `'@react-native-firebase/app'`, `'@react-native-firebase/analytics'`,
   `['expo-build-properties', { ios: { useFrameworks: 'static', forceStaticLinking: ['RNFBApp','RNFBAnalytics'] } }]`.
   `ios.googleServicesFile`/`android.googleServicesFile`을 env로 지정.
4. Firebase 프로젝트 dev/prod 생성 → `GoogleService-Info.plist`/`google-services.json`(EAS file secret, git 제외).
   iOS plist는 gromo 타깃에만(확장 제외).
5. 스크래치 `expo prebuild --no-install` → ① `Podfile.properties.json`의 `"ios.useFrameworks":"static"`
   ② `AppDelegate`의 `FirebaseApp.configure()` ③ Android `google-services` gradle 만 손반영
   (Podfile 패치·Screen Time 확장·entitlements 보존). 이후 `pod install`.
6. **빌드 검증(최우선 리스크):** static frameworks 전환이 Kakao·Screen Time 확장 링크에 영향 →
   iOS 실기기 빌드부터 스모크 테스트. Firebase DebugView로 이벤트 실시간 확인.
7. **수동:** App Store/Play 데이터 수집 고지 + `ios/gromo/PrivacyInfo.xcprivacy` 갱신(제출 전 필수).

## 향후 (범위 밖)

- 나머지 [C] 이벤트: 그룹/챌린지/콕/태그/알림(Phase 3), `flow_abandoned`·`repeated_failure`·`rage_tap_detected`.
- Track 2(서버 구조화 로그), Track 3(Crashlytics·Perf·Sentry), BigQuery export.
