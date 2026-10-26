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

> 시스템 구조·배선·용어(i18n/l10n)는 [`docs/prd/fishcat/l10n/high-level-design.md`](../../docs/prd/fishcat/l10n/high-level-design.md)에 있습니다. 이 절은 추가 규칙만 다룹니다.

화면 문구는 `src/i18n/locales/ko.json`·`en.json`에 둡니다(네임스페이스: `common`·`login`·`account`·`character`·`onboarding`·`app`·`building`·`color`·`track`·`focus`·`focusFlow`·`home`·`settings`·`errors`·`time`·`magazine`). 키는 점 표기 네임스페이스(`home.quest.claim`)이고 **ko 가 정본**이라 먼저 쓰고 en 은 번역만 채웁니다. 두 파일은 같은 리프 키·같은 `{{var}}` 자리표시자 집합이어야 하며 어긋나면 `src/i18n/index.test.ts` 가 실패합니다. 서버 오류 코드가 늘면 같은 테스트가 business-api `ApiErrorCode` 와 대조해 `errors.*` 누락을 잡습니다.

- 치환은 `{{var}}`. 복수는 `{ one, other }` 객체 + `vars.count`(숫자)로 고릅니다(Hermes 엔 `Intl.PluralRules` 가 없어 자체 분기). ko 는 단일 문자열로 두는 것이 관례입니다(`t()` 자체는 ko 의 복수 객체도 처리합니다).
- 없는 키는 `t()` 가 **키 문자열을 그대로** 돌려줍니다 — 화면에 `home.foo.bar` 가 보이면 키 누락입니다. 값을 조립하는 동적 키(`login.continue.<provider>`)는 ko/en 동치 테스트가 못 잡으니, 제공자 등을 추가할 때 두 JSON 에 모두 넣습니다.
- 시간·숫자·날짜는 문자열을 직접 만들지 말고 `src/i18n/format.ts` 의 `formatDuration`·`formatNumber`·`formatDate`(내부에서 `localeTag()` 로 `ko-KR`/`en-US` 선택)를 씁니다.
- **번역된 값을 모듈 최상위에 담지 않습니다** — `t()`·`localized()` 직접 호출뿐 아니라 `buildingNames.hall` 같은 값을 최상위 표에 복사해도 import 시점 언어로 굳어 언어를 바꿔도 그대로입니다(1.x 교훈, `WorldMap.tsx` `legacyDoors` 사례). 최상위 표에는 키만 두거나 프로퍼티 게터로 두고 렌더 바디·콜백에서 해석합니다. 화면 prop `e`(`App.tsx` 가 `RedesignScreens` 에 내려주는 이벤트·상태 객체)의 `e.localePref` 는 언어 변경 때 바뀌는 값이라, `memo`/`useMemo`/`useCallback` 안에서 `t()` 를 쓰면 이것을 prop·deps 에 넣습니다.
- `App.tsx` 의 `titles`(Datadog RUM 뷰 이름)는 번역하지 않습니다 — 분석 식별자입니다.
- 서버 오류 문구는 직접 분기하지 말고 두 함수 중 하나를 씁니다. `errorText(err)` 는 화면 공용 분기 — `CLIENT_STALE_SESSION` 은 `''`, `SLUG_NOT_FOUND`·`INVITATION_EXPIRED`·`STATE_CONFLICT`(= `VERSION_CONFLICT`)·`REQUEST_IN_PROGRESS`/재시도 가능 오류는 **ko 에서도 앱 문구**로 덮고, `FORBIDDEN` 은 서버 문구가 있으면 그것(ko 원문·en 번역), 나머지는 ko 는 서버 `message`, en 은 `errors.<code>`(없으면 `errors.GENERIC`). `errorTextOr(err, fallbackKey)` 는 종전 `x instanceof ApiError ? x.message : '한글'` 자리의 1:1 교체 — ko 는 서버 원문 그대로(비면 `fallbackKey`), en 은 `errorText` 결과(비면 `fallbackKey`), `ApiError` 가 아니면 `fallbackKey`. 어느 쪽이든 **en 에서 서버가 보낸 한글이 새어 나가면 안 됩니다**(`index.test.ts` 가 가립니다).
- 닉네임·섬 이름·퀘스트 제목 같은 사용자 데이터는 번역 대상이 아닙니다 — en 화면의 «한글 0자» 테스트는 영문 이름의 픽스처로 씁니다.

