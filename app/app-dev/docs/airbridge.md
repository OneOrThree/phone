# Android Airbridge 연동

앱 이름은 `catus`, Android 패키지는 `com.oneorthree.gromo`다. main에 설치된 Airbridge React Native SDK 4.11.0을 재사용한다. 이번 설정·실행 검증 대상은 Android다. iOS의 기존 초기화 코드는 유지하며 iOS 토큰 설정·ATT·실기기 검증은 별도 작업이다.

## 빌드 설정

1. [catus SDK 토큰 설정](https://app.airbridge.io/app/catus/settings/tokens)에서 **App SDK Token**을 확인한다. API 토큰은 사용하지 않는다.
2. `app/app-dev/.env.local` 또는 빌드 환경 변수에 `AIRBRIDGE_APP_TOKEN`을 설정한다. 미설정 개발 빌드는 SDK 초기화를 건너뛰며, 릴리스 APK/AAB 생성은 실패한다.
3. 개발 빌드로 온보딩을 검증하려면 `EXPO_PUBLIC_AIRBRIDGE_DEV_ENABLED=1`도 설정한다.
4. `npm run android`로 새 네이티브 앱을 빌드·설치한다. SDK 토큰 변경도 네이티브 리빌드가 필요하다. Expo Go와 OTA 업데이트만으로는 SDK를 설치할 수 없다.

직접 Gradle 빌드는 `airbridge.gradle`이 Expo의 `.env` 로딩 규칙으로 토큰을 읽고 빌드 산출물에 `BuildConfig` 상수를 생성한다. 토큰을 소스에 저장하지 않는다. 이 저장소는 체크인된 네이티브 프로젝트를 빌드하므로 `expo prebuild --clean`으로 덮어쓰지 않는다. SDK 토큰은 앱에 포함되는 클라이언트 식별자이므로 서버 비밀로 사용해서는 안 된다.

GitHub Actions의 `AIRBRIDGE_APP_TOKEN` 저장소 변수에는 catus App SDK Token을 등록한다. Android CI의 키 없는 build 잡이 이 값을 주입하며, 누락·자리표시자 토큰은 Gradle 릴리스 가드가 거부한다. 수동 운영 빌드도 같은 환경 변수가 필요하다. 이 값은 공개 클라이언트 식별자이며 Airbridge API 토큰이나 서명 키를 넣지 않는다.

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

광고 링크에서 특정 화면으로 이동해야 한다면 Airbridge 딥링크 설정을 별도로 추가한다. 이번 변경은 기존 로그인 콜백·앱 링크 라우팅을 수정하지 않는다.

공식 참고: [Expo SDK](https://help.airbridge.io/en/developers/expo-sdk-v4), [표준 이벤트](https://help.airbridge.io/en/guides/airbridge-event-types).

`airbridge.json`은 공통 SDK의 자동 수집을 지연한다. JS 초기화는 iOS·Android 모두에서 같은 개발·데모 제외 조건을 적용하므로, 나중에 iOS 네이티브 토큰을 설정해도 `startTracking` 경로를 재사용한다.
