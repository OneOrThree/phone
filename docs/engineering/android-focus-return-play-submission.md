# Android 집중 복귀 — Play 제출 준비본

- 작성일: 2026-11-08
- 작업: [GROMO-2798](https://romance.atlassian.net/browse/GROMO-2798)
- 앱: `com.oneorthree.gromo` / 집중할고양 · Cattus
- 범위: 제출 자료와 콘솔 초안 준비. 사용자 지시에 따라 심사 제출·출시·배포·프로덕션 승격은 하지 않는다.
- 구현: [PR #1630](https://github.com/OneOrThree/phone/pull/1630)의 두 커밋을 최신 main 기반 준비 브랜치로 가져왔다. 기존 PR은 이미 머지된 부모 기능 브랜치로 들어가 현재 main에는 기능이 포함되지 않았다. 준비 브랜치도 머지하지 않는다.

## 접근성 선언 답변

| 질문                                  | 준비한 답변                          | 근거                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 접근성 도구인가                       | 아니요                               | 장애인 지원을 주목적으로 하는 도구가 아니다. `isAccessibilityTool=false`.                                                                                                                        |
| 사용 목적                             | 앱 기능 / App functionality          | 사용자가 시작한 집중 중 비허용 앱에서 기존 Cattus 화면으로 복귀.                                                                                                                                 |
| 접근성으로 개인정보를 수집·공유하는가 | **접근성 이벤트 처리에 한해 아니요** | 이벤트의 패키지명·Activity 종류는 기기 메모리에서 비교하고 서버·분석 SDK에 전달하지 않는다. 아래의 기존 측정·분석 수집과 구분한다. 최종 문항의 수집·공유 정의가 달라지면 그대로 적용하지 않는다. |
| 시연 영상 링크                        | 아직 제출 가능한 최종 링크 없음      | 실제 앱 시작·별도 고지·동의/거절·권한 설정·복귀 기능을 포함한 영상이 필요하다. 리허설 영상과 최종 제출 영상을 구분한다.                                                                          |

### 핵심 기능 설명 — English

Cattus is a focus timer. A user chooses apps they want to keep using and starts a focus session. During that session, AccessibilityService detects app-window changes and brings the user's existing Cattus activity to the foreground if an app outside the allowed list is opened. It does not close the other app or reset the focus session.

The service accesses only the package name and Activity type needed for this comparison. It does not retrieve window content, read messages or typed input, record screens, or perform gestures. Detected app-transition information is processed in device memory and is not stored as browsing/app-use history or sent to our servers or analytics providers. User-selected allowed apps and consent settings are stored separately in app preferences.

Users see a dedicated in-app disclosure and can agree or decline before opening Android accessibility settings. They can turn the feature off in Cattus or Android settings. It is deactivated on pause, focus end, logout or consent withdrawal. Phone calls, system settings, the home screen and essential system functions are excluded. The app does not prevent permission revocation or uninstallation. This is a fixed, user-configured rule, not AI-driven autonomous control.

Usage Access is used separately for optional screen-time measurement. It cannot perform the foreground-return action. The app does not request accessibility access for advertising, analytics or reading screen content.

### 핵심 기능 설명 — 한국어

Cattus는 집중 타이머 앱이다. 이용자가 집중 중에도 사용할 허용 앱을 고르고 직접 집중을 시작하면, 접근성 서비스가 앱 화면 전환을 확인하여 비허용 앱에서 진행 중인 Cattus 화면으로 돌아오게 한다. 다른 앱을 강제 종료하거나 집중 세션을 새로 시작하지 않는다.

판단에는 이벤트의 앱 패키지명과 Activity 종류만 사용한다. 화면 내용·메시지·입력값을 읽거나 화면을 기록하거나 제스처를 수행하지 않는다. 감지한 앱 전환 정보는 기기 메모리에서만 처리하며 이용 기록으로 저장하거나 서버·분석 서비스로 전송하지 않는다. 이용자가 고른 허용 앱 목록과 동의 설정은 별도로 앱 저장소에 보관한다.

시스템 접근성 설정을 열기 전에 앱 안에서 별도 고지와 동의·거절 버튼을 제공한다. 이용자는 앱이나 Android 설정에서 해제할 수 있다. 휴식·집중 종료·로그아웃·동의 철회 시 해제하며, 전화·홈·시스템 설정 등 필수 기능과 권한 철회·앱 삭제를 막지 않는다. 이용자가 정한 고정 규칙에 따라 동작하며 AI가 자율적으로 다른 앱을 조작하는 기능이 아니다.

스크린타임 측정의 사용정보 접근 권한은 별도다. 사용정보 접근만으로는 Cattus 화면을 앞으로 가져오는 동작을 제공할 수 없다. 접근성 권한은 광고·분석이나 화면 내용 읽기에 사용하지 않는다.

## 스토어 전체 설명에 추가할 문구

2026-11-08 Aside로 한국어·영어 전체 설명의 아래 단락을 **임시보관함에 저장**하고 새로고침 뒤 확인했다. 한국어 961자, 영어 1,985자이며 문단은 한 번씩만 들어 있다. 앱 이름·짧은 설명·이미지·영상 필드는 바꾸지 않았다. 일본어는 로컬 준비본이다. 기능이 포함된 버전과 함께 공개할 초안이며, 심사 제출·게시는 하지 않았다.

기존 전체 설명의 모든 앱이 잠긴다는 문장도 실제 복귀 동작으로 고쳤다.

- 한국어: 「집중 1분마다 물고기 한 마리. 집중 중 앱 복귀 기능을 켜면 허용하지 않은 앱을 열었을 때 집중할고양으로 돌아와요.」
- 영어: “With return to focus enabled, opening an app outside your allowed list brings you back to your ongoing Cattus session.”

### 한국어

집중 중 앱 복귀 기능 안내
집중할고양은 사용자가 켠 집중 중 앱 복귀 기능을 위해 Android 접근성 서비스(AccessibilityService API)를 사용해요. 허용하지 않은 앱을 열면 진행 중인 집중할고양 화면으로 돌아와요. 앱 전환을 판단하는 정보는 기기 안에서 처리하며, 화면 내용이나 입력값을 읽지 않아요. 별도 안내에 동의하고 Android 설정에서 서비스를 켠 경우에만 사용하며, 앱 또는 Android 접근성 설정에서 언제든 끌 수 있어요. 사용 시간 측정은 별도의 사용정보 접근 권한으로 설정해요.

### English

Return to focus on Android
Cattus uses the Android AccessibilityService API for the optional return-to-focus feature. During a focus session you start, opening an app outside your allowed list brings your existing Cattus screen back to the foreground. App-transition information is processed on your device; the service does not read screen content or typed input. The feature requires a separate in-app disclosure, your consent, and activation in Android settings. You can turn it off in Cattus or Android accessibility settings. Screen-time measurement uses a separate Usage Access permission.

### 日本語

Androidの集中画面に戻る機能
Cattusは、任意の集中画面復帰機能にAndroidアクセシビリティサービス（AccessibilityService API）を使用します。利用者が開始した集中中に許可していないアプリを開くと、進行中のCattus画面に戻ります。アプリ切り替え情報は端末内で処理し、画面内容や入力内容は読み取りません。個別の案内への同意とAndroid設定での有効化が必要で、アプリまたはAndroidのアクセシビリティ設定でいつでも無効にできます。使用時間の測定には別の使用状況へのアクセス権限を使用します。

## 콘솔 상태와 미제출 경계

- 관리형 게시가 켜져 있으며, 기존 프로덕션 `2.3.23 / 857`의 전체 출시 1건이 「게시 준비됨」 상태였다. 이 변경은 그대로 보존했다.
- 최신 업로드 번들 857에는 새 기능이 없고, 앱 콘텐츠의 조치 완료 11개 항목에도 Accessibility API 선언 양식이 없었다. 선언 답변은 이 문서에 준비했으며 콘솔 제출 완료로 간주하지 않는다. 기능이 포함된 최종 AAB가 등록되어 양식이 나타난 뒤 입력·검토해야 한다.
- 개인정보처리방침 URL은 `https://oneorthree.world/catus/privacy/`다. [한·영·일 수정안](https://github.com/OneOrThree/cattus-info-page/commit/68ca410)은 작업 브랜치에만 보관했다. 해당 저장소는 PR만 열어도 웹 프리뷰 배포가 발생하므로 이번 무배포 범위에서는 PR을 열지 않았다.
- 앱 액세스는 「제한된 영역 없음」이며 별도 테스트 계정 안내가 없다. 게스트로 실제 기능까지 진입 가능한지 실행 검증한 뒤 판단한다.
- 새 AAB 업로드, 심사 제출, 게시, 트랙 승격, main/release 머지는 수행하지 않았다.

## 데이터 보안 대조

기존 콘솔 응답 12종을 읽기만 했고 수정하지 않았다. 아래는 콘솔의 현황이며, 전체 앱·외부 SDK의 적정성 검증 완료를 뜻하지 않는다.

| 기존 선택 데이터        | 수집 | 공유   | 임시 처리 | 필수 여부 | 목적                                                 |
| ----------------------- | ---- | ------ | --------- | --------- | ---------------------------------------------------- |
| 이름                    | 예   | 아니요 | 아니요    | 필수      | 앱 기능, 계정 관리                                   |
| 이메일                  | 예   | 아니요 | 예        | 선택      | 계정 관리                                            |
| 사용자 ID               | 예   | 아니요 | 아니요    | 필수      | 앱 기능, 분석, 계정 관리                             |
| 기타 개인 정보          | 예   | 아니요 | 아니요    | 필수      | 앱 기능, 분석, 맞춤 설정, 계정 관리                  |
| 대략적인 위치           | 예   | 예     | 아니요    | 필수      | 수집·공유: 분석                                      |
| 비정상 종료 로그        | 예   | 아니요 | 아니요    | 필수      | 분석                                                 |
| 진단                    | 예   | 아니요 | 아니요    | 필수      | 분석                                                 |
| 앱 상호작용             | 예   | 예     | 아니요    | 필수      | 수집: 분석, 광고·마케팅 / 공유: 앱 기능, 광고·마케팅 |
| 앱 내 검색 기록         | 예   | 아니요 | 아니요    | 선택      | 앱 기능                                              |
| 기타 사용자 제작 콘텐츠 | 예   | 아니요 | 아니요    | 선택      | 앱 기능                                              |
| 기타 작업               | 예   | 아니요 | 아니요    | 필수      | 앱 기능, 분석                                        |
| 기기 또는 기타 ID       | 예   | 예     | 아니요    | 필수      | 수집·공유: 앱 기능, 분석, 광고·마케팅                |

「설치된 앱」은 선택되지 않았다. 전송 구간 암호화 예, OAuth 계정 생성, 계정 삭제 URL은 개인정보처리방침의 `#account-deletion`, 계정 삭제 없는 데이터 삭제는 아니요로 등록되어 있다. 이 기능은 패키지 정보를 외부로 보내지 않아 설치 앱 수집 항목을 추가하지 않았다. 이메일의 임시 처리 등 기존 응답과 실제 서버·SDK 계약은 별도 전체 감사 대상이며 그대로 보존했다.

### 신규 기능의 실제 데이터 흐름

| 정보                                    | 실제 코드의 처리                                                                                                        | 선언 시 주의                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 접근성 앱 전환의 패키지명·Activity 종류 | `FocusReturnService.kt`에서 비교. 패키지명은 서버 확인 이벤트에도 넣지 않음.                                            | 이 경로는 기기 내 처리. 앱 전체를 미수집으로 바꾸지 않음.                                |
| 사용자가 고른 측정·허용 앱 목록         | 네이티브 앱 설정에 저장. 목록의 용도와 저장 키 분리.                                                                    | 이벤트 미저장과 설정 보관을 구분. OS 백업·기기 이전 가능성은 별도.                       |
| 접근성 동의·소유 계정                   | `gromo_focus_return` 설정에 저장. 계정 바인딩 변경 시 초기화.                                                           | 동의 철회와 저장된 목록 삭제는 다른 동작.                                                |
| 현재 집중 세션                          | 기존 계정 인증으로 서버 집중 상태를 확인.                                                                               | 앱 복귀를 구현해도 기존 계정·집중 기록 수집은 유지.                                      |
| 스크린타임                              | `screenTimeReporting.ts` → `/me/screen-time/{date}`. 날짜, 분 단위 합계, 측정 상태·시각·구간, 시간대, 기기 세션 식별자. | 앱 활동과 식별자 검토 대상. 패키지명·앱별 목록은 이 요청에 없음.                         |
| PostHog 제품 분석                       | `screen_time_daily`에 합계 분 등을 보냄. 제품 기능 상태·계정/기기 식별자 등 기존 경로.                                  | 접근성 이벤트 비전송을 제품 분석 비전송으로 확대하지 않음.                               |
| Airbridge·Meta·오류/성능 SDK            | 앱의 기존 SDK 설정과 실행 조건에 따름.                                                                                  | 현재 콘솔의 수집·공유·목적을 SDK 설정과 대조. 기능 추가만으로 전체 선언을 단정하지 않음. |

## 심사자 접근 안내 초안

현재 콘솔에 등록된 계정/로그인 지침을 먼저 확인한다. 비밀번호는 이 문서·PR·영상에 넣지 않는다. 최신 앱에서 실제 진입을 확인한 뒤 아래 흐름을 콘솔 안내에 추가한다.

1. 앱에서 기존 심사 안내에 따라 로그인 또는 게스트 시작을 진행한다.
2. 초기 안내를 마치고 낚시섬에 들어간다.
3. AI 집중 측정 스위치 왼쪽의 「허용 앱 설정」을 누른다. AI 측정은 꺼 두어도 된다.
4. 통합 안내의 「설정하기」를 누른다. 측정을 설정하거나 「측정은 나중에 하고 허용 앱 고르기」로 진행한다.
5. 시험할 앱(예: Chrome)을 허용 목록에서 제외하고 저장한다.
6. 별도 접근성 고지를 읽고 「동의하고 접근성 설정하기」를 누른다. Android 설정에서 「집중할고양 집중 도우미(Focus with Cattus)」를 켜고 앱으로 돌아온다.
7. 집중을 시작한 뒤 제외한 앱을 열어 기존 집중 화면으로 복귀하는 것을 확인한다.
8. 휴식·종료하거나 설정에서 앱 복귀를 끄면 강제 복귀가 해제된다.

## 시연 영상 촬영 순서

| 구간      | 화면에서 보여줄 내용                                                                |
| --------- | ----------------------------------------------------------------------------------- |
| 시작      | 런처에서 실제 앱 열기. 앱 이름·대상 빌드/기기 정보는 자막으로 구분.                 |
| 진입      | 낚시섬 → 허용 앱 설정 → 통합 안내 → 앱 선택.                                        |
| 거절      | 별도 접근성 고지 전체를 읽을 수 있게 표시 → 동의하지 않고 닫기 → 일반 앱 이용 가능. |
| 재진입    | 같은 설정을 다시 열어 별도 고지에 재도달.                                           |
| 동의      | 고지 전체 → 동의 버튼 → Android 접근성 서비스 활성화 → 앱 복귀.                     |
| 동작      | 집중 시작 → 비허용 앱 열기 → 기존 집중 화면/타이머로 복귀.                          |
| 허용·예외 | 허용 앱 유지, 시스템 설정 접근 가능.                                                |
| 철회      | 앱 복귀 끄기 또는 OS 권한 해제 → 비허용 앱을 열어도 복귀하지 않음.                  |

편집은 대기시간 정리·자막에 한정하고 권한 화면·동작 결과를 합성하지 않는다. 기존 QA 전용 화면은 실제 앱/서버 전체 흐름을 대신하므로 제출 영상으로 쓰지 않는다. 영상은 검증용과 제출용을 표시하고, 사용자 허락 없는 공개 게시를 하지 않는다.

## 공식 근거

- [접근성 API 선언·동의·영상](https://support.google.com/googleplay/android-developer/answer/10964491?hl=ko)
- [권한 선언과 심사자 접근 안내](https://support.google.com/googleplay/android-developer/answer/9214102?hl=ko)
- [데이터 보안의 기기 내 처리·수집 정의](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)

콘솔 관찰 결과와 실행 검증은 [Release QA 기록](android-focus-return-release-qa.md)에 남긴다.
