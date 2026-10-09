# Live Activity 원격 갱신·종료

기준: 2026-10-09. 기존 앱 내 갱신에 APNs 경로를 추가한다. 서버의 집중 세션·정산 정책은 바꾸지 않는다.

## 흐름

1. iOS가 `Activity.request(pushType: .token)`으로 Activity를 시작하고 토큰 회전을 관찰한다.
2. 앱은 로그인한 서버 집중 세션과 일치하는 토큰만 `PUT /focus-sessions/{sessionId}/live-activity`로 등록한다.
3. Business API는 인증 주체로 Data API의 내부 경로에 위임한다. Data는 세션 소유자를 확인한다.
4. Data의 `focus_live_activities` 테이블은 세션당 최신 Activity, 토큰, 환경, 고양이 색, 전송 성공 버전을 보관한다.
5. 스케줄러는 5초마다 최대 20건을 읽는다. 각 등록의 상태 확인 간격은 15초이며, 전이가 없으면 푸시하지 않는다.
6. 최신 서버 상태가 휴식·집중이면 `update`, 완료·포기·소속 상실이면 `end`와 `dismissal-date: 0`을 보낸다.
7. 일시 실패는 성공 버전을 올리지 않고 재시도한다. 종료 전송 성공·무효 토큰·8시간 만료 시 등록을 삭제한다.

APNs 종료 메시지는 일시 오프라인 기기를 위해 최대 8시간 보관하도록 요청한다. APNs 수락은 기기 표시 확인과 다르며,
실제 잠금화면 제거는 서명 설치본에서 확인해야 한다. 서버 재시작 후에도 등록과 전송 버전은 DB에 남는다.

## API

`PUT /focus-sessions/{sessionId}/live-activity`

인증 필수. 앱이 userId·집중 상태·전송 URL을 지정할 수 없다. 재등록은 멱등이며 별도 Idempotency-Key는 필요 없다.
공개 성공 응답은 기존 공통 봉투 규칙에 따라 `200 { "data": null }`, Data 내부 응답은 204다.

```json
{
  "activityId": "ActivityKit이 부여한 ID",
  "pushToken": "16진수 Activity 전용 토큰",
  "environment": "development",
  "catColor": "black"
}
```

`environment`는 development/production만 허용한다. 일반 알림 토큰·FCM 토큰과 다른 토큰이다.
단일 기기 정책을 따른다. 다중 기기 지원 시 세션당 여러 Activity 등록 모델로 확장해야 한다.

## 배포 설정

- Data API: Flyway V106 적용. Business API와 Data API의 새 등록 경로를 함께 배포한다.
- Data API 환경변수:
  - `FOCUS_LIVE_ACTIVITY_APNS_TEAM_ID`: Apple 팀 ID
  - `FOCUS_LIVE_ACTIVITY_APNS_KEY_ID`: 해당 APNs 인증 키 ID
  - `FOCUS_LIVE_ACTIVITY_APNS_KEY_BASE64`: APNs .p8 PEM 전체를 base64로 인코딩한 값
- App Store Connect API 키와 APNs 키는 용도가 다르다. 기존 APNs 키의 앱·환경 권한을 확인해 사용한다.
  실제 키 파일이나 값은 저장소·로그에 넣지 않는다.
- dev Compose에 변수 전달을 추가했다. prod는 기존 `.env.prod` 전체 주입 방식을 사용한다.
- 키가 없으면 서버는 기동되지만 원격 전송은 대기한다. 등록 성공만으로 APNs 연결 검증이 끝난 것은 아니다.
- iOS 본체에 `aps-environment`를 추가했다. `APS_ENVIRONMENT`는 Debug=development, Release=production이다.
  이 값을 Info.plist에도 넣어 API 서버의 dev/prod와 별개로 APNs sandbox/production을 선택한다.
- 인증서·팀·프로비저닝 파일 선택은 변경하지 않았다. 기존 푸시 권한이 있는 프로파일로 서명한다.

## 시간·순서

Swift Codable Date는 2001-01-01 기준 초, APNs timestamp/stale-date는 Unix epoch 초다.
집중 타이머의 anchor는 서버 구간의 ACTIVE 시간 합만 반영한다. 휴식은 서버 휴식 시작 시각을 사용한다.
서버는 세션 → Activity 순서로 잠그고 상태 스냅샷과 전송 순서를 지킨다. APNs 요청 시간 제한은 5초다.
전송 중 해당 집중 명령이 이 잠금을 기다릴 수 있다. 전송량이 늘면 분리된 전송 큐와 전이 순서 보장을 함께 검토한다.

앱 등록은 인증 세대·현재 집중 세션을 확인한다. 토큰 변경은 즉시, 실패·이벤트 누락은 포그라운드 복귀와
15초 폴링에서 재시도한다. 최초 등록 전 앱이 종료되면 다음 실행 전까지 원격 전송을 사용할 수 없다.
JS와 네이티브 양쪽에서 시작·갱신·종료를 직렬화하며, 과거 pushType:nil Activity는 다음 동기화에서 교체한다.

## 검증 범위

- 앱: 토큰 복원·중복 억제·회전·실패 재시도·계정 전환·종료 후 이벤트 폐기
- 서버: 소유자 검증, 버전별 전송, 재시도, 만료, 휴식 타이머, 모든 종료 상태
- PostgreSQL: 실제 Flyway 적용 및 등록 → pause → finish 통합 흐름
- Business: 인증 사용자 위임, 미인증·추가 필드 거절
- APNs HTTP 계약: EC 테스트 키로 JWT 서명 검증, 환경별 호스트·topic·종료 보관·오류 분류
- 실서버 배포·실제 APNs 키 주입·실기기 잠금화면 전송은 별도 확인이 필요하다.
