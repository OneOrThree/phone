# Gromo 스크린 타임 통합 개발 개고생 Work Log

## 개요

홈 화면에 실제 iOS 스크린 타임 데이터를 표시하는 기능 구현 추적 과정.

---

## 아키텍처

```
메인 앱 (gromo)
├── HomeScreen.js
│   ├── "사용" StatBox → <ScreenTimeReportView reportContext="Compact Activity" />를 직접 임베드
│   ├── "남은" StatBox → <ScreenTimeReportView reportContext="Remaining Activity" />를 직접 임베드
│   │   (iOS + 권한 승인 시. 그 외에는 goalSeconds - screenTimeSeconds 텍스트로 fallback)
│   └── goalSeconds 변경 시 setGoalSeconds()로 App Group에 기록
│       → 익스텐션이 이 값을 읽어서 "남은 = 목표 - 사용"을 내부에서 계산
├── ScreenTimeScreen.js → <ScreenTimeReportView reportContext="Total Activity" />로 전체 리포트 표시
├── ScreenTimeReportUIView.swift → SwiftUI DeviceActivityReport ↔ UIView 브릿지
│   └── reportContext prop으로 "Total Activity" | "Compact Activity" | "Remaining Activity" 선택
└── ScreenTimeModule.js / .swift → setGoalSeconds() (App Group 쓰기, "남은" 계산용)

스크린 타임 리포트 익스텐션 (screentimereport)
├── screentimereport.swift → DeviceActivityReportScene 3개 등록
├── TotalActivityReport.swift + TotalActivityView.swift → "Total Activity" (총 사용 시간 + 앱별 목록)
├── CompactActivityReport.swift + CompactActivityView.swift → "Compact Activity" (총 사용 시간 숫자만)
├── RemainingActivityReport.swift + RemainingActivityView.swift → "Remaining Activity"
│   (App Group에서 gromo:user:goalSeconds를 읽어 "목표 - 사용 = 남은" 계산, 음수면 "실패")
└── buildActivityReport() / formatDuration() → 세 리포트가 공유하는 데이터 가공 함수
    (ActivityReport에 goalSeconds 필드 포함)
```

> ⚠️ `gromo:screentime:totalDuration` App Group 저장(`buildActivityReport()` 내부)과
> `getTotalScreenTime()`/`screenTimeSeconds`는 **원인 3**에서 밝혀진 샌드박스 제약으로
> 실제로는 항상 `0`을 반환함 (익스텐션 → App Group 쓰기 차단). 현재는 Android/미승인
> 상태의 fallback 텍스트 계산용으로만 남아있는 legacy 경로.

---

## 1. Apple Developer 설정

### 1.1 App Groups 추가

