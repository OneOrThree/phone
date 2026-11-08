# Android 집중 복귀 출시 준비 검증

- 작업: [GROMO-2798](https://romance.atlassian.net/browse/GROMO-2798)
- 시작일: 2026-11-08
- 사용자 범위: 준비만 수행. 심사 제출·출시·배포·프로덕션 승격 금지.
- 소스: 최신 main `15385603d`에 기존 구현 `1fb39185f`·`b643afd51`을 반영한 준비 브랜치. 합친 결과 `be919bc96`.

## 확인한 배포 이력 문제

[PR #1627](https://github.com/OneOrThree/phone/pull/1627)은 2026-11-07 13:09:09 UTC main에 머지됐다. [PR #1630](https://github.com/OneOrThree/phone/pull/1630)은 21초 뒤 이미 머지된 부모 기능 브랜치에 머지되어 main에 포함되지 않았다. 2026-11-08 원격 main을 다시 가져와 `FocusReturnService.kt` 부재를 확인했다. 준비 브랜치로 두 기능 커밋을 가져왔으며 main 머지나 내부 트랙 발행은 하지 않았다.

## 검증 범위

| 항목                         | 상태/근거                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 접근성 서비스 범위           | `typeWindowStateChanged`, 화면 내용·제스처 권한 false, `isAccessibilityTool=false` 소스 확인                                                                              |
| 고지·동의·거절·철회          | 기존 구현 소스 확인. 동의 전 시스템 설정을 열지 않으며 철회 시 네이티브 상태 해제                                                                                         |
| 접근성 이벤트 전송           | 패키지명·Activity 종류의 서버/분석 전달 경로 없음. 네이티브에서 비교                                                                                                      |
| 개인정보처리방침             | [별도 브랜치 커밋 `68ca410`](https://github.com/OneOrThree/cattus-info-page/commit/68ca410)에 한·영·일 문구 보관. 37개 파일/517개 테스트 및 정적 페이지 빌드 통과. 미게시 |
| 콘솔 선언·스토어·데이터 보안 | 한·영 전체 설명을 비공개 임시보관함에 저장·재확인. 데이터 보안 12개 유형을 읽고 보존. 접근성 선언 양식은 현재 보이지 않음. 기존 857 게시 대기 건 보존                     |
| Android Release              | dev V2 서버 대상 `assembleRelease` 성공(5분). 필수 공개 Airbridge 설정을 전달한 빌드. 접근성 네이티브 Release 단위 테스트 19개 통과                                       |
| 에뮬레이터                   | Android 17/API 37, `CodexFocusQA`, arm64, 1080×2400. 전용 에뮬레이터 기동                                                                                                 |
| 최소 OS                      | 아직 실행하지 않음                                                                                                                                                        |
| Pixel·Galaxy 실기기          | 연결된 실기기 없음. 확인하지 않음                                                                                                                                         |
| 제출 영상                    | 아직 제출 가능 영상 없음. 실제 앱 흐름 확인 후 작성                                                                                                                       |

빌드 성공과 실제 실행 성공을 구분한다. 개발 서버 연결 Release는 운영 서버의 앱 전체 흐름이나 제조사별 실기기 검증을 대신하지 않는다.

## 자동 검사와 산출물

- 앱 관련 Jest: 5개 스위트, 97개 테스트 통과. Android 설정·네이티브 어댑터·섬 진입·동기화·안내 화면을 검증했다.
- TypeScript 검사, Prettier 및 생성 팔레트 검사 통과. ESLint 오류 0개, 기존 경고 1,736개.
- 네이티브: `FocusReturnLeaseTest` 4개, `AndroidStateTest` 15개 통과.
- 합쳐진 Release manifest에 `FocusReturnService`와 `BIND_ACCESSIBILITY_SERVICE` 등록 확인. `QUERY_ALL_PACKAGES`, `SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE_SPECIAL_USE` 없음. 기존 `PACKAGE_USAGE_STATS`는 유지한다.
- 로컬 APK: `app/app-dev/android/app/build/outputs/apk/release/app-release.apk`. 서버는 `https://oneorthree-v2.dev.mooo.com`, arm64-v8a, Release 서명/최적화 산출물이다. Play 최종 제출 AAB가 아니다.
- 첫 화면 진입과 재실행을 확인했고, 약관 동의 → 게스트 시작 → 고양이/닉네임/목적지 설정까지 실제 앱 흐름으로 진행했다. 집중 복귀 결과는 아래에 별도로 기록한다.

## 남은 출시 전 조건

1. 실제 기능의 동의·거절·철회·비허용/허용 앱 및 세션 보존을 확인한 영상과 기록.
2. 최소 지원 OS, Pixel·Galaxy의 제조사별 권한/배터리/재연결, 보조 사용자·작업 프로필, 이벤트 비용 측정. 연결 실기기가 없어 실기기 완료로 표시하지 않는다.
3. 최종 제출 AAB로 나타나는 Accessibility API 선언 양식과 해당 빌드의 제출 영상 링크. 현재 양식과 최종 링크는 없으며 심사 제출하지 않았다.
4. 기능 제공 버전과 개인정보처리방침/스토어 설명의 공개 시점 조율. 이번 작업에서는 공개하지 않는다.

## 보관과 제출 경계

[제출 준비본](android-focus-return-play-submission.md)에 선언·스토어 문구와 촬영 순서를 정리했다. 비밀값·심사 계정 비밀번호는 저장소에 남기지 않는다. 로그·영상은 로컬 산출물로 보관하며, 콘솔에서 공개로 이어지는 동작은 수행하지 않는다.
