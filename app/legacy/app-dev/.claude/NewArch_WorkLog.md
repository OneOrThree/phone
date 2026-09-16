# New Architecture 전환 WorkLog (GROMO-563)

React Native New Architecture(Fabric/TurboModules) 전환 작업 기록.

- **티켓**: GROMO-563 `[Architecture] React Native New Architecture(Fabric/TurboModules) 전환`
- **브랜치**: `arefactor/GROMO-563-new-arch`
- **작업일**: 2026-07-03

---

## 1. 배경 / 왜 지금

- Expo SDK 54 · RN 0.81은 New Arch가 **기본값**이고 구 아키텍처는 단계적 폐지 중.
- `newArchEnabled=false` 상태라 reanimated 4 등 New Arch 필수 라이브러리를 못 씀
  (GROMO-553 과목 드래그에서 draggable-flatlist 도입 실패 → PanResponder로 우회했던 원인).
- react-native-firebase도 "곧 모든 모듈 New Arch 필수" 경고 중.
- 앱이 작을 때 전환하는 게 회귀 비용 최소.

## 2. 변경 내용

### 직접 수정

| 파일                               | 변경                                                                                                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.config.js`                    | `newArchEnabled: false → true`                                                                                                                                                                                                                                             |
| `ios/Podfile.properties.json`      | `"newArchEnabled": "false" → "true"` + `"ios.buildReactNativeFromSource": "true"` 추가(firebase × 프리빌트 코어 충돌 회피 — §8 참고)                                                                                                                                       |
| `android/gradle.properties`        | `newArchEnabled=false → true` (app.config.js와 드리프트 방지용 — 안드로이드는 현재 빌드 대상 아님)                                                                                                                                                                         |
| `ios/Podfile`                      | post_install에 Pod 타겟 경고 억제(`GCC_WARN_INHIBIT_ALL_WARNINGS`+`SWIFT_SUPPRESS_WARNINGS`, 앱 타겟 경고는 유지) + 출력 미지정 스크립트 페이즈 `always_out_of_date` 표시. 앱 프로젝트 쪽 페이즈([RNFB] 등)는 integrate 단계에 재생성되므로 **post_integrate** 훅에서 처리 |
| `ios/gromo.xcodeproj`              | gromo 타겟 `OTHER_LDFLAGS`의 `-lc++` 제거 — Pods 상속 플래그와 중복돼 ld 경고 발생하던 것                                                                                                                                                                                  |
| `ios/gromo/ScreenTimeModule.swift` | iOS 26 SDK 신규 `AuthorizationStatus.approvedWithDataAccess` 케이스 → JS 계약상 "approved"로 매핑 (exhaustive 경고 해소)                                                                                                                                                   |

### pod install 부수효과 (자동 생성)

- **모든 타겟 Info.plist**(앱 + 익스텐션 6종)의 `RCTNewArchEnabled`가 `<true/>`로 — RN 런타임이 시작 시 읽는 플래그.
- **Podfile.lock**: Fabric/코드젠 파드 추가(ReactCodegen, React-Fabric, React-runtimescheduler 등),
  구 의존성(DoubleConversion·RCT-Folly·boost·glog·fmt·SocketRocket) 제거 →
  **ReactNativeDependencies / React-Core-prebuilt 프리빌트 프레임워크**로 대체
  (`newArchEnabled != 'false'`일 때 Podfile이 `RCT_USE_PREBUILT_RNCORE=1` 설정; pod install 34초, 빌드도 단축).
- **project.pbxproj**: Fabric 헤더 검색 경로, 프리빌트 React.framework 임베딩, `SWIFT_ENABLE_EXPLICIT_MODULES=NO`.

## 3. 커스텀 네이티브 모듈 호환성 조사 결과

**코드 수정 없이 인터롭 레이어로 전부 커버** — RN 0.74+는 레거시 NativeModule/ViewManager를
자동으로 TurboModule/Fabric 인터롭에 등록한다.

| 대상                                                                                       | 패턴                                                                                                                                                                 | 판정                                  |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `ScreenTimeModule.swift/.m`                                                                | `RCT_EXTERN_MODULE` + Promise 메서드만. 이벤트 이미터·bridge 접근·constantsToExport 없음. UI 표시는 `DispatchQueue.main.async` + scene 기반 top VC 탐색(브릿지 무관) | ✅ TurboModule 인터롭                 |
| `ScreenTimeReportViewManager` / `AllowedAppsListViewManager`                               | 레거시 `RCTViewManager` + `RCT_EXPORT_VIEW_PROPERTY`, JS는 `requireNativeComponent`                                                                                  | ✅ Fabric 레거시 뷰 인터롭(자동 등록) |
| `AppDelegate.swift`                                                                        | 이미 SDK 54 `ExpoReactNativeFactory` 패턴 → 플래그만 읽어 자동 전환                                                                                                  | ✅ 수정 불필요                        |
| 익스텐션 6종 (screentimereport·GromoScreenTimeMonitor·Shield\*·Widget·NotificationService) | RN 링크 안 함(순수 Swift/SwiftUI)                                                                                                                                    | ✅ 영향 없음                          |
| JS (`src/`)                                                                                | `findNodeHandle`·`UIManager`·`setNativeProps` 등 Fabric 비호환 패턴 **없음**                                                                                         | ✅                                    |

### 서드파티 네이티브 모듈

전부 SDK 54 세대 = New Arch 지원 버전: firebase 25.x, fbsdk-next 13.x, kakao 2.4.x,
google-signin 16.x, LINE(xmartlabs) 4.1(인터롭), AsyncStorage 2.2, datetimepicker 9.x,
screens 4.16(Fabric 네이티브), safe-area-context 5.6, svg 15.12, view-shot 4.x(Fabric 지원).

## 4. 빌드·검증 결과

- `pod install` ✅ (소스 빌드 전환 후 100 deps / 126 pods)
- 시뮬레이터 Debug 빌드 (iPhone 17 Pro): ✅ **BUILD SUCCEEDED, 에러 0** (2026-07-03)
- 실기기 회귀 테스트: ✅ **전 항목 통과** (2026-07-03, 오스카 — §5 체크리스트 기준 "다 잘된다" 확인)
- Xcode 경고 정리: 로그 기준 **1008줄 → 21줄** (잔여 = libtool 'no symbols' 13건·appintents 등 로그 전용 노이즈 + 익스텐션 버전 불일치 1건 — 후자는 0.1.0 버전 범프 stash가 해결 예정). Xcode 이슈 내비게이터 기준 사실상 0

## 5. 실기기 회귀 테스트 체크리스트 (오스카 수행)

New Arch는 렌더러(Fabric)·네이티브 모듈 경로(TurboModule) 전면 교체라 **전 기능 회귀 필수**.

- [ ] **로그인 4종**: 카카오 / 구글 / 애플 / LINE — 각각 로그인 → 토큰 저장 → 재기동 자동로그인
- [ ] **스크린타임**: 권한 요청(FamilyControls) / 총 사용시간 표시(DeviceActivityReport 뷰 = 인터롭 뷰) / 앱 picker 표시·선택 반영
- [ ] **집중 세션**: 시작→진행→종료 플로우, 과목 드래그 정렬(PanResponder), 친구 그리드
- [ ] **집중 실드**: 허용앱 picker/관리 시트, 실드 시작·해제, ShieldConfiguration 표시
- [ ] **Live Activity**: 세션 시작 시 잠금화면/다이나믹 아일랜드 표시, 캐릭터 스냅샷(view-shot base64), 종료 처리
- [ ] **홈/통계**: 원형 게이지·차트(svg), 사용시간 버킷 갱신
- [ ] **탭·내비게이션**: 탭 전환, 스택 push/pop, 모달(시트) — screens 4.16 Fabric 경로
- [ ] **알림**: expo-notifications 권한·수신, NotificationService 익스텐션
- [ ] **위젯**: 홈 화면 위젯 데이터 갱신 (App Group 경유)
- [ ] **상점/장착**: 아이템 목록·구매·장착 (구 디자인 화면 포함)
- [ ] **온보딩**: 신규 유저 전체 플로우 (닉네임→스크린타임 권한→목표 설정)
- [ ] Firebase Analytics 이벤트 전송 확인 (DebugView)

## 6. 롤백 플랜

문제 발견 시 아래만 되돌리고 `pod install` 재실행:

1. `app.config.js` → `newArchEnabled: false`
2. `ios/Podfile.properties.json` → `"newArchEnabled": "false"` + `ios.buildReactNativeFromSource` 키 제거
3. `android/gradle.properties` → `newArchEnabled=false`

(Info.plist·pbxproj·Podfile.lock은 pod install이 자동으로 원복)

## 7. 완료 후 가능해지는 것

- reanimated 4 + gesture-handler + draggable-flatlist 정식 도입 → 과목 드래그를 라이브러리 기반으로 업그레이드 (ticket 553 우회분 해소)
- 향후 New Arch 전용 라이브러리 사용 가능

## 8. 트러블슈팅 기록

### react-native-firebase × 프리빌트 React 코어 충돌 (빌드 에러 6건)

- **문제**: 첫 빌드에서 RNFBApp 모듈 컴파일 실패 —
  `error: include of non-modular header inside framework module 'RNFBApp.*'`
  (`#import <React/RCTConvert.h>` 등이 `-Werror=non-modular-include-in-framework-module`에 걸림)
