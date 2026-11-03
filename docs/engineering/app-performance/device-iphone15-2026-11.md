# iPhone 15 실기기 성능 측정 — 홈 움직임·집중·AI집중측정 (GROMO-2735)

[2.0 앱 성능 측정](measurements.md)은 시뮬레이터 숫자만 있고 실기기 프레임·CPU 는 남은 일이었다. 2026-11-03 iPhone 15 에
Release 빌드를 올려 Xcode Instruments 로 쟀고, 같은 날 밤 개선 전후를 다시 쟀다(§3). 대상은 세 가지다.

- 홈 안 움직임: 가만히 · 고양이 걷기 · 지도 끌기 · 손가락 확대
- 낚시섬 집중: AI집중측정 끔 · 켬 · 켬 + 미리보기 열림
- 집중 전 카메라 미리보기(AI집중측정이 0.3초마다 판정)

배터리 소모량은 재지 않았다(§6). 숫자는 모두 **앱 프로세스 CPU**(코어 하나를 꽉 채우면 100%)와 화면 갱신·끊김이다.

## 1. 결과 요약

### 홈 (빌드 `239efc3f4`, 45초 조작, 중앙값)

| 장면 | 횟수 | 앱 CPU | 메인 스레드 | JS 스레드 | 화면 갱신 | 끊김 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 가만히 | 5 | 8.8% (8.6~8.9) | 4.4% | 1.8% | 14 fps (11.6~18.1) | 0 ms/s (0~0.78) |
| 걷기 | 5 | 20.6% (18.6~21.5) | 10.8% | 6.0% | 40 fps (36.9~42.2) | 0.4 ms/s (0~1.16) |
| 지도 끌기 | 3 | 38.3% (37.3~39.0) | 19.5% | 13.7% | 27 fps (25.8~27.2) | 1.2 ms/s (0.77~1.55) |
| 손가락 확대(사람) | 1 | 24.8% | — | — | 43 fps | 2.0 ms/s |

- 화면 갱신(fps)은 앱이 새 화면을 내보낸 횟수다. 움직이는 것이 적으면 낮은 게 정상이라 «가만히 14 fps» 는 문제가 아니다.
- 끊김은 1초당 늦게 나온 화면 시간의 합(Hitches)이다. 모든 장면이 5 ms/s 아래라 사람 눈에 띄는 끊김은 없었다.
- 지도 끌기는 손가락이 계속 움직이는데도 27 fps 라 개선 후보다(티켓 없음, §7).

### 낚시섬 집중·AI집중측정 (빌드 `239efc3f4`, 60초)

| 장면 | 횟수 | 앱 CPU | 메인 스레드 | 이름 없는 스레드 | 발열 상태 |
| --- | ---: | ---: | ---: | ---: | --- |
| 집중 · AI 끔 | 1 | 37.9% | 32.1% | 2.5% | Nominal |
| 집중 · AI 켬 · 미리보기 닫힘 | 1 | 37.0% | 28.5% | 5.4% | Fair |
| 집중 · AI 켬 · 미리보기 열림 | 2 | 39.2% · 42.3% | 29.5% · 32.2% | 6.8% · 7.1% | Nominal · Fair |
| 집중 전 미리보기(0.3초마다 판정) | 1 (+20초 시험 1) | 75.0% (시험 63.1%) | 0.6% | 73.2% | Fair |

- 집중 중 AI집중측정(20초마다 3장)이 더하는 CPU 는 약 3%p 다. 비싼 것은 AI 가 아니라 집중 화면 자체(§2.1)와 집중 전 미리보기(§2.2)다.
- 이름 없는 스레드는 카메라 프레임 처리·모델 추론이 도는 곳이다(Time Profiler 에 프로세스 이름 `cattus` 로 묶여 나온다).
- 발열 상태는 iOS 의 4단계(Nominal · Fair · Serious · Critical)다. 미리보기 60초 뒤 Fair 로 올라 이어진 측정에도 남았다.

## 2. 원인

Time Profiler 의 호출 경로에서 해당 스레드 시간을 가장 많이 쓴 함수를 봤다(포함 시간).

### 2.1 집중 화면 메인 스레드 32% — 찌 주변 반짝임·물결 고리의 테두리 그림 (GROMO-2736)

| 함수 | 메인 스레드 중 |
| --- | ---: |
| `-[RCTNativeAnimatedNodesManager stepAnimations:]` | 88.2% |
| `-[RCTViewComponentView invalidateLayer]` | 58.5% |
| `RCTAddContourEffectToLayer` | 56.0% |
| `RCTGetBorderImage` | 53.0% |

