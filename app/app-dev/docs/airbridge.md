# iOS·Android Airbridge 연동

앱 이름은 `catus`, Android 패키지는 `com.oneorthree.gromo`, iOS Bundle ID는 `com.oneorthree.focuscat`이다. 기존 Airbridge React Native SDK 4.11.0(iOS SDK 4.11.1)을 재사용한다. 두 플랫폼이 같은 로그인·집중 완료 이벤트와 사용자 식별 흐름을 사용한다.

## 빌드 설정

1. [catus SDK 토큰 설정](https://app.airbridge.io/app/catus/settings/tokens)에서 **App SDK Token**을 확인한다. API 토큰은 사용하지 않는다.
2. `app/app-dev/.env.local` 또는 빌드 환경 변수에 `AIRBRIDGE_APP_TOKEN`을 설정한다. 미설정 개발 빌드는 SDK 초기화를 건너뛰며, Android 릴리스 APK/AAB 및 iOS Release 빌드는 실패한다.
3. 개발 빌드로 온보딩을 검증하려면 `EXPO_PUBLIC_AIRBRIDGE_DEV_ENABLED=1`도 설정한다.
4. Android는 `npm run android`, iOS는 `cd ios && pod install` 후 Xcode의 `Cattus.xcworkspace`로 새 네이티브 앱을 빌드·설치한다. SDK 토큰 변경도 네이티브 리빌드가 필요하다. Expo Go와 OTA 업데이트만으로는 SDK를 설치할 수 없다.

직접 Gradle 빌드는 `airbridge.gradle`이 Expo의 `.env` 로딩 규칙으로 토큰을 읽고 빌드 산출물에 `BuildConfig` 상수를 생성한다. 토큰을 소스에 저장하지 않는다. 이 저장소는 체크인된 네이티브 프로젝트를 빌드하므로 `expo prebuild --clean`으로 덮어쓰지 않는다. SDK 토큰은 앱에 포함되는 클라이언트 식별자이므로 서버 비밀로 사용해서는 안 된다.

GitHub Actions의 `AIRBRIDGE_APP_TOKEN` 저장소 변수에는 catus App SDK Token을 등록한다. Android CI의 키 없는 build 잡과 iOS TestFlight 빌드 잡이 이 값을 주입하며, 누락·자리표시자 토큰은 Gradle 릴리스 가드가 거부한다. 수동 운영 빌드도 같은 환경 변수가 필요하다. 이 값은 공개 클라이언트 식별자이며 Airbridge API 토큰이나 서명 키를 넣지 않는다.

## 이벤트

Core 플랜에서 지원하는 표준 이벤트만 전송한다. 서버 응답과 앱 상태 반영이 성공한 기존 제품 이벤트 지점을 재사용한다.

| 동작                          | Airbridge 이벤트              | 속성                                                                                 |
| ----------------------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| 설치·실행·새 세션 진입        | SDK 자동 이벤트               | SDK가 수집                                                                           |
| 게스트 로그인 완료            | `airbridge.user.signin`       | `action=guest`                                                                       |
| 소셜 로그인 완료              | `airbridge.user.signin`       | `action=provider`                                                                    |
| 게스트에서 회원으로 전환 완료 | `airbridge.user.signin`       | `action=provider`, `label=member_conversion`                                         |
| 집중 완료 및 보상 확정        | `airbridge.unlockAchievement` | `achievementID=focus_completed`, `score=earned_fish`, 커스텀 속성 `duration_seconds` |

회원 전환에는 기존 회원 계정으로의 전환도 포함되므로 가입 이벤트로 기록하지 않는다. 집중 시작·섬 가입 등 대응하는 표준 이벤트가 없는 동작은 Airbridge에 보내지 않는다. 기존 PostHog 전송은 유지한다.

인증 세션 변경 시 서버의 사용자 ID를 설정하고 세션 해제 시 SDK 사용자 정보를 초기화한다. 이메일·전화번호·소셜 토큰은 전달하지 않는다. SDK 자동 추적은 `airbridge.json`에서 지연하고 JS에서 시작한다. 데모 모드 및 명시적으로 허용하지 않은 개발 빌드는 추적하지 않는다.

## 온보딩 확인

새 빌드에서 앱 실행 → 로그인 → 집중 완료를 수행한 뒤 [catus 대시보드](https://app.airbridge.io/app/catus)로 돌아가 설치·로그인·과제 달성 이벤트 수신을 확인하고 온보딩을 계속한다. 코드 및 컴파일 검증과 실제 대시보드 수신 검증은 별개다.

Airbridge 딥링크는 아래 설정으로 기존 앱 링크 라우터에 전달한다. 로그인 콜백과 기존 앱 링크 처리도 유지한다.

공식 참고: [Expo SDK](https://help.airbridge.io/en/developers/expo-sdk-v4), [표준 이벤트](https://help.airbridge.io/en/guides/airbridge-event-types).

## iOS 초기화·ATT

Xcode의 `[Airbridge] Generate app configuration` 단계가 같은 `.env` 로딩 규칙으로 앱 번들에 `AirbridgeConfig.json`을 생성한다. 토큰은 소스에 기록하지 않으며 설정 변경 시 항상 다시 생성한다. `AppDelegate`는 이 파일로 RN 실행 전에 SDK를 초기화한다. 확장 프로그램에는 SDK 설정이나 ATT 요청을 추가하지 않는다.

개발 빌드의 `EXPO_PUBLIC_AIRBRIDGE_DEV_ENABLED=1`은 네이티브 빌드와 Metro 양쪽에 적용해야 한다. 데모 또는 개발 수집 제외 시 iOS 네이티브 초기화와 ATT 요청도 건너뛴다. 토큰·개발·데모 설정 변경은 새 네이티브 빌드가 필요하다.

앱이 처음 활성화될 때 ATT 상태가 미결정인 경우에만 권한을 요청한다. 한국어·영어 사용 목적 문구를 제공하며 SDK는 최대 30초 동안 ATT 결정을 기다린다. 거부·제한 상태에서는 IDFA 없이 SDK 정책에 따라 이벤트를 수집하며 앱 사용을 막지 않는다. 공통 `autoStartTrackingEnabled=false` 설정과 JS `startTracking`은 그대로 적용한다.

시뮬레이터 설치·전송 확인과 실제 iPhone의 ATT/IDFA·광고 유입 검증은 별개다. 실기기에서는 허용·거부 후 설치·로그인·집중 완료 이벤트를 대시보드에서 각각 확인한다.

## 딥링크

Airbridge에 두 플랫폼의 URI 스킴 `gromo://`, iOS App ID `P6Z68QUK9M.com.oneorthree.focuscat`, Android 패키지 `com.oneorthree.gromo`와 사용자 제공 Play 앱 서명 SHA-256을 등록했다. `catus.airbridge.io`와 `catus.abr.ge`의 AASA·assetlinks 공개 응답도 확인한다. 인증서가 변경되면 대시보드 등록값도 갱신해야 한다.

- Android: MainActivity의 두 HTTP intent-filter가 App Links를 수신하고 `onResume`에서 SDK에 전달한다. `onNewIntent`는 최신 intent를 유지한다.
- iOS: Associated Domains에 두 호스트를 등록하고 AppDelegate의 URL·Universal Link 콜백에서 SDK를 호출한다. 기기용 배포 프로파일에는 Associated Domains capability가 포함돼야 한다.
- JS: `setOnDeeplinkReceived`를 추적 시작 전에 등록한다. SDK가 복원한 링크만 기존 라우터로 넘기며, 화면 구독 전의 지연 딥링크는 한 번 보관한다. OS·SDK의 같은 목적지 중복 알림은 1초 이내 한 번만 전달한다.

추적 링크 생성 시 앱 내 목적지 예시는 `gromo://home`, `gromo://friends`, `gromo://focus`다. 섬은 `gromo://group?g=<UUID>`, 잡지는 `gromo://magazine?issue=<UUID>`를 사용한다. 기존 로그인·온보딩 중 링크 보관과 사용자 세션 검사를 그대로 거친다. 임의 외부 URL을 앱 내부 화면으로 실행하지 않는다.

iOS는 사용자 확인 기준 미출시이므로 Airbridge 스토어 주소 `https://apps.apple.com/app/id0`을 유지한다. 출시 후 실제 App Store 주소를 입력해야 미설치 사용자의 스토어 이동을 검증할 수 있다. 설치 상태의 스킴 진입 테스트, OS 연결 파일 검증, 실제 광고 링크의 설치 후 지연 이동은 서로 다른 검증 항목이다.
