# 링크·알림 분리의 실행 환경

서비스별 env·이미지 digest와 nginx 적용 준비는 [deployment.md](deployment.md)를 따른다.
정본은 `docs/architecture/decisions.md` A1~A22와 서비스 아키텍처 §7이다. 이 문서는 그 절차를 실행하는 도구의 입력을 설명한다. DB·시크릿·라우팅·발송 gate 전환은 서로 다른 단계다.

## 서비스별 시크릿 생성

`.github/scripts/write-compose-env.py`는 stdin의 Secrets Manager JSON에서 선택한 서비스의 허용목록만 추출한다. `--service` 생략은 기존 dev-cd와 같은 legacy 동작이다.

```bash
aws secretsmanager get-secret-value --secret-id gromo/dev/env --query SecretString --output text \
  | python3 .github/scripts/write-compose-env.py \
      --service business-api --environment dev --image 'IMAGE_REPOSITORY@sha256:DIGEST' \
      --output .runtime/business-api.env
```

같은 명령에서 `--service notification`으로 알림 파일, `--service data-api`로 Data 파일을 만든다. 이미지 digest는 해당 서비스 CI 산출물의 값을 사용한다. 운영에서는 `--environment prod`와 `gromo/prod/env`를 사용한다. 파일은 원자 교체하고 권한은 0600, 상위 디렉터리는 0700이다. 검증 실패는 기존 파일을 보존한다.

| 서비스 | 필수 자격 |
|---|---|
| data-api | API_DB 3종, OPENAI_API_KEY, BIZ_TO_DATA·NOTI_TO_DATA·DATA_TO_NOTI·DATA_TO_LINK 서비스 토큰, LINK_CAPABILITY_KEY, LINK_IP_SALT, LINK_BASE_URL, NOTIFICATION_BASE_URL, KAFKA_BOOTSTRAP_SERVERS |
| business-api | JWT_SECRET, BIZ_TO_DATA·BIZ_TO_NOTI·BIZ_TO_LINK 서비스 토큰, DATA_API_BASE_URL, NOTIFICATION_BASE_URL, LINK_BASE_URL, LINK_IP_SALT |
| notification | NOTI_DB 3종, FCM 2종, BIZ_TO_NOTI·DATA_TO_NOTI·CONSOLE_TO_NOTI·NOTI_TO_DATA 서비스 토큰, DATA_API_BASE_URL, KAFKA_BOOTSTRAP_SERVERS |

표의 서비스 토큰에는 모두 `SVC_TOKEN_` 접두가 붙는다. 대상이 다른 caller 토큰을 같은 값으로 재사용하지 않는다. `DD_API_KEY`와 콘솔 로그인/sudo 비밀번호는 세 서비스 어디에도 전달하지 않는다.

Data 파일은 기본 `--phase transition`에서 JWT·Google/Apple client ID·FCM 2종도 요구한다. 구 코드가 기동·발송해야 하는 기간의 자격이다. 구 빈 제거·트래픽 전환·롤백 창 종료 확인 후에만 `--phase final`을 사용한다. writer의 final 선택 자체가 구 빈 제거를 수행하지는 않는다.

## 기존 볼륨과 RDS의 알림 DB 초기화