iOS React Native 는 테두리를 두 가지로 그린다. 네 변의 두께·색·모서리가 같고 뷰가 안쪽을 잘라낼 때(`overflow: 'hidden'`)만
Core Animation 테두리(`CALayer.borderWidth`)를 쓰고, 나머지는 테두리를 그림으로 만들어 붙인다
(`RCTViewComponentView.mm` 의 `useCoreAnimationBorderRendering`). 그림 테두리는 뷰 속성이 바뀔 때마다 다시 만든다.
네이티브 드라이버가 opacity·크기를 프레임마다 바꾸는 뷰라면 프레임마다 그림을 다시 만든다.

`FishingFloatMotion`(`app/app-dev/src/screens/focus/FishingSceneMotion.tsx`)에 이런 뷰가 두 종류 있었다.

- 물빛 반짝임 6개: 윗변에만 테두리(`borderTopWidth`)를 줬다. 네 변이 같지 않다.
- 물결 고리 3개: 네 변이 같은 테두리지만 안쪽을 잘라내지 않는다.

AI 를 꺼도 집중 중 CPU 가 홈 대기의 4배였던 이유다. 집중은 몇 시간씩 이어지므로 배터리 영향이 가장 크다.
처음에는 반짝임만 원인으로 보고 고쳤는데, 다시 재 보니 메인 스레드의 33%가 아직 `RCTGetBorderImage` 였다. 그래서 고리를 찾았다(§3).

### 2.2 집중 전 미리보기 75% — 카메라 프레임 스레드의 JS 실행 (GROMO-2737)

| 함수·라이브러리 | 이름 없는 스레드 중 |
| --- | ---: |
| 맨 끝 함수가 `hermesvm`(JS 실행) | 85.3% |
| 맨 끝 함수가 `Cattus` 실행 파일(TFLite 등) | 12.1% |
| `HybridCameraFrameOutput.setOnFrameCallback` → 워클릿 JS 호출 | 97.9% |

`VerificationCamera`(`app/app-dev/src/screens/focus/VerificationCamera.tsx`)의 프레임 워클릿이 판정(0.3초마다)마다
JS 로 도는 일은 두 가지가 크다. Time Profiler 는 Hermes 안의 JS 함수 이름을 보여 주지 않아, 아래는 반복 횟수로 본 추정이다.

- 손 모델 입력 변환(`rgbToFloat`): 리사이저가 uint8 로 내보낸 192×192×3 = 110,592개 값을 0~1 실수로 바꿨다.
  처음에는 이것을 원인으로 보고 고쳤으나(리사이저가 GPU 에서 float32 0.0~1.0 으로 바로 내보내게 함), 다시 재도 CPU 가
  그대로였다(§3).
- 물체 모델 결과 검사(`studyObjectScores`, `app/app-dev/src/services/studyVerification/studyObjects.ts`): EfficientDet-Lite0
  출력 19,206 위치 × 90 종류 = 1,728,540개 값을 하나씩 정상 확률인지 검사한다. 판정에 쓰는 것은 그중 3종류(노트북·키보드·책)다.
  반복 횟수가 손 모델 변환의 약 16배라 지금 가장 유력한 원인이다.

미리보기는 집중 시작 전에 잠깐 켜는 화면이고, 집중 중 AI집중측정(20초마다 3장)이 더하는 CPU 는 약 3%p 다. 그래서 물체 결과 검사는
고치지 않고 후보로만 남긴다(§7).

## 3. 개선 전후 (GROMO-2736 · GROMO-2737)

기준은 2026-11-03 밤의 main `b0940c786` 이다. 고친 빌드는 그 위에 각 티켓의 커밋만 올렸다. 모두 60초, 케이블을 꽂은 채로 쟀다.

### 3.1 집중 · AI 끔 (GROMO-2736)

| 빌드 | 횟수 | 앱 CPU | 메인 스레드 | 메인 스레드 중 `RCTGetBorderImage` | 발열 상태 |
| --- | ---: | ---: | ---: | ---: | --- |
| 고치기 전 | 2 | 39.7% · 40.5% | 33.3% · 34.9% | 52.4% · 53.4% | Nominal · Fair |
| 반짝임만 막대로 | 1 | 28.2% | 22.9% | 32.6% | Nominal |
| 반짝임 + 물결 고리 `overflow: 'hidden'` | 3 | 18.6% · 18.4% · 18.6% | 13.6% · 13.5% · 13.5% | 0.3% · 0.3% · 0.3% | Fair |

- 집중 화면 앱 CPU 가 약 40% 에서 18.5% 로 절반 아래가 됐다. 홈 걷기(20.6%)와 비슷한 수준이다.
- 고친 빌드는 발열 상태가 Fair 로 더 따뜻할 때 쟀는데도 낮게 나왔다.
- 남은 메인 스레드의 대부분(76%)은 네이티브 드라이버 애니메이션 진행(`stepAnimations`) 자체다.
- 반짝임·고리는 찌 둘레의 옅은 선이라 캡처에서 잘 보이지 않는다. 바꾸기 전후 낚시섬 집중 화면 캡처에서 달라진 곳은 없었다.

