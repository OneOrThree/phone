# 측정 조건과 재실행 절차

기준 코드는 `fd2881a4f6527004ac8422ef3d3d245c78405f3e`다. 변경 후는 이 기준 위의 `arefactor/GROMO-2714-app-refactoring` 작업이다. 정적 조사 JSON의 `commit`은 조사 시점 HEAD이므로 미커밋 변경 후 자료에도 기준 SHA가 나온다. 전후 구분은 파일명으로 한다.

## 고정한 입력

- 앱: `app/app-dev`, Release, `EXPO_PUBLIC_DEMO=1`, `EXPO_PUBLIC_ENV=dev`. 서버 응답 대신 기존 `demoState()`를 쓴다. PostHog token과 Sentry DSN은 비우고 Airbridge는 DEMO 조건으로 비활성화했다. 자산 채널은 비활성 상태다. 운영 API·실제 계정·사용자 데이터로 부하를 만들지 않았다.
- lockfile SHA-256: `dd6e2591a9bf62db9cc8d6253f04b6be4586bb95ded741da2f56ea91dd88ef2d`. 전후 의존성과 네이티브 설정을 유지했다.
- Node 24.17.0, npm 11.13.0. Android는 Android Studio JBR 21.0.10, Gradle 9.3.1.
- iOS는 `DEVELOPER_DIR=/Applications/Xcode-26.6.0.app/Contents/Developer`, Xcode 26.6 / 17F113, iPhoneSimulator SDK 26.5로 빌드했다. 시스템 기본 Xcode를 사용하지 않았다.
- 전용 iPhone 17 / iOS 27.0 시뮬레이터와 전용 Android API 37 arm64 에뮬레이터를 사용했다. 실제 사고 버전인 iOS 27.0.1 런타임은 설치되어 있지 않아 이 버전 실행 검증으로 대신 표시하지 않는다. 실기기 설치는 하지 않았다.
- iOS 산출물은 서명하지 않은 arm64 Simulator `.app`, Android는 측정 전용 로컬 키로 서명한 arm64 Release APK다. 배포·스토어 다운로드 크기 측정이 아니다.

## 데이터·캐시와 판정

각 플랫폼에서 새 설치 5회와 로컬 데이터를 유지한 프로세스 재실행 5회를 분리한다. 새 설치는 전용 기기의 이 앱만 제거한 뒤 동일 산출물을 설치한다. OS 파일 캐시·셰이더 캐시까지 비운 실기기 콜드 부팅은 아니다. 재실행 묶음은 마지막 새 설치의 데이터를 유지한다.

첫 화면 시간은 launch 명령 시작부터 홈의 분홍 집중 버튼·퀘스트 종이·섬 지형·상점 지붕·고양이 초상이 함께 나타난 스크린샷까지다. 고정한 화면을 201×437로 정규화해 같은 영역·색 조건을 검사했다. `simctl`/`adb` 명령과 캡처 비용을 포함하므로 정밀한 첫 프레임 시간이나 사용자 체감 지연 그 자체가 아니다. 원시 캡처로 잘못된 화면을 판정하지 않았는지도 확인한다.

홈 확인 후 5초 기다려 메모리를 읽고 10초간 프로세스 CPU 사용 시간을 잰다. iOS는 `footprint`, Android는 `dumpsys meminfo`의 TOTAL PSS를 사용한다. 서로 다른 플랫폼의 메모리 수치는 직접 비교하지 않는다. CPU는 한 코어 100% 기준 프로세스 CPU 시간/경과 시간이다.

화면 진입은 Maestro로 홈→상점→홈→집중 자리 선택→홈→뗏목→바다를 5회 반복한다. 목표 문구가 나타날 때까지 기다린다. 상점까지 걷는 시간, 전환 연출, 자동화의 안정화 대기가 포함된다. 집중은 **자리 선택까지**이며 카메라를 사용하는 실제 집중 세션의 프레임 성능을 측정한 것은 아니다.

