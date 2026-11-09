# Android 집중 복귀 출시 준비 검증

- 작업: [GROMO-2798](https://romance.atlassian.net/browse/GROMO-2798)
- 시작일: 2026-11-08
- 현재 사용자 범위: 기능 포함 새 AAB와 콘솔 준비까지 진행. 버전별 추가 테스트는 제외한다. 실제 스토어 출시·프로덕션 승격은 수행하지 않는다.
- 소스: 최신 main `15385603d`에 기존 구현 `1fb39185f`·`b643afd51`을 반영한 준비 브랜치. 합친 결과 `be919bc96`.

## 확인한 배포 이력 문제

[PR #1627](https://github.com/OneOrThree/phone/pull/1627)은 2026-11-07 13:09:09 UTC main에 머지됐다. [PR #1630](https://github.com/OneOrThree/phone/pull/1630)은 21초 뒤 이미 머지된 부모 기능 브랜치에 머지되어 main에 포함되지 않았다. 2026-11-08 원격 main을 다시 가져와 `FocusReturnService.kt` 부재를 확인했다. 준비 브랜치로 두 기능 커밋을 가져왔다. 이 기록을 갱신한 PR 검토 시점에는 main 반영과 내부 트랙 등록 전이며, 이후 반영·공개 순서는 아래를 따른다.

## 검증 범위

| 항목                         | 상태/근거                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 접근성 서비스 범위           | `typeWindowStateChanged`, 화면 내용·제스처 권한 false, `isAccessibilityTool=false` 소스 확인                                                                              |
| 고지·동의·거절·철회          | 소스와 실제 고지·거절·재진입·OS 활성화 확인. 동의 전 서비스 비활성 상태를 확인했으며 철회는 아래 실행 결과와 구분                                                         |
| 접근성 이벤트 전송           | 패키지명·Activity 종류의 서버/분석 전달 경로 없음. 네이티브에서 비교                                                                                                      |
| 개인정보처리방침             | [별도 브랜치 커밋 `68ca410`](https://github.com/OneOrThree/cattus-info-page/commit/68ca410)에 한·영·일 문구 보관. 37개 파일/517개 테스트 및 정적 페이지 빌드 통과. 미게시 |
| 콘솔 선언·스토어·데이터 보안 | 한·영 전체 설명을 비공개 임시보관함에 저장·재확인. 데이터 보안 12개 유형을 읽고 보존. 접근성 선언 양식은 현재 보이지 않음. 기존 857 게시 대기 건 보존                     |
| Android Release              | dev V2 서버 대상 `assembleRelease` 성공(5분). 필수 공개 Airbridge 설정을 전달한 빌드. 접근성 네이티브 Release 단위 테스트 19개 통과                                       |
| 에뮬레이터                   | Android 17/API 37, `CodexFocusQA`, arm64, 1080×2400. 전용 에뮬레이터 기동                                                                                                 |
| 최소 OS                      | 아직 실행하지 않음                                                                                                                                                        |
| Pixel·Galaxy 실기기          | 연결된 실기기 없음. 확인하지 않음                                                                                                                                         |
| 제출 영상                    | 실제 dev Release 검증 영상 5개를 로컬 보관. 최종 제출 AAB 영상과 외부 링크는 아직 없음                                                                                    |

빌드 성공과 실제 실행 성공을 구분한다. 개발 서버 연결 Release는 운영 서버의 앱 전체 흐름이나 제조사별 실기기 검증을 대신하지 않는다.

## 자동 검사와 산출물

- 앱 관련 Jest: 5개 스위트, 97개 테스트 통과. Android 설정·네이티브 어댑터·섬 진입·동기화·안내 화면을 검증했다.
- TypeScript 검사, Prettier 및 생성 팔레트 검사 통과. ESLint 오류 0개, 기존 경고 1,736개.
- 네이티브: `FocusReturnLeaseTest` 4개, `AndroidStateTest` 15개 통과.
- Android runtimeVersion은 `2.0.1-android-focus-return-v1`이다. iOS의 `2.0.0-screen-time-setup-v1`과 별개이며, Android 앱 복귀 모듈이 없는 이전 바이너리와 OTA를 분리한다.
- 합쳐진 Release manifest에 `FocusReturnService`와 `BIND_ACCESSIBILITY_SERVICE` 등록 확인. `QUERY_ALL_PACKAGES`, `SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE_SPECIAL_USE` 없음. 기존 `PACKAGE_USAGE_STATS`는 유지한다.
- 로컬 APK: `app/app-dev/android/app/build/outputs/apk/release/app-release.apk`. 서버는 `https://oneorthree-v2.dev.mooo.com`, arm64-v8a, Release 서명/최적화 산출물이다. 설치 버전은 로컬 기본값 `2.3.2 / 379`, minSdk 26, targetSdk 36이며 Play의 최신 857과 다른 산출물이다. Play 최종 제출 AAB가 아니다.
- 첫 화면 진입과 재실행을 확인했고, 약관 동의 → 게스트 시작 → 고양이/닉네임/목적지 설정까지 실제 앱 흐름으로 진행했다. 집중 복귀 결과는 아래에 별도로 기록한다.

## 실제 앱 실행 결과 (Android 17 / API 37)

개발 서버의 게스트 계정으로 약관 동의·고양이/닉네임 선택·기존 테스트 섬 가입을 진행했다. 앱의 실제 서버 흐름을 사용했으며 QA 전용 화면이나 가짜 집중 응답을 사용하지 않았다.

| 항목                  | 결과                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 집중 전 설정 진입     | AI 측정 스위치 왼쪽의 「Allowed apps」 버튼 확인. 최초 AI 안내의 `>`가 통합 측정/허용 앱 안내로 이동                                                       |
| 측정과 복귀 구분      | Usage Access 설명에서 「Skip tracking and choose allowed apps」로 측정 없이 설정 가능. Files만 허용하고 Chrome은 제외                                      |
| 고지와 거절           | 접근성 별도 고지 전체와 동의/거절 버튼 확인. 거절 뒤 앱에 남고 `enabled_accessibility_services=null` 확인                                                  |
| 재진입과 동의         | 같은 설정으로 다시 진입해 고지 재표시 → 동의 → Android 접근성 설정 → 「Focus with Cattus」 켜기 → 앱 복귀                                                  |
| 실제 서비스 권한      | `dumpsys accessibility`: 연결됨, `capabilities=0`, `eventTypes=TYPE_WINDOW_STATE_CHANGED`, `notificationTimeout=100`                                       |
| 집중 중 비허용 앱     | 타이머 00:00:10 이후 Chrome 실행. 3초 뒤 기존 `MainActivity` 작업 `t30`이 전면이며 타이머 00:00:38로 계속 진행                                             |
| 집중 중 허용 앱       | Files 실행 후 FilesActivity가 전면 유지. 자동 복귀하지 않음                                                                                                |
| 120초 이상 백그라운드 | Files에서 120초 넘게 대기한 뒤 Chrome 실행. 5초 뒤 기존 `t30` 작업으로 복귀하고 타이머 00:03:53 확인. 이 에뮬레이터에서 확인 만료 후 재확인·복귀 동작 확인 |
| 휴식                  | 집중 00:04:06에서 휴식 전환 후 Chrome이 전면에 유지됨. 복귀 동작 해제 확인                                                                                 |
| OS 권한 철회          | 집중 재개 후 설정 진입 가능. 서비스 끄기 확인창을 거쳐 해제, enabled 서비스 목록이 비고 Chrome이 전면 유지됨                                               |
| OS 재연결             | 서비스를 다시 켠 뒤 진행 중 집중에서 Chrome → 기존 Cattus `t30` 복귀 재확인                                                                                |
| 집중 종료             | 종료 버튼 길게 누르기 → 결과 00:07:05 확인. OS 서비스는 켜진 상태에서 Chrome 전면 유지. 종료 후 복귀 해제 확인                                             |
| 앱 내 동의 철회       | 앱 설정 → 앱 권한 관리 → 「Turn off return to focus」 후 상태가 off로 변경. OS 서비스 활성화와 허용 앱 1개는 유지되어 OS 권한/동의/목록의 분리를 확인      |

Android 17은 서비스를 켤 때 포괄적인 「full control」 시스템 확인창을 표시했다. 실제 연결 서비스의 권한은 위의 `capabilities=0`이며 화면 내용/제스처 기능을 요청하지 않는 manifest와 일치한다. 시스템 문구를 앱이 제어한다고 안내하지 않는다.

로컬 검증 자료는 소유자 Mac의 `Downloads/Cattus-Play-출시준비-2026-11-08/`에 보관했다. 영상은 실제 앱 화면의 원본이며 대기시간을 포함한다. 최종 제출 빌드의 영상/공유 링크가 아니며 외부에 게시하지 않았다.

1. `01-setup-and-decline-dev-release.mp4`: 앱 열기, AI→통합 안내, 측정 건너뛰기, 허용 목록, 별도 고지와 거절.
2. `02-consent-and-permission-dev-release.mp4`: 재진입, 별도 고지 동의, Android 접근성 활성화, 집중 시작 준비.
3. `03-return-and-allowed-app-dev-release.mp4`: 실제 집중 타이머, Chrome에서 기존 화면 복귀, Files 유지.
4. `04-background-rest-os-revoke-dev-release.mp4`: 120초 넘게 백그라운드에 있던 뒤 복귀, 휴식 해제, OS 설정에서 권한 철회.
5. `05-reconnect-end-inapp-revoke-dev-release.mp4`: OS 서비스 재연결 후 복귀 재확인, 집중 종료 뒤 Chrome 유지, 앱 안의 복귀 기능 끄기.

빌드 SHA256: `982676fbf27b8b2736347111f39c5c5ccb5cb4e1a04127602af10e0d104d3103`. 이는 이 개발 서버 APK만 식별한다.

## 미검증 범위와 이후 확인 항목

1. 최종 제출 빌드의 전체 실행 재검증과 시연 영상·심사자 접근 안내. 현재 dev Release 영상으로 최종 빌드 검증을 대체하지 않는다.
2. 최소 지원 OS(API 26)·대상 OS(API 36), Pixel·Galaxy의 제조사별 권한/배터리/재연결, 보조 사용자·작업 프로필, 이벤트 비용 측정은 미검증이다. 사용자가 이번 작업의 버전별 추가 테스트를 제외했으므로 실행하지 않으며 완료로 표시하지 않는다. API 37 에뮬레이터의 120초 이상 백그라운드 재확인은 통과했지만, 실제 기기의 Doze 후 서버 재확인 이벤트 전달과 `startActivity` 반복 실패 때 5초 간격 요청 비용을 확인한다. 연결 실기기가 없어 실기기 완료로 표시하지 않는다.
3. 최종 제출 AAB로 나타나는 Accessibility API 선언 양식과 해당 빌드의 제출 영상 링크. 현재 양식과 최종 링크는 없으며 심사 제출하지 않았다.
4. 기능 제공 버전과 개인정보처리방침/스토어 설명의 공개 시점 조율. 이번 작업에서는 공개하지 않는다.

## 이후 반영·공개 순서

사용자는 기존 승인 빌드로 콘솔만 준비하려 했으나, 857에 Android 복귀 구현이 없는 것을 확인한 뒤 새 AAB가 필요하다고 범위를 변경했다. 앞선 「이번 작업에서 머지하지 않는다」는 제한은 현재 범위를 설명하지 못하므로 철회한다. main 반영과 실제 스토어 출시를 구분한다.

1. 같은 head의 코드 리뷰·필수 검사를 확인하고 소유자가 직접 또는 위임한 에이전트가 누락 구현을 main에 반영한다. 이 저장소는 app main 머지로 Android CI/CD와 Play internal 등록이 이어진다.
2. 새 산출물의 버전·소스 SHA·접근성 서비스 포함 여부를 확인하고, 기능 포함 번들 기준으로 접근성 선언·시연 영상·심사자 지침과 스토어 초안을 대조한다. 버전별 추가 테스트는 하지 않는다.
3. 개인정보처리방침과 스토어 설명은 새 기능이 실제 제공되는 시점에 맞춘다. 준비된 수정안을 현재 승인 빌드 857의 기능으로 소개하지 않는다.
4. 기존 857 프로덕션 게시 준비 건은 보존한다. 프로덕션 승격과 실제 스토어 출시는 별도 지시 전까지 실행하지 않는다.

### 기존 승인 빌드 857 대조

- 콘솔: 프로덕션 `2.3.23 / 857 / 7d7d5c32`, 게시 준비 1건, 관리형 게시 켜짐. 앱 콘텐츠는 조치된 선언 11개이며 접근성 선언 카드는 없다.
- 실제 업로드 산출물: [Android CD 42398753559](https://github.com/OneOrThree/phone/actions/runs/42398753559)의 서명 AAB를 내려받아 원본 manifest를 확인했다. 새 AAB를 만든 검사가 아니다.
- AAB SHA256: `43144cadbec75a0c8e0cd76280efda3c19a4555d56c026e247fe79ad288552a5`. 패키지 `com.oneorthree.gromo`, 버전 `2.3.23 / 857`.
- manifest에 `FocusReturnService`, `android.accessibilityservice.AccessibilityService`, `BIND_ACCESSIBILITY_SERVICE`가 모두 없다. Usage Access는 있다. 같은 소스 SHA의 `syncAndroidFocus`도 `false`를 반환한다.
- 따라서 승인 빌드에는 허용 앱 선택과 안내는 있어도 Android 실제 복귀 기능은 없다. 콘솔 설정만으로 추가할 수 없으며 새 네이티브 빌드가 필요하다.
- 한·영 스토어 초안은 857 기준으로 앱 잠금/복귀 주장을 제외한 619자/1,269자로 저장·새로고침 검증했다. 신규 기능 포함 빌드가 등록되면 제출 준비본의 기능 설명을 적용한다.

## 보관과 제출 경계

[제출 준비본](android-focus-return-play-submission.md)에 선언·스토어 문구와 촬영 순서를 정리했다. 비밀값·심사 계정 비밀번호는 저장소에 남기지 않는다. 로그·영상은 로컬 산출물로 보관하며, 콘솔에서 공개로 이어지는 동작은 수행하지 않는다.
