# GROMO 2.0 앱

GROMO 2.0의 활성 React Native·Expo 앱입니다. 세로·가로 레이아웃과 iOS·Android·웹을 지원하며, 서버 API와 기기 로컬 저장을 함께 사용합니다. 기능별 서버 연결 범위는 아래 API 모듈 표를 기준으로 확인하세요.

## 로컬 실행

```sh
npm ci
npm start
```

Expo 개발 서버에서 플랫폼을 선택하거나 아래 명령으로 바로 실행할 수 있습니다.

```sh
npm run ios
npm run android
npm run web
```

루트의 `RN-앱-열기.command`와 `GROMO-데모.command`는 macOS에서 개발 서버 또는 정적 웹 빌드를 여는 보조 스크립트입니다.

일반 URL은 첫 시작부터 진행합니다. `?demo=1`은 완공된 마을 체험, `?review=1`은 검증 스크립트의 상태 주입용입니다. 두 모드는 기존 로컬 저장을 읽거나 덮어쓰지 않습니다.

### 캐릭터 스프라이트 모션

웹 주소에 `?motion=1`을 붙이면 앱에서 쓰는 `CatSprite`로 고양이 6종의 동작을 비교할 수 있습니다. 동작 버튼을 다시 누르면 처음부터 재생하며, 왼쪽 보기와 모션 줄이기도 확인할 수 있습니다. 이 미리보기는 계정이나 로컬 저장 데이터를 사용하지 않습니다.

메인 고양이는 이동할 때 걷고, 멈추면 눈 깜박임·갸웃·하품·기지개·그루밍을 간헐적으로 재생합니다. 집중 화면에서는 낚시 동작을 유지하고 물고기를 잡은 직후에만 낚아올리기로 전환합니다. 동작 간 발 위치를 기준으로 정렬하며, 모션 줄이기 또는 앱 백그라운드 상태에서는 스프라이트 재생을 중단합니다. NPC 전용 동작 확장은 이 작업 범위에 포함하지 않습니다.

```sh
# 실행 중인 웹 서버를 대상으로 6종·프레임 변경·좌우 반전·모션 줄이기와 화면 진입 검증
MOTION_REVIEW_URL=http://localhost:8081 node scripts/review-cat-motion.cjs
```

황금 물고기 영상은 임시 검수 URL `?demo=1&golden-test=1`에서 확인할 수 있습니다.
이 모드는 인증·서버 연결 없이 데모 상태로 시작하며, 집중 낚시에 들어가면 황금 물고기가
반드시 한 번 등장합니다.

검증 결과와 화면 캡처는 `.docs/cat-motion/`에 저장됩니다. 브라우저 검증은 실제 저사양 iOS·Android 기기의 프레임 성능 검증을 대신하지 않습니다.

## 구조

- `src/App.tsx`: 앱 상태·저장·화면 전환·음원 재생
- `src/screens/`: 섬, 집중, 탐색, 인테리어, 꾸미기, 월드 화면
- `src/design-system/`: UI kit 기반 토큰·타이포그래피·공용 UI·화면 조합 패턴
- `src/components/`: 캐릭터·연출처럼 도메인에 가까운 공용 컴포넌트
- `src/services/model.ts`: 재화·건설·집중·퀘스트·친구 정책
- `src/hooks/`: 카메라와 사운드 훅
- `src/utils/`: 섬 경로·카메라·월드 그리드 계산
- `src/constants/`: 에셋 레지스트리와 월드·모션 상수
- `src/assets/`: 앱에 번들되는 이미지·폰트·오디오
- `ios/`, `android/`: 가져온 네이티브 프로젝트
- `scripts/`: 화면·사용자 여정 검증 도구. 결과는 gitignored `.docs/`에 생성

## 문구·이미지 추가 규칙

