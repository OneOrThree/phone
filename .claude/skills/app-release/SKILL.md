---
name: app-release
description: 앱 출시 — 서버 선행 확인, iOS·Android·OTA 출시, 출시 기록 태그.
disable-model-invocation: true
---

# app-release — 앱 출시

사람이 부르는 절차다. 정본:

- [앱 README](../../../app/app-dev/README.md) 「앱 출시 전 서버 선행 게이트」·「TestFlight」
- [Android CI와 Play 내부 테스트 CD](../../../docs/conventions/android-ci-cd.md)
- [iOS dev TestFlight 러너](../../../docs/conventions/ios-testflight-dev-runner.md)
- [app-server-gate.py](../../../.github/scripts/app-server-gate.py)

## 1. 서버가 먼저 나갔는지 본다

- `app-server-gate.py` 는 운영 V2 에 배포된 태그의 커밋과 HEAD 를 비교한다. 그 사이에 서버 실행 코드(`server/*/src/main/`) 변경이 있으면 출시를 막는다. 로컬 `ota-update.sh`, 운영 `testflight.sh`, Android 운영 빌드, Android CI 의 `server-gate` 잡이 이 검사를 부른다.
- release 의 최근 `prod-cd-V2` 실행이 `completed`·`success` 가 아니어도 막는다. 승인 대기·거부·실패·취소가 최신이면 다음 성공 실행까지 막힌다. 거부로는 풀리지 않는다 — 운영 CD 를 승인해 성공으로 끝내야 풀린다(`/prod-release` 4절).
- 미리 본다. 출시할 커밋의 깨끗한 체크아웃에서 `python3 .github/scripts/app-server-gate.py` 를 돌린다. 백오피스 「출시 현황」 화면도 같은 판정이다.
- 막히면 서버를 먼저 올린다(`/prod-release`).

완료 조건: 게이트가 `app-server-gate: 통과` 를 낸다.

## 2. iOS 운영 빌드

스토어 앱은 1.x 와 같은 App Store 앱이다(번들 `com.oneorthree.gromo`, id6774498679, 2.3.0 부터). 저장소의 Fastfile `APP_ID`·Appfile·Cattus.xcodeproj 는 아직 `com.oneorthree.focuscat` 이라, 그대로 올리면 공개된 적 없는 다른 App Store 앱으로 간다. 레인을 gromo 로 바꾸기 전에는 빌드 번들부터 확인한다.

1. 최신 main 의 깨끗한 워크트리를 만들고 `cd app/app-dev && npm ci` 를 돌린다.
2. 준비물을 둔다. 깨끗한 워크트리에는 gitignore 된 파일이 없다.
   - App Store Connect 키: `ios/fastlane/.env`(양식 `ios/fastlane/.env.example`) 또는 환경변수 `ASC_KEY_ID`·`ASC_ISSUER_ID`·`ASC_KEY_PATH`.
   - 푸시 설정 파일: `GROMO_IOS_CREDENTIALS_DIR` 가 레포 밖 폴더를 가리킨다. 그 아래 `dev/`·`prod/` 에 `GoogleService-Info.plist` 가 있다.
   - `AIRBRIDGE_APP_TOKEN`: 레포 변수와 같은 값이다. 없으면 Airbridge 설정 단계에서 빌드가 막힌다.
3. 셸의 `EXPO_PUBLIC_*` 를 모두 빼고 출시 값만 준다. 이미지 변수는 넣지 않는다.
   ```sh
   cd ios
   env $(env | sed -n 's/^\(EXPO_PUBLIC_[A-Za-z0-9_]*\)=.*/-u \1/p') \
     AIRBRIDGE_APP_TOKEN="$(gh variable get AIRBRIDGE_APP_TOKEN)" \
     EXPO_PUBLIC_API_URL=https://catus-api-v2.oneorthree.world EXPO_PUBLIC_APPLE_LOGIN_ENABLED=1 \
     ./testflight.sh
   ```
4. 버전 이름과 빌드 번호는 Fastfile 이 정한다. 버전 이름은 `app-*-ios-*` 태그 중 최대의 patch + 1(하한 pbxproj 값), 빌드 번호는 그 버전의 TestFlight 최대 + 1 이다. 업로드가 끝나면 Fastfile 이 그 커밋에 `app-<버전>-ios-<빌드>` 태그를 단다(GROMO-2731).

완료 조건: TestFlight 업로드가 끝났고, 빌드 번호와 빌드한 커밋(HEAD)을 적었다.

- `./testflight.sh --dev` 빌드는 아직 옛 dev VM 주소를 본다(티켓 2661).
- main 머지의 dev TestFlight 자동 업로드는 레포 변수 `IOS_DEV_RUNNERS` 가 없어 돌지 않는다.

## 3. Android

- main 의 앱 머지 → Android CI(운영 V2 서버용 AAB) → Android CD → Play internal 자동 게시. Android CD 는 2026-11-02 18:08 KST 에 다시 켜졌다.
- 프로덕션은 Play 콘솔에서 internal 출시를 승격한다.
- 버전 이름은 게시마다 끝자리가 하나씩 오른다. CI 가 `app-*-android-*` 태그 중 최대의 patch + 1 로 정하고, CD 가 게시 뒤 그 커밋에 태그를 단다. 직전 태그 이하의 버전은 CD 가 게시 전에 막는다(GROMO-2731). minor·major 는 `android/app/build.gradle` 의 `versionName`(하한)을 PR 로 올린다.
- versionCode 규칙, `server-gate` 로 막혔을 때의 재실행, 게시 재시도는 android-ci-cd.md 를 따른다.

완료 조건: Android CD 실행이 success 이고, 버전 이름·versionCode 와 그 Android CI 실행의 커밋을 적었다.

## 4. OTA

- `cd app/app-dev && ./scripts/ota-update.sh [--platform ios|android|all] "수정 내용 한 줄"`. 스크립트가 서버 선행 게이트를 먼저 부르고 `EXPO_PUBLIC_*` 를 스스로 비운다.
- runtimeVersion 이 같은 바이너리만 이 업데이트를 받는다(`app.config.js`).

완료 조건: 업데이트 발행이 끝났고 그 커밋(HEAD)을 적었다.

## 5. 출시 기록

스토어 업로드가 끝나면 출시한 커밋에 주석 태그를 단다. 1.x 의 `app-1.1.0-7` 과 같은 방식이다. Android CD(「앱 버전 태그」 잡)와 fastlane `beta` 는 이 태그를 스스로 단다. 아래는 그 자동 단계가 실패했을 때만 손으로 한다 — 다음 버전 계산이 이 태그에 기대므로 빠뜨리지 않는다.

```sh
gh api -H 'Accept: application/vnd.github.raw+json' 'repos/{owner}/{repo}/contents/prod-V2/app.json?ref=deployment-status' --jq .message
git tag -a app-<버전>-<ios|android>-<빌드> <커밋> -m "server: <위에서 읽은 운영 서버 태그>"
git push origin refs/tags/app-<버전>-<ios|android>-<빌드>
```

- 첫 줄이 그때의 운영 서버 태그(`catus-vX.Y.Z-V2`)를 읽는다.
- Jira fixVersion 은 앱 버전 축이다. 그 버전이 Jira 에 없으면 만든다.

완료 조건: `git ls-remote --tags origin 'app-*'` 에 새 태그가 있다.
