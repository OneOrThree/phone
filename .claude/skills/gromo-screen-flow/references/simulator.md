# 아이폰 시뮬레이터로 찍기

웹에서 안 뜨는 화면을 보완할 때 쓴다. 2026-10-05에 이 방법으로 찍은 것: 초대 공유 창(iOS 공유 시트), 스크린타임 허용 창, 아이폰 앱 선택 창("측정할 앱 선택"), 측정 앱 시트, 앱 권한 관리 시트.

시뮬레이터에서도 못 찍은 것: 메일 앱(시뮬레이터에 없는 것으로 알고 있다 — 직접 확인은 안 했다), 서버 데이터가 있어야만 나오는 화면(연습용 모드로는 못 띄움).

## 1. 캡처 전용 시뮬레이터

오스카가 쓰는 시뮬레이터에 앱을 덮어쓰지 않으려고 따로 둔다. iPhone 17은 402×874라 피그마 틀과 딱 맞는다(캡처 1206×2622).

```sh
U=$(node -p "require('$WF/run.json').simulator.udid")      # 지난 실행의 시뮬레이터 (오스카 기계 기준)
xcrun simctl list devices | grep "$U" || echo "없음 — 새로 만든다"
# 없을 때만:
# U=$(xcrun simctl create "GROMO 캡처용 iPhone 17" com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-26-5)
xcrun simctl boot $U; xcrun simctl bootstatus $U
```

새로 만들었으면 `run.json`의 `simulator.udid`를 고친다. 이후 모든 명령은 `$U`를 지정한다 — 켜져 있는 다른 시뮬레이터를 건드리지 않기 위해서다.

## 2. 깔린 앱이 쓸 만한지 확인, 아니면 Debug 빌드

```sh
APP=$(xcrun simctl get_app_container $U com.oneorthree.focuscat 2>/dev/null) && stat -f "설치 %Sm" -t "%Y-%m-%d %H:%M" "$APP" && ls "$APP" | grep main.jsbundle
git log -1 --format="%ad %s" --date=format:"%Y-%m-%d %H:%M" -- app/app-dev/ios app/app-dev/package.json app/app-dev/modules
git status --short app/app-dev/ios/Podfile.lock app/app-dev/package.json
```

- 앱 안에 `main.jsbundle`이 있으면 화면 코드가 빌드 때 묶여 들어간 것이라 **설치 시각 이후의 코드 변경이 반영되지 않는다.** 이런 앱으로 본 것을 지금 앱의 동작으로 말하지 않는다.
- Debug 앱(`main.jsbundle` 없음)은 화면 코드를 번들러에서 받아 오므로 화면은 항상 최신이다. 다만 설치 뒤에 네이티브 쪽(`ios/`, `package.json`, `Podfile.lock`)이 바뀌었으면 "Cannot find native module"로 죽는다.
- 그래서: **캡처용 시뮬레이터에 Debug 앱이 깔려 있고 그 뒤로 네이티브 쪽이 안 바뀌었으면 빌드를 건너뛰고 3절로 간다.** 아니면 새로 빌드한다.

```sh
cd <레포>/app/app-dev/ios
diff -q Podfile.lock Pods/Manifest.lock        # 다르면 pod install 이 필요한 상태 — 직접 하지 말고 오스카에게 알린다
xcodebuild -workspace GROMO.xcworkspace -scheme GROMO -configuration Debug -sdk iphonesimulator \
  -destination "id=$U" -derivedDataPath <스크래치패드>/simbuild/DerivedData build > <스크래치패드>/simbuild/build.log 2>&1
xcrun simctl install $U <스크래치패드>/simbuild/DerivedData/Build/Products/Debug-iphonesimulator/GROMO.app
```

- 백그라운드로 돌린다. 5~10분 걸렸다.
- **Release로 빌드하지 않는다.** "Check iOS release Apple audience readiness" 단계가 운영 서버 주소·약관 버전·Apple 로그인 설정이 없으면 막는다. 의도된 안전장치이니 값을 꾸며 넣어 통과시키지 않는다.
- Debug 빌드는 `ios/Pods`의 미리 빌드된 프레임워크를 Debug용으로 바꾼다. 다음 Release 빌드 때 자동으로 돌아가지만, 링크 에러가 나면 이것이 원인일 수 있으니 보고에 적는다.

## 3. 연습용 모드 번들러를 따로 띄운다

먼저 연습용 모드가 네이티브에서 켜지는지 확인한다. 이 판정은 2026-10-05에 아직 커밋되지 않은 파일에 있었다.

```sh
grep -n "EXPO_PUBLIC_DEMO" <레포>/app/app-dev/src/services/demoMode.ts
```