화면 문구는 `src/i18n/locales/ko.json`·`en.json`에 둡니다(네임스페이스: `common`·`login`·`account`·`character`·`building`·`color`·`track`·`focus`·`home`·`settings`·`errors`·`time`). 키는 점 표기 네임스페이스(`home.quest.claim`)이고 **ko 가 정본**이라 먼저 쓰고 en 은 번역만 채웁니다. 두 파일은 같은 리프 키·같은 `{{var}}` 자리표시자 집합이어야 하며 어긋나면 `src/i18n/index.test.ts` 가 실패합니다. 서버 오류 코드가 늘면 같은 테스트가 business-api `ApiErrorCode` 와 대조해 `errors.*` 누락을 잡습니다.

- 치환은 `{{var}}`, 복수는 **en 쪽만** `{ one, other }` 객체 + `vars.count` 로 고릅니다(Hermes 엔 `Intl.PluralRules` 가 없어 자체 분기). ko 는 항상 단일 문자열입니다.
- 시간·숫자·날짜는 문자열을 직접 만들지 말고 `src/i18n/format.ts` 의 `formatDuration`·`formatNumber`·`formatDate`(내부에서 `localeTag()` 로 `ko-KR`/`en-US` 선택)를 씁니다.
- **모듈 최상위에서 `t()`·`localized()` 를 부르지 않습니다** — import 시점 언어로 값이 굳어 언어를 바꿔도 그대로입니다(1.x 교훈). 렌더 바디·콜백 안에서 부르고, `memo`/`useMemo`/`useCallback` 안에서 쓰면 언어 전환이 다시 계산을 유발하도록 `e.localePref` 를 prop·deps 에 넣습니다.
- `App.tsx` 의 `titles`(Datadog RUM 뷰 이름)는 번역하지 않습니다 — 분석 식별자입니다.
- 서버 오류 문구는 직접 분기하지 말고 `errorText`/`errorTextOr` 를 거칩니다. ko 는 서버 `message` 그대로, en 은 `errors.<code>` 번역(없으면 `errors.GENERIC`)이며 **en 에서 서버가 보낸 한글이 새어 나가면 안 됩니다**(index.test.ts 가 가립니다).

### 언어별 이미지 (GROMO-2240)

이미지는 `<이름>.ko.png`/`<이름>.en.png` 두 파일을 모듈 최상위에서 **require 쌍으로만** 두고(`{ ko: require(...), en: require(...) }`), 실제 선택은 **렌더 시점**에 `localized({ ko, en })` 로 합니다(위와 같은 이유로 최상위에서 `localized()` 를 직접 부르지 않습니다). en 자산은 `scripts/gen-localized-stamp.py`처럼 전용 스크립트로 결정적으로 생성하고(두 번 돌려도 같은 바이트), `npm run gen:localized-stamp`로 재생성·`npm run gen:localized-stamp:check`로 커밋 전 바이트가 최신인지 확인합니다. 자동 생성 스크립트가 없는 자산은 en 파일을 직접 그려 넣습니다 — 로케일별 require 쌍 구조는 같습니다. **새 PNG 는 OTA 로 못 나갑니다** — `app.config.js`의 `assetPatternsToBeBundled`가 `src/assets/ota/**`만 실어서, 새 로케일 이미지는 네이티브 빌드가 있어야 사용자에게 반영됩니다.

### 저장·테스트

- 언어 선택은 `gromo.locale`(AsyncStorage, 값 `'ko'|'en'|'system'`)에 **기기 전역**으로 저장합니다 — 계정과 무관하므로 로그아웃·회원 탈퇴의 `removeItem` 목록에 넣지 않습니다.
- en 쪽을 확인하는 테스트는 `jest.setup.js`가 전역으로 고정한 `expo-localization` ko-KR 모킹을, 테스트 안에서 `mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }])`로 덮고 `applyLocalePref('system')`을 부른 뒤, 파일 상단 `afterEach(() => applyLocalePref('system'))`로 다음 테스트에 ko 상태를 되돌려 줍니다.