### 언어별 이미지 (GROMO-2240 머지 후 유효)

- 글자가 박힌 이미지는 `<이름>.ko.png`/`<이름>.en.png` 두 파일을 모듈 최상위에 **require 쌍으로만** 둡니다(`{ ko: require(...), en: require(...) }`).
- 실제 선택은 **렌더 시점**에 `localized({ ko, en })` 로 합니다(최상위에서 `localized()` 를 부르지 않습니다).
- en 자산은 `scripts/gen-localized-stamp.py` 처럼 전용 스크립트로 결정적으로 생성합니다(같은 입력이면 같은 픽셀). `npm run gen:localized-stamp` 로 재생성하고 `npm run gen:localized-stamp:check` 로 커밋 전 최신인지 확인합니다(글꼴이 없으면 exit 2, 폴백 글꼴 결과는 `*.en.fallback-preview.png` 에만 쓰고 커밋하지 않습니다).
- 자동 생성 스크립트가 없는 자산은 en 파일을 직접 그려 넣습니다 — require 쌍 구조는 같습니다.
- **새 이미지(언어별 이미지 포함)는 `src/assets/ota/` 아래에 둡니다** — `app.config.js` 의 `assetPatternsToBeBundled` 가 `src/assets/ota/**/*` 만 OTA 업데이트에 실어서, 이 경로 밖에 둔 새 이미지는 OTA 를 받은 구 바이너리(고정 `runtimeVersion`)에서 못 찾아 깨집니다. 예: `src/assets/ota/interiors/ui/blueprint-ready-stamp-v3.{ko,en}.png`.

### 저장·테스트

- 언어 선택은 `gromo.locale`(AsyncStorage, 값 `'ko'|'en'|'system'`, 미지원 값은 `'system'` 으로 정규화)에 **기기 전역**으로 저장합니다 — 계정과 무관하므로 로그아웃·회원 탈퇴의 `removeItem` 목록에 넣지 않습니다. 2.0 키가 없으면 부팅이 1.x 키 `gromo:settings:locale` 을 읽어 승계합니다.
- en 쪽을 확인하는 테스트는 `jest.setup.js` 가 전역으로 고정한 `expo-localization` ko-KR 모킹을 테스트 안에서 `mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }])` 로 덮고 `applyLocalePref('system')` 을 부릅니다. `mockReturnValue` 는 저절로 되돌아가지 않으므로 `afterEach` 에서 **먼저 ko-KR 로 `mockReturnValue` 를 되돌린 뒤** `applyLocalePref('system')` 을 불러야 다음 테스트가 ko 로 돌아갑니다(`LoginScreen.test.tsx` 참고). 한 번만 바꿀 거면 `mockReturnValueOnce` 도 됩니다.

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