없으면 멈춘다. 그 상태로 띄우면 앱이 서버 모드로 떠서 로그인을 요구한다. 네이티브 빌드의 기본 서버 주소가 팀 개발 서버라서, 거기서 더 진행하면 그 서버에 계정과 섬이 만들어진다. 오스카에게 알리고 어떻게 할지 묻는다.

```sh
cd <레포>/app/app-dev
TMPDIR=<스크래치패드>/simbuild/metro-tmp/ EXPO_PUBLIC_DEMO=1 CI=1 npx expo start --dev-client --port 8099
```

- Debug 앱은 켜질 때 `localhost:8081`에 번들러가 있으면 그것을 자동으로 불러온다. 8081은 보통 다른 작업의 개발 서버이니 건드리지 않고 다른 포트에 하나 더 띄운다.
- `TMPDIR`을 따로 주는 이유: 번들러 캐시가 섞이면 연습용 모드 설정이 다른 빌드(최악의 경우 TestFlight용)로 새어 들어갈 수 있다.
- 백그라운드로 돌리고, 끝나면 내가 띄운 것만 끈다.

## 4. 앱을 그 번들러로 연다

```sh
xcrun simctl openurl $U "gromo://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8099"
```

"'GROMO'에서 열겠습니까?" 창이 뜨면 Maestro로 "열기"를 누른다. 첫 번들은 1분쯤 걸린다. 로그인 없이 홈이 뜨고 섬 이름이 "소다 섬"이면 연습용 모드다.

## 5. 조작은 Maestro, 캡처는 simctl

```sh
maestro --device $U test flow.yaml
maestro --device $U hierarchy > h.json          # 지금 화면의 글자·접근성 이름·좌표
xcrun simctl io $U screenshot out.png
```

`scripts/maestro-example.yaml`이 홈에서 마을회관 → 섬 관리까지 가는 예시다. 지난번 조작 파일은 스킬의 `last-run/sim/`(작업 폴더에 복사했다면 `$WF/sim/`)에 있다:

| 화면 | 조작 파일 순서 |
|---|---|
| 초대 공유 창 | `hall.yaml` → `share.yaml` |
| 앱 권한 관리 | `perm.yaml` → `perm2.yaml` |
| 스크린타임 허용 ~ 앱 선택 창 | `st.yaml` → `st2.yaml` → `st3.yaml` → `st4.yaml` → `st5.yaml` → `pick.yaml` → `pick2.yaml` |

- `tapOn: "글자"`는 전체 일치다. 접근성 이름이 "앱 설정, 알림 · 소리 · …"처럼 길게 합쳐져 있으면 `"앱 설정.*"`로 쓴다.
- 좌표로 누를 때는 `point: 339,678`(pt 절대값) 또는 정수 퍼센트 `point: 93%, 93%`. 소수 퍼센트를 쓴 단계는 실행되지 않았다.
- 건물은 지도를 끌어야 보인다. `swipe`로 옮긴 뒤 `hierarchy`로 "마을회관" 같은 이름이 화면 안(0~402, 0~874)에 들어왔는지 본다. 게시판은 지난번에 못 찾고 중단했다.
- 건물에 들어갈 때는 걸어가는 연출이 있어 `extendedWaitUntil`로 20초쯤 기다린다.
- 개발용 빌드라 화면 아래에 경고 띠("Open debugger to view warnings")가 뜬다. 캡처 전에 띠 오른쪽 끝(93%, 93%)을 눌러 닫는다. 홈 오른쪽 위의 "새 마을 미리보기" 버튼도 개발용 빌드에만 나온다.
- 시스템 창(암호 입력 등)은 `hierarchy`가 비어 나온다. 스크린샷으로 본다.

## 스크린타임 흐름

내 뗏목 → 앱 설정 → 앱 권한 관리 → "스크린타임 연결" 토글 → iOS 허용 창("계속") → "스크린 타임 접근 허용"("암호로 허용") → 암호 입력(시뮬레이터는 아무 글자나 넣고 Enter) → 승인됨("완료") → "측정 앱" → "측정 앱 고르기" → 아이폰 앱 선택 창.

한 번 승인한 뒤에는 그 시뮬레이터에 승인 상태가 남아 허용 창이 다시 안 뜰 수 있다(다시 시험해 보지는 않았다). 허용 창부터 찍어야 하면 앱을 지우고 다시 깔거나 시뮬레이터를 새로 만든다.

## 끝나면

- 번들러(8099)를 끄고 캡처용 시뮬레이터를 끈다(`xcrun simctl shutdown $U`). 8081은 그대로 둔다.
- 찍은 원본과 조작 파일을 `$WF/sim/`에 둔다.
- 피그마에는 `references/figma-upload.md`의 "한 장 교체"로 넣는다.