## 검증

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npx expo export --platform all
```

## 소셜 로그인 약관 버전

소셜 로그인과 게스트 회원 전환은 배포 대상에 적용되는 실제 약관 문서 버전을 `EXPO_PUBLIC_TERMS_VERSION`으로 명시해 빌드합니다. 예시값이나 코드 기본값은 두지 않습니다. 값이 없거나 공백이면 소셜 제공자 버튼과 회원 전환 진입을 숨기고, 직접 호출도 서버 요청 전에 차단합니다. 게스트 로그인은 계속 사용할 수 있습니다. 동의 화면과 설정의 문서 링크는 팀 공개 정책 정본 [`이용약관`](https://oneorthree.world/catus/terms)과 [`개인정보처리방침`](https://oneorthree.world/catus/privacy)을 엽니다. `EXPO_PUBLIC_TERMS_VERSION`은 이 약관 배포본의 실제 버전과 맞춰 설정하세요.

## PostHog 제품 분석

릴리스 빌드는 PostHog `CatUs / Default project`(US)의 공개 프로젝트 토큰으로 이벤트를 보냅니다. [활성화와 집중 대시보드](https://us.posthog.com/project/624010/dashboard/2126236)에서 첫 사용·집중 퍼널과 일별 사용량을 봅니다. 개발 빌드는 기본적으로 전송하지 않으며, 검증할 때만 `EXPO_PUBLIC_POSTHOG_DEV_ENABLED=1`을 설정합니다. `?demo`·`?review` 웹 화면은 수집 대상에서 제외합니다.

| 이벤트                              | 발생 시점                                           |
| ----------------------------------- | --------------------------------------------------- |
| `$screen`                           | 커스텀 라우터의 화면 전환                           |
| `guest_login_completed`             | 게스트 계정 세션 채택 완료                          |
| `member_conversion_completed`       | 소셜 회원 전환 완료                                 |
| `island_join_requested`             | 섬 가입 승인 요청 확정                              |
| `island_membership_activated`       | 섬 생성·즉시 가입·승인 후 소속 확정 (`method` 속성) |
| `focus_started` / `focus_completed` | 서버 집중 시작·정산 확정                            |

로그인 세션의 서버 `userId`만 분석 식별자로 쓰고 로그아웃 시 식별자를 초기화합니다. 화면의 입력 내용·섬 이름·집중 주제는 전송하지 않습니다. 세션 리플레이, 터치 자동 수집, 위치 추정은 꺼져 있습니다. 프로젝트 토큰과 수집 호스트는 각각 `EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN`, `EXPO_PUBLIC_POSTHOG_HOST`로 빌드별 재정의할 수 있습니다.

웹 상호작용 검증은 정적 빌드를 로컬 서버로 띄운 뒤 실행합니다.

```sh
npm run build:all
python3 -m http.server 18762 --bind 127.0.0.1 --directory dist-all
npm run review:v2
npm run review:v2-journeys
```

## 현재 연결 범위

로그인·계정, 섬·주민, 집중 세션, 친구·편지 등은 서버 API에 연결되어 있으며, 설정·화면 상태와 스크린타임 측정은 기기에서 처리합니다. 일부 시각 효과와 건설·음원 흐름은 앱 로컬 상태로 동작합니다. 새 API 연결 범위는 `src/services/api/`와 해당 기능 표를 함께 갱신합니다.

앱 버전은 `2.0.0`, iOS 식별자는 `com.oneorthree.focuscat`, Android 식별자는 `com.oneorthree.gromo`입니다.
Kakao는 2.0 전용 Kakao 앱의 native key `1280641e9b639a279b7406f24b059703`을 iOS·Android 공통으로 씁니다. Kakao provider ID는 Kakao 앱마다 따로 발급되므로, 1.x 앱(native key `af3ff0c5…`)으로 가입한 카카오 사용자는 2.0에서 다른 계정으로 로그인됩니다(팀 결정, 2026-09-29). Kakao Developers 콘솔의 이 Kakao 앱에 iOS bundle ID `com.oneorthree.focuscat`, Android package `com.oneorthree.gromo`와 배포 서명 키 해시를 등록해야 합니다. 두 플랫폼 모두 OAuth callback scheme은 `kakao<key>`이고, iOS `Info.plist`와 Android manifest에 `kakao1280641e9b639a279b7406f24b059703` scheme이 들어 있어야 합니다.
Android release task graph는 기본 차단됩니다. Android legacy 세션의 RT를 잃지 않는 서버 멱등 승격 계약이 준비되고 검증된 뒤에만 `GROMO_LEGACY_SESSION_MIGRATION_READY=1`을 지정해 release 빌드를 실행하세요. release에는 실제 약관 문서 버전 `EXPO_PUBLIC_TERMS_VERSION`과 운영 API URL `EXPO_PUBLIC_API_URL=https://api.oneorthree.world`이 모두 필요합니다. URL이 빠졌거나 dev/다른 주소이면 release artifact를 만들지 않습니다. 예를 들어 `GROMO_LEGACY_SESSION_MIGRATION_READY=1 EXPO_PUBLIC_TERMS_VERSION=2026-09 EXPO_PUBLIC_API_URL=https://api.oneorthree.world ./gradlew :app:assembleRelease`입니다. 조건은 release artifact 작업에만 적용되며, debug 빌드와 `check`에는 영향을 주지 않습니다. release에는 기존 Play 업로드 키도 `android/credentials/prod/`에 필요하며, 새 업로드 키를 발급하지 않습니다.

