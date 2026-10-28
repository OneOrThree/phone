# 게스트 로그인 TestFlight 배포 기록

- 앱: GROMO 2.0 `com.oneorthree.focuscat`
- 앱 변경: [GROMO-2111](https://romance.atlassian.net/browse/GROMO-2111), [PR #969](https://github.com/OneOrThree/phone/pull/969)
- 시간대: 2026-09-23 KST

## 소스

PR #969가 `43bfa609b`로 머지된 뒤 `git pull --ff-only origin main`으로 별도 작업 트리의 `main`을 해당 커밋까지 갱신했다. 먼저 만든 빌드 8은 머지 전 코드로 생성되어 업로드 프로세스를 중단했다. 17:25 KST App Store Connect의 최신 등록 빌드는 여전히 7이었다.

머지된 앱 코드와 이 후속 PR의 iOS 릴리스 설정으로 `2.0.0 (9)`를 아카이브했다. 앱은 `POST /auth/sessions/guest`로 게스트 세션을 발급하고 설치별 장치 ID와 세션 토큰을 SecureStore에 보관한다. 서버 경로 오류는 공통 API 클라이언트에서 재시도 안내로 표시한다.

## iOS 릴리스 설정

- 앱과 확장 대상의 서명을 자동 서명으로 변경했다. 기존 수동 프로비저닝 프로파일은 아카이브에 사용할 수 없었다.
- Homebrew Ruby의 Bundler 경로를 사용하고, App Store Connect의 최신 빌드 번호와 Xcode 프로젝트 번호 중 큰 값에서 다음 번호를 선택한다.
- 앱의 `Info.plist`에 `ITSAppUsesNonExemptEncryption=false`를 추가했다. 새 암호화 기능을 도입하면 이 선언을 재검토해야 한다.
- `pod install` 후 Datadog을 포함한 103개 Pod가 설치됐다. 작업 트리의 `node_modules` 심볼릭 링크 때문에 생성된 로컬 Podfile.lock 경로 변경은 커밋하지 않았다.

## 검증과 업로드

- Xcode 아카이브 및 IPA 내보내기 성공.
- IPA `2.0.0 (9)`에서 `AppIcon` 2개, `ITSAppUsesNonExemptEncryption=false`, Hermes 번들의 `/auth/sessions/guest`를 확인했다.
- IPA SHA-256: `6988d2a2e8cc73ea964253430ea422d7db65596e765648c19934681eacf12d9d`.
- Fastlane은 17:33:48 KST에 `Successfully uploaded package to App Store Connect`를 반환하고 종료 코드 0으로 끝났다. `skip_waiting_for_build_processing=true`이므로 Apple 처리 완료와 테스터 표시 상태는 확인하지 않았다.
- 공개 개발 호스트는 17:12 KST에 `/health`, `/screens/board`, `/auth/sessions/guest` 모두 502였다. 17:34 KST에는 `/health`가 200으로 회복됐으나 뒤의 두 경로는 404였다. 게스트 로그인 성공은 서버 경로가 정상 연결된 뒤 실제 기기에서 확인해야 한다.
