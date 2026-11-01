# PostHog 출시 전 대시보드

대시보드는 집계 대상과 데이터의 의미를 짧게 설명하고, 상세 집계 기준은 [posthog-metric-definitions.md](posthog-metric-definitions.md)에 보관합니다. 대시보드 정의와 앱 계측 구현 상태를 구분합니다. 운영 이벤트가 없는 것은 출시 전에는 정상이며, 0% 전환율이나 크래시 없음의 근거가 아닙니다.

| 대시보드                                                                            | 지표 수 | 저장된 정의                                                                                     |
| ----------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| [Catus · 첫 섬과 집중](https://us.posthog.com/project/669473/dashboard/2220995)     | 9       | [기존 정의](posthog-dashboard.json) · [장소별 추가 정의](posthog-focus-location-additions.json) |
| [Catus · 섬과 친구](https://us.posthog.com/project/669473/dashboard/2234114)        | 6       | [posthog-social-dashboard.json](posthog-social-dashboard.json)                                  |
| [Catus · 오류와 수집 상태](https://us.posthog.com/project/669473/dashboard/2234116) | 4       | [posthog-health-dashboard.json](posthog-health-dashboard.json)                                  |
| [Catus · 섬 성장과 경제](https://us.posthog.com/project/669473/dashboard/2236458)   | 6       | [posthog-growth-dashboard.json](posthog-growth-dashboard.json)                                  |

각 대시보드의 상단 안내 한 개에 수집 상태·집계 범위와 다른 대시보드 링크를 둡니다. 기존 인사이트 ID와 쿼리는 유지하고 배치·제목·설명만 변경합니다.

## AI 집중측정·미리보기 비교 · 2026-11-01

[Catus · 2주 집중과 생활 변화](https://us.posthog.com/project/669473/dashboard/2220995) 하단에 AI 비교 섹션을 추가했습니다. 운영 환경의 낚시섬 집중 중 관측을 기준으로 최근 14개 UTC 날짜의 고유 사용자를 비교합니다.

- [AI 집중측정 ON·OFF 사용자](https://us.posthog.com/project/669473/insights/CJ8K1PRL): 전체 관측 사용자와 측정 ON·OFF 사용자.
- [AI 측정·미리보기 조합별 사용자](https://us.posthog.com/project/669473/insights/jwdHMWw9): 측정 ON/OFF × 미리보기 열림/닫힘 네 조합.
- 기존 13개 타일의 쿼리·배치·안내문·필터를 보존했고 새 카드의 실행을 확인했습니다. **아직 새 앱 이벤트가 수신되지 않아 수집 대기 상태이며, 화면의 0은 실제 사용자가 0명이라는 뜻이 아닙니다.**

앱은 `focus_verification_state_observed`를 집중 전·집중 화면 진입 및 상태 변경에 연결했습니다. 최초 OFF도 관측하고 변경 여부를 따로 보내므로 기본 OFF와 실제 끈 행동을 구분할 수 있습니다. 단순 재렌더·권한 거절은 변경 성공으로 보내지 않습니다. 같은 사용자가 여러 상태를 경험할 수 있어 막대 합계는 전체 인원이 아닙니다. 영상·판정·인증 시간은 전송하지 않습니다.

정의와 검증 기록은 [추가 카드 정의](posthog-focus-verification-additions.json)와 [지표별 집계 기준](posthog-metric-definitions.md#ai-집중측정-사용-상태)에 있습니다. Data Catalog의 두 정의는 승인 전 `proposed` 상태입니다. 앱의 새 빌드 적용·실기기 수신 확인은 아직 하지 않았습니다. 공식 기능 참고: [PostHog 대시보드](https://posthog.com/docs/product-analytics/dashboards).

## 게시 완료·미계측: 섬 성장·경제와 집중 장소

2026-10-21 PostHog MCP로 아래 8개 카드를 게시하고 SQL·저장된 인사이트·대시보드 재실행을 확인했습니다. **카드는 게시됐지만 필요한 새 이벤트는 아직 미계측입니다.** 모두 빈 결과이며 실제 0을 뜻하지 않습니다. 기존 카드의 ID·쿼리·레이아웃·안내문과 제외 필터를 보존했습니다.

- 새 대시보드 **Catus · 섬 성장과 경제**, 6개 카드: [게시 정의](posthog-growth-dashboard.json).
- 기존 **Catus · 첫 섬과 집중**에 섬/바다 집중시간·사용자 수와 장소별 하루 집중시간 2개 카드 추가: [추가 정의](posthog-focus-location-additions.json).
- 집계 의미, 이벤트 계약, 구현·검증 조건: [섬 성장·경제·집중 장소 지표 계약](posthog-growth-metric-contract.md).
- 원격 게시 ID·검증 결과·합성 CTE 표본: [게시 검증 기록](posthog-growth-publication-verification.json). 실제 수신 표본·원장 대조는 계측 배포 후 진행합니다.

서버 원장·완공 상태와 실제 집중 장소가 필요합니다. 기존 `focus_completed.earned_fish`만으로 공동 경제를 집계하거나, 섬 소속을 실제 집중 장소로 대신 쓰지 않습니다.

## OS 기기 ID 계측 · 2026-10-29 로컬 구현

`src/services/analyticsDevice.ts`가 Android의 `ANDROID_ID`, iOS의 `IDFV`를 읽습니다. JS SDK 이벤트에는 `device_id`와 `device_id_source`(`android_id` / `idfv`)를 추가합니다. 가입·게스트 시작 전에도 수집할 수 있으며, 기존 계정 `userId`와 SDK 익명 ID는 그대로 사용합니다. 게스트 로그인용 `gromo.guestDeviceId`를 재사용하거나 OS ID를 `identify()`에 전달하지 않습니다.

- IDFV 조회는 SDK 저장소 복원 완료 전에 최대 1초 기다려 첫 `Application Installed`·화면·사용자 이벤트에도 속성을 붙입니다. 앱 진입과 Provider 생성은 기다리지 않습니다.
- OS 조회 오류·IDFV `null`·빈 값·0으로만 된 ID·시간 초과는 기기 속성을 생략합니다. 임의 ID로 대체하거나 디스크에 OS ID를 캐시하지 않고 다음 앱 실행에서 다시 조회합니다.
- 로그인·로그아웃의 `reset()`과 무관하게 같은 실행에서 읽은 OS ID를 JS 이벤트에 적용합니다. 네이티브 SDK가 직접 전송해 JS `before_send`를 거치지 않는 크래시에는 이 속성을 보장하지 않습니다.
- Android dev 빌드는 코드와 CI의 빈 프로젝트 토큰으로 수집을 끕니다. 초기 무인증 snapshot은 SDK 익명 ID를 초기화하지 않으며, 저장된 로그인 식별자가 있는 경우에만 로그아웃 초기화를 수행합니다.
- 신규 기기 지표를 만들 때는 `device_id_source`와 `device_id`의 조합별 최초 관측으로 집계해야 합니다. OS ID도 초기화·서명·앱 삭제 조건에 따라 바뀔 수 있습니다. 최초 적용한 기존 설치도 처음 관측되므로 신규 다운로드로 간주하지 않습니다. 기존 이벤트에 기기 ID를 소급 채우지 않습니다.

현재는 로컬 구현·테스트 단계입니다. 배포한 iOS·Android 기기에서 실제 수신을 확인한 뒤 적용 상태를 갱신합니다. 기존 대시보드 집계는 변경하지 않았습니다.

공식 문서: [Expo Application](https://docs.expo.dev/versions/latest/sdk/application/) · [PostHog 이벤트 보정](https://posthog.com/docs/libraries/react-native#common-before_send-patterns).

## 우선순위

1. 로그인 화면부터 실제 첫 섬 화면까지: 단계별 전환·이탈, 생성/가입/초대 경로별 차이.
2. 첫 섬에서 안내를 마치고 첫 실제 집중을 시작·완료하는지.
3. 첫 실제 집중 후 다른 날 다시 집중하는지: 정확한 D1·D7과 D1~D7 중 한 번 이상 재집중을 구분.
4. 주간 집중 습관과 친구·섬 상태별 비교.
5. 오류·크래시 영향 사용자와 계측 상태.

기존의 일반 섬 가입 퍼널을 최초 여정으로 간주하지 않습니다. 안내용 집중 체험은 서버 집중 기록과 분리되어 있으므로 실제 집중 완료와 합치지 않습니다. 섬 소속 확정과 실제 섬 입장도 별개입니다.

## 구현 예정: 최초 여정 이벤트

아래는 대시보드가 사용할 **계측 계약**이며 아직 앱에서 발행하지 않습니다. 메인 대시보드 상단에 첫 여정 카드 4개의 앱 이벤트 추가가 필요하다고 안내합니다. SDK 연동·검증 후 이 안내를 갱신합니다.

- 이벤트: `activation_step`
- 공통 속성: `activation_schema_version=1`, `journey=first_island`, `stage`, `analytics_environment=production|development`
- 계정의 첫 섬 온보딩 여정에만 사용합니다. 재로그인·추가 섬 가입·재설치로 새 최초 여정을 만들지 않습니다.
- 중단 후 재개는 같은 여정으로 연결하고, 계정별 완료 단계의 재발행을 방지해야 합니다. 설치 로컬 플래그만으로 생애 최초를 판정하지 않습니다.
- 경로 비교는 첫 선택의 `entry_path`를 해당 여정에 고정합니다. 이후 선택을 바꿔도 `island_route_selected`를 재발행하지 않고, 소속 확정·도착 단계에도 같은 최초 선택값을 전달합니다. 이 지표는 최종 가입 방법별 성과가 아닌 최초 선택 경로별 전환입니다.
- 로그인 전 익명 식별자가 로그인 후 사용자와 연결되어야 합니다. 미로그인 이탈자는 기존 계정 여부를 확정할 수 없으므로 로그인 화면 분모의 한계로 표시합니다.
- 과거 완료 사실을 실제 발생 시각으로 소급 전송하지 않습니다. 계측 시작 이후 관측할 수 있는 여정의 한계를 명시합니다.

| `stage`                   | 확정 조건                                                  | 추가 속성                       |
| ------------------------- | ---------------------------------------------------------- | ------------------------------- |
| `login_viewed`            | 최초 진입 로그인 화면 노출. 확인된 재로그인자는 제외       | —                               |
| `login_completed`         | 게스트/소셜 인증 및 앱 세션 채택 완료                      | `provider`                      |
| `profile_ready`           | 서버에서 고양이·이름 설정 완료 확인. 화면 노출 자체는 아님 | —                               |
| `island_route_selected`   | 생성·가입·초대 경로 선택                                   | `entry_path=create/join/invite` |
| `island_membership_ready` | 첫 소속을 서버에서 확정. 승인 대기는 미완료                | —                               |
| `island_arrived`          | 현재 섬이 선택되고 서버 스냅샷을 갖춘 홈/안내 화면 표시    | —                               |
| `tutorial_exited`         | 안내 완료 또는 명시적 건너뛰기. 앱 종료는 해당하지 않음    | `outcome=completed/skipped`     |
| `first_focus_started`     | 안내용 체험을 제외한 첫 실제 서버 집중 시작 확정           | —                               |
| `first_focus_completed`   | 안내용 체험을 제외한 첫 실제 집중 완료·서버 정산 확정      | `duration_seconds > 0`          |

`first_focus_completed`는 첫 번째 시작 시도가 반드시 끝났다는 뜻이 아니라, 사용자가 처음으로 실제 집중을 완료했다는 뜻입니다. 퍼널은 사용자 전환율이며 개별 세션 성공률이 아닙니다. 생성/가입/초대의 선택 화면과 승인 대기 화면은 분기이므로 공통 필수 퍼널에 모두 끼워 넣지 않습니다.

## 연결 완료: 오류·크래시 (새 빌드 적용 필요)

`posthog-react-native` 4.81.2와 `@posthog/react-native-plugin` 2.12.6으로 JS 예외·처리하지 않은 Promise rejection 및 운영 네이티브 크래시 자동 수집을 연결했습니다. Catus 프로젝트의 exception autocapture도 켰습니다. 오류 카드 3개는 새 운영 빌드 적용과 수신 확인이 필요하다고 해당 대시보드 상단에 안내합니다. 설정 변경만으로 기존 설치 앱에 적용되지는 않습니다.

- 정식 SDK의 `$exception` 이벤트를 사용합니다. `$exception_level=fatal`만 크래시로 분류하며 일반 오류·Promise rejection을 크래시로 세지 않습니다. `console` 수집은 꺼서 로그 내용과 일반 개발 경고를 오류로 보내지 않습니다.
- JS의 모든 이벤트는 `before_send`에서 `analytics_environment`를 받습니다. 네이티브 SDK가 직접 보내는 크래시는 이 콜백을 거치지 않으므로 **네이티브 크래시 옵션은 운영 환경에서만 켭니다**. 오류 SQL은 운영 태그 이벤트 및 `analytics_environment`가 없고 `$lib=posthog-react-native`, `$exception_level=fatal`인 이벤트만 포함합니다. 개발·staging 네이티브 수집을 켜려면 이 필터 계약부터 변경해야 합니다. 초기화 전 크래시까지 모두 수집된다고 보장하지 않습니다.
- iOS 네이티브, Android Java/Kotlin 및 Android C/C++ NDK 크래시 옵션을 켰습니다. Android NDK 수집은 SDK가 지원하는 Android 12 이상에서 동작하며, 다음 실행에 전송될 수 있습니다. OS 강제 종료·모든 ANR을 포괄하는 설정은 아닙니다.
- 로그인하면 기존 앱 사용자 ID로 식별하고 로그아웃 시 초기화합니다. 로그인 전 오류도 익명 사용자로 남기며 인증 후의 `app_active`로 대상을 제한하지 않습니다. 이름·이메일은 이 대시보드에 필요하지 않습니다.
- 버전·OS·세션 ID가 없으면 미확인으로 남깁니다. NDK 보고 전에 앱을 업데이트했다면 이벤트의 사용자·버전은 재실행 시점일 수 있으므로 크래시 당시 사용자로 단정하지 않고 심볼의 빌드 ID도 확인합니다. 최초 활성화 때 OS가 보관한 과거 NDK 크래시가 함께 들어올 수 있습니다. 일반 오류와 fatal 사용자 수는 겹칠 수 있습니다.
- 전체 사용자 분모와 실제 수집 커버리지가 검증되기 전에는 crash-free 비율을 표시하지 않습니다. 실제 기기 강제 크래시 후 재실행·리플레이 연결은 출시 빌드 검증에 포함해야 합니다.

### 소스맵·네이티브 심볼

Metro의 `getPostHogExpoConfig`가 debug ID를 넣습니다. iOS Bundle 단계는 PostHog의 Hermes 업로드 스크립트를 호출하며 마지막 빌드 단계에서 dSYM을 올립니다. Android는 JS 소스맵 업로드와 `com.posthog.android` 1.5.0 플러그인의 R8 mapping·NDK 심볼 업로드를 연결했습니다. 플러그인의 전이 의존성 때문에 Expo의 Kotlin 버전이 바뀌지 않게 제외 규칙을 둡니다.

업로드 CLI 0.18.10은 devDependency로 고정했습니다. **빌드 머신마다** 아래 인증을 `app/app-dev/.env.posthog`(gitignore, 권한 0600)에 두거나 CI 환경변수로 제공해야 합니다. `EXPO_PUBLIC_*`에 비밀 키를 넣으면 안 됩니다.

```dotenv
POSTHOG_CLI_API_KEY=<전용 개인 API 키>
POSTHOG_CLI_PROJECT_ID=669473
POSTHOG_CLI_HOST=https://us.posthog.com
```

현재 작업 머신에는 Catus 프로젝트로 제한되고 `error_tracking:write`만 허용된 키를 저장했습니다. 로컬 파일이 없으면 `~/.config/posthog/catus.env`를 사용하므로 같은 Mac의 다른 체크아웃에서도 연결됩니다. `POSTHOG_CLI_DOTENV_FILE`로 경로를 재정의할 수 있습니다. 키 없는 팀원/PR 빌드는 경고 후 업로드만 건너뜁니다. 인증된 업로드 실패는 빌드 실패로 노출됩니다. iOS Debug와 PostHog 수집을 끈 빌드는 업로드하지 않습니다. Android CI의 main 빌드는 저장소의 `POSTHOG_CLI_API_KEY` secret을 사용합니다. 이 secret은 등록했으며 워크플로 변경은 머지 후 적용됩니다. PR·다른 브랜치에는 전달하지 않습니다. iOS dev TestFlight는 기존대로 PostHog 수집을 끄므로 업로드도 건너뜁니다. 그 외 빌드 머신에는 별도 인증이 필요합니다.

OTA는 네이티브 빌드 훅을 거치지 않습니다. 실제 배포한 번들의 소스맵을 그대로 올려야 합니다(업로드를 위해 별도로 재번들링하면 debug ID가 달라질 수 있습니다).

```sh
npx posthog-cli --dotenv-file .env.posthog hermes upload --directory <OTA-내보내기-디렉터리>
```

공식 문서: [React Native 오류 수집](https://posthog.com/docs/error-tracking/installation/react-native), [소스맵·네이티브 심볼](https://posthog.com/docs/error-tracking/upload-source-maps/react-native), [오류와 이슈](https://posthog.com/docs/error-tracking/issues-and-exceptions).

## 기존 계측을 사용하는 보조 카드

`app_active`, `social_state_observed`, `focus_started`, `focus_completed`, `island_membership_activated`를 사용하는 기존 카드는 현재 로컬 코드의 이벤트 계약을 따릅니다. 배포 및 실제 기기 수신 검증은 별도입니다. 친구 평균은 최근 관측 사용자마다 최신 관측 한 건으로 집계하고 조회 실패는 0명으로 바꾸지 않습니다. 섬·친구별 재방문 비교는 기간 내 첫 관측 기준이며 신규 가입 리텐션이 아닙니다.

SQL 카드는 KST 기준 고정 기간을 사용합니다. 표준 퍼널은 기본 최근 28일이며 대시보드 날짜 필터가 적용됩니다. D1·D7 재집중 지표는 해당 날짜가 완전히 끝난 사용자만 분모에 포함합니다.

## 2026-10-17 연결 검증

- 관련 Jest 23개, TypeScript, ESLint(오류 0개), Prettier 및 팔레트 생성 검사를 통과했습니다.
- iOS Debug 시뮬레이터 빌드와 Android `compileDebugKotlin`을 통과했습니다. Gradle에 Release JS 소스맵·NDK 심볼 업로드 작업이 등록된 것도 확인했습니다.
- iOS·Android Hermes 번들과 debug ID가 있는 소스맵을 생성하고 Catus에 실제 업로드했습니다. 빌드한 iOS Debug 바이너리의 dSYM도 생성·업로드하고 서버에서 파일 존재를 확인했습니다. 운영 Archive 및 실제 난독화 R8 mapping 업로드를 실행한 검증은 아닙니다.
- iOS 26.5 시뮬레이터에서 개발 환경의 수동 테스트 예외와 처리하지 않은 Promise 오류를 실제 전송했습니다. 후자는 `mechanism=onunhandledrejection`, `handled=false`, `$exception_level=error`로 자동 수집된 것을 확인했습니다. Error Tracking 이슈 생성과 동일 세션의 리플레이 생성도 확인했습니다. 운영 오류 카드 3개에는 포함되지 않았습니다. 리플레이 조회에는 처리 지연이 있었습니다.
- 실제 기기의 강제 네이티브 크래시·재실행 복구는 아직 검증하지 않았습니다. iOS 27 시뮬레이터는 JS가 시작되기 전 `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`에서 중단되어 iOS 26.5로 수신 검증했습니다. 이 UIScene 호환성 문제는 이번 PostHog 연결과 별도로 확인해야 합니다.
- 임시 테스트 예외 코드와 SDK debug 로그는 제거했습니다. 테스트 이벤트는 development로 남겼으며 실제 사용자 데이터는 만들지 않았습니다. 커밋·푸시·앱 배포는 실행하지 않았습니다.