릴리스 빌드는 PostHog `Catus / Catus`(US, 프로젝트 `669473`)로 이벤트를 보냅니다. [이벤트 목록](https://us.posthog.com/project/669473/activity/events)에서 수신을 확인합니다. 로컬 이벤트 큐와 식별자는 프로젝트 토큰별로 분리합니다. 기존 배포 앱은 업데이트 전까지 이전 설정을 사용합니다. 개발 빌드는 기본적으로 전송하지 않으며, 검증할 때만 `EXPO_PUBLIC_POSTHOG_DEV_ENABLED=1`을 설정합니다. `?demo`·`?review` 웹 화면은 수집 대상에서 제외합니다.

| 이벤트                              | 발생 시점                                           |
| ----------------------------------- | --------------------------------------------------- |
| `$screen`                           | 커스텀 라우터의 화면 전환                           |
| `guest_login_completed`             | 게스트 계정 세션 채택 완료                          |
| `member_conversion_completed`       | 소셜 회원 전환 완료                                 |
| `island_join_requested`             | 섬 가입 승인 요청 확정                              |
| `island_membership_activated`       | 섬 생성·즉시 가입·승인 후 소속 확정 (`method` 속성) |
| `focus_started` / `focus_completed` | 서버 집중 시작·정산 확정                            |
| `app_active`                        | 인증된 계정의 앱 시작·계정 변경·포그라운드 복귀     |
| `social_state_observed`             | 활동 시 서버에서 확인한 섬 소속·수락된 친구 수      |

로그인 세션의 서버 `userId`만 분석 식별자로 쓰고 로그아웃 시 식별자를 초기화합니다. 앱 열기·백그라운드 전환 등 생명주기와 터치를 자동 수집하며, 터치 속성과 요소 이름에는 기존 `testID`를 사용합니다. 화면 글자(`children`), 접근성 라벨, 입력값은 터치 속성으로 보내지 않습니다. 구분이 필요한 버튼에는 사용자 입력을 포함하지 않는 고정 `testID`를 붙이세요. 커스텀 라우터의 화면 전환은 기존 `$screen` 이벤트를 사용합니다. 터치 자동 수집은 조작 위치를 기록하고, 서버 처리 성공·완료 여부는 위 명시적 이벤트로 집계합니다.

iOS·Android [세션 리플레이](https://us.posthog.com/project/669473/replay)는 `@posthog/react-native-plugin`이 포함된 새 네이티브 빌드부터 사용할 수 있습니다. iOS는 `cd ios && pod install`로 Pods를 동기화합니다. Expo Go와 웹에서는 이 네이티브 리플레이를 사용할 수 없습니다. 모든 텍스트·입력값과 이미지, iOS 시스템 선택 화면을 마스킹하며 로그·네트워크 상세 수집과 위치 추정은 끕니다. 녹화 범위·샘플링은 PostHog 프로젝트 설정에서 관리합니다. 실제 기기에서 녹화 수신과 마스킹을 확인한 뒤 배포하세요.

프로젝트 토큰과 수집 호스트는 각각 `EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN`, `EXPO_PUBLIC_POSTHOG_HOST`로 빌드별 재정의할 수 있습니다. 기존 키가 빌드 환경변수에 남아 있으면 기본값보다 우선하므로 교체해야 합니다. 빈 토큰은 수집을 끄며, dev TestFlight는 기존대로 빈 토큰을 강제합니다.

Android CI의 main 릴리스는 AWS Secrets Manager `gromo/prod/android`의 `POSTHOG_PROJECT_TOKEN`과 `POSTHOG_REGION`을 읽어 위 SDK 환경변수에 적용합니다. `POSTHOG_REGION`은 `US`·`US Cloud` 또는 US PostHog 주소(예: `https://us.i.posthog.com`)로 지정할 수 있으며 수집 호스트로 변환됩니다. CLI 프로젝트 ID `669473`과 업로드 인증이 US Catus 프로젝트용이므로 EU 등 다른 리전은 거부합니다. 두 값이 없거나 유효하지 않으면 릴리스 빌드를 중단합니다. 심볼·소스맵 업로드 인증은 별도의 GitHub secret `POSTHOG_CLI_API_KEY`를 사용하며, 이 개인 API 키는 앱에 포함하지 않습니다. CI는 `npm ci`로 설치한 고정 버전 `posthog-cli`를 사용합니다.

### 첫 섬·집중, 섬·친구, 오류 대시보드

[Catus · 첫 섬과 집중](https://us.posthog.com/project/669473/dashboard/2220995)은 로그인 → 첫 섬 도착 → 첫 실제 집중 → 다른 날 재집중과 집중 습관·장소별 집중을 보는 9개 지표로 구성합니다. [섬과 친구](https://us.posthog.com/project/669473/dashboard/2234114)의 6개 지표와 [오류와 수집 상태](https://us.posthog.com/project/669473/dashboard/2234116)의 4개 지표, [섬 성장과 경제](https://us.posthog.com/project/669473/dashboard/2236458)의 6개 지표는 별도 대시보드에서 확인합니다. 성장·경제·장소별 집중 카드 8개는 게시·SQL 검증을 마쳤으며 필요한 이벤트는 아직 미계측입니다. 각 카드에는 집계 대상과 데이터의 의미를 짧게 설명합니다. 저장된 정의·상세 집계 기준·이벤트 구현 상태는 [analytics/README.md](analytics/README.md)에서 연결합니다.

최초 여정 카드 4개는 분석 정의만 준비된 상태이며 신규 `activation_step` 발행은 아직 구현하지 않았습니다. 기존의 일반 섬 가입·집중 이벤트를 최초 여정으로 간주하지 않습니다. 오류 카드 3개는 새 운영 빌드 적용과 수신 확인이 필요합니다. 이 준비 상태는 각 대시보드 상단에 안내합니다. JS 오류·운영 네이티브 크래시 자동 수집과 소스맵/심볼 업로드를 연결했으며 새 네이티브 빌드에 적용됩니다. 인증 파일과 플랫폼별 범위는 [계측 문서](analytics/README.md)를 따릅니다.

제품 이벤트뿐 아니라 JS SDK의 자동 수집·화면·생명주기·오류 이벤트에도 `analytics_environment`를 붙입니다. 개발 실행 또는 `EXPO_PUBLIC_ENV`가 `prod`·`production` 이외의 값인 빌드는 `development`이며, 비개발 실행에서 값이 없거나 운영 환경이면 `production`입니다. 네이티브 직접 전송은 JS 콜백을 거치지 않으므로 운영 환경에서만 크래시를 수집하고, 오류 SQL에서 환경 태그 없는 RN SDK의 fatal 이벤트를 함께 집계합니다. 개발·staging 네이티브 수집을 켤 때는 이 분류 규칙도 바꿔야 합니다.

`social_state_observed`는 친구 화면에 방문하지 않은 활성 계정도 포함하기 위해 앱 시작·계정 변경·복귀 때 `/me/islands`와 `/screens/friends`를 조회합니다. 복귀 시 조회는 5분 간격으로 제한하고 동시에 진행 중인 요청을 중복하지 않습니다. SDK가 꺼져 있거나 인증 세션이 없으면 추가 조회도 하지 않습니다. 계정 변경·로그아웃·구독 해제 뒤 이전 응답은 버립니다. 같은 실행 중의 섬·친구 변경은 다음 관측에 반영됩니다.

| 속성                       | 정의                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `analytics_schema_version` | 두 새 이벤트의 계약 버전 `1`                                                             |
| `island_status`            | 소속 섬이 하나 이상이면 `member`, 없으면 `drifting`, 조회 실패·불완전 응답이면 `unknown` |
| `island_count`             | 서버의 소속 섬 개수. 현재 선택 섬이 없어도 소속으로 계산                                 |
| `friend_count`             | 서버 목록의 중복을 제거한 수락된 친구 수. 요청·핀을 별도 가산하지 않음                   |
| `friend_bucket`            | `0` / `1` / `2-4` / `5+` / `unknown`                                                     |

조회에 실패한 수치는 필드를 생략하며 0으로 바꾸지 않습니다. 친구 이름·친구 ID·섬 이름·섬 ID 목록은 전송하지 않습니다. 표류에는 가입 대기·온보딩 중인 계정도 포함하고, 인증된 게스트 계정도 활동자로 포함합니다.

대시보드의 친구 평균·중앙값·분포는 최근 28일 관측 사용자별 **최신 관측 한 건**을 사용합니다. 전체 누적 가입자의 통계가 아니며 미확인 값을 제외한 분모를 표시합니다. 재방문 비교는 기간 내 **첫 관측 당시**의 섬·친구 구간을 고정하고 KST 기준 D1·D7 해당 날짜가 완전히 지난 사람만 분모에 넣습니다. 신규 가입 리텐션이나 친구 관계의 인과 효과로 해석하지 않습니다. 현재 집중에는 소속 섬이 필요하므로 표류 유저와 소속 유저의 집중률을 동등한 조건의 비교로 제시하지 않습니다. 새 계측은 앱 업데이트 이후부터 쌓이며 과거 프로젝트 데이터를 소급하지 않습니다.

웹 상호작용 검증은 정적 빌드를 로컬 서버로 띄운 뒤 실행합니다.

```sh
npm run build:all
python3 -m http.server 18762 --bind 127.0.0.1 --directory dist-all
npm run review:v2
npm run review:v2-journeys
```

`GROMO_REVIEW_URL`로 다른 로컬 검수 주소를 지정할 수 있습니다. `review:v2`는 화면·이미지·팻말 영역을, `review:v2-journeys`는 이동·구매·건설 등의 상태 변경을 확인합니다. 버튼 단위 검수는 `REVIEW_ROUTES=hall,construction,board,mail,shop,sound npm run review:buttons`처럼 경로를 제한할 수 있습니다. 버튼 클릭 성공만으로 저장·구매 완료를 판정하지는 않습니다. 실패나 실행 오류가 있으면 종료 코드 1을 반환하며 상세 결과는 `.docs/`에 저장합니다.

`?review`에서는 주입한 튜토리얼 진행도와 미완공·공사 상태를 보존합니다. 건물 내부 검수용 상태에는 `tutorial: { step: 99 }`를 지정하고, 튜토리얼 자체를 확인할 때만 `guideStep`을 명시합니다.

## 현재 연결 범위

로그인·계정, 섬·주민, 집중 세션, 친구·편지 등은 서버 API에 연결되어 있으며, 설정·화면 상태와 스크린타임 측정은 기기에서 처리합니다. 일부 시각 효과와 건설·음원 흐름은 앱 로컬 상태로 동작합니다. 새 API 연결 범위는 `src/services/api/`와 해당 기능 표를 함께 갱신합니다.

iOS 스토어 버전은 `1.0.2`(App Store Connect 에 새로 만든 Cattus 앱의 첫 버전과 맞춤), Android 는 동결된 1.x 패키지를 잇는 업데이트라 `2.0.0` 입니다. expo-updates `runtimeVersion` 은 플랫폼마다 따로 둡니다 — iOS `2.0.0-push`(GROMO-2523 푸시 네이티브, 체크인 `ios/Cattus/Supporting/Expo.plist` 도 같은 값), Android `2.0.0-no-special-use`(GROMO-2415). 런타임을 가르면 이전 런타임(iOS `2.0.0`) 바이너리는 새 OTA 를 받지 않고, 그 사용자는 새 바이너리로 업데이트해야 이후 수정을 받습니다. `scripts/ota-update.sh` 는 지금 커밋의 런타임으로 두 플랫폼을 함께 발행하므로 이전 런타임 전용 핫픽스에는 쓸 수 없습니다 — 옛 커밋에서 돌리면 Android 에 옛 JS 가 나가고, `eas update` 를 직접 부르면 이 스크립트의 운영값 주입·사전 검사를 건너뛰어 dev 설정이 운영 번들에 박힐 수 있습니다. `app.config.js` 의 `version` 은 Android 용 `2.0.0` 그대로이고, iOS 값은 `iosStoreVersionConfig.js` 의 `IOS_STORE_VERSION` 이 정본입니다 — prebuild 가 Info.plist 와 pbxproj 를 다시 써도 이 플러그인이 `MARKETING_VERSION` 과 `CFBundleShortVersionString` 을 `1.0.2` 로 되돌립니다. iOS 스토어 버전을 올릴 때는 pbxproj·Info.plist 와 이 상수를 함께 바꾸세요. iOS 식별자는 `com.oneorthree.focuscat`, Android 식별자는 `com.oneorthree.gromo`입니다. Xcode 프로젝트·워크스페이스·스킴·메인 타깃 이름은 `Cattus`(`ios/Cattus.xcworkspace`)이고, 홈 화면 앱 이름은 한국어 기기 `집중할고양`·그 외 `cattus` 입니다(`ios/Cattus/Supporting/*.lproj/InfoPlist.strings`·`locales/*.json`·Android `values-ko`). 번들 ID·URL 스킴 `gromo`·저장 키는 배포된 사용자 데이터와 묶여 있어 바꾸지 않습니다.
Kakao는 2.0 전용 Kakao 앱의 native key `1280641e9b639a279b7406f24b059703`을 iOS·Android 공통으로 씁니다. Kakao provider ID는 Kakao 앱마다 따로 발급되므로, 1.x 앱(native key `af3ff0c5…`)으로 가입한 카카오 사용자는 2.0에서 다른 계정으로 로그인됩니다(팀 결정, 2026-09-29). Kakao Developers 콘솔의 이 Kakao 앱에 iOS bundle ID `com.oneorthree.focuscat`, Android package `com.oneorthree.gromo`와 배포 서명 키 해시를 등록해야 합니다. 두 플랫폼 모두 OAuth callback scheme은 `kakao<key>`이고, iOS `Info.plist`와 Android manifest에 `kakao1280641e9b639a279b7406f24b059703` scheme이 들어 있어야 합니다.
Android release task graph는 기본 차단됩니다. Android legacy 세션의 RT를 잃지 않는 서버 멱등 승격 계약이 준비되고 검증된 뒤에만 `GROMO_LEGACY_SESSION_MIGRATION_READY=1`을 지정해 release 빌드를 실행하세요. release에는 실제 약관 문서 버전 `EXPO_PUBLIC_TERMS_VERSION`과 운영 API URL `EXPO_PUBLIC_API_URL=https://catus-api.oneorthree.world`이 모두 필요합니다. URL이 빠졌거나 dev/다른 주소이면 release artifact를 만들지 않습니다. 예를 들어 `GROMO_LEGACY_SESSION_MIGRATION_READY=1 EXPO_PUBLIC_TERMS_VERSION=2026-09 EXPO_PUBLIC_API_URL=https://catus-api.oneorthree.world ./gradlew :app:assembleRelease`입니다. 조건은 release artifact 작업에만 적용되며, debug 빌드와 `check`에는 영향을 주지 않습니다. release에는 기존 Play 업로드 키도 `android/credentials/prod/`에 필요하며, 새 업로드 키를 발급하지 않습니다.

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

서버의 dual-audience 지원(`gromo`와 `focuscat`)이 배포되고 기존 Apple 로그인 계정으로 검증되기 전까지는 iOS archive와 TestFlight 업로드가 차단됩니다. 릴리스에는 실제 배포 약관 문서 버전 `EXPO_PUBLIC_TERMS_VERSION`과 운영 API URL `EXPO_PUBLIC_API_URL=https://catus-api.oneorthree.world`이 필요하며, 빠졌거나 다른 주소이면 `ios/testflight.sh`, Fastlane `beta`, Xcode Release gate가 차단합니다. `ios/testflight.sh`와 Fastlane `beta` lane이 같은 `EXPO_PUBLIC_APPLE_LOGIN_ENABLED=1` readiness flag를 확인하므로 직접 Fastlane을 실행해도 우회할 수 없습니다. 이 Apple 플래그는 로그인 화면의 Apple 버튼에도 쓰이며, 설정하지 않은 debug/dev 빌드에는 출시 gate가 적용되지 않습니다.

```sh
cd ios
EXPO_PUBLIC_API_URL=https://catus-api.oneorthree.world EXPO_PUBLIC_APPLE_LOGIN_ENABLED=1 ./testflight.sh
```

스크립트는 Pods와 Fastlane 의존성을 확인하고, App Store Connect의 현재 `MARKETING_VERSION`(`1.0.2`) 최신 빌드번호 다음 번호로 archive·업로드합니다.

### dev 서버 빌드

팀 dev 서버(`https://oneorthree.dev.mooo.com`)를 바라보는 TestFlight 빌드는 `--dev`로 올립니다(인자는 없음 또는 정확히 `--dev`만 받고, 그 외는 오타로 보고 멈춥니다). 서버 주소는 스크립트와 Fastlane `beta_dev` lane이 직접 고정하므로 `EXPO_PUBLIC_API_URL`을 넘길 필요가 없고, 운영 주소를 넘겨도 dev 주소로 덮어씁니다. Xcode Release gate는 `GROMO_IOS_AUDIENCE=dev`일 때만 dev 주소를 허용합니다(그 외에는 여전히 운영 주소만). 테스트 노트 첫 줄에 "dev 서버" 표기가 붙고, 그 노트를 달기 위해 Apple 처리 완료를 기다리므로 운영 빌드보다 5~15분 더 걸립니다.

운영 빌드와 같은 번들 id로 올라가므로 운영 쪽에 섞이지 않게 lane이 몇 가지를 더 고정합니다: Datadog RUM 환경명 `EXPO_PUBLIC_ENV=dev`, PostHog 수집 끔(빈 토큰), OTA 업데이트(expo-updates) 끔 — 운영과 같은 채널·runtime을 쓰기 때문에 켜 두면 운영 OTA를 받아 운영 API가 박힌 JS로 바뀝니다(빌드 중 `Expo.plist`를 잠시 바꾸고 끝나면 원복). 저장된 로그인 세션은 아직 서버별로 분리하지 않아, 운영 빌드 위에 dev 빌드를 덮어 설치하면 첫 실행에서 운영 세션이 dev 서버에 거절돼 다시 로그인하게 됩니다. `bundle exec fastlane beta_dev`를 직접 부르면 `release-config.sh`를 거치지 않으므로 Datadog 값이 비어 lane이 막습니다 — 평소에는 `./testflight.sh --dev`를 쓰세요.

```sh
cd ios
./testflight.sh --dev
```

App Store Connect API 키는 `ASC_KEY_ID`·`ASC_ISSUER_ID`·`ASC_KEY_PATH` 환경변수가 이미 있으면 그대로 쓰고(CI 러너), 없을 때만 `ios/fastlane/.env`를 읽습니다(양식 `ios/fastlane/.env.example`). 1.x legacy 폴더의 설정은 더 이상 읽지 않습니다. main 머지 시 자동으로 이 빌드를 올리는 워크플로는 티켓 2219 에서 다룹니다.

### 푸시 설정 파일 `GoogleService-Info.plist` (GROMO-2523)

iOS 앱은 FCM 토큰을 받으려고 서버 환경별 Firebase 설정 파일을 앱 번들에 넣습니다. 파일은 커밋하지 않고 빌드 맥마다 둡니다. Xcode 빌드 단계 `[Firebase] Copy GoogleService-Info.plist`(`scripts/firebase-plist-xcode.sh`)가 Debug/Release 가 아니라 `EXPO_PUBLIC_ENV`(없으면 `dev`)로 파일을 고릅니다.

- 개발 맥: `ios/credentials/dev/GoogleService-Info.plist`·`ios/credentials/prod/GoogleService-Info.plist`(gitignore). 다른 곳에 두려면 `GROMO_IOS_CREDENTIALS_DIR`(그 아래 `dev/`·`prod/`)를 환경변수나 `ios/.xcode.env.local` 에 둡니다. 운영 서버로 디버그 빌드를 돌릴 때는 `ios/.xcode.env.local` 에 `export EXPO_PUBLIC_ENV=prod` 도 둡니다 — plist 와 서버 환경이 어긋나면 발송이 `SENDER_ID_MISMATCH` 로 실패합니다.
- plist 의 `BUNDLE_ID` 가 번들 id 와 다르거나 `PROJECT_ID` 가 `ios/release-config.sh` 의 `GROMO_FIREBASE_PROJECT_ID_DEV`·`_PROD`(각 서버 `FCM_PROJECT_ID`)와 다르면 빌드가 실패합니다. 파일이 없으면 Release 는 실패하고, Debug 는 경고만 내고 푸시 없이 빌드합니다(`FCMTokenModule` 이 `NOT_CONFIGURED` 로 거절).
- TestFlight 러너 맥은 레포 밖 경로를 씁니다 — [`ios-testflight-dev-runner.md`](../../docs/conventions/ios-testflight-dev-runner.md) 「푸시 설정 파일」.

### 약관 문서 버전 `EXPO_PUBLIC_TERMS_VERSION`

앱이 사용자에게 보여 준 약관 문서의 판을 가리키는 꼬리표입니다. 빌드에 박혀 로그인 요청의 `termsVersion`으로 서버에 전달되고, 서버는 사용자가 어느 판에 동의했는지를 이 값으로 기록합니다. 비어 있으면 로그인이 막히므로 운영·dev 빌드 모두 필수입니다.

- **정본은 `ios/release-config.sh`** (현재 `2026-09`) — 지금 올라가 있는 약관 문서 기준이며, 2026-10 까지의 TestFlight 빌드가 전부 이 값으로 나갔습니다. 바꾸면 기존 동의 기록과 판이 달라지므로 약관 문서를 실제로 개정할 때만, PR로 바꿉니다. `testflight.sh`가 이 파일을 읽으므로 명령 앞에 값을 붙일 필요가 없고, 붙이면 그 값이 우선합니다.
- 허용 값 목록(정책 Q05)은 아직 서버에 없습니다. 형식은 64자 안의 문자열이면 되지만, 의미는 약관 문서의 판이어야 합니다.

## Android 스크린타임

`modules/screen-time`은 1.x의 UsageStatsManager 계산기를 이식한 로컬 Expo 모듈입니다. Expo Go에서는 사용할 수 없으며 네이티브 개발 빌드가 필요합니다.

- `src/services/ScreenTimeModule.ts`: Android Expo 모듈과 기존 iOS RN 브리지 선택.
- `src/services/androidScreenTime.ts`: 시작·복귀·자정·활성 상태 1분 간격으로 계정별 측정 원장을 조회하고 공통 서버 보고 큐에 연결합니다. 화면은 KST 날짜, 서버 보고는 원본 이벤트를 UTC 자정~자정 구간으로 다시 집계합니다. KST 합계의 날짜만 바꾸지 않습니다.
- 설정 → 앱 권한 관리에서 측정 앱과 집중 중 허용 앱을 별도로 고릅니다. 측정 대상은 최초 선택 직후, 변경은 다음 KST 자정부터 적용합니다. 빈 측정 목록을 전체 앱으로 간주하지 않습니다. 허용 앱의 빈 목록은 추가 예외 없음입니다.
- 최초 측정 이전·선택 변경을 가로지르는 UTC 일자·권한 공백·재부팅·원본 결측은 0으로 보고하지 않습니다. 보상 보고에는 일별 통계 근사 폴백을 쓰지 않습니다. 현재 서버 계약에 맞춰 진행 중 UTC 날짜는 `pending`, 마감된 날짜만 수치로 보고합니다. 당일 중간 관측/최종 확정 계약은 iOS와 공통 후속입니다.
- 집중 차단(`FocusShieldService`·가림막)과 집중/휴식 지속 알림, 이를 갱신하던 FCM 수신은 GROMO-2415에서 뺐습니다(`specialUse` 포그라운드 서비스 제거, Android runtime `2.0.0-no-special-use`). 모듈은 `supportsFocusShield=false`를 내보내고, JS는 허용 앱·다른 앱 위에 표시·집중 상태 알림 설정을 숨기며 `syncAndroidFocus`·집중 푸시 등록을 건너뜁니다. 네이티브 `endAndroidFocus`는 이전 버전이 남긴 알림(4201)과 복구 상태만 지웁니다. 아래 FCM 설정과 실기기 점검의 오버레이·알림·FCM 항목은 차단 기능을 되살릴 때만 해당합니다.
- 홈 위젯은 서버 홈 스냅샷의 오늘 총 집중시간과 고양이 4포즈를 표시합니다. 계정 변경·로그아웃 시 지우고 KST 날짜가 만료되면 미확인으로 표시합니다. 제조사별 위젯 갱신 주기에 따라 자정·포즈 갱신이 지연될 수 있습니다.
- 모듈 namespace는 `com.oneorthree.gromo.screentime`이며 실제 권한 검사는 `context.packageName`을 사용합니다. 앱 applicationId 변경과 독립적입니다.

FCM 설정은 `android/credentials/{dev|prod}/google-services.json`에서 해당 `GROMO_ANDROID_AUDIENCE` 파일만 읽습니다(기본 prod). 등록 패키지는 `com.oneorthree.gromo`이며 파일은 커밋하지 않습니다. 미설정 개발 빌드도 로컬 측정·차단·위젯은 사용할 수 있지만 FCM 원격 갱신은 사용할 수 없습니다. 서버는 기존 `FCM_PROJECT_ID`·base64 `FCM_SERVICE_ACCOUNT_JSON`을 재사용하고 V107·V108 마이그레이션과 Data API 배포가 필요합니다. iOS 전용 APNs 설정은 유지합니다.

검증은 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test -- --runInBand`, `android/`의 `./gradlew :app:assembleDebug :screen-time:testDebugUnitTest`로 수행합니다. 실기기에서는 사용 정보 접근·오버레이·알림 권한 허용/철회, 측정/허용 앱 독립성, 집중→휴식→종료, 전화·알람, KST/UTC 경계, 계정 전환, 실제 FCM 수신, 절전·강제 종료·재부팅, 위젯 탭/자정/로그아웃을 확인합니다. 네이티브 모듈 변경이므로 새 설치본이 필요합니다.