Flyway 전에 `server/scripts/provision-notification-db.sh`를 관리자 연결로 실행한다. 신규 Postgres 볼륨의 entrypoint에만 의존하지 않으므로 이미 데이터가 든 dev 볼륨에서도 사용할 수 있다. psql 16의 [환경변수 입력과 동적 SQL 실행](https://www.postgresql.org/docs/16/app-psql.html)을 사용한다.

필요 입력:

- 관리자 연결: `PGHOST`, `PGUSER`, 선택 `PGPORT`/`PGSSLMODE`, 인증은 `PGPASSFILE` 또는 `PGPASSWORD`.
- 기존 코어: `CORE_DB_NAME`, `API_DB_USERNAME`. Data 계정은 이미 존재하는 비관리자 전용 계정이어야 한다.
- 신규 알림: `NOTI_DB_USERNAME`, `NOTI_DB_PASSWORD`. database 이름은 정본의 `gromo_notification`이다.

스크립트는 다음을 수행한다.

1. 코어 계정이 superuser/CREATEDB/CREATEROLE 또는 관리자 역할을 쓸 수 있으면 변경 전에 실패한다. dev가 아직 `POSTGRES_USER` 관리자로 앱을 실행 중이면 Data 전용 계정으로 먼저 전환한다.
2. 알림 역할과 database를 생성한다. 기존 database의 소유자가 다르면 자동 인수하지 않는다. 같은 소유자로 재실행하면 데이터를 보존하며 비밀번호를 전달받은 값으로 맞춘다.
3. 알림 DB의 PUBLIC 권한과 Data 계정 권한을 회수한다. 코어 DB의 PUBLIC CONNECT와 알림 계정 권한을 회수하고 Data 전용 계정에는 CONNECT를 부여한다. 코어에 붙는 별도 운영/분석 계정이 있다면 그 계정의 명시적인 CONNECT 권한을 실행 전에 확인한다.

관리자 자격은 이 일회성 작업에만 사용하고 JVM 서비스 env 파일에는 넣지 않는다. 이 스크립트는 코어 schema의 소유자나 기존 table 권한을 바꾸지 않는다. Data 전용 계정 전환은 기존 운영 권한에 맞춰 별도로 준비해야 한다.

## 신규 서비스 compose

`server/scripts/docker-compose.satellites.yml`은 기존 환경 compose와 함께 사용하는 추가 파일이다. 프로젝트 네트워크는 `app-network`이며 Business/Notification의 host port와 management port는 공개하지 않는다.

Compose 보간 입력에 다음을 둔다.

- `BUSINESS_API_IMAGE`, `NOTIFICATION_IMAGE`: CI가 발행한 서비스별 digest.
- `BUSINESS_API_ENV_FILE`, `NOTIFICATION_ENV_FILE`: 위에서 생성한 각 서비스의 전용 파일 경로.
- `DEPLOY_ENV`: dev 또는 prod.

env 파일을 통째로 공유하지 않는다. Business의 HTTP port는 8080, Notification은 8082다. 이미지에는 compose healthcheck가 사용하는 curl이 포함돼야 한다. Data 주소와 Kafka 주소는 각 서비스 전용 env의 `DATA_API_BASE_URL`, `KAFKA_BOOTSTRAP_SERVERS`로 지정한다.

이 파일만 추가해 기존 dev/prod CD가 자동으로 신규 서비스를 올리지는 않는다. 릴리즈는 이미지·DB 권한·서비스 토큰·라우팅을 검증한 매니페스트로 수행한다. Notification의 내구 발송 gate는 별도이며, 서비스가 healthy라는 사실로 gate를 열면 안 된다.

## 검증과 CI

```bash
python3 -m unittest discover -s .github/scripts -p 'test_*.py' -v
```

합성 JSON을 writer→실제 compose config로 전달하여 필수 키·서비스 간 자격 혼입·전환 자격을 확인한다. 별도 Postgres 컨테이너에서는 실제 초기화 스크립트를 재실행해 데이터 보존, 교차 DB 접속 거부, 관리자 Data 계정 거부, 다른 소유자의 DB 인수 거부를 확인한다. 테스트 컨테이너는 검사 후 제거하며 운영 DB를 사용하지 않는다.

`satellite-ci.yml`은 두 서비스의 build/test/정적 검사와 Docker build를 실행한다. main push는 GAR에 amd64, release push는 ECR에 arm64 SHA 이미지와 digest 산출물을 발행한다. prod의 `gromo/prod/cicd`에는 `BUSINESS_API_ECR_REPO`와 `NOTIFICATION_ECR_REPO`를 준비하고 기존 prod OIDC 역할에 해당 저장소의 push 권한을 부여해야 한다. PR에서는 이미지만 검증하고 발행하지 않는다. digest 발행을 호스트 배포나 이관 완료로 취급하지 않는다. 기존 Data/채팅 CI는 각자의 검증을 계속 담당한다.

## 구현된 컷오버 스위치

| 스위치 | 초기값 | 전환 조건 |
|---|---|---|
| Data `INTERNAL_API_ENABLED` | false | 서비스별 caller/token 설정 검증 후 true |
| Data `OUTBOX_RELAY_ENABLED` | false | A18 재시도 정책 입력과 Kafka/HTTP 목적지 준비 후 true |
| Data `NOTIFICATION_DISPATCH_MODE` | LEGACY | 구 FCM·리스너·flush 정지/drain 후 OUTBOX |
| Notification `NOTIFICATION_KAFKA_ENABLED` | false | `.DLT`까지 토픽 준비 후 true. 수신·내구 적재만 시작 |
| Notification `NOTIFICATION_GENERATION_REQUIRED` | false | gen 발급 롤아웃 + 구 AT 최대수명 대기 후 true |
| Notification `NOTIFICATION_LEGACY_DEVICE_REGISTRATION` | true | 소유권·bootstrap 미지원 구 앱 지원 종료 후 false. AT의 gen 존재와 별개인 앱 롤아웃 축 |
| Notification `NOTIFICATION_SCHEDULING_ENABLED` | false | 각 등록부 job 활성화와 함께 true. 공통 gate는 계속 별도 |
| Notification `dispatch_control.enabled` | false | 최종 import/verify/stopWindow 검증 후 Console open으로만 true |

`OUTBOX_RELAY_BATCH_SIZE`, `OUTBOX_RELAY_LEASE_DURATION`, `OUTBOX_RELAY_POLL_INTERVAL`,
`OUTBOX_RELAY_INITIAL_BACKOFF`, `OUTBOX_RELAY_MAX_BACKOFF`, `OUTBOX_RELAY_WARNING_ATTEMPTS`는
relay를 켤 때 모두 명시한다. warning attempts는 폐기 횟수가 아니다. 미전달 행은 보존한다.
Kafka4 기본 DLT 이름에 의존하지 않고 수신기가 `notification-events.DLT`를 명시한다.

### Link 정지 스냅샷 이관

Data 실행 profile에 `link-migration`을 **한시적으로** 추가한다(예: `dev,satellites,link-migration`).
기존 `BATCH_ADMIN_KEY`로 운영 caller를 인증하며 freeze·manifest·두 export·close 다섯 경로만 연다.
Business/Notification 서비스 토큰은 이 운영 권한을 갖지 않는다. 이관 완료 뒤 profile을 제거한다.

아래 명령은 이관 호스트에서 `BATCH_ADMIN_KEY`, `LINK_MIGRATION_TOKEN`을 환경변수로 주입한 뒤 실행한다. Link의 일회성 이관 자격은 상시 Data relay 자격과 별개다.
토큰을 명령행 인수로 넣거나 결과 로그에 출력하지 않는다. Data URL은 private origin, Link URL은
운영자가 확정한 Vercel origin이다. redirect 응답은 토큰을 전달하지 않고 실패한다.

```bash
python3 server/scripts/migrate-link.py freeze --data-url "$DATA_URL" --link-url "$LINK_URL" \
  --migration-id "$MIGRATION_ID" --source-drained
python3 server/scripts/migrate-link.py import --data-url "$DATA_URL" --link-url "$LINK_URL" \
  --migration-id "$MIGRATION_ID"
python3 server/scripts/migrate-link.py verify --data-url "$DATA_URL" --link-url "$LINK_URL" \
  --migration-id "$MIGRATION_ID"
python3 server/scripts/migrate-link.py close --data-url "$DATA_URL" --link-url "$LINK_URL" \
  --migration-id "$MIGRATION_ID"
```

freeze 전에 기존 landing/match/claim/발급 쓰기를 정지하고 drain한다. `--source-drained`는 이 작업을
수행했다는 운영자 입력이며 스크립트가 nginx나 프로세스를 정지했다는 뜻이 아니다.
freeze 응답 유실은 같은 migration ID로 재실행한다. import는 0클릭 링크까지 전체 링크를 먼저,
그 뒤 클릭을 가져온다. 배치는 최대20이고 기본10이다. 503이면 배치를 나눠 동일 체크섬으로 재시도한다.
실패한 import/verify는 원본을 수정하지 말고 같은 회차의 import부터 재개한다.
close는 Link의 원자 검증·importer drain·IMPORT_CLOSED가 성공한 뒤 Data를 닫는다.
Data close 응답 유실도 같은 close를 재실행한다. 어느 단계도 DNS·nginx·발송 gate를 자동 전환하지 않는다.

### 알림 예약·재생과 등록부

Flyway V2는 **사건19종 + 렌더 전용 묶음4종, 각4 locale**를 시드한다. 한국어는 현재 발송 분기를
보존하고, en/ja/zh-Hant 문구는 알림 등록부가 소유한다. 묶음 kind를 Data producer가 발행하지 않는다.
몰수는 달성 여부보다 먼저 판정하고, 과거 `voidReason=null`은 일반 무효 환불 문구로 렌더한다.

V3의 실행 job은 `bundle-flush`, `ack-reconcile`, `user-reconcile`이다. 기본은 비활성이다.
나머지 Data 소유 잡은 읽기만 가능하며 실제 cron 식·replay CLI ID를 config에 함께 둔다.
종류19개, 기존 `@Scheduled`17개, 기존 메서드16개는 다른 수치다. 코어를 읽는 판정은 A22 ⓘ·ⓤ에
따라 Data에 남기므로 문서의 과거 "22잡 이관" 숫자만 보고 메서드를 통째로 끄면 안 된다.
`JobRegistry`가 cron과 `job_runs`의 재생 요청을 함께 소비한다. Data 소유 잡은 호출할 수 없으며,
실행 오류는 완료로 기록하지 않는다. 다중 Notification 인스턴스는 자기 DB의 ShedLock을 공유한다.
`user-reconcile`은 전용 단일 스레드 스케줄러와 `notification-user-reconcile` 잠금으로 실행하며,
`bundle-flush`·`ack-reconcile`의 스케줄러와 `notification-registry` 잠금을 공유하지 않는다.
각 실행은 완료 뒤에만 다시 예약되므로 전수 snapshot 조회가 느려도 발송·ack 회차는 계속 진행한다.
종료 인터럽트는 페이지 조회 전후·행 적용 전에 확인하며, 중단된 회차는 완료로 기록하지 않는다.
직접 `SnapshotReconciler.reconcile()` 호출은 기존처럼 호출 스레드에서 전수 조회를 마친다.
Data의 알림 배치는 OUTBOX 모드에서 잠금 충돌 — DB 직렬화 충돌(40001)과 교착 희생자(40P01) — 을 재시도한다(GROMO-893).
판정 스냅샷은 배치 트랜잭션에 두고 적기만 짧은 조각 트랜잭션으로 나누므로, 조각이 충돌하면 **이미 판정된 같은 요청**으로 그 조각만
새 트랜잭션에서 최대 3회 다시 적는다(`notification.fanout.chunk.retry`). 판정 트랜잭션 자체가 충돌했고 아직 커밋된 조각이 없을 때만
전체를 롤백한 뒤 동일 슬롯으로 다시 판정한다(최대 3회). **조각이 하나라도 커밋된 뒤에는 다시 판정하지 않는다** — 새 스냅샷에서
상태가 바뀐 사용자에게 다른 종류의 알림이 같은 슬롯에 또 적히기 때문이다. 이때 `notification.batch.partial_commit` 지표와 함께
재생 좌표(잡 이름·원래 슬롯)를 실은 실패가 올라온다. 소진되면 스케줄 실패 로그의 슬롯을 확인하고
`--notification.migration.replay=<잡 이름>@<놓친 슬롯 ISO-8601>`로 유효기간 안에 재생한다 — 부분 커밋된 슬롯의 재생은 새 스냅샷으로
다시 판정하므로(이미 적힌 같은 종류는 결정적 키로 접힌다) 운영자가 판단한다. LEGACY 모드는 FCM 중복을 피하기 위해 자동 재시도하지 않는다.
`user-reconcile`은 Data snapshot의 탈퇴·세대·locale/version만 반영하고 위성 설정·기기 소유권은 덮지 않는다.

최초 gate 개방과 이후 재개는 `docs/contracts/notification-admin-api.yaml`의 import/verify/open/close를
사용한다. open은 manifest를 실제 DB와 다시 대조한다. 실패하면 닫은 채 최종 import/verify로 돌아간다.
같은 close 키의 재시도도 다시 닫고 drain한다. 응답 유실로 open을 같은 키로 재전송할 때에는 현재 개방과 실제 데이터를 재검증한다. 이후 close로 닫혔으면 `409 DISPATCH_OPEN_REPLAY_STALE`이며 자동 재개하지 않는다. 의도적으로 다시 열 때에는 새 open 키로 전체 검증을 거친다.
한 번 열린 뒤에는 구 Data FCM 경로로 되돌리지 않는다. close가 진행 중 발송을 drain한 뒤 새 경로를 수정한다.

## 최종 알림 export

Data의 CLI를 `notification.migration.enabled=true`로 기동하고 `notification.migration.export-to=<로컬 파일>` 및 `notification.migration.id=<고정 ID>`를 지정한다. 구 발송·쓰기 인플라이트를 실제로 drain한 뒤 최종본에는 `notification.migration.closed-at=<epoch millis>`와 `notification.migration.inflight-drained=true`를 함께 준다. 최초 탐색에서는 두 값을 생략한다. 재조립 실패 또는 미전달 outbox가 남으면 최종본을 만들지 않는다.

export마다 고유한 `manifest.snapshot`이 만들어진다. 모든 `*.import-####.json`은 같은 `snapshot`을 포함하며, 빈 전체 export도 `records: []`인 import 파일 하나를 만든다. 한 export의 청크와 manifest를 섞지 않고 재시도에는 같은 파일·명령 키를 사용한다. 재추출은 새 snapshot이며 최종 verify/open은 그 새 manifest로 수행한다. import 멱등 키는 `noti-import:<snapshot>:<청크 번호>`처럼 export·청크별로 발급한다. 새 snapshot에 이전 요청 키를 재사용하면 본문 충돌이므로 새 키를 쓰고, 같은 파일 재전송만 같은 키를 유지한다. 부분 적재는 검증 실패로 닫힌 채 재개하고, 최초 개방 직전에 선택한 집합 밖의 변경되지 않은 이관 소유 행만 정리한다. 라이브 설정·기기 소유권·더 높은 버전은 보존한다.

`*.import-0000.json`의 500건 이하 배치를 Noti import API에 순서대로 전달하고, `*.verify.json`의 manifest로 검증한다. PENDING·DEFERRED는 미발송 데이터로 적재하며 queueDepth에는 포함하지 않는다. 빈 settings/device/delivery도 count 0과 SHA256(empty)를 manifest에 기록한다. 각 파일은 생성 시 0600이며 기존 파일을 덮지 않는다. 동일 원본 재시도는 새 출력 경로를 지정해 같은 migrationId에 반영한다.

직렬화 호환 검증은 Noti bootJar 빌드 뒤 `python3 .github/scripts/check-migration-checksum.py`로 실행한다. 발송 개방 전 실제 DB의 건수·체크섬·필드·미발송 렌더 검증은 별도로 통과해야 한다.


앱의 최초 기기 등록은 sid 없는 로그인을 먼저 refresh해 승격한 뒤 전송한다. 따라서 gen·sid·bootstrap을
발급하는 Data 인증 제공자를 앱 변경보다 먼저 배포한다. 갱신 장애나 세션 응답 미지원은 미전송 큐로 남긴다.
구 앱은 계속 무자격 본문을 보내므로 Business가 서명된 sid를 검증해 별도 legacy 세션 fence에 연결한다.
이 호환 경로는 현대 bootstrap 행을 덮지 않는다. 현대 등록 이후 구 JS로 롤백하는 배포는 호환 범위에 포함하지 않는다.


Data→Link 가입 relay를 활성화하기 전에 MMP의 A22 ㋻ 가입 귀속 검증을 배포·검증한다.
Data가 알 수 없는 새 slug도 가입 사실로 전달하므로, MMP의 그룹 일치·셀프 초대 제외 검증 없이
가입 relay부터 켜면 잘못된 귀속이 남는다. Data 제공자 배포 → MMP 검증 배포 → 가입 relay 개방 순서다.


## OUTBOX 후보 배치 활성화 선행 조건

[GROMO-893](https://romance.atlassian.net/browse/GROMO-893)의 다중 수신자 USER 잠금 경계와
결과·환불 후보 배치의 수신 완료 경계를
완료·검증하기 전에는 `NOTIFICATION_DISPATCH_MODE=OUTBOX`로 전환하지 않는다. 기본 LEGACY를
유지한다. 여러 페이지·그룹을 넘는 트랜잭션은 부분 정렬로 순서가 통일되지 않아 교착 시
생성 요청이나 해당 알림 슬롯 전체가 롤백될 수 있다. Foundation 코드 머지가 이 운영 조건의
해결을 뜻하지 않는다. 코어 mutation/outbox 원자성과 RR 판정 의미를 보존하는 수정이 선행한다.
결과·환불 재훑기는 이미 닫힌 같은 슬롯의 여러 사건을 생산하지만 현재 `bundleMembers`를
전달하지 않는다. 두 수신 사이에 flush가 실행되면 한 배치가 여러 푸시로 나갈 수 있으므로,
이 경계의 수정과 실제 수신·flush 교차 회귀도 위 선행 작업에 포함한다.

Kafka 오버레이는 `KAFKA_LOG_DIRS=/var/lib/kafka/data`를 영속 볼륨과 연결한다. `.github/scripts/test_kafka_persistence.py`는 실제 오버레이에서 별도 테스트 자원 이름만 적용하고 토픽 생성·메시지 발행·컨테이너 재생성·재수신을 검사한다. 운영 브로커에는 실행하지 않는다.

업그레이드 첫 등록 전 로그아웃은 로컬 소유권·대기 등록이 없으면 FCM SDK에서 현재 토큰을 읽어 사용자·토큰 범위로 정리한다. SDK 조회까지 실패하면 세션에 연결되지 않은 구 토큰은 정리되지 않을 수 있다. 대상 없는 사용자 전체 삭제로 확대하지 않으며 RT 폐기는 계속한다(A22 ㋲).

refresh는 서명된 userId의 활성 users 행을 잠근 뒤 RT 세션을 조회한다. 세션이 있으면 그 행의 소유자·폐기를 판정하고 세션 RT를 조건부 회전한다. users의 단일 해시는 세션 없는 구 RT의 승격에만 유효성 근거로 사용하며, 회전 시에도 같은 옛 해시를 가리킬 때만 동기화한다. 다른 기기의 로그인·회전·개별 로그아웃은 살아 있는 세션의 갱신을 무효화하지 않는다. (A22 ㋣)

소유권 값은 null 또는 정규 UUID 표기만 받는다. 잘못된 값은 Business 상류 호출·Data 내구 기록 전에 400으로 거절하며 null로 바꿔 삭제 범위를 넓히지 않는다. 이미 내구화된 잘못된 소유권 삭제 사건은 Notification이 어떤 기기도 변경하지 않고 소비 완료해 후속 사용자 사건을 막지 않는다. (A22 ㋗)