### 서버 API 기반 (`src/services/api/`, GROMO-2004)

정본 계약은 [`docs/prd/fishcat/account/low-level-design.md`](../../docs/prd/fishcat/account/low-level-design.md)입니다.

| 파일                    | 역할                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client.ts`             | 베이스 URL 해석 · `Authorization: Bearer` 주입 · 15초 타임아웃(본문 읽기 포함) · `{data}` 봉투 해제 · 오류 봉투 → `ApiError` · 멱등 키(`uuid()`) |
| `session.ts`            | 토큰 보관(expo-secure-store, 웹은 AsyncStorage) · **커밋 마커로 원자 저장** · 세션 세대 · 401 세션 상실 알림                                     |
| `auth.ts`               | 인증 도메인 — `login` · `logout` · `me` · `checkSession`                                                                                         |
| `restore.ts` (한 층 위) | 재시작 복구 화면 판정. 서버 세션이 있으면 온보딩 여부는 서버가 정본                                                                              |

**오류 봉투는 `{ "error": { code, message, field, retryable }, "requestId": "..." }` 입니다**(LLD §1·§5). `docs/conventions/error-contract.md` 의 최상위 `{code,message}` 는 data-api·legacy 형태이며 무접두 공개 경로에는 쓰이지 않습니다 — `client.ts` 가 둘 다 읽되 신규 형태를 먼저 봅니다. `code` 문자열이 계약이므로 화면은 `ApiError.code` 로 분기합니다.

**새 도메인은 `src/services/api/<도메인>.ts` 를 새로 만듭니다.** `auth.ts` 에 얹지 않습니다 — 한 파일에 몰면 병렬 티켓이 서로의 머지 충돌이 됩니다. 요청은 전부 `client.ts` 의 `request()` 를 지나고, 명령성 요청(PATCH `/me` · DELETE `/me` · PATCH `/me/settings`)은 `uuid()` 로 만든 `idempotencyKey` 를 넘기며 **재시도는 같은 값으로** 보냅니다.

**계정 전환**(A→B, 같은 사용자 s1→s2 재로그인 포함)은 `login()` 이 LLD §2.4 의 「준비 → commit → commit 뒤 전달」 순서로 **이전 세션 RT 폐기까지만** 합니다. FCM 토큰 재발급·B 세션 bootstrap 재등록·`deliveryTag` 대조와 commit 직후의 결과 세션 채택 확인 요청은 기기·푸시 등록 티켓 몫입니다.

토큰 갱신(`POST /auth/sessions/current/refresh`, GROMO-2035)과 게스트 세션 발급(`POST /auth/sessions/guest`, GROMO-2036)은 2.0 공개 표면에 있고 앱이 호출합니다 — 401 은 갱신을 한 번 시도한 뒤 실패하면 재로그인입니다. 로그인 화면 제공자는 iOS 애플·구글, Android 구글입니다(계정 정책 LOGIN-D04). Kakao·LINE SDK 와 버튼 코드는 남아 있어 `src/services/loginProviders.ts` 목록만 바꾸면 되돌릴 수 있으며, Apple-only 기존 계정의 재진입을 보장하려면 서버가 Apple의 `gromo`와 `focuscat` audience를 모두 허용해야 합니다. 이 준비 전에는 Apple 버튼만 숨기지 않고 iOS 2.0 전체 출시를 보류합니다. LLD §2.1 의 `X-Device-Bootstrap` 응답 헤더도 서버 미구현이라 `login()` 이 받지 못합니다 — 푸시 기기 등록 티켓이 이 값을 쓰려면 `request()` 가 응답 헤더를 넘겨주도록 한 줄 늘려야 합니다.

## TestFlight

Catus 테스트 빌드를 TestFlight에 올립니다. 공개 릴리스 설정(약관 버전·Datadog RUM)은 `ios/release-config.sh`, App Store Connect API 키는 `ios/fastlane/.env`(gitignore, 양식은 `.env.example`)에 둡니다.

서버의 dual-audience 지원(`gromo`와 `focuscat`)이 배포되고 기존 Apple 로그인 계정으로 검증되기 전까지는 iOS archive와 TestFlight 업로드가 차단됩니다. 릴리스에는 실제 배포 약관 문서 버전 `EXPO_PUBLIC_TERMS_VERSION`과 운영 API URL `EXPO_PUBLIC_API_URL=https://api.oneorthree.world`이 필요하며, 빠졌거나 다른 주소이면 `ios/testflight.sh`, Fastlane `beta`, Xcode Release gate가 차단합니다. `ios/testflight.sh`와 Fastlane `beta` lane이 같은 `EXPO_PUBLIC_APPLE_LOGIN_ENABLED=1` readiness flag를 확인하므로 직접 Fastlane을 실행해도 우회할 수 없습니다. 이 Apple 플래그는 로그인 화면의 Apple 버튼에도 쓰이며, 설정하지 않은 debug/dev 빌드에는 출시 gate가 적용되지 않습니다.