- **Console**: [developer.apple.com](https://developer.apple.com)
- **경로**: Certificates, Identifiers & Profiles → Identifiers → App Groups → [+]
- **설정**:
  - Description: `gromo shared`
  - Identifier: `group.com.oneorthree.gromo`

### 1.2 두 App ID에 App Groups 연결

1. `com.oneorthree.gromo` App ID → Edit → App Groups 체크 → 위의 그룹 선택
2. `com.oneorthree.gromo.screentimereport` App ID → 동일하게

### 1.3 Provisioning Profile 재발급

1. **Profiles** → 각 프로파일 Edit → Save (재생성) → Download
2. Xcode에 import하거나 자동 갱신

---

## 2. 코드 변경 사항

### 2.1 Entitlements 파일 (2개)

**`gromo.entitlements`** 및 **`screentimereport.entitlements`**:

```xml
<key>com.apple.security.application-groups</key>
<array>
    <string>group.com.oneorthree.gromo</string>
</array>
```

### 2.2 Native 모듈 (Swift/Objective-C)

**`ScreenTimeModule.swift`**: `getTotalScreenTime()` 메서드 추가

```swift
@objc func getTotalScreenTime(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
) {
    let sharedDefaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
    let totalDuration = sharedDefaults?.double(forKey: "gromo:screentime:totalDuration") ?? 0
    resolve(totalDuration)
}
```

**`ScreenTimeModule.m`**: RCT_EXTERN_METHOD 등록

```objc
RCT_EXTERN_METHOD(
    getTotalScreenTime:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    setGoalSeconds:(double)seconds
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)
```

**`ScreenTimeModule.swift`**: `setGoalSeconds()` 메서드 추가 — 목표 시간을 App Group에 저장
(메인 앱 → App Group 쓰기는 샌드박스 제약이 없어 정상 동작)

```swift
@objc func setGoalSeconds(
    _ seconds: Double,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
) {
    let sharedDefaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
    sharedDefaults?.set(seconds, forKey: "gromo:user:goalSeconds")
    resolve(nil)
}
```

**`TotalActivityReport.swift`**: App Group에 데이터 저장

```swift
let sharedDefaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
sharedDefaults?.set(totalDuration, forKey: "gromo:screentime:totalDuration")
sharedDefaults?.set(Date(), forKey: "gromo:screentime:lastUpdated")
```

**`ScreenTimeReportUIView.swift`**: `reportContext` prop으로 렌더링할 Context 결정

```swift
@objc var reportContext: String = "Total Activity"
...
let reportView = DeviceActivityReport(.init(reportContext), filter: filter)
```

**`ScreenTimeReportViewManager.m`**: `reportContext` prop을 RN에 export

```objc
RCT_EXPORT_VIEW_PROPERTY(reportContext, NSString)
```

**익스텐션(`screentimereport`) — Context별 리포트 분리**

- `TotalActivityReport.swift` / `TotalActivityView.swift` → Context `"Total Activity"`:
  총 사용 시간 + 앱별 목록 (ScreenTimeScreen 전용)
- `CompactActivityReport.swift` / `CompactActivityView.swift` → Context `"Compact Activity"`:
  총 사용 시간 숫자만 (HomeScreen "사용" StatBox 전용)
- `RemainingActivityReport.swift` / `RemainingActivityView.swift` → Context `"Remaining Activity"`:
  "목표 - 사용 = 남은" (HomeScreen "남은" StatBox 전용)
  - App Group에서 `gromo:user:goalSeconds`를 읽어 `totalDuration`과 함께 계산
  - `goalSeconds < 0`(못 읽음) → `"-"`, 결과가 음수면 `"실패"`(빨간색), 그 외 `formatDuration(remaining)`
- `buildActivityReport()` / `formatDuration()`은 `TotalActivityReport.swift`에 top-level
  함수로 두고 세 리포트가 공유
- `ActivityReport` 구조체에 `goalSeconds: TimeInterval` 필드 추가 — `buildActivityReport()`가
  App Group에서 읽은 값을 채워서 반환 (모든 `ActivityReport(...)` 생성 시 필수 인자)
- `screentimereport.swift`의 `body`에 세 scene을 모두 등록:
  ```swift
  var body: some DeviceActivityReportScene {
      TotalActivityReport { TotalActivityView(totalActivity: $0) }
      CompactActivityReport { CompactActivityView(totalActivity: $0) }
      RemainingActivityReport { RemainingActivityView(totalActivity: $0) }
  }
  ```
- ⚠️ 새 Context 파일에는 반드시 `import ExtensionKit`을 포함해야 함 — 없으면
  `DeviceActivityReportScene`이 상속하는 `AppExtensionScene` conformance 에러 발생
- 💡 `ios/screentimereport/`는 Xcode의 **file system synchronized group**이라 새 `.swift`
  파일을 폴더에 추가만 하면 자동으로 빌드 타겟에 포함됨 (project.pbxproj 수동 수정 불필요)

### 2.3 JavaScript

**`ScreenTimeModule.js`**: `getTotalScreenTime()` / `setGoalSeconds()` 래퍼 추가

```js
getTotalScreenTime: async () => {
  if (Platform.OS !== 'ios') return 0;
  return NativeScreenTimeModule.getTotalScreenTime();
},
setGoalSeconds: async (seconds) => {
  if (Platform.OS !== 'ios') return;
  return NativeScreenTimeModule.setGoalSeconds(seconds);
}
```

**`Homescreen.js`**:

- Import: `ScreenTimeModule`, `ScreenTimeReportView`
- State: `screenTimeSeconds` (useEffect로 30초마다 `getTotalScreenTime()` 호출 —
  현재는 Android/미승인 fallback 텍스트 계산용으로만 사용, 항상 `0`)
- `goalSeconds` 변경 시 `ScreenTimeModule.setGoalSeconds(goalSeconds)` 호출 →
  App Group(`gromo:user:goalSeconds`)에 기록
- `StatBox`에 `valueComponent` prop 추가 — 있으면 기본 `<Text>` 대신 커스텀 컴포넌트 렌더링
- "사용" StatBox: `<ScreenTimeReportView reportContext="Compact Activity" style={s.statValueReport} />`를
  직접 임베드 (SwiftUI 뷰가 화면에 실제로 보여야 익스텐션 scene이 활성 상태로 유지되고
  `makeConfiguration`이 호출됨)
- "남은" StatBox: iOS + 권한 승인 시 `<ScreenTimeReportView reportContext="Remaining Activity" style={s.statValueReport} />`
  직접 임베드 (익스텐션 내부에서 `goalSeconds - totalDuration` 계산). 그 외(Android, 미승인)는
  `goalSeconds - screenTimeSeconds` 텍스트로 fallback
- (이전 버전의 화면 밖 숨겨진 트리거 뷰는 제거됨 — 비가시 영역의 DeviceActivityReport는
  scene이 Background로 전환되어 `makeConfiguration`이 호출되지 않았음)

**`ScreenTimeScreen.js`**:

- 마이페이지 → 스크린 타임 화면 진입 (탭바 숨김 화면)
- 좌상단 "← 뒤로" 버튼으로 `navigation.goBack()` → 마이페이지 복귀
- 권한 허용 시 `<ScreenTimeReportView style={{ flex: 1 }} />`로 실제 리포트 전체화면 표시

---

## 3. 개발 환경 설정

### 3.1 로컬 IP 확인

```bash
ifconfig | grep inet
# 결과: 172.16.102.49 같은 형태
```

### 3.2 .env 파일

```
EXPO_PUBLIC_API_URL=http://172.16.102.49:8080
REACT_NATIVE_PACKAGER_HOSTNAME=172.16.102.49
```

---

## 4. 개발 서버 실행

### 4.1 백엔드 서버

```bash
# 별도 프로세스에서 실행
python manage.py runserver 0.0.0.0:8000
# 또는 포트 8080에서
```

### 4.2 Metro 번들러

```bash
cd /Users/Ahn/Desktop/Gromo/app
npm start
# 또는
expo start
```

출력에서 Metro 상태 확인:

```
› Metro waiting on exp://172.16.102.49:8081
```

---

## 5. 빌드 & 테스트

### 5.1 iOS 시뮬레이터 (간단함)

```bash
cd app
npx expo run:ios
```

### 5.2 실기기 (p12 인증서 사용)

**전제조건**:

- `npm start` 실행 중 (Metro 띄움)
- iPhone과 Mac이 같은 Wi-Fi 연결
- USB로 기기 연결

**방법**:

1. Xcode 열기: `open ios/gromo.xcworkspace`
2. 좌상단 Device 선택 → 자신의 iPhone 선택
3. Product → Run (Cmd+R)

**Xcode 안에서 명시적으로 Metro URL 설정**:

1. Product → Scheme → Edit Scheme
2. Run 탭 → Pre-actions
3. `+` 버튼 → New Run Script Action
4. Script:

```bash
export RCT_METRO_HOST=172.16.102.49:8081
```

### 5.3 트러블슈팅

#### "No script URL provided" 에러

**원인**: 실기기가 Metro 번들러를 못 찾음

**해결**:

1. Metro 터미널에 "Metro waiting on..." 메시지가 있는지 확인
2. iPhone Wi-Fi: Settings > Wi-Fi → Mac과 같은 네트워크인지 확인
3. 방화벽: Mac 포트 8081 열려있는지 확인
   ```bash
   lsof -i :8081
   ```

#### Metro 포트 충돌

```bash
# 기존 프로세스 죽이기
pkill -f "expo start"
pkill -f "metro"
```

#### 네트워크 재설정

```bash
cd app
npm start --clear  # Metro 캐시 초기화
```

#### 스크린 타임 데이터가 안 보임 (트러블슈팅 히스토리)

증상에 따라 원인이 다르므로, **어느 화면에서 안 보이는지**부터 구분한다.

| 증상                                    | 의미                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| ScreenTimeScreen에서도 0분/빈 화면      | Extension 자체가 동작 안 함 (권한/빌드 설정 문제)                    |
| ScreenTimeScreen은 정상, HomeScreen만 0 | Extension은 동작하지만 HomeScreen의 "숨겨진 뷰"가 익스텐션을 못 깨움 |

##### ✅ (해결됨) 원인 1: Extension 배포 타겟 불일치

- **증상**: ScreenTimeScreen에서도 데이터가 안 뜸. `getTotalScreenTime()`이 항상
  `duration: 0.0, lastUpdated: nil`
- **원인**: `ios/gromo.xcodeproj/project.pbxproj`에서 `screentimereport` 익스텐션 타겟의
  `IPHONEOS_DEPLOYMENT_TARGET`이 `26.5`로 설정되어 있었음 (메인 앱은 `15.1`).
  테스트 기기의 iOS 버전이 그보다 낮아서 익스텐션이 기기에 설치/실행될 수 없었음.
- **해결**: `screentimereport` 타겟의 Debug/Release `IPHONEOS_DEPLOYMENT_TARGET`을
  `16.0`으로 변경 (FamilyControls/DeviceActivity의 최소 요구 버전)
- **추가로 필요한 절차**: FamilyControls 권한 허용 후 **앱을 완전히 종료하고 재시작**해야
  익스텐션이 정상 인식됨 (권한 변경만으로는 부족)
- **결과**: ScreenTimeScreen에서 실제 스크린 타임 데이터 정상 표시 확인됨

##### ✅ (해결됨) 원인 2: HomeScreen의 숨겨진 뷰에서 scene이 활성화되지 않음

- **증상**: ScreenTimeScreen은 정상인데, HomeScreen의 "사용" StatBox는
  계속 `getTotalScreenTime()` → `duration: 0.0, lastUpdated: nil`
- **확인 방법**: Console.app으로 `screentimereport` 익스텐션 프로세스 로그 확인
  (아래 "Console.app으로 익스텐션 로그 보기" 참고)
- **1차 시도 — VC containment 복원**:
  - 발견: `TotalActivityReport.swift`의 `makeConfiguration()`에 추가한 진단 print가
    **전혀 호출되지 않음** (Console.app에 한 번도 안 찍힘)
  - 대신 `DeviceActivityReportService`의 호스팅 scene이 생성되자마자
    `Removing parent scene` / `Parent scene invalidated` /
    `scene content state changed: notReady` / `Unregistering scene`으로 무효화됨
  - 원인: 커밋 `085528b`에서 `UIHostingController`를 `addChild`/`didMove(toParent:)` 없이
    단순 `addSubview`만 하도록 변경 → parent VC가 없어 scene이 즉시 invalidate
  - 조치: `ScreenTimeReportUIView.swift`에서 UIResponder 체인으로 찾은 실제 화면 VC를
    parent로 `addChild` + `didMove(toParent:)` 복원
  - 결과: scene 즉시 파괴/크래시는 해소됐지만, scene이 "Background"/"notReady" 상태로
    전환되며 `makeConfiguration`은 여전히 호출 안 됨
    (HomeScreen의 트리거 뷰가 `top: -1000`으로 화면 밖에 있어 **실제로는 안 보이는** 상태였음)
- **최종 해결 — 아키텍처 변경 (비가시 트리거 → 가시 임베드)**:
  - "비가시 영역의 DeviceActivityReport는 scene이 활성화되지 않는다"는 패턴이 반복
    확인되어, **HomeScreen "사용" StatBox 자체를 실제로 화면에 보이는
    `DeviceActivityReport`(Compact Activity)로 교체**
  - `ScreenTimeReportUIView.swift`에 `reportContext` prop을 추가해 Context를
    "Total Activity"(ScreenTimeScreen) / "Compact Activity"(HomeScreen)로 분리
  - 익스텐션에 `CompactActivityReport`/`CompactActivityView` 신규 추가 (총 사용 시간
    숫자만 표시, `TotalActivityReport`와 `buildActivityReport`/`formatDuration` 공유)
  - HomeScreen의 화면 밖 숨겨진 트리거 뷰 제거
  - **결과**: "사용" 칸에 실제 스크린 타임이 표시되고, App Group의 `totalDuration`이
    갱신되어 "남은" 칸도 정상 계산됨 (실기기 확인 완료)

##### ✅ (해결됨) 원인 3: "남은" 칸 - DeviceActivityReportExtension의 App Group 쓰기가 OS 샌드박스에서 차단됨

- **증상**: "사용" 칸(Compact Activity)은 정상 표시되는데 `getTotalScreenTime()`은
  항상 `0`. 디버그 print 결과: `sharedDefaults nil?: false`, `keys: []`, `totalDuration: 0.0`
  → App Group 접근 자체는 되지만 익스텐션이 쓴 키가 비어있음
- **Console.app 로그** (`screentimereport` 프로세스):

  ```
  cfprefsd rejecting write of key(s) <private> in { group.com.oneorthree.gromo, ... }
  from process ... (screentimereport) because setting preferences outside an
  application's container requires user-preference-write or file-write-data sandbox access

  kernel Sandbox: screentimereport(...) deny(1) file-write-data
  /private/var/mobile/Containers/Shared/AppGroup/<UUID>/Library/Preferences/group.com.oneorthree.gromo.plist
  ```

- **원인**: entitlements/provisioning profile 모두 정상(App Groups 포함, codesign 확인됨)이지만
  `DeviceActivityReportExtension`은 Apple이 의도적으로 App Group 공유 저장소에 대한
  **쓰기를 OS 샌드박스 레벨(`cfprefsd`/kernel)에서 차단**함. 프라이버시 설계상의 구조적
  제약으로, 코드/엔타이틀먼트/프로비저닝 설정으로는 해결 불가
- **시도해본 것 (모두 동일 증상 재현)**:
  - 앱 완전 삭제 → Clean Build Folder → 재빌드/재설치
  - 권한 재허용 + 앱 재시작 (다른 AppGroup 컨테이너 UUID로도 동일하게 deny)
- **최종 해결 — 반대 방향(메인 앱 → 익스텐션)으로 데이터 전달**:
  - 메인 앱의 App Group **쓰기는 샌드박스 제약이 없음** → `goalSeconds`를 메인 앱이
    `setGoalSeconds()`로 App Group(`gromo:user:goalSeconds`)에 쓰고, 익스텐션이
    `buildActivityReport()`에서 그 값을 **읽어서** `totalDuration`과 함께
    "남은 = goalSeconds - totalDuration"을 익스텐션 내부에서 계산
  - **검증**: `CompactActivityView`에 `goalSeconds` 값을 임시로 화면에 표시 →
    실기기에서 목표 시간(8시간15분 = `29700`초)이 정확히 표시됨 →
    **익스텐션이 메인 앱이 App Group에 쓴 값을 읽을 수 있음을 확인**
    (쓰기만 막혀있고 읽기는 정상 — Report Extension은 App Group에 대해 read-only)
  - **구현**: `RemainingActivityReport`/`RemainingActivityView` 신규 추가, "남은" StatBox에
    `<ScreenTimeReportView reportContext="Remaining Activity" />` 임베드
  - **결과**: "남은" 칸에 `목표 - 사용` 값이 정상 표시됨 (실기기 확인 완료)

##### Console.app으로 익스텐션 프로세스 로그 보기

`screentimereport`는 `.appex` 익스텐션으로 **메인 앱과 별도 프로세스**로 실행되기 때문에
**Xcode 콘솔에는 안 찍힘**. Mac의 Console.app으로 확인해야 함:

1. Spotlight(`Cmd+Space`) → "Console" 실행
2. 좌측 사이드바에서 연결된 iPhone 선택
3. 검색창에 `screentimereport` 입력 (필터링)
4. 기기에서 동작 재현 후 실시간 로그 확인
   - `print()` 로그, `DeviceActivityReportService` scene 생명주기 로그 등이 표시됨

##### 그 외 일반적인 원인 (참고용)

| 원인                            | 확인 방법                                                                                 | 해결                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| FamilyControls 권한 없음        | Console.app에 익스텐션 로그 자체가 없음                                                   | HomeScreen/ScreenTimeScreen에서 `ScreenTimeModule.requestAuthorization()` 호출 |
| Extension이 번들에 포함 안 됨   | Xcode > gromo 타겟 > Build Phases > Copy Bundle Resources에 `screentimereport.appex` 없음 | Xcode에서 screentimereport 타겟을 Embedded Content에 추가                      |
| App Groups 권한이 인증서에 없음 | Apple Developer Console의 provisioning profile이 App Groups 미포함                        | Apple Developer에서 provisioning profile 재발급                                |
| Bundle ID 불일치                | 앱 실제 Bundle ID ≠ entitlements의 `group.com.oneorthree.gromo`                           | Xcode에서 Bundle ID 재확인 및 맞춤                                             |

---

## 6. 배포 (프로덕션)

### 6.1 Embedded JS Bundle

```bash
cd app
npm run build  # 또는 eas build
```

---

## 7. 핵심 파일 목록

| 파일                                                 | 역할                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ios/gromo/gromo.entitlements`                       | App Groups 권한                                                                                                           |
| `ios/screentimereport/screentimereport.entitlements` | App Groups 권한                                                                                                           |
| `ios/gromo/ScreenTimeModule.swift`                   | 네이티브 모듈 (`getTotalScreenTime()`, `setGoalSeconds()`)                                                                |
| `ios/gromo/ScreenTimeModule.m`                       | 모듈 등록                                                                                                                 |
| `ios/gromo/ScreenTimeReportUIView.swift`             | SwiftUI `DeviceActivityReport` → UIView 브릿지, `reportContext` prop으로 Context 선택                                     |
| `ios/gromo/ScreenTimeReportViewManager.swift` / `.m` | RN ViewManager 등록, `reportContext` prop export                                                                          |
| `ios/screentimereport/screentimereport.swift`        | 익스텐션 진입점, `TotalActivityReport`/`CompactActivityReport`/`RemainingActivityReport` scene 등록                       |
| `ios/screentimereport/TotalActivityReport.swift`     | Context "Total Activity" + 공유 함수(`buildActivityReport`, `formatDuration`), `ActivityReport`에 `goalSeconds` 필드 포함 |
| `ios/screentimereport/TotalActivityView.swift`       | "Total Activity" 화면 (총 사용 시간 + 앱별 목록)                                                                          |
| `ios/screentimereport/CompactActivityReport.swift`   | Context "Compact Activity"                                                                                                |
| `ios/screentimereport/CompactActivityView.swift`     | "Compact Activity" 화면 (총 사용 시간 숫자만)                                                                             |
| `ios/screentimereport/RemainingActivityReport.swift` | Context "Remaining Activity"                                                                                              |
| `ios/screentimereport/RemainingActivityView.swift`   | "Remaining Activity" 화면 (목표 - 사용 = 남은 시간, 실패 시 "실패")                                                       |
| `utils/ScreenTimeModule.js`                          | JS 래퍼 (`getTotalScreenTime()`, `setGoalSeconds()`)                                                                      |
| `components/ScreenTimeReportView.js`                 | RN 네이티브 컴포넌트 래퍼, `reportContext` prop                                                                           |
| `screens/Homescreen.js`                              | "사용" StatBox에 Compact Activity, "남은" StatBox에 Remaining Activity 뷰 임베드                                          |
| `screens/ScreenTimeScreen.js`                        | Total Activity 전체 리포트 화면                                                                                           |
| `.env`                                               | 개발 설정                                                                                                                 |

---

## 8. 체크리스트

개발 시작 전 확인:

- [ ] Apple Developer에서 App Groups 생성
- [ ] 두 App ID에 App Groups 연결
- [ ] Provisioning Profile 재발급 및 Xcode import
- [ ] .env 파일에 로컬 IP 설정
- [ ] 백엔드 서버 실행 (포트 8000/8080)
- [ ] Metro 번들러 실행 (`npm start`)
- [ ] iPhone과 Mac이 같은 Wi-Fi 연결
- [ ] Xcode에서 실기기 선택 후 빌드

---

## 9. 유용한 명령어

```bash
# 캐시 초기화 후 시작
cd app && npm start --clear

# 포트 확인
lsof -i :8081

# 프로세스 죽이기
pkill -f "expo start"

# Xcode 열기
open ios/gromo.xcworkspace

# Pod 재설치 (필요시)
cd ios && pod install --repo-update && cd ..
```

---

## 10. 참고 링크

- [Apple DeviceActivityReport](https://developer.apple.com/documentation/deviceactivity)
- [React Native Native Modules](https://reactnative.dev/docs/native-modules-ios)
- [App Groups (iOS)](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_application-groups)

---

**최종 업데이트**: 2026-06-17
→ 보상 모듈 개발은 [ScreenTime2_WorkLog.md](./ScreenTime2_WorkLog.md) 참고

### 11.1 현재 아키텍처

```
[자정 23:59] DeviceActivityMonitorExtension.intervalDidEnd()
  → goalExceededToday 플래그 읽기
  → App Group에 "success"/"fail" + 날짜 저장
  → goalExceededToday 초기화

[다음날 앱 실행] HomeScreen.js
  → ScreenTimeModule.getYesterdayResult() 호출
  → App Group에서 lastResult + lastResultDate 읽기
  → "success"면 코인 지급 + 성공 모달
  → "fail"이면 실패 모달
```

`goalExceededToday`는 `eventDidReachThreshold`가 발화할 때 true로 세팅됨.

---

### 11.2 버그: 실패했는데 성공 보상이 지급됨

**증상**: 홈 화면 "남은" 칸에 "달성 실패"가 표시되는데 보상 모달은 "목표 달성!"이 뜸

**근본 원인 1 — `eventDidReachThreshold` 미발화:**

`startGoalMonitoring()`에서 `DeviceActivityEvent`를 이렇게 생성하고 있음:

```swift
DeviceActivityEvent(
    applications: [],   // 빈 배열
    categories: [],     // 빈 배열
    webDomains: [],     // 빈 배열
    threshold: threshold
)
```

Apple 문서상 `applications: []` + `categories: []` + `webDomains: []`이면 **모니터링할 대상이 없으므로 threshold 이벤트가 절대 발화하지 않음**.
→ `goalExceededToday`는 항상 false → `intervalDidEnd`에서 항상 "success" 기록

**근본 원인 2 — `totalDuration` 백업도 항상 0:**

`intervalDidEnd` 보완책으로 `gromo:screentime:totalDuration` vs `goalSeconds` 직접 비교를 추가했으나, 원인 3(아래)에서 확인된 것처럼 Report 익스텐션은 App Group에 쓰기가 차단되어 있어 이 값은 **항상 0**임. 결국 두 판정 경로 모두 항상 "success"를 반환.

---

### 11.3 구조적 제약 정리

| 익스텐션 종류                                             | App Group 읽기 | App Group 쓰기                    | 스크린타임 수치 접근                                 |
| --------------------------------------------------------- | -------------- | --------------------------------- | ---------------------------------------------------- |
| `DeviceActivityReportExtension` (screentimereport)        | ✅ 가능        | ❌ OS 샌드박스 차단 (원인 3 참고) | ✅ makeConfiguration에서 접근 가능                   |
| `DeviceActivityMonitorExtension` (GromoScreenTimeMonitor) | ✅ 가능        | ✅ 가능                           | ❌ threshold 이벤트 콜백만 받음, 수치 직접 조회 불가 |
| 메인 앱 (gromo)                                           | ✅ 가능        | ✅ 가능                           | ❌ DeviceActivity 직접 조회 불가                     |

**딜레마**: 수치를 아는 쪽(Report 익스텐션)은 쓰기 불가, 쓸 수 있는 쪽(Monitor 익스텐션)은 수치를 모름.

---

### 11.4 검토한 대안들

**Option A: DeviceActivityReport를 어제 날짜 구간으로 렌더링** → ❌ 불가

- 비가시 영역 DeviceActivityReport는 `makeConfiguration`이 호출 안 됨 (원인 2 참고)
- Report 익스텐션이 계산한 결과를 App Group에 저장 불가 (원인 3)

**Option B: FileManager로 App Group 컨테이너에 파일 쓰기** → 🔲 미검증

- 원인 3의 sandbox 차단은 `cfprefsd` (UserDefaults/plist) 경로에 대한 것
- `containerURL(forSecurityApplicationGroupIdentifier:)/Documents/` 경로에 JSON 파일 직접 쓰기는 다른 커널 규칙을 적용받을 가능성 있음
- App Group 엔타이틀먼트가 shared container 전체에 대한 read/write를 부여하는지 여부가 관건
- **실기기에서 테스트 필요**

**Option C: `DeviceActivityEvent`에 전체 앱 토큰 전달** → ❌ 비현실적

- 앱 토큰은 `FamilyActivityPicker` UI를 통해 사용자가 직접 선택해야 발급됨
- "전체 앱"에 해당하는 토큰 집합을 프로그래밍 방식으로 얻는 공개 API 없음

---

### 11.5 다음 할 일: FileManager 접근법 테스트

Report 익스텐션의 `buildActivityReport`에서 UserDefaults 대신 FileManager로 날짜별 JSON 파일 쓰기를 시도:

```swift
// 예시 — 실기기 테스트 필요
let containerURL = FileManager.default
    .containerURL(forSecurityApplicationGroupIdentifier: "group.com.oneorthree.gromo")
let fileURL = containerURL?.appendingPathComponent("screentime-2026-06-16.json")
try? JSONEncoder().encode(["totalDuration": totalDuration]).write(to: fileURL!)
```

**성공 시**: 날짜별 파일로 사용량 저장 → Monitor 익스텐션은 `intervalDidEnd`에서 goalSeconds만 저장 → 메인 앱이 둘을 읽어 비교

**실패 시 (FileManager도 차단)**: DeviceActivity API로는 보상 판정이 구조적으로 불가능. 별도의 스크린타임 추적 방식(서버 연동, 별도 사용 추적 등) 검토 필요.

---
