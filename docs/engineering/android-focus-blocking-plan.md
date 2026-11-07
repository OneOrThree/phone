# Android 집중 중 Cattus로 돌아오기

- 작성·구현: 2026-11-07, [GROMO-2797](https://romance.atlassian.net/browse/GROMO-2797).
- 통합 안내 선행 PR: [#1627](https://github.com/OneOrThree/phone/pull/1627).
- 사용자 결정: 별도 차단 화면 대신, 집중 중 비허용 앱을 열면 진행 중인 Cattus 화면으로 돌아온다. 집중 시간·세션을 새로 시작하지 않는다.

## 기존 상태와 변경

기존 Android는 `supportsFocusShield=false`이고 차단 서비스가 없었다. [#1295](https://github.com/OneOrThree/phone/pull/1295)에서 Play 정책 대응을 이유로 specialUse 포그라운드 서비스·오버레이·부팅 복구를 삭제했다. 반려 사유 원문은 이번 작업에서 확인하지 않았다.

이번 구현은 `FocusReturnService` 접근성 서비스가 `typeWindowStateChanged`의 패키지명·Activity 종류만 판별하고 기존 MainActivity 작업을 앞으로 가져온다. `SYSTEM_ALERT_WINDOW`, specialUse FGS, 부팅 수신기, 원격 푸시 수신기를 추가하지 않는다. `canRetrieveWindowContent=false`, `canPerformGestures=false`, `isAccessibilityTool=false`다. 이벤트의 화면 텍스트·source 트리를 읽거나 제스처를 수행하지 않는다.

시스템이 연결한 접근성 서비스의 백그라운드 Activity 시작 예외를 사용한다. 일반 백그라운드 앱에 같은 권한이 있다는 뜻은 아니다. [Android Activity 시작 제한](https://developer.android.com/guide/components/activities/secure-bal), [AOSP 서비스 연결 플래그](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/accessibility/java/com/android/server/accessibility/AccessibilityServiceConnection.java)

## 안내·권한·설정

| 목적                         | iOS                   | Android                             |
| ---------------------------- | --------------------- | ----------------------------------- |
| 선택 앱 사용량 측정          | Screen Time 승인      | 사용정보 접근                       |
| 집중 중 허용 앱 밖의 앱 제한 | 같은 Screen Time 승인 | 접근성 별도 고지·동의·시스템 활성화 |

1. 통합 안내는 「설정하기」 버튼 하나다. Android는 권한 한 번으로 둘 다 설정한다고 설명하지 않는다.
2. 측정 권한과 앱을 선택한다. 최초 저장은 즉시, 기존 측정 변경은 KST 다음 자정 적용이다. 측정 권한을 거절해도 「측정은 나중에 하고 허용 앱 고르기」로 진행할 수 있다.
3. 허용 앱을 저장한다. 미설정과 **0개 저장**을 구분하며, 취소는 다음 단계로 넘기지 않는다. 전화·홈·설정 등 필수 예외는 0개를 저장해도 쓸 수 있다.
4. 접근성 전용 고지에서 읽는 정보·사용 목적·기기 내 처리·비저장·비전송·철회 방법을 설명한다. 「동의하고 접근성 설정하기」로만 동의 값을 저장하고 공개 API인 `ACTION_ACCESSIBILITY_SETTINGS`를 연다.
5. 앱 복귀 뒤 enabled·connected·consented·configured를 모두 확인한다. 미연결이면 완료로 닫지 않고 재시도할 수 있다. 앱 설정의 「앱 복귀 끄기」는 동의를 철회하며 즉시 임대를 해제한다. OS 접근성 서비스 자체는 시스템 설정에서도 끌 수 있다.

낚시섬 AI 안내의 다음 버튼과 허용 앱 버튼, 기록 화면의 측정 설정에서 같은 흐름을 사용한다. iOS 안내 이력은 버전 1, 새 Android 복귀 안내는 버전 2로 분리해 예전 “차단 준비 중” 안내 응답이 새 안내를 소비하지 않게 한다. 노출 이력·응답 이력·실제 권한/저장은 서로 다르다.

## 세션 수명과 계정 경계

`syncAndroidFocus`는 로컬 active 세션마다 서버 `currentFocusSession`을 확인한다. 서버 세션 ID가 현재 화면과 같고 active일 때만 적용한다. 서버 조회는 네이티브 쓰기 큐 밖에서 진행하여 늦은 조회가 휴식·종료를 막지 않는다. 세대·계정·호출 revision이 바뀐 응답은 버린다.

- 최대 유효기간: **서버 확인 요청을 시작한 뒤 120초**. JS `performance.now()`로 조회·큐 대기 시간을 차감하고 네이티브 `elapsedRealtime()`로 만료를 판단한다. 이는 클라이언트의 보수적 유효기간이며 서버 발급 임대라고 부르지 않는다.
- 전경 집중 중 45초마다 확인한다. 배경에서 임대가 만료된 뒤 비허용 앱을 열면 서비스가 패키지명을 넘기지 않는 `onFocusReturnCheck` 이벤트로 JS 확인을 요청한다. 성공하기 전까지는 돌려보내지 않는다. 요청은 5초에 최대 한 번이다.
- 네트워크 실패는 즉시 해제한다. JS가 중단돼 확인할 수 없는 경우에도 만료 뒤 복귀하지 않는다. 원격 종료 신호를 별도 수신하지 않으므로, 다른 곳에서 종료된 세션은 최대 120초의 확인 지연이 있다.
- 휴식·종료·로그아웃·계정 변경·동의 철회는 즉시 해제한다. 만료 상태는 서버 확인을 다시 요청할 수 있지만 명시적 종료 상태는 요청하지 않는다.
- 임대는 메모리에만 둔다. 프로세스 종료·재부팅·서비스 재연결 후 옛 상태를 복원하지 않는다. 기존 `FocusSessionState`의 28일 저장값이나 `FocusRemoteDelivery`는 새 복귀 기능의 근거로 사용하지 않는다.
- 서비스 재연결은 새 서버 확인을 요청하고, JS가 없으면 앱을 열어 다시 확인하기 전까지 동작하지 않는다. 오래된 계정의 허용 목록은 새 계정 바인딩 때 삭제하고 동의도 다시 받는다.
- `focusShieldApplied`는 지원 상수가 아니라 실제 연결·동의·허용 설정·유효 임대를 확인한다. 작동하지 않을 때 기존 앱 이탈 판정이 유지된다.

## 앱 예외·중복 이벤트

Cattus 자신, Android 시스템 UI, 기본 전화 앱, HOME·설정·전화·알람 Intent 처리 앱, 활성 키보드와 런처에서 실행할 수 없는 시스템/권한 창은 항상 예외다. 허용 앱 목록과 측정 목록은 별도 키다. 새 `QUERY_ALL_PACKAGES` 권한은 추가하지 않는다.

실제 Activity로 확인되는 창 전환만 처리한다. 시스템 창으로 넘어가면 보관 중인 대상 패키지를 지워 늦은 서버 응답이 사용자를 끌어오지 않게 한다. 화면이 꺼졌거나 잠겨 있으면 복귀하지 않는다. 연속 복귀는 1.2초 간격으로 제한하되, 그사이 비허용 앱을 다시 연 경우 마지막 화면을 재확인해 처리한다. 패키지명은 저장·로그·JS 전달을 하지 않는다.

## 검증과 배포 경계

- 자동 테스트: 서버 조회 지연 중 종료, 계정 변경, 서버 세션 불일치·오프라인, 측정/허용 분리, 0개 저장, 동의 전 권한 요청 금지, 피커 취소, 미허용·늦은 응답, 단조 만료·재연결 초기화를 검사한다.
- 로컬 검증(2026-11-07): Jest 283개 스위트·4,715개 테스트, TypeScript·ESLint(오류 0)·포맷 검사, Android Debug APK와 모듈 단위 테스트를 통과했다. 안내 버전 보완 뒤 관련 23개 테스트도 통과했다.
- Android 17/API 37 에뮬레이터에서 실제 안내 → 측정 권한 → Chrome 측정 선택 → 빈 허용 목록 저장 → 별도 동의 → 접근성 연결을 확인했다. 최신 Debug APK에서 비허용 Chrome 실행 시 기존 Cattus task로 복귀, 허용 Chrome 유지, 시스템 설정 예외, 명시적 종료·5초 시험 임대 만료·계정 변경 후 해제를 확인했다. 재설치/프로세스 재시작 뒤 옛 임대는 복원되지 않았다.
- 로컬 QA 화면은 실제 네이티브 브리지·설정 컴포넌트를 사용하고 서버 집중 확인만 테스트 데이터로 분리했다. 기존 React 화면의 세션 ID와 타이머 유지도 확인했다. 실제 서버 집중 전체 흐름과 OEM 실기기 검증을 대신하지 않는다.
- 출시 전 확인 범위: 최소 지원 OS·목표 OS, Pixel·Galaxy Release, 장시간 화면 꺼짐·배터리 제한·서비스 종료, 큰 글자와 권한 철회, 보조 사용자·작업 프로필, 앱 삭제/데이터 초기화, 이벤트 빈도·배터리 영향. 접근성 서비스는 같은 Android 사용자/프로필의 앱만 대상으로 삼는다.
- Play 제출 전 접근성 선언·별도 고지 및 동의/거절/철회 동영상, 스토어 설명·개인정보 처리방침·Data Safety 답변을 실제 수집 내용에 맞춰 검토한다. [Google Play 접근성 API 정책](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en). 코드 구현이 Play 승인을 뜻하지 않는다.
- 새 Android runtime은 `2.0.1-android-focus-return-v1`이다. 네이티브 서비스가 필요하므로 OTA만으로 배포할 수 없다. 앱 main 머지는 Play 내부 트랙 발행을 시작한다. 이 작업은 PR까지이며 merge·운영 워크플로·스토어 게시를 수행하지 않는다.