```sh
cd ios
EXPO_PUBLIC_API_URL=https://api.oneorthree.world EXPO_PUBLIC_APPLE_LOGIN_ENABLED=1 ./testflight.sh
```

스크립트는 Pods와 Fastlane 의존성을 확인하고, App Store Connect의 `2.0.0` 최신 빌드번호 다음 번호로 archive·업로드합니다.

### dev 서버 빌드

팀 dev 서버(`https://oneorthree.dev.mooo.com`)를 바라보는 TestFlight 빌드는 `--dev`로 올립니다(인자는 없음 또는 정확히 `--dev`만 받고, 그 외는 오타로 보고 멈춥니다). 서버 주소는 스크립트와 Fastlane `beta_dev` lane이 직접 고정하므로 `EXPO_PUBLIC_API_URL`을 넘길 필요가 없고, 운영 주소를 넘겨도 dev 주소로 덮어씁니다. Xcode Release gate는 `GROMO_IOS_AUDIENCE=dev`일 때만 dev 주소를 허용합니다(그 외에는 여전히 운영 주소만). 테스트 노트 첫 줄에 "dev 서버" 표기가 붙고, 그 노트를 달기 위해 Apple 처리 완료를 기다리므로 운영 빌드보다 5~15분 더 걸립니다.

운영 빌드와 같은 번들 id로 올라가므로 운영 쪽에 섞이지 않게 lane이 몇 가지를 더 고정합니다: Datadog RUM 환경명 `EXPO_PUBLIC_ENV=dev`, PostHog 수집 끔(빈 토큰), OTA 업데이트(expo-updates) 끔 — 운영과 같은 채널·runtime을 쓰기 때문에 켜 두면 운영 OTA를 받아 운영 API가 박힌 JS로 바뀝니다(빌드 중 `Expo.plist`를 잠시 바꾸고 끝나면 원복). 저장된 로그인 세션은 아직 서버별로 분리하지 않아, 운영 빌드 위에 dev 빌드를 덮어 설치하면 첫 실행에서 운영 세션이 dev 서버에 거절돼 다시 로그인하게 됩니다. `bundle exec fastlane beta_dev`를 직접 부르면 `release-config.sh`를 거치지 않으므로 Datadog 값이 비어 lane이 막습니다 — 평소에는 `./testflight.sh --dev`를 쓰세요.

