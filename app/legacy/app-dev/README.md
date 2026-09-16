# GROMO 앱

> 집중 기록, 캐릭터 성장, 친구와 섬 활동을 제공하는 React Native·Expo 앱입니다.

[전체 프로젝트](../../../README.md) · [서버 전체 보기](../../../server/README.md) · [기능 문서](../../../docs/README.md) · [프론트엔드 개발 가이드](.claude/CLAUDE.md)

> ⚠️ **동결된 1.x 앱입니다** (스토어 1.1.0까지). 2.0.0부터는 같이숲 v2 앱이 `app/app-dev/`에 들어옵니다 —
> 새 기능은 여기에 넣지 않습니다. 이 앱에는 CI가 없으므로 핫픽스는 로컬에서 직접 검증합니다
> (`npm ci && npm run lint && npm run typecheck && npm test`).
>
> **앱이 이동한 커밋을 처음 받았다면 자격·설정 파일을 먼저 옮기세요.** `git mv`는 추적 파일만 옮기므로
> `.env*` · Firebase plist · `fastlane/.env` · `sentry.properties` · `android/credentials/` 같은
> **비추적 파일은 옛 경로 `app/app-dev/`에 그대로 남습니다.** 안 옮기면 TestFlight·Android 빌드가 자격
> 파일 누락으로 실패하고, 나중에 v2 앱이 같은 자리에 들어오면 남은 1.x 환경 변수를 읽을 수 있습니다.
> 저장소 루트에서 한 번만 실행합니다.
>
> ```sh
> old=app/app-dev; new=app/legacy/app-dev
> for p in .env .env.local .env.production .env.hotupdater \
>          ios/GoogleService-Info-dev.plist ios/GoogleService-Info-prod.plist \
>          ios/fastlane/.env ios/sentry.properties \
>          android/sentry.properties android/credentials; do
>   [ -e "$old/$p" ] || continue
>   mkdir -p "$new/$(dirname "$p")"
>   mv "$old/$p" "$new/$p"
> done
> rm -rf "$old"   # 남은 것은 node_modules · Pods · 빌드 산출물뿐입니다
> ```
>
> iOS는 프로젝트 경로가 바뀌었으므로 다음 빌드 전에 `ios/`에서 `pod install`과 클린 빌드를 한 번 합니다.

## 한눈에 보기

| 영역      | 구현                                                        |
| --------- | ----------------------------------------------------------- |
| 런타임    | React Native 0.86, Expo SDK 57, React 19, TypeScript strict |
| 화면 이동 | React Navigation의 탭과 Native Stack                        |
| 상태      | Context API와 hooks, AsyncStorage 영속화                    |
| 서버 통신 | axios, JWT 주입과 401 재발급                                |
| 네이티브  | iOS Screen Time 확장, Android 사용량 권한, 푸시·분석 SDK    |
| 배포      | TestFlight, Android release, hot-updater OTA                |

## 코드 구조

```text
src/
  App.tsx          인증·온보딩 게이트와 Provider 구성
  navigation/      탭·스택과 라우트 타입
  screens/         기능별 화면
  components/      여러 기능이 함께 쓰는 UI
  services/        API·네이티브·외부 연동
  store/           전역 Context 상태
  hooks/           공용 hooks
  constants/       테마·공용 값
  types/           공용 TypeScript 타입
  utils/           공용 순수 함수
  legacy/          참조용 v1 코드
```

`@/`는 `src/`를 가리킵니다. 화면 전용 코드부터 해당 기능 폴더에 두고, 둘 이상의 기능이 함께 사용할 때 공용 폴더로 옮깁니다. 상세 배치 규칙은 [프론트엔드 개발 가이드](.claude/CLAUDE.md)를 따릅니다.

## 로컬 실행

Node.js 24 이상을 준비하고 이 디렉터리에서 실행합니다.

```bash
npm install
cp .env.example .env
npm start
```

| 대상               | 명령                                                     |
| ------------------ | -------------------------------------------------------- |
| iOS 시뮬레이터     | `npm run ios`                                            |
| Android 에뮬레이터 | `npm run android`                                        |
| 웹 디버깅          | 저장소 루트에서 `./app/legacy/scripts/local-web.command` |
| 타입 검사          | `npm run typecheck`                                      |
| 린트               | `npm run lint`                                           |
| 테스트             | `npm test`                                               |

### 서버 연결

`.env`의 `EXPO_PUBLIC_API_URL`로 API 서버를 선택합니다. 로컬 Data API는 기본적으로 `http://localhost:8080`을 사용하며, 실기기에서는 개발 머신의 LAN IP를 지정합니다. 사용 가능한 키는 [.env.example](.env.example)을 기준으로 합니다.

<details>
<summary><strong>네이티브 첫 실행 준비 보기</strong></summary>

iOS 네이티브 의존성은 처음 한 번과 네이티브 패키지가 바뀐 뒤에 설치합니다.

```bash
cd ios
pod install
cd ..
npx expo run:ios --device
```

Android 실기기는 USB 디버깅을 켠 뒤 `npx expo run:android --device`로 설치합니다. `expo prebuild`는 기존 네이티브 프로젝트를 다시 생성하므로 실행하지 않습니다.

</details>

## 인증과 플랫폼 기능

- 앱은 카카오, Apple, Google, LINE, Meta 로그인을 노출합니다.
- iOS Screen Time은 별도 확장 타겟과 Expo 네이티브 모듈을 사용합니다.
- 네이티브 로그인·푸시·스크린타임은 웹 디버깅에서 비활성화됩니다.
- API 요청은 `src/services/api.ts`의 공용 axios 인스턴스를 사용합니다. 인증 전 요청과 토큰 재발급처럼 인터셉터를 우회해야 하는 경로는 개발 가이드에 기록되어 있습니다.

## 빌드와 배포

| 작업            | 시작점                       |
| --------------- | ---------------------------- |
| TestFlight      | `ios/testflight.sh`          |
| Android release | `scripts/android-release.sh` |
| OTA             | hot-updater 설정과 배포 명령 |
| Maestro E2E     | `scripts/e2e.sh`             |

서명 자산, Firebase 설정, 새 머신 준비와 배포 절차는 [.claude/DevRunbook.md](.claude/DevRunbook.md)를 정본으로 사용합니다.

## 더 보기

- 기능별 PRD·정책·설계: [docs/README.md](../../../docs/README.md)
- 앱 코드 규칙과 상세 구조: [.claude/CLAUDE.md](.claude/CLAUDE.md)
- Screen Time 통합 기록: [.claude/ScreenTime_WorkLog.md](.claude/ScreenTime_WorkLog.md)
- 서버 연결과 서비스별 실행: [server/README.md](../../../server/README.md)
