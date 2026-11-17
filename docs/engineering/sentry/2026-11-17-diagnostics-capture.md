# 2026-11-17 오류 수집과 재현 문맥 보강

기존 SDK는 미처리 JS 오류와 네이티브 크래시를 수집하지만, 카메라 오류를 잡아 UI로 복구하는 경로는 `captureException`을 호출하지 않았다. CATTUS-8 조사에서는 정확한 심볼뿐 아니라 크래시 전 카메라 상태와 PostHog 기록을 직접 연결할 식별자도 부족했다. 이번 변경은 다음 사고에서 그 자료를 남긴다. 운영 배포는 아직 하지 않았다.

## 변경

- `VerificationSession`의 렌더/effect 초기화 예외와 카메라 `onError`를 원래 Error 객체·스택으로 Sentry에 전달한다. 기존 오류 안내와 재시도는 유지한다.
- 모델 로드, 리사이저, 모델 입력·출력 불일치, 손·물체 추론, 프레임 타임아웃을 실패 단계별로 수집한다. 같은 측정 시도의 같은 단계는 한 번만 전송한다. 손이나 공부 도구가 보이지 않는 정상 판정은 오류가 아니다.
- 카메라 켜짐·미리보기·전후면·집중 여부·화면 종료·백그라운드 상태와 촬영 시작·중단·복구를 `focus_camera` context와 breadcrumb에 남긴다. 프레임·사진·입력 텐서·과목명·집중 세션 ID를 진단 속성으로 보내지 않는다.
- 커스텀 라우터의 화면, 앱 생명주기, 창 크기·가로세로 상태를 기록한다. SDK 7.11의 scope 동기화를 통해 네이티브 크래시에도 같은 정보가 남는다.
- PostHog와 동일한 `readAnalyticsDeviceProperties()` 결과를 `analytics_device` context 및 `analytics.device_id` tag로 연결한다. iOS IDFV / Android ID이며, OS 조회가 실패하면 대체 식별자를 임의 생성하지 않는다.
- 개발·목업·빈 DSN의 기존 수집 제외 조건을 유지한다. 수집기 실패가 앱 시작이나 카메라 오류 복구를 막지 않는다.

## 실제 전송·심볼 검증

전용 iPad 10세대 / iOS 27.2 시뮬레이터에서 Release Hermes 번들을 실행했다. 앞선 Xcode 26.6 빌드의 실행 파일에 **현재 진단 코드와 진단 전용 entry**를 넣은 검사다. 실제 서비스 전체의 신규 바이너리 실행 검증으로 표현하지 않는다. 네이티브 버전 표시는 이 검사 기반 바이너리의 `2.3.4(13)`이다.

`scripts/tests/sentry-observability-probe.tsx`는 로컬 DSN에서만 실행하도록 차단되어 있다. 실제 `VerificationSession`을 띄워 시뮬레이터의 가속도계 초기화 실패를 잡고, 12초 뒤 Sentry SDK의 테스트용 `nativeCrash()`를 한 번 호출한다. 재실행 시 크래시를 반복하지 않는다.

1. **처리한 JS 오류**: `OrientationManager…accelerometer is not available`의 원래 스택, `handled=true`, `camera_stage=capture`, 화면·카메라·기기 문맥을 HTTP 수집기에서 확인했다.
2. **의도적인 네이티브 EXC_BREAKPOINT**: 앱 재실행 후 `handled=false`, 크래시 전 `capture_status=interrupted`, AI 측정·미리보기 ON, 집중 화면, 공통 IDFV가 전송됐다. 이는 CATTUS-8의 재현이나 해결 증거가 아니다.
3. 네이티브 이벤트의 앱 UUID와 확보한 dSYM은 `8CA0554A-5451-35B4-B7B7-27DE2900D8B8`로 일치했다. 크래시 주소를 해당 dSYM으로 해독해 **`+[SentrySDKInternal crash] (SentrySDKInternal.m:701)`**을 얻었다. [해독 출력](evidence/observability-2026-11-17/native-symbolication.txt)

[실제 수신 이벤트에서 추린 검증 결과](evidence/observability-2026-11-17/received-events.json). 보관본은 전용 시뮬레이터 IDFV를 가렸다. 원본 envelope는 `/tmp/cattus-observability-envelopes`에 있다. 운영 Sentry에 진단 이벤트를 보내거나 알림 규칙을 바꾸지 않았다. 이 검사는 실제 SDK의 전송·네이티브 저장 및 재전송을 확인하며, 운영 Sentry 서버 수신 확인과는 구분한다.

검증 명령:

```sh
python3 app/app-dev/scripts/tests/verify-sentry-probe.py /tmp/cattus-observability-envelopes
```

해당 스크립트는 잡은 JS 예외와 재실행 후 네이티브 예외가 모두 존재하는지, 각 이벤트에 화면·생명주기·창·카메라 breadcrumbs와 같은 기기 ID가 있는지 검사한다.

추가 자동 검사: Sentry·기기 식별·PostHog·카메라·앱 진입 회귀 **18 suites / 312건 통과**, TypeScript 검사 통과, 전체 ESLint 오류 0건. [Jest 결과](evidence/observability-2026-11-17/jest.log)

## 다음 배포와 남은 범위

dSYM 누락 방지 변경은 [기존 배포 검증 기록](2026-11-16-camera-and-dsym.md)의 `check-release` → 아카이브 UUID 대조 → Sentry 처리 완료 확인 → TestFlight 순서를 유지한다. 심볼 업로드 실패를 성공으로 넘기지 않는다.

이번 변경과 기존 카메라 네이티브 패치는 로컬 작업 트리에 있다. 다음 바이너리 배포에 포함돼야 사용자에게 적용된다. 아직 배포되지 않은 상태를 운영 오류 수집 완료라고 보고하지 않는다. CATTUS-8 원인 확정과 실제 기기에서의 촬영 크래시 재발 검증은 별도로 남는다.
