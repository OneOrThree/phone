# 2026-11-16 카메라 작업 해제·iOS dSYM 누락 방지

기준 main: `7dbcc6a69b4e0020d6f168da06c1c5edda1552cf`. 수정은 로컬 작업 트리에 있으며 앱 배포와 Sentry 해결 처리는 하지 않았다.

## 오류와 수정 근거

### CATTUS-D — 카메라 작업이 끝나도 JNI 콜백에 캡처가 남는다

[CATTUS-D](https://oneorthree.sentry.io/issues/7849229323/)는 Android 2.3.25(904), SM-S931N에서 11/15 22:59 KST 발생했다. 확인한 스택은 `JFunc_void_cxx::~JFunc_void_cxx` → Worklets의 예약 작업 소멸 → `RetainingSerializable` → `cleanupRuntimeAware` → `facebook::jsi::Pointer::~Pointer`다.

설치된 VisionCameraWorklets 5.2.3의 `NativeThreadAsyncQueue::push`와 `NativeThreadDispatcher::runAsync`는 전달받은 작업을 복사해 `runOnThread`에 넘긴다. Android의 생성 코드 `JFunc_void_cxx`는 `_func()` 호출 후에도 함수를 보관한다. 따라서 끝난 작업의 JSI 캡처가 Java finalizer에서 뒤늦게 해제될 수 있다. 5.2.4 패키지와 비교했을 때도 이 두 어댑터의 구현은 같았다.

`patches/react-native-vision-camera-worklets+5.2.3.patch`는 작업을 공유 슬롯으로 이동하고 카메라 executor에서 꺼내 실행한다. 정상 종료와 예외 모두 실행 스레드에서 캡처를 해제하며, JNI가 보관한 콜백 사본에는 빈 슬롯만 남는다. 생성된 JNI 파일은 수정하지 않는다.

검증은 설치된 두 C++ 헤더를 직접 컴파일해 콜백 사본을 보관하는 플랫폼 대역에 연결했다. 수정 전에는 정상·예외 × queue·dispatcher 네 경우 모두 해제 시점/스레드 검사에 실패했고 수정 후 모두 통과했다. AddressSanitizer·UndefinedBehaviorSanitizer를 사용했다. PR Lint에도 이 검사를 추가했다.

이 검사는 **작업 캡처 해제 결함**을 재현한 것이다. Hermes/Samsung 기기의 실제 SIGSEGV를 재현한 것은 아니므로 CATTUS-D의 운영 해결이나 다른 여섯 크래시의 공통 원인까지 증명하지 않는다. [CATTUS-C](https://oneorthree.sentry.io/issues/7848961932/), [7](https://oneorthree.sentry.io/issues/7833855883/), [9](https://oneorthree.sentry.io/issues/7835746228/), [A](https://oneorthree.sentry.io/issues/7836521048/), [B](https://oneorthree.sentry.io/issues/7844043550/), [5](https://oneorthree.sentry.io/issues/7828739138/)는 새 바이너리에서 별도 확인해야 한다.

[PR #1591](https://github.com/OneOrThree/phone/pull/1591)은 모델 파일 주소 문제만 수정하고 SIGSEGV는 별도 조사로 남겼다. 최신 904에도 크래시가 있으며 해당 태그와 조사 기준 main 사이에 카메라 코드·의존성·패치 변경이 없었다. 이것이 기존 조사에서 말한 「해결 근거 없음」의 뜻이다.

### 카메라 출력 종료 — 콜백이 남고 정리 작업보다 런타임이 먼저 회수된다

VisionCamera 5.2.3의 `useFrameOutput`은 `onFrame`을 등록하지만 화면 종료·출력 교체 때 해제하지 않았다. Worklets의 사용자 지정 큐는 런타임을 약한 참조로 보관하므로 해제 작업을 추가하는 것만으로는 부족하다. 화면이 사라진 후 해당 작업이 실행되기 전에 런타임이 회수될 수 있다.

다음 세 부분을 함께 수정했다.

- `useFrameOutput`은 출력 교체·unmount 시 프레임과 dropped 콜백을 해제한다.
- `createRuntimeThreadProvider`는 예약된 콜백 등록·해제가 실행되고 RN에 완료를 돌려줄 때까지 런타임을 유지한다. 예약 실패와 실행 예외도 참조를 정리한다.
- Android `HybridFrameOutput`은 분석기 등록 시의 콜백을 계속 캡처하지 않고 실행 시점의 콜백을 읽는다. 해제 전에 이미 큐에 들어온 이미지도 현재 콜백이 없으면 닫고 반환한다.

설치된 실제 소스를 Babel/Worklets 플러그인으로 변환하고 React 렌더러·GC를 사용하는 회귀 검사를 추가했다. 수정 전 패키지는 **교체된 출력의 콜백 해제**와 **네이티브 정리 전 런타임 유지**에서 실패했고 수정 후 통과했다. 정상 종료·실행 예외·예약 예외 이후 회수까지 확인했다. 플랫폼 큐는 대역이며 실제 Android 크래시 재현과는 구분한다.

### CATTUS-8 — 토큰 없이도 배포할 수 있었고 최종 심볼 확인이 없었다

[CATTUS-8](https://oneorthree.sentry.io/issues/7835276494/)는 iPad13,18 / iOS 27.2 / 앱 2.3.4(13)에서 발생했다. Sentry가 보고한 누락 이미지와 UUID는 다음과 같다.

```text
Cattus.app/Cattus
53ca47a9-42aa-3e6f-b33c-3f30568f5b52
```

11/16 현재 업로드 보관함에서도 정확한 UUID로 조회했다. [cattus 검색](https://oneorthree.sentry.io/settings/projects/cattus/debug-symbols/?query=53ca47a9-42aa-3e6f-b33c-3f30568f5b52), [구 gromo 검색](https://oneorthree.sentry.io/settings/projects/gromo/debug-symbols/?query=53ca47a9-42aa-3e6f-b33c-3f30568f5b52) 모두 `There are no debug symbols that match your search.`였다. 과거 이벤트의 누락 표시만 보고 현재 상태를 추정한 것이 아니다.

기존 `scripts/sentry-xcode.sh`는 토큰이 없으면 경고 후 업로드를 건너뛰고 성공으로 종료한다. `SENTRY_DISABLE_AUTO_UPLOAD=true`로도 업로드를 생략할 수 있다. Fastlane은 아카이브 뒤 심볼 확인 없이 바로 TestFlight로 올렸다. 따라서 앱 업로드 성공만으로 심볼 업로드를 보장할 수 없었다.

다만 **2.3.4에서 실제로 토큰이 없었는지, 비활성화했는지, 업로드가 실패했는지는 아직 확정할 수 없다.** [2756 빌드 기록](https://romance.atlassian.net/browse/GROMO-2756?focusedCommentId=12383)은 11/05 19:09 KST TestFlight 업로드 성공만 확인한다. 같은 소스로 다시 빌드한 dSYM을 원본 대신 올려서는 안 된다.

#### 2.3.4 다운로드 재조사

App Store Connect API에서 실제 빌드 `4c3f3ea4-b193-4c03-8fe0-162f7b037351`을 조회했다. 2.3.4(13), 11/05 19:21 KST 업로드, `VALID`, `includesSymbols=true`지만 **`dSYMUrl`은 null**이었다. 심볼을 Apple에 포함해 제출한 사실과 다운로드 가능 여부는 다르다.

[Apple의 공식 안내](https://developer.apple.com/help/app-store-connect/manage-builds/view-builds-and-metadata/)의 「Download dSYM files」는 다운로드를 과거 bitcode 제출에만 제공하며 Xcode 14 이후 제출에는 제공하지 않는다고 명시한다. 따라서 로그인이나 다운로드 재시도로 해결되는 문제가 아니다.

추가 조회 결과:

- 이 Mac의 Xcode 아카이브, 워크트리, Downloads에 2.3.4 원본이 없었다. 남은 `Cattus.app.dSYM.zip` 세 개와 DerivedData의 앱 dSYM 네 개를 `dwarfdump --uuid`로 대조했지만 해당 UUID가 없었다.
- 2.3.4 소스 SHA `2a741d6b1f8e6d9752edd86820fa075ec6247a7b`의 [iOS CI 실행](https://github.com/OneOrThree/phone/actions/runs/41993978540)은 skipped다. 이 실행에서 빌드 산출물이 만들어진 것은 아니다.
- Apple TestFlight 크래시 피드백 API의 전체 4건은 6~8월 기록으로, 11월 iPad 사고는 없었다.
- Xcode GUI는 워크스페이스 열기와 읽기까지 됐지만 입력 시 `window_not_focused`가 발생했고 `--restore-window`도 실패했다. Organizer 보고서를 확인했다고 보고하지 않는다.

기존 이벤트의 정확한 함수·행을 복구하려면 해당 UUID의 원본 아카이브 또는 Apple이 해독한 동일 사고의 크래시 로그가 필요하다. **같은 소스로 재빌드해 사고를 재현하는 조사는 별도로 가능하다.** 이 경로의 실제 빌드·실행과 증거는 [2.3.4 재빌드 기록](2026-11-16-ios-2.3.4-rebuild.md)에 남겼다. dSYM 누락 방지 변경을 iPad 크래시 수정 완료라고 볼 수 없다.

수정한 배포 경로:

1. `check-release`: 토큰 존재뿐 아니라 Sentry 인증 성공을 확인한다. 비활성화 플래그가 켜져 있으면 배포를 막는다.
2. `archive <xcarchive>`: 완성된 아카이브의 앱 실행 파일과 dSYM의 UUID 전체가 일치하는지 확인한다.
3. 실제 UUID를 `sentry-cli debug-files upload --require-all --id … --wait`에 전달한다. 조직·프로젝트를 `oneorthree/cattus`로 고정하고 `SENTRY_ALLOW_FAILURE=false`를 강제한다. 확장·프레임워크 심볼도 업로드한다.
4. 인증·UUID·심볼 처리 확인이 실패하면 `upload_to_testflight`에 도달하지 않는다. 일반 Debug/로컬 빌드의 선택적 업로드는 유지한다.

실제 Mach-O/dSYM을 만든 셸 통합 검사 9개와 실제 Fastfile을 읽는 호출 순서 검사 4개를 통과했다. 네트워크와 Apple 업로드는 대역이므로 신규 아카이브의 Sentry 수신을 실제 확인한 것은 아니다. 현재 맥의 실제 Sentry 인증 읽기 검사는 통과했다.

## 검증 기록

| 검사                                                                                                           | 결과                                                        |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| C++ 작업 해제 회귀                                                                                             | 수정 전 4건 실패, 수정 후 4건 통과, ASan/UBSan              |
| 실제 React 출력 교체·종료 및 Worklets/GC 회귀                                                                  | 수정 전 실패, 수정 후 정상·예외 4개 시나리오 통과           |
| Android `:react-native-vision-camera-worklets:externalNativeBuildRelease -PreactNativeArchitectures=arm64-v8a` | 성공, 82 tasks                                              |
| Android 콜백 수정 후 Release Kotlin + 네이티브 컴파일                                                          | 성공, 109 tasks                                             |
| iOS 26.5 시뮬레이터 진단용 Release + ThreadSanitizer                                                           | 콜백 등록·해제 30회, 네이티브 호출 300,000회 완료, 경고 0건 |
| dSYM 배포 차단 통합 검사                                                                                       | 9건 통과                                                    |
| Fastlane 업로드 순서 검사                                                                                      | 4건·8 assertions 통과                                       |
| `VerificationCamera`·`VerificationSession` Jest                                                                | 2 suites·57건 통과                                          |
| 앱 lint·Prettier·typecheck                                                                                     | 통과, lint 기존 경고 1,708건·오류 0건                       |

macOS 검사 때 `DEVELOPER_DIR=/Applications/Xcode-26.6.0.app/Contents/Developer`, Xcode 26.6 / build 17F113, iOS SDK 26.5를 확인했다. iOS 네이티브 프로젝트를 Release로 빌드하고 진단 entry `scripts/tests/camera-runtime-probe.jsx`를 실행했다. 실제 서비스 화면·로그인·촬영이나 iPad iOS 27.2 사고의 재현 검사는 아니다.

진단 entry는 실제 `createRuntimeThreadProvider`로 콜백을 등록·해제한 뒤 같은 네이티브 큐의 관찰용 Worklet에서 출력을 반복 호출한다. 큐가 끝났음을 RN으로 전달하면 앱 Documents의 `sentry-repro.json`을 갱신한다. 결과는 `{"completed":30,"target":30,"nativeCallsPerRuntime":10000}`였다. 진단용 시뮬레이터에서만 Expo Updates를 끄고 해당 번들을 실행했다. Nitro 글로벌 캐시 경합 가설은 이번 실행에서 재현되지 않아 추가 수정 근거로 사용하지 않았다.

재실행 명령은 저장소 루트에서 다음과 같다. Ruby는 Fastlane과 같은 Homebrew Ruby를 쓴다.

```sh
DEVELOPER_DIR=/Applications/Xcode-26.6.0.app/Contents/Developer python3 app/app-dev/scripts/tests/test-camera-queue.py
node --expose-gc app/app-dev/scripts/tests/test-camera-lifecycle.cjs
DEVELOPER_DIR=/Applications/Xcode-26.6.0.app/Contents/Developer python3 app/app-dev/scripts/tests/test-sentry-archive.py -v
/opt/homebrew/opt/ruby/bin/ruby app/app-dev/scripts/tests/test-sentry-fastlane.rb
```

네이티브 진단 빌드는 앱 폴더의 `ios/`에서 실행한다. `ios/release-config.sh`의 공개 설정, 검사 환경과 일치하는 Firebase plist·Airbridge 설정이 필요하다. `EXPO_PUBLIC_ENV=dev`, `GROMO_IOS_AUDIENCE=dev`, `EXPO_PUBLIC_API_URL=https://oneorthree-v2.dev.mooo.com`으로 로컬 진단 빌드를 만들었으며 진단 entry는 서버 API를 호출하지 않는다.

```sh
DEVELOPER_DIR=/Applications/Xcode-26.6.0.app/Contents/Developer \
ENTRY_FILE=scripts/tests/camera-runtime-probe.jsx SENTRY_DISABLE_AUTO_UPLOAD=true \
EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN='' \
xcodebuild -workspace Cattus.xcworkspace -scheme Cattus -configuration Release \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,id=<진단용 시뮬레이터 UUID>' \
  -derivedDataPath /tmp/cattus-sentry-ios-repro -enableThreadSanitizer YES \
  CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES ARCHS=arm64 \
  HERMES_CLI_PATH="$PWD/../node_modules/hermes-compiler/hermesc/osx-bin/hermesc" build
```

## 남은 검증과 배포 영향

- 네이티브 C++ 수정이라 새 Android/iOS 바이너리가 필요하다. OTA만으로 기존 앱의 네이티브 결함을 고칠 수 없다. 두 플랫폼 runtimeVersion과 체크인된 네이티브 설정을 함께 올렸다.
- 새 Release에서 AI 측정 시작·끄기·전후면 전환·백그라운드 복귀를 반복하고, 이후 Sentry에서 **수정 빌드의** 동일 스택 재발 여부를 확인한다. 현재 기기에 대한 실행 검증 및 운영 해결 판정은 미완료다.
- CATTUS-8은 원본 dSYM으로 기존 스택을 해독하거나, [2.3.4 재빌드](2026-11-16-ios-2.3.4-rebuild.md)에서 같은 크래시를 재현해 새 dSYM으로 원인을 좁혀야 한다. dSYM 누락 방지 수정은 해당 크래시 자체의 수정이 아니다.
- 토큰 없이 동작하던 팀원의 TestFlight 빌드는 앞으로 차단된다. 배포 머신에 Cattus 업로드 권한이 있는 토큰을 환경변수 또는 `SENTRY_DOTENV_PATH`로 제공해야 한다.
