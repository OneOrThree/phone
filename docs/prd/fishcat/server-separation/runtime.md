# ~~링크·~~알림 분리의 실행 환경

> A23(2026-09-13): 링크 분리는 폐기됐다 — 링크·MMP 는 business-api(공개 표면·콘솔)·data-api(원장) 안이다([링크 정본](../link-attribution/README.md)). 이 문서의 링크 관련 값·절차는 PR #745 가 남긴 코드의 운용 설명이며 링크 구현 PR 이 걷어낼 때까지만 유효하다(링크 LLD §9).

서비스별 env·이미지 digest와 nginx 적용 준비는 [deployment.md](deployment.md)를 따른다.
정본은 `docs/architecture/decisions.md` A1~A22와 서비스 아키텍처 §7이다. 이 문서는 그 절차를 실행하는 도구의 입력을 설명한다. DB·시크릿·라우팅·발송 gate 전환은 서로 다른 단계다.

## 서비스별 시크릿 생성

`.github/scripts/write-compose-env.py`는 stdin의 Secrets Manager JSON에서 선택한 서비스의 허용목록만 추출한다. `--service` 생략은 기존 data-api-cd와 같은 legacy 동작이다.

```bash
aws secretsmanager get-secret-value --secret-id gromo/dev/env --query SecretString --output text \
  | python3 .github/scripts/write-compose-env.py \
      --service business-api --environment dev --image 'IMAGE_REPOSITORY@sha256:DIGEST' \
      --output .runtime/business-api.env
```

같은 명령에서 `--service notification`으로 알림 파일, `--service data-api`로 Data 파일을 만든다. 현재 dev CD는 `.github/scripts/dev-env.sh`로 매 실행마다 `$RUNNER_TEMP`에 필요한 env를 만들고 종료 시 삭제한다. 영구 수동 env를 배포 입력으로 사용하지 않는다. 이미지 digest는 해당 서비스 CI 산출물의 값을 사용한다. Catus 운영은 Infra runtime이 `catus/prod/env`와 `catus/prod/database`에서 서비스별 임시 env를 만든다. 파일은 원자 교체하고 권한은 0600, 상위 디렉터리는 0700이다. 검증 실패는 기존 파일을 보존한다.