### 3.2 집중 전 미리보기 (GROMO-2737)

| 빌드 | 횟수 | 앱 CPU | 프레임 스레드 중 `hermesvm` | 프레임 스레드 중 `Cattus`(TFLite 등) |
| --- | ---: | ---: | ---: | ---: |
| 고치기 전 | 2 | 71.0% · 74.5% | 85.3% · 85.3% | 12.1% · 12.2% |
| 손 모델 입력 float32 | 2 | 71.0% · 75.1% | 84.1% · 84.4% | 13.3% · 13.0% |

- 손 모델 입력 변환을 없애도 CPU 는 측정 오차 안에서 같았다. 40% 를 넘는 남은 상위는 여전히 JS 실행(`hermesvm`)이다.
  가장 유력한 원인은 물체 결과 검사다(§2.2).
- 고친 빌드에서 손과 노트북·키보드를 비추면 «집중 확인 완료», 손을 빼면 «손이 보이지 않아요.» 가 나왔다.

## 4. 측정 조건

- 기기: iPhone 15(iPhone15,4), iOS 27.0.1. **케이블을 꽂은 채** 쟀다(충전 중).
- 빌드: Release, Xcode 26.6, 개발용 서명(`get-task-allow` — Instruments 가 앱에 붙으려면 필요하다). 스토어·TestFlight 빌드는
  붙지 않는다(«Cannot find process»). 서버는 dev V2(`oneorthree-v2.dev.mooo.com`), OTA 끔, PostHog 토큰 빈 값.
- 계정: dev V2 의 시험 계정 하나. 홈은 그 계정의 섬, 집중은 낚시섬에서 혼자(다른 주민 없음).
- 기록: Xcode 26.6 의 `xctrace record --attach <pid>`. Xcode 27.2 의 xctrace 는 iOS 27.0.1 에서 같은 pid 를 못 찾는다.
  내보내기는 Xcode 27.2 의 `xctrace export`(26.6 은 큰 기록에서 세그폴트).
- 계측기: 홈은 Hitches · Display · Time Profiler · Thermal State, 집중은 Time Profiler · Thermal State.
- 분석 구간: 홈은 기록 4~47초(조작 45초), 집중은 3~62초. 앱 샘플이 하나도 없는 초는 «기록 빠짐» 으로 빼고 나눴다(이번 결과는 0초).
- 조작: 별도 XCUITest 러너 앱(`com.oneorthree.perfdriver`, 팀 P6Z68QUK9M)이 testID·좌표로 누른다. 기록 중에는 정해진
  조작만 하고 다른 것은 누르지 않는다.
  - 걷기: 땅 세 곳(화면 비율 0.55,0.42 · 0.72,0.50 · 0.60,0.60)을 2.5초마다 번갈아 누른다.
  - 지도 끌기: 좌우·상하 왕복 끌기(속도 600pt/s)를 쉬지 않고 반복한다.
  - 확대: XCUITest `pinch` 는 홈 지도(PanResponder)에 먹히지 않아 사람이 했다.
  - 집중: `depart-focus` → 낚시섬 → 스위치 「카메라 인증 사용」 → `focus-start` → `start-focus` → 측정 → `end-focus` 2초 누름 → `result-done`.

## 5. 다시 재는 법

1. 측정 빌드 — 레포 파일 두 개를 잠깐 바꾸고 빌드 뒤 되돌린다.
   - `app/app-dev/ios/Cattus/Supporting/Expo.plist` 의 `EXUpdatesEnabled` 를 false 로(OTA 가 JS 를 바꾸지 않게).
   - 2026-11-03 오전 빌드(`239efc3f4`)에서는 pbxproj 의 Release 검문이 옛 dev VM 주소만 허용해 dev V2 주소로 바꿨다(티켓 2661 로 이후 해소).
   - `b0940c786` 에서는 `app/app-dev/ios/Podfile.lock` 의 확인값 두 줄(ExpoModulesCore · hermes-engine)이 이 Mac 의
     `pod install` 결과(`Pods/Manifest.lock`)와 달라 «The sandbox is not in sync with the Podfile.lock» 로 빌드가 멈췄다.
     빌드하는 동안만 `Pods/Manifest.lock` 을 `Podfile.lock` 에 덮어쓰고 끝나면 되돌렸다.

   ```bash
   export DEVELOPER_DIR=/Applications/Xcode-26.6.0.app/Contents/Developer
   cd app/app-dev/ios && source ./release-config.sh
   export EXPO_PUBLIC_API_URL=https://oneorthree-v2.dev.mooo.com GROMO_IOS_AUDIENCE=dev EXPO_PUBLIC_ENV=dev
   export EXPO_PUBLIC_APPLE_LOGIN_ENABLED=1 EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN=   # 빈 값
   export GROMO_IOS_CREDENTIALS_DIR=$HOME/.gromo/ios-credentials AIRBRIDGE_APP_TOKEN=<app-dev/.env 값>
   xcodebuild -workspace Cattus.xcworkspace -scheme Cattus -configuration Release \
     -destination id=<UDID> -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
     -authenticationKeyPath <ASC 키> -authenticationKeyID <id> -authenticationKeyIssuerID <issuer> build
   xcrun devicectl device install app --device <UDID> <DerivedData>/Build/Products/Release-iphoneos/Cattus.app
   ```