- **원인**: `newArchEnabled=true`면 Expo Podfile이 **프리빌트 RN 코어**(`RCT_USE_PREBUILT_RNCORE=1`,
  `RCT_USE_RN_DEP=1`)를 기본 활성화. 프리빌트 코어의 React 헤더는 비모듈러 경로
  (`Pods/Headers/Public/React-Core/...`)로 제공되는데, firebase는 `ios.useFrameworks: static` 때문에
  framework 모듈로 빌드되어 비모듈러 include가 에러가 됨.
  구 아키텍처에서 문제없던 이유 = 그땐 프리빌트가 아예 안 켜져서(RN 소스 빌드) 모듈러 헤더였음.
- **해결**: `Podfile.properties.json`에 `"ios.buildReactNativeFromSource": "true"` 추가 →
  프리빌트만 끄고(RN 코어 소스 빌드, 기존과 동일 방식) New Arch는 유지.
  트레이드오프: 클린 빌드 시간이 프리빌트 대비 김(기존 수준으로 복귀일 뿐 악화는 아님).
  추후 firebase가 프리빌트 코어를 지원하면 이 키만 지우면 됨.

### 기타

- `pod install --project-directory=...`는 실패 — Podfile의 `require.resolve('expo/package.json')`가
  CWD 기준이라 **반드시 `app/ios`에서 실행**해야 함. (`cd app/ios && pod install`)
- Podfile 훅에서 `phase.input_paths`/`output_paths`는 **nil일 수 있음** — `(x || []).empty?`로 가드
  안 하면 post-install 훅이 `undefined method 'empty?' for nil`로 터짐.
- 앱 프로젝트의 `[CP-User]` 스크립트 페이즈(RNFB 등)는 **integrate 단계에서 매번 재생성** →
  post_install에서 속성을 바꿔도 사라짐. 앱 프로젝트 조작은 `post_integrate` 훅에서.
- FirebaseCore CocoaPods 배포는 2026-10 이후 신규 버전 중단 예고(SPM 전환 권고) — 당장 영향 없음, 추후 별도 티켓 감.