| 서비스 | 필수 자격 |
|---|---|
| data-api | API_DB 3종, BIZ_TO_DATA·NOTI_TO_DATA·REALTIME_TO_DATA·DATA_TO_NOTI 서비스 토큰, LINK_BASE_URL, NOTIFICATION_BASE_URL, KAFKA_BOOTSTRAP_SERVERS (relay 를 켜면 REALTIME_BASE_URL·DATA_TO_REALTIME 토큰도 — [relay ON 체크리스트](#relay-on-체크리스트)) |
| business-api | JWT_SECRET, BIZ_TO_DATA·BIZ_TO_NOTI·BIZ_TO_REALTIME 서비스 토큰, DATA_API_BASE_URL, NOTIFICATION_BASE_URL, REALTIME_BASE_URL, BUSINESS_REDIS_PASSWORD, LOGIN_ATTEMPT_DIGEST_SECRET, BUSINESS_CURSOR_KEY_V1 (prod 는 LINK_PROXY_SECRET 추가) |
| notification | NOTI_DB 3종, FCM 2종, BIZ_TO_NOTI·DATA_TO_NOTI·CONSOLE_TO_NOTI·NOTI_TO_DATA 서비스 토큰, DATA_API_BASE_URL, KAFKA_BOOTSTRAP_SERVERS |

표의 서비스 토큰에는 모두 `SVC_TOKEN_` 접두가 붙는다. 대상이 다른 caller 토큰을 같은 값으로 재사용하지 않는다. Data·Realtime에는 같은 `REALTIME_TO_DATA` 토큰을 공급하고 Data 프로파일에 `satellites,realtime-authorization`을 포함한다. `LINK_BASE_URL`은 현재 섬 초대 공유 주소이며, `LINK_PROXY_SECRET`은 게스트 요청의 프록시 신뢰 검증용이다. 폐기한 독립 Link 자격과 OpenAI 키는 주입하지 않는다. `DD_API_KEY`와 콘솔 로그인/sudo 비밀번호는 세 서비스 어디에도 전달하지 않는다.

Data 파일은 기본 `--phase transition`에서 JWT·Google/Apple client ID·FCM 2종도 요구한다. FCM은 현재 집중 상태 알림에서도 쓰므로 `final` 허용 목록에도 유지한다. `--phase final`은 env 분리 옵션으로, DB 전환이나 트래픽 교체를 대신 수행하지 않는다. 자동 배포·실패 복구는 [배포 문서](deployment.md)를 따른다.

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

## dev 에서 켜는 순서

dev(GCP `gromo-dev-app`, e2-standard-2 · 2 vCPU · 8 GB, decisions.md A25)에서 Kafka와 Data 위성 모드를 켜는 순서다. 모든 단계는 사람이 명시적으로 실행한다. `data-api-cd.dev.yml`은 **이미 켜진 것을 유지만** 하고 스스로 켜거나 끄지 않는다. 스위치의 의미와 전환 조건은 [구현된 컷오버 스위치](#구현된-컷오버-스위치) 표가 정본이다.

| 단계 | 하는 일 | 되돌리기 |
|---|---|---|
| 0 | `data-api-cd.dev.yml` 조건부 오버레이 + `ops-kafka.dev.yml` 머지. `phone-kafka` 미실행이고 `/var/lib/gromo/runtime/data-api.env`가 없으면 배포 입력은 `docker-compose.dev.yml`(+기존 datadog) 그대로다 — **no-op** | 해당 PR revert |
| 1 | 서버에서 `free -m` 확인 → Actions **Dev Kafka** `up`. 여유 1024 MiB 미만이면 워크플로가 거부한다. 브로커만 뜨고 토픽은 없다(자동 생성 꺼짐). 이후 CD는 `phone-kafka`가 돌면 `docker-compose.kafka.yml`을 함께 물린다 | **Dev Kafka** `down` (`kafka-data` 볼륨 보존) |
| 2 | `/var/lib/gromo/runtime/data-api.env`(0600, VM 시작 스크립트가 만드는 고정 경로 — GROMO-2134)를 [서비스별 시크릿 생성](#서비스별-시크릿-생성)의 `--service data-api --environment dev`로 만든다. 스위치는 전부 끈 채로 둔다: `OUTBOX_RELAY_ENABLED=false`, `NOTIFICATION_DISPATCH_MODE=LEGACY`(내부 API 는 스위치가 없다 — caller 토큰이 문이다, 10-27 티켓 2535). 다음 CD부터 `docker-compose.satellites.data.yml`이 마지막 `-f`로 붙어 파일의 `SPRING_PROFILES_ACTIVE`(기본 `dev,satellites`)로 뜬다 | 파일 삭제 → 다음 CD가 dev 단독으로 app 재생성 |
| 3 | relay ON. A18의 `OUTBOX_RELAY_*` 여섯 값을 모두 명시하고, 정적 목적지 ~~`LINK_BASE_URL`·~~`NOTIFICATION_BASE_URL`이 app 컨테이너 안에서 풀려야 한다(A23: relay 를 켜기 전에 `outbox.relay.endpoints` 의 `link.*` 대상을 뺀다 — 링크 LLD §9.1, GROMO-2407 로 완료). `notification-events`·`.DLT` 토픽은 이때 NewTopic 빈이 만든다. REALTIME 대상도 이때 함께 열리므로 아래 [relay ON 체크리스트](#relay-on-체크리스트)를 먼저 채운다 | `OUTBOX_RELAY_ENABLED=false` (미전달 행 보존) |
| 4 | Notification·Business 위성 기동 — [신규 서비스 compose](#신규-서비스-compose)와 [deployment.md](deployment.md) | 해당 서비스만 제거 |
| 5 | ~~`NOTIFICATION_DISPATCH_MODE=OUTBOX` — [OUTBOX 선행 조건](#outbox-후보-배치-활성화-선행-조건)(GROMO-893) 해소 후에만. **단방향**~~ → 스위치 삭제(#1247, 티켓 2421): Data 에 구 FCM 발송 경로가 없어 Notification 이 유일한 발송 경로다 | — |
| 6 | Notification 발송 게이트 상시 개방(dev 만, 2026-10-27 티켓 2522): SM `NOTIFICATION_SCHEDULING_ENABLED=true` → `ops-redeploy.dev` notification → 열기 전 대기 발송 확인 → `PUT /internal/admin/jobs/delivery-dispatch`(`enabled=true`) → `POST /internal/admin/dispatch/open`(새 멱등 키). 절차는 [notification README](../../../../server/notification/README.md#dev-발송-게이트) | `POST /internal/admin/dispatch/close`(새 멱등 키, 진행 중 발송 drain) |

### relay ON 체크리스트

3단계에서 `OUTBOX_RELAY_ENABLED=true` 로 바꾸기 **전에** 모두 확인한다. 키별 「비었을 때」 동작은 [server/scripts README §4](../../../../server/scripts/README.md#4-시크릿스위치--비었을-때의-동작)가 정본이다.

- [ ] A18 의 `OUTBOX_RELAY_*` 여섯 값이 `data-api.env` 에 있다.
- [ ] `REALTIME_BASE_URL`(dev: `http://realtime:8081`)과 `SVC_TOKEN_DATA_TO_REALTIME` 이 SM 에 있고 `data-api.env` 에 들어갔다. 둘 중 하나라도 비면 relay 를 켠 Data 가 기동을 거부한다.
- [ ] 같은 `SVC_TOKEN_DATA_TO_REALTIME` 값이 Realtime 에도 닿았다(dev: SM `gromo/dev/env` → CD 가 job 마다 만드는 임시 `dev.env` → `docker-compose.realtime.yml`). 비어 있으면 Data 는 뜨지만 Realtime 이 `POST /internal/events` 를 401 로 거절해 REALTIME 행이 쌓인다. Business 토큰(`SVC_TOKEN_BIZ_TO_REALTIME`)과 **다른 값**이다(A22 ㊀).
- [ ] Realtime 을 재생성해 토큰을 읽혔다: `docker compose … -f docker-compose.realtime.yml up -d realtime`. CD 는 Realtime 을 건드리지 않는다.
- [ ] REALTIME 을 Kafka 로 보낼 때만 — **Realtime 먼저, Data 나중**: ① Kafka 오버레이 기동 ② SM 에 `REALTIME_EVENTS_KAFKA_ENABLED=true` → Realtime 재생성 → `realtime-events` 소비자 기동 확인 ③ 그다음 `OUTBOX_RELAY_REALTIME_KAFKA_ENABLED=true` 로 Data 재생성. 반대 순서면 소비자 없는 토픽에 사건이 쌓인다. 되돌릴 때는 역순(Data 먼저 끄고 Realtime 을 끈다).

막힌 곳:

- **A18 보류** — relay 재시도 값이 정해지지 않아 3단계 이후로 못 간다.
- **dev VM 메모리** — kafka.yml의 512 MB 힙은 prod t4g.large(8 GB) 기준이다. dev는 e2-medium(4 GB)에서 **e2-standard-2(8 GB)로 사이즈업**(decisions.md A25 — 경유했던 e2-custom-2-6144(6 GB)는 존 자원 부족으로 기동 거부, 09-24)했지만 app·db·redis·(datadog-agent 512 MB)가 이미 있어 여유가 넉넉하지 않다. 1단계의 메모리 게이트가 첫 관문이고, 여유가 없으면 관측 스택 정리가 먼저다.
- **GROMO-893** — 5단계 선행 조건.

2단계 주의:

- `gromo/dev/env`에 data-api 필수 자격([위 표](#서비스별-시크릿-생성))이 먼저 있어야 writer가 파일을 쓴다. 지금 legacy data-api-cd가 요구하는 9개 키보다 많다.
- `satellites.data.yml`은 app의 `environment`를 `!override`로 지우므로 `docker-compose.dev.yml`이 계산하던 `API_DB_*`·`REDIS_HOST`·`FOCUS_PRESENCE_ENABLED`는 이 파일에서만 온다. CD는 파일을 직접 읽지 않고 **Compose가 파싱한 값**(env_file 하나만 가진 임시 서비스의 `config --format json`)으로 판정하므로 인라인 주석·CRLF·따옴표 해석이 실제 컨테이너와 같다. 파일이 비었거나 0600이 아니거나, Compose가 파싱하지 못하거나, `API_DB_*` 3종 중 하나라도 없거나 비었거나(공백뿐 포함), `SPRING_PROFILES_ACTIVE`가 있는데 비었거나 `dev`·`satellites`를 빠뜨리거나 `prod`를 담으면 app을 건드리기 전에 실패한다. `dev,satellites` 기본값은 키가 **없을 때만** 쓴다. 로그에는 키 이름·프로파일 목록만 남는다. `!override`를 모르는 구형 Compose면 `config --quiet`에서 멈춘다.
- Datadog이 켜져 있으면 CD가 `DATA_API_JAVA_OPTS`에 `-javaagent`를 유지한다. 다만 오버레이의 `DD_SERVICE`는 `gromo-data-dev`라 컨테이너 라벨의 `gromo-back-dev`와 갈린다.
- `ops-datadog.dev.yml`의 up/restart/down은 app을 dev(+datadog) 파일로만 재생성한다. 2단계 이후 실행하면 다음 CD 전까지 satellites 없이 뜬다.

## 검증과 CI

```bash
python3 -m unittest discover -s .github/scripts -p 'test_*.py' -v
```

합성 JSON을 writer→실제 compose config로 전달하여 필수 키·서비스 간 자격 혼입·전환 자격을 확인한다. 별도 Postgres 컨테이너에서는 실제 초기화 스크립트를 재실행해 데이터 보존, 교차 DB 접속 거부, 관리자 Data 계정 거부, 다른 소유자의 DB 인수 거부를 확인한다. 테스트 컨테이너는 검사 후 제거하며 운영 DB를 사용하지 않는다.

`satellite-ci.dev.yml`은 두 서비스의 build/test/정적 검사와 Docker build를 실행한다. main push는 GAR에 amd64, release push는 ECR에 arm64 SHA 이미지와 digest 산출물을 발행한다. prod의 `gromo/prod/cicd`에는 `BUSINESS_API_ECR_REPO`와 `NOTIFICATION_ECR_REPO`를 준비하고 기존 prod OIDC 역할에 해당 저장소의 push 권한을 부여해야 한다. PR에서는 이미지만 검증하고 발행하지 않는다. digest 발행을 호스트 배포나 이관 완료로 취급하지 않는다. 기존 Data/채팅 CI는 각자의 검증을 계속 담당한다.

## 구현된 컷오버 스위치

| 스위치 | 초기값 | 전환 조건 |
|---|---|---|
| Data `OUTBOX_RELAY_ENABLED` | false | A18 재시도 정책 입력과 Kafka/HTTP 목적지 준비 후 true |
| ~~Data `NOTIFICATION_DISPATCH_MODE`~~ | ~~LEGACY~~ | ~~구 FCM·리스너·flush 정지/drain 후 OUTBOX~~ → 스위치 삭제(#1247, 위 5단계) |
| Notification `NOTIFICATION_KAFKA_ENABLED` | false | `.DLT`까지 토픽 준비 후 true. 수신·내구 적재만 시작 |
| Notification `NOTIFICATION_GENERATION_REQUIRED` | false | gen 발급 롤아웃 + 구 AT 최대수명 대기 후 true |
| Notification `NOTIFICATION_LEGACY_DEVICE_REGISTRATION` | true | 소유권·bootstrap 미지원 구 앱 지원 종료 후 false. AT의 gen 존재와 별개인 앱 롤아웃 축 |
| Notification `NOTIFICATION_SCHEDULING_ENABLED` | false | 각 등록부 job 활성화와 함께 true. 공통 gate는 계속 별도. dev 는 2026-10-27 부터 true(위 6단계) |
| Notification `dispatch_control.enabled` | false | `POST /internal/admin/dispatch/open` 으로만 true(이관용 import/verify 경로는 #1247 에서 제거). dev 는 2026-10-27 부터 상시 개방(위 6단계 — 운영은 바꾸지 않음) |

`OUTBOX_RELAY_BATCH_SIZE`, `OUTBOX_RELAY_LEASE_DURATION`, `OUTBOX_RELAY_POLL_INTERVAL`,
`OUTBOX_RELAY_INITIAL_BACKOFF`, `OUTBOX_RELAY_MAX_BACKOFF`, `OUTBOX_RELAY_WARNING_ATTEMPTS`는
relay를 켤 때 모두 명시한다. warning attempts는 폐기 횟수가 아니다. 미전달 행은 보존한다.
처리량 손잡이 `OUTBOX_RELAY_RUN_LENGTH`(10)·`OUTBOX_RELAY_WORKER_THREADS`(4)·`OUTBOX_RELAY_TICK_BUDGET`(PT5S, 0 = 한
라운드)는 **선택**이다 — 비우면 괄호의 기본값(GROMO-2338). poll 1s·예산 5s 면 relay 가 일하는 비율은 ≈ 83%다.
Kafka4 기본 DLT 이름에 의존하지 않고 수신기가 `notification-events.DLT`를 명시한다.

### 폐기한 Link 정지 스냅샷 이관

A23에서 링크 이관 절차를 폐기했으며, V0 전환에서 정지 스냅샷 API·프로필·실행 도구를 제거했다.
현행 섬 초대 링크는 Data 내부 API가 관리한다. 현재 DB 전환과 Data·Realtime 교체는
[서버 실행 가이드](../../../../server/scripts/README.md#catus-v0-전환과-datarealtime-동시-교체)와
[Data V0 전환 절차](../../../../server/data-api/docs/db/README.md)를 따른다.

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
새 트랜잭션에서 다시 적는다 — 횟수는 `notification.fanout.chunk-max-attempts`(기본 3), 재시도마다 지표 `notification.fanout.chunk.retry`. 판정 트랜잭션 자체가 충돌했고 아직 커밋된 조각이 없을 때만
전체를 롤백한 뒤 동일 슬롯으로 다시 판정한다(최대 3회). **조각이 하나라도 커밋된 뒤에는 다시 판정하지 않는다** — 새 스냅샷에서
상태가 바뀐 사용자에게 다른 종류의 알림이 같은 슬롯에 또 적히기 때문이다. 이때 `notification.batch.partial_commit` 지표와 함께
재생 좌표(잡 이름·원래 슬롯)를 실은 실패가 올라온다. 소진되면 스케줄 실패 로그의 슬롯을 확인하고
`--notification.migration.replay=<잡 이름>@<놓친 슬롯 ISO-8601>`로 유효기간 안에 재생한다 — 부분 커밋된 슬롯의 재생은 새 스냅샷으로
다시 판정하므로(이미 적힌 같은 종류는 결정적 키로 접힌다) 운영자가 판단한다. LEGACY 모드는 FCM 중복을 피하기 위해 자동 재시도하지 않는다.
`user-reconcile`은 Data snapshot의 탈퇴·세대·locale/version만 반영하고 위성 설정·기기 소유권은 덮지 않는다.

gate 개방과 재개는 `docs/contracts/notification-admin-api.yaml`의 `dispatch/open`·`dispatch/close`를 사용한다
(이관용 import/verify 경로와 manifest 대조는 #1247 에서 제거했다).
같은 close 키의 재시도도 다시 닫고 drain한다. 응답 유실로 open을 같은 키로 재전송하면 지금 열려 있을 때만 원 응답을 재생하고, 이후 close로 닫혔으면 `409 DISPATCH_CLOSED`이며 자동 재개하지 않는다. 의도적으로 다시 열 때에는 새 open 키를 쓴다.
Data 에는 구 FCM 발송 경로가 없다(#1247). 발송을 고칠 때는 close 로 진행 중 발송을 drain 한 뒤 고친다.

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
