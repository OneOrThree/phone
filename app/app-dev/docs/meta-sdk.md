# Android Meta SDK

Meta 앱 ID는 `1092876403132413`, Android 패키지는 `com.oneorthree.gromo`, 기본 액티비티는 `com.oneorthree.gromo.MainActivity`다. Meta 대시보드의 Android 설정에는 이 패키지·클래스를 입력한다.

## 설치와 설정

앱 이벤트 측정용 공식 `com.facebook.android:facebook-core:19.0.0` 모듈을 고정 버전으로 설치한다. Maven Central과 INTERNET 권한은 기존 설정을 재사용한다. SDK의 `FacebookInitProvider`가 앱 시작 시 초기화하므로 수동 `FacebookSdk.sdkInitialize` 호출은 추가하지 않는다.

1. 해당 Meta 앱의 설정 → 고급에서 **Client Token**을 확인한다. App Secret 또는 Airbridge 토큰을 사용하지 않는다.
2. `app/app-dev/.env.local` 또는 빌드 환경 변수에 `META_CLIENT_TOKEN`을 설정한다.
3. GitHub Actions 저장소 변수 `META_CLIENT_TOKEN`에도 같은 값을 등록한다. Android CI build 작업이 이 공개 클라이언트 토큰을 주입한다.
4. 새 Android 바이너리를 빌드한다. OTA만으로 SDK와 토큰을 설치할 수 없다.

토큰은 `meta.gradle`에서 생성한 문자열 리소스에만 들어간다. 미설정 상태는 빌드 로그에 경고하고 provider·자동 초기화·이벤트 수집을 모두 비활성화하므로 **SDK가 포함되어 있어도 측정 완료 상태가 아니다**. Client Token을 등록한 뒤 다시 빌드해야 한다.

개발 빌드의 자동 수집은 기본적으로 비활성화된다. 테스트 기기에서 검증할 때만 `META_DEV_ENABLED=1`로 네이티브 빌드한다. 릴리스는 토큰 설정 시 자동 설치·앱 활성화 이벤트와 광고 식별자 수집을 켠다. 화면 제목·AppLink 메타데이터 및 제품 개선 데이터 자동 전송은 비활성화한다.

## 이벤트 확인

토큰을 설정한 새 APK 설치 → 앱 실행 → Meta 이벤트 관리자의 앱 테스트 이벤트에서 설치·활성화 수신을 확인한다. 빌드 및 매니페스트 검증은 서버의 이벤트 수신 확인과 다르다.

이번 변경은 Android 앱 이벤트 SDK 설치 범위다. 기존 OAuth 로그인 흐름은 유지하며 Facebook Login·Share UI 모듈은 추가하지 않는다. Airbridge 전환 이벤트를 Meta 파트너 연동으로 전달한다면 같은 사용자 동작을 Meta 커스텀 이벤트로 이중 전송하지 않도록 이벤트 소유권을 확인한다.

공식 근거: [SDK 모듈 설치](https://github.com/facebook/facebook-android-sdk/blob/sdk-version-19.0.0/README.md), [19.0.0 변경 사항](https://github.com/facebook/facebook-android-sdk/blob/sdk-version-19.0.0/CHANGELOG.md), [자동 초기화 provider](https://github.com/facebook/facebook-android-sdk/blob/sdk-version-19.0.0/facebook-core/src/main/java/com/facebook/internal/FacebookInitProvider.kt).