2. 폰 설정: 설정 → 개발자 → «UI 자동화 사용» 켬, 방해 금지 모드 켬(알림 배너가 XCUITest 를 끊는다), 자동 잠금 끔.
3. 러너가 `PERF_READY` 를 찍으면 기록을 붙인다.

   ```bash
   PID=$(xcrun devicectl device info processes --device <UDID> | grep '/Cattus.app/Cattus *$' | awk '{print $1}')
   DEVELOPER_DIR=/Applications/Xcode-26.6.0.app/Contents/Developer xcrun xctrace record \
     --instrument 'Time Profiler' --instrument 'Thermal State' \
     --device <UDID> --attach "$PID" --time-limit 64s --output a0.trace
   xcrun xctrace export --input a0.trace --xpath '//table[@schema="time-profile"]' > a0-time-profile.xml
   ```

4. 폰 남은 공간은 `uvx pymobiledevice3 lockdown get com.apple.disk_usage` 의 `AmountDataAvailable` 로 본다(`devicectl` 은 알려 주지 않는다).

## 6. 한계와 주의

- **배터리는 재지 않았다.** 케이블을 꽂으면 충전 중이라 Power Profiler 의 시스템 배터리 값이 0%/h 로 나온다. 같은 이유로 발열도
  충전 열이 섞여 있다.
- 표본이 적다. 홈은 장면당 3~5회, 집중은 1~2회다. 집중 8회 중 3회는 기록 도구가 앱에 붙지 못하거나(«Cannot find process»)
  러너가 시작하지 못해 버렸다. 전후 비교(§3)도 같은 이유로 몇 회를 버렸다. 전후 비교는 같은 기준 커밋·같은 순서로 잰 값끼리만 한다.
- 폰이 Wi-Fi 로만 연결돼 있으면(`devicectl device info details` 의 Transport Type 이 `localNetwork`) 기록 도구가 앱에 붙지 못하고
  남은 공간도 읽히지 않는다. 케이블(`wired`)로 잰다.
- AI 판정 캡처는 고친 빌드로만 찍었다. 고치기 전 빌드로 같은 장면을 찍지는 않았다.
- Animation Hitches 템플릿은 긴 지도 끌기에서 기록이 몇 초씩 통째로 빠져 가짜 «Severe Hang»·0 fps 를 만든다(화면은 멈추지
  않았다). 그래서 계측기를 골라 붙였다.
- 3분짜리 기록을 여러 번 붙였다가 폰 저장 공간이 두 번 가득 찼다(기록 도구가 폰에 임시 데이터를 쌓는다). 재부팅으로 돌아왔고,
  60초 · Time Profiler 만 쓰면 8회 기록에 0.3GB 만 줄었다. 긴 기록은 남은 공간을 보며 한다.
- 지도 끌기·걷기는 XCUITest 합성 터치라 사람 손 속도와 다르다.

## 7. 다음에 잴 것

- 케이블을 뺀 배터리 소모: 폰의 설정 → 개발자 → Performance Trace 로 집중 30분 이상.
- 홈 지도의 뗏목 물결: `app/app-dev/src/components/village-motion/RaftWaterMotion.tsx` 도 아랫변 테두리(`borderBottomWidth`)
  3개의 opacity·크기를 네이티브 드라이버로 바꿔 §2.1 과 같은 비용이 있을 수 있다. 홈 대기 CPU(8.8%)를 다시 재서 확인한 뒤 티켓을 만든다.
  다른 화면도 «애니메이션하는 뷰 + 보이는 테두리 + `overflow` 없음» 이면 같은 비용이 든다.
- 집중 전 미리보기의 물체 결과 검사(§2.2): 판정에 쓰는 3종류 값만 검사하면 반복이 약 30분의 1이 된다. 다만 쓰지 않는 종류의
  비정상 값도 오류로 보는 지금 규칙(`studyObjects.test.ts`)이 바뀐다. 미리보기는 짧게 켜는 화면이라 미룬다.
- 지도 끌기 27 fps 의 원인(메인·JS 스레드가 비슷하게 바쁘다).
- Android 같은 장면.
