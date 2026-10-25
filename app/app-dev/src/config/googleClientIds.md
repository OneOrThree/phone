# Google 로그인 클라이언트 id (GROMO-2226)

JSON 은 주석을 못 쓰므로 `googleClientIds.json` 의 규칙을 여기에 적는다.

## 정본

- 환경별 Google 클라이언트 id 의 정본은 `googleClientIds.json` 한 곳이다. `dev`·`prod` 행마다 `ios`(iOS 클라이언트)와
  `web`(웹 클라이언트, ID 토큰 `aud`)을 둔다. 값은 공개값이지만 서버 `GOOGLE_CLIENT_ID` 허용 목록과 짝이어야 한다.
- `dev` 행은 2.0 전용 프로젝트 `263851348176`(GROMO-2215)이다. `prod` 행은 운영 프로젝트에서 발급해 채울 때까지 비어 있다.
- `.env` 의 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` 같은 덮어쓰기는 없다. `.env` 가 Release 번들에 섞이는 통로라서 지웠다.

## 행 선택 규칙

- JS(`src/services/socialLogin.ts`): `__DEV__` 이거나 `EXPO_PUBLIC_ENV` 가 정확히 `dev` 면 `dev` 행, 그 밖(운영 TestFlight·OTA·스토어 번들)은 `prod` 행.
  `EXPO_PUBLIC_ENV=`(빈 문자열)은 `dev` 가 아니다.
- 고른 행의 `ios`·`web` 이 비어 있으면 로그인 시도를 거절한다(`CLIENT_PROVIDER_UNAVAILABLE`). dev id 로 몰래 돌아가지 않는다.
- 네이티브 URL 스킴: `app.config.js`(prebuild 전용 플러그인 입력)는 `dev.ios` 를 뒤집어 만들고, 체크인된 `ios/GROMO/Info.plist` 의
  `GoogleSignIn` 항목은 정적이다. Release 에서는 JS `iosClientId` 와 바이너리 스킴이 어긋나면 로그인 탭에서 크래시하므로
  (`RNGoogleSignin.mm` 의 `@try` 는 `#if DEBUG` 안에만 있다) Info.plist 에 dev·prod 스킴을 **둘 다** 등록한다. 그래야 OTA 로 JS 만 바뀌어도 안전하다.

## 운영 빌드 가드

`prod.ios`·`prod.web` 중 하나라도 비면 `ios/testflight.sh`(인자 없는 운영 레인)와 `scripts/ota-update.sh` 가 `exit 1` 로 멈춘다.

## prod 발급 뒤 할 일

1. 이 JSON 의 `prod.ios`·`prod.web` 두 값을 채운다(둘 다 같은 Cloud 프로젝트 번호이고 `dev` 와 달라야 한다 — `googleClientIds.test.js` 가 확인한다).
2. `ios/GROMO/Info.plist` 의 `GoogleSignIn` `CFBundleURLSchemes` 에 prod 스킴 한 줄을 더한다 — `com.googleusercontent.apps.<prod.ios 에서 .apps.googleusercontent.com 뺀 값>`. 기존 dev 스킴은 지우지 않는다.
3. 서버 SM `GOOGLE_CLIENT_ID` 순서: prod Web id 를 덧붙임 → 운영 빌드 → 마지막에 `263851348176` 값 제거.