12분 관찰은 같은 iOS 프로세스에서 홈→상점→홈→집중 자리 선택→홈을 10회 반복한다. 각 회차 뒤 홈에서 메모리를 읽고 마지막에도 최초 PID가 살아 있는지 확인한다. 초기 이미지/장면 캐시 적재와 지속 증가를 구분해 해석한다. 짧은 관찰만으로 메모리 누수가 전혀 없다고 결론 내리지 않는다.

초기 탐색 측정은 Android와 iOS 작업이 일부 겹쳤고 버튼·종이만으로는 이미지가 아직 뜨지 않은 프레임도 완료로 판정했다. 이 묶음은 최종 첫 화면 비교에서 제외한다. 최종 측정은 위 이미지 판정을 전후 동일하게 적용하고, 다른 플랫폼 앱 프로세스를 멈춘 뒤 iOS 전→후, Android 전→후 순서로 직렬 실행한다. 빌드·전체 테스트·화면 자동화·12분 관찰은 먼저 끝낸다. 호스트는 전용 실험실이 아니므로 배경 시스템 부하까지 통제했다고 보지 않으며 시간·CPU 원값의 편차를 공개한다.

## 재실행

앱 폴더에서 `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test -- --runInBand`를 실행한다. 정적 조사는 `node scripts/audit-code-quality.cjs > quality.json`, 플랫폼 export는 같은 환경에서 `npx expo export --platform all --source-maps --output-dir <출력폴더>`로 만든다. 생성물 검사는 `assets.md`를 따른다.

iOS는 먼저 위 `DEVELOPER_DIR`에서 `xcodebuild -version`과 `xcodebuild -showsdks`를 확인한다. 기존 Pods를 사용해 `xcodebuild -workspace ios/Cattus.xcworkspace -scheme Cattus -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO -derivedDataPath <출력폴더> build`로 빌드한다. `expo prebuild`로 네이티브 프로젝트를 재생성하지 않는다. Android는 기존 서명 설정을 침범하지 않는 별도 측정 작업 사본·키에서 `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`를 사용한다.

비밀값이 없는 측정 스크립트는 `measurement/`에 있다. 외부 설치가 가능한 Python/Pillow, Xcode 도구, Android SDK, Maestro가 필요하다. 산출물 폴더의 `baseline/`와 `after/`에 각각 `Cattus.app`, `app-release.apk`를 넣고 다음처럼 실행한다.

```sh
export REFACTOR_ARTIFACTS=/절대경로/측정산출물
export REFACTOR_IOS_DEVICE=전용시뮬레이터UDID
export REFACTOR_ANDROID_DEVICE=전용에뮬레이터ID
export ADB=/AndroidSDK/platform-tools/adb
python3 measurement/measure-ios.py baseline fresh
python3 measurement/measure-ios.py baseline
python3 measurement/measure-android.py baseline fresh
python3 measurement/measure-android.py baseline
maestro --udid "$REFACTOR_IOS_DEVICE" test measurement/journeys.yaml
maestro --udid "$REFACTOR_ANDROID_DEVICE" test measurement/android-journeys.yaml
cp measurement/warm-cycle.yaml "$REFACTOR_ARTIFACTS/warm-cycle.yaml"
python3 measurement/soak-ios.py baseline
```

`after`에도 같은 절차를 적용한다. 새 설치 명령은 지정 기기에서 이 앱의 데이터를 지우므로 **측정 전용 기기만** 지정한다. `soak-ios.py`는 이미 설치된 버전을 관찰하므로 stage에 맞는 앱이 설치되어 있어야 한다. 전후 렌더 횟수는 제품 소스가 아닌 별도 테스트 사본에서 기존 테스트의 카운터를 로깅했다. 계측 파일 해시는 `measurement/render-instrumentation.json`에 있다.

원본 임시 폴더에는 개인 환경 파일·네이티브 입력이 있을 수 있어 전체를 공유하지 않는다. 이 문서 옆에 선별한 JSON·측정 스크립트·검증 결과만 보관한다.