```sh
cd ios
./testflight.sh --dev
```

App Store Connect API 키는 `ASC_KEY_ID`·`ASC_ISSUER_ID`·`ASC_KEY_PATH` 환경변수가 이미 있으면 그대로 쓰고(CI 러너), 없을 때만 `ios/fastlane/.env`를 읽습니다(양식 `ios/fastlane/.env.example`). 1.x legacy 폴더의 설정은 더 이상 읽지 않습니다. main 머지 시 자동으로 이 빌드를 올리는 워크플로는 티켓 2219 에서 다룹니다.

### 약관 문서 버전 `EXPO_PUBLIC_TERMS_VERSION`

앱이 사용자에게 보여 준 약관 문서의 판을 가리키는 꼬리표입니다. 빌드에 박혀 로그인 요청의 `termsVersion`으로 서버에 전달되고, 서버는 사용자가 어느 판에 동의했는지를 이 값으로 기록합니다. 비어 있으면 로그인이 막히므로 운영·dev 빌드 모두 필수입니다.

- **정본은 `ios/release-config.sh`** (현재 `2026-09`) — 지금 올라가 있는 약관 문서 기준이며, 2026-10 까지의 TestFlight 빌드가 전부 이 값으로 나갔습니다. 바꾸면 기존 동의 기록과 판이 달라지므로 약관 문서를 실제로 개정할 때만, PR로 바꿉니다. `testflight.sh`가 이 파일을 읽으므로 명령 앞에 값을 붙일 필요가 없고, 붙이면 그 값이 우선합니다.
- 허용 값 목록(정책 Q05)은 아직 서버에 없습니다. 형식은 64자 안의 문자열이면 되지만, 의미는 약관 문서의 판이어야 합니다.

## Android 스크린타임

`modules/screen-time`은 1.x의 UsageStatsManager 계산기를 이식한 로컬 Expo 모듈입니다. Expo Go에서는 사용할 수 없으며 네이티브 개발 빌드가 필요합니다.

- `src/services/ScreenTimeModule.ts`: Android Expo 모듈과 기존 iOS RN 브리지 선택.
- `src/services/screentimeSync.ts`: 시작·복귀·자정·활성 상태 1분 간격으로 오늘/어제 값을 동기화하며, 호출 직렬화와 로컬 보존으로 관측값 감소를 방지합니다. 날짜는 2.0 퀘스트와 같은 KST입니다.
- 첫 측정 이전 날짜는 소급하지 않습니다. 마지막 관측일부터 어제 이전까지의 공백과 권한 철회 구간은 미확인으로 보존합니다. 오늘의 승인된 0분과 조회 실패는 구분합니다.
- 전체 앱 사용량만 연결합니다. Android 앱 잠금과 기존 1.x 서버 업로드 API는 연결하지 않습니다. 기존 계산기의 일별 통계 폴백은 근사값이며 기기 설정의 총합과 차이가 날 수 있습니다.
- 모듈 namespace는 `com.oneorthree.gromo.screentime`이며 실제 권한 검사는 `context.packageName`을 사용합니다. 앱 applicationId 변경과 독립적입니다.

검증은 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test -- --runInBand`, `android/`의 `./gradlew :app:compileDebugKotlin`으로 수행합니다. 기기에서는 설정 → 측정 권한 → 사용 정보 접근 허용/철회 후 복귀, 다른 앱 사용 후 내 일기장 갱신, 자정 후 어제 기록을 확인합니다.
