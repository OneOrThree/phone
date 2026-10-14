# 위성 서비스 배포 준비

`prepare-satellite-deploy.py`는 서비스별 env, digest 입력, 적용 순서를 생성한다. 실행 환경과 컷오버는 [runtime.md](runtime.md), 정본은 서비스 아키텍처 §7을 따른다. 이 도구는 배포·DNS·시크릿 조회를 실행하지 않는다.

```bash
python3 server/scripts/prepare-satellite-deploy.py \
  --environment dev --phase transition --project-name phone \
  --base-compose server/scripts/docker-compose.dev.yml \
  --shared-env-file /배포경로/.env --output-dir /배포경로/runtime \
  --data-image 'DATA_REPOSITORY@sha256:DIGEST' \
  --business-image 'BUSINESS_REPOSITORY@sha256:DIGEST' \
  --notification-image 'NOTIFICATION_REPOSITORY@sha256:DIGEST' < /보호된경로/SecretString.json
```

입력은 실제 배포의 SecretString과 기존 compose 보간 env다. 이미지 태그·누락 자격·존재하지 않는 기존 env는 거부한다. prod에서는 현재 스택과 같은 `--project-name`을 명시한다. env·절차 출력은 0700 디렉터리의 0600 파일이며 값은 로그에 남기지 않는다. 입력의 relay·스케줄 설정은 그대로 전달하므로 준비 도구가 이를 꺼 준다고 가정하지 않는다.

준비 단계에도 Docker Compose CLI가 필요하다. 서비스 실행이나 Docker daemon 접속 없이 `config`로 필수 보간값을 해석한다. 셸 환경변수(빈값 포함) → 생성 compose.env → 공유 env 우선순위를 적용한 최종값이 비거나 공백뿐이면 기존 산출물을 쓰기 전에 거부한다. 공유 env의 인용·여러 줄·변수 참조는 Compose 문법을 그대로 따르고, 선택 변수의 기본값은 유지한다. 검증 결과에는 누락된 키 이름만 표시하며 Compose의 원문 출력은 로그에 남기지 않는다.

`SVC_TOKEN_CONSOLE_TO_NOTI`는 `member-1:<전용토큰>,member-2:<전용토큰>` 형태이며 행위자는 `member-1`부터 `member-3`까지 허용한다. 단일 공유 토큰, 비어 있는 토큰, 콘솔 토큰 중복 및 Business·Data caller 토큰과의 충돌은 env를 쓰기 전에 거부한다. 같은 행위자의 서로 다른 토큰은 회전을 위해 허용한다. 준비 검사는 알림 `ServiceAuth`의 공백·구분자 규칙을 따르며 입력 원문을 바꾸지 않는다.

## Data 전용 환경 연결

`docker-compose.satellites.data.yml`을 마지막 `-f`로 넣는다. `env_file: !override`로 prod의 공유 `.env.prod`를 교체하고 `environment: !override`로 dev의 관리자 DB 자격 덮어쓰기를 제거한다. Data 이미지는 `APP_IMAGE`의 검증된 digest를 사용한다. 전용 파일의 `dev,satellites` 또는 `prod,satellites` 프로파일을 검사한다. `!override`를 지원하는 Compose가 필요하며 `config --quiet` 실패 시 진행하지 않는다.

공유 SecretString의 `SPRING_PROFILES_ACTIVE`·`DEPLOY_ENV`·`DATA_API_PROFILES`·`DD_ENV`·`DD_SERVICE`·`DD_VERSION`은 공개 설정 키로 분류해 compose 누출 후보에서 제외한다. 같은 문자열을 가진 실제 자격 키와 미분류 키는 계속 검사하며, 자격을 포함할 수 있는 URL·접속 문자열도 제외하지 않는다.

`--data-image`를 지정하면 `--data-profiles`의 선택값을 Data env의 `SPRING_PROFILES_ACTIVE`와 오버레이의 `DATA_API_PROFILES`에 동일하게 전달한다. 생략 시 기본값은 `<environment>,satellites`이며 `--data-profiles=prod,satellites,foo`처럼 추가할 수 있다. 쉼표로 구분한 정확한 `satellites` 항목이 필수이고, 선택값과 다른 셸 `DATA_API_PROFILES`는 준비 단계에서 거부한다. 이 선택값은 Business·Notification에 전달하지 않는다.

Business/Notification만 기동하는 단계와 Data(app)를 재생성하는 단계는 생성된 `deploy-plan.txt`에서 분리한다. 기존 스택의 네트워크·볼륨과 프로젝트명은 유지한다. Data의 prod APM JVM 옵션도 준비한 보간 파일에 포함한다. 운영 DB 초기화·서비스 토큰·A18 입력은 기동 전에 준비한다.

## 라우팅

nginx·인증서는 Infra 소유다. `nginx-satellites.include.conf.example`과 `nginx-satellites-proxy-headers.conf.example`를 검토한 뒤 실제 upstream과 프록시 시크릿을 주입한다.

- 준비된 Business 경로만 라우팅하고 나머지 기존 Data 경로를 유지한다.
- Notification은 시스템 §2.1대로 `/internal/admin/`만 공개하며 서비스가 콘솔 전용 Bearer와 actor를 검증한다. 나머지 `/internal/`과 management 9091은 공개하지 않는다.
- ~~Cloudflare CIDR·방화벽·realip 설정으로 검증한 방문자 IP를 전용 `X-Link-Client-IP`로 보낸다. 프록시 시크릿은 nginx·Business·Link에서 일치해야 한다.~~ → A23(2026-09-13): 링크 서버가 없다 — 검증한 방문자 IP 는 현행대로 `X-Real-IP` 로 넘기고 프록시 시크릿은 없다([링크 정본](../link-attribution/high-level-design.md) §2·§5).
- (A23(2026-09-13)으로 폐기 — 링크 컷오버·정지 창이 없다, 링크 정본 HLD §7 4단계: nginx 설정 한 번) §7.2 3~4단계에는 랜딩을 닫고 Business 호환 match를 사용한다. `IMPORT_CLOSED`·import drain 후 예시의 final 블록으로 랜딩과 match를 같은 reload에서 Link로 넘긴다. claim 목적지 전환·큐 처리도 같은 정지 창에서 확인한다.
- ~~라우팅 교체 후 호환 인플라이트를 drain하고 `COMPAT_MATCH_HANDLER_ENABLED`를 끈다. 구 앱의 `/l/match` URL은 제거하지 않는다. DNS 이전은 두 경로가 Neon을 본 뒤에 한다.~~ → A23: 호환 핸들러·Neon·DNS 이전이 없다. `business.compat.*` 는 #745 잔재로 기본 false 를 유지하고(링크 LLD §9.1) 링크 구현 PR 이 걷어낸다(링크 LLD §9.2).

## 실패 복구

준비 단계의 실패는 기존 서비스를 변경하지 않는다. 신규 쓰기 전 기동 실패는 해당 서비스의 직전 검증 digest로 복구한다. ~~Link §7.2 3단계 이후에는 Neon을 정본으로 유지하며 실패한 import·검증·라우팅 단계를 재개한다.~~ → A23: 링크 이관 단계가 없다(정본은 계속 RDS `gromo`). Notification의 최초 gate 개방 이후에는 close/drain → 새 경로 수정·검증 → 재개 순서다. 이 단계 이후 구 Data FCM이나 구 클릭 원장으로 자동 복귀하지 않는다. DB·이관 원장·서비스별 env를 보존한다.

`--phase final`은 구 빈 제거·트래픽 전환·롤백 창 종료가 확인된 뒤에만 사용한다. 현재 최소 Business 어댑터는 전체 인증 이전을 완료하지 않았으므로 이 배치만으로 final 자격 회수를 실행하지 않는다.

## 검증

`python3 -m unittest discover -s .github/scripts -p 'test_*.py' -v`로 서비스별 값·파일 권한·누락 입력과 실제 compose 병합 결과를 검증한다. compose 전체 출력에는 비밀이 포함될 수 있으므로 운영 로그에 남기지 않는다. nginx 예시는 합성 upstream으로 syntax 검사하고 운영에서는 실제 Infra 설정과 합쳐 `nginx -t`를 통과한 뒤 reload한다.

## 기존 Business 미리보기 통합

Business 전용 `BUSINESS_REDIS_PASSWORD`를 SecretString에 추가한다. 선택적인 `GOOGLE_DRIVE_API_KEY`도 Business env에만 전달한다. 준비 도구는 `business-redis.acl`과 그 경로 `BUSINESS_REDIS_ACL_FILE`을 생성한다. ACL에는 원문 비밀번호 대신 SHA-256이 들어가며, 0700 디렉터리 안의 ACL 파일만 Redis 컨테이너 UID가 읽도록 0644다. 다른 env 파일은 0600을 유지한다.

Redis는 Business 전용 내부 네트워크에서 `cache:business:*`만 읽고 쓴다. default 계정·다른 키·CONFIG/ACL/FLUSHALL은 거부하며 health 계정은 PING만 수행한다. 기존 미리보기의 2 GiB 컨테이너 한도, PDF 도구와 CPU·PID·tmpfs·비특권 실행을 보존한다. 대상 EC2의 전체 메모리 실측 뒤 기동한다.

단독 로컬 실행도 `write-compose-env.py --service business-api --redis-acl-output <경로>`가 생성한 env와 ACL을 사용한다. `BUSINESS_API_ENV_FILE`·`BUSINESS_REDIS_ACL_FILE`을 지정해 `server/business-api/compose.yml`을 실행하면 호스트 `127.0.0.1:8082`가 컨테이너 8080으로 연결된다. 시크릿이 포함된 파일은 커밋하지 않는다.

~~Link/MMP는 `OneOrThree/mmp-custom`의 별도 배포다. 여기서 Vercel·Neon 연결이나 DNS 전환을 수행하지 않는다.~~ → A23(2026-09-13): Link/MMP 는 별도 배포가 아니다 — business-api·data-api 이미지에 포함되며 공개 경로 전환은 nginx 설정 한 번이다([링크 정본](../link-attribution/high-level-design.md) §7).

## Catus 2.0 운영 발행·배포

위의 준비 도구·기존 prod Compose 설명과 별도로, Catus 실행 구성·nginx·SSM 배포 문서는 Infra 저장소의 `prod/catus/runtime`에서 관리한다. Phone은 네 서비스의 애플리케이션 이미지와 릴리스를 발행한다. 구성은 `CATUS_PROD_INFRA_REVISION`의 40자리 Infra 커밋 SHA로 고정하며, S3의 `configurations/<Infra SHA>/configuration.zip`·`configuration.json`을 검증한 뒤 사용한다.

### 운영 선행 조건

- Infra에서 최신 IAM·SSM 변경을 적용하고, 승인된 구성 산출물을 먼저 게시한다. Phone의 `CATUS_PROD_INFRA_REVISION`에는 **게시된 구성**의 SHA를 설정한다.
- Phone의 `catus-production` 환경에 배포 승인자와 배포 허용 브랜치 `release`를 설정하고, `release` 보호 규칙을 확인한다. 발행 역할은 `catus-prod-publish`, 수동 배포 역할은 `catus-prod-deploy`다. 대상 설정은 Secrets Manager `catus/prod/cicd`에서 읽는다.
- 제품명을 Catus로 정정해 Infra의 `prod/catus`에 새 state·새 AWS 스택을 준비한다. 신규 스택의 적용 완료와 운영 검증을 확인한 뒤 다음 단계로 진행한다. 기존 FocusCat은 전환 검증 후 별도 정리하며, Gromo 1.x는 계속 유지한다. 이전 스택의 성공 상태나 이미지·버전 참조를 Catus로 복사하지 않는다.
- Infra의 private GitHub 저장소에서 required reviewers 설정은 API 422, main 보호 설정은 API 403으로 실패했다. 사용자는 내장 승인자를 유지하고 지원 플랜 준비 전까지 정규 GitHub 구성 발행 잠금을 유지하기로 결정했다. 이후 FocusCat→Catus 교체 지시로 이번 전환은 운영자 직접 작업으로 수행했다. Phone은 public 저장소이므로 별도 승인 환경·release 제한을 설정한다. `CATUS_PROD_INFRA_REVISION`에는 실제 승인 발행된 구성의 SHA만 등록한다.
- `catus/prod/env`의 필요한 앱 설정·FCM·Google·Apple·OpenAI·JWT·서비스 caller 자격은 `gromo/dev/env`의 키와 값을 그대로 따른다. DB 접속 키·POSTGRES 관리 값·관리형 서비스 URL·파일 경로 키는 복사 대상에서 제외한다. 운영 DB 자격은 별도로 생성한 `catus/prod/database`에서 공급하고, 개발 env에 없는 채팅 DB 자격도 여기에 따로 준비한다. Redis·프록시·Datadog의 운영 설정과 자격은 Infra에서 별도 보충한다. 앱의 OAuth audience/bundle ID(`com.oneorthree.focuscat`)는 스택 이름 변경으로 바꾸지 않는다. 관리형 RDS 시크릿의 AWS 자동 생성 이름도 변경 대상이 아니다.
- Link는 같은 구성으로 미완 상태를 유지하되 prod `LINK_BASE_URL`은 Catus 운영 주소 `https://catus-api.oneorthree.world`를 사용한다. dev는 기존 주소를 유지한다. 실제 dev에는 별도 Link 서비스가 없고 `/internal/links`·`/l/...`가 404이므로 초대 링크 기능은 미연결이다. 닫힌 PR #736의 코드는 가져오지 않았다. DB·로그 장애 알람 수신처도 사용자 요청으로 TODO다.

### 2026-10-14 운영 전환 확인

`https://catus-api.oneorthree.world`에 배포했고 기존 `focuscat-api.oneorthree.world`도 Catus로 연결했다. 기존 Gromo 1.x는 유지한다. 쓰기 중지 후 세 DB를 복원해 앱 시작 전에 모든 public 테이블의 행 수를 대조했고, 컨테이너 9개 health·앱 digest/ARM64·DB 계정 격리·Datadog·로그 아카이브·두 주소 HTTPS health를 확인했다. 세부 AWS 상태와 복구 자료는 Infra의 `prod/catus/cutover-2026-10-14.md`에서 관리한다.

배포 메타데이터 버전과 prod 배지는 `catus-v2.0.0`이며 이번 운영자 작업에서 정식 Git 버전 태그는 만들지 않았다. Phone PR #1139는 draft를 유지한다. 정규 버전 태그·승인 CD는 PR 반영과 `release` 승격 후 위 절차를 따른다. 후속 검증에서 같은 이미지·스키마·Secret의 검증용 릴리스를 배포한 뒤 SSM rollback으로 원래 릴리스 복구를 확인했다. 서로 다른 앱 버전의 동작 복구와 GitHub 승인 CD 검증은 별도다. 운영 스모크 결과는 `smoke/server/verification.md`를 참고한다.

### 발행과 버전

1. `main`·`release` 대상 PR에서 `prod-ci.yml`은 변경 서비스 검사·이미지 빌드를 수행하며 ECR에 발행하지 않는다. 공통 빌드 입력이 바뀌면 전체 서비스가 검사 대상이다.
2. `release` push 또는 `release`를 선택한 `prod-ci.yml` 수동 실행에서 발행한다. 마지막 prod 성공 상태 `deployments/current.json`의 소스 지문과 비교해 변경 서비스만 `linux/arm64`로 빌드한다. 최초 발행과 수동 `rebuild_all=true`는 전체 빌드이며, Infra SHA만 바뀌면 이미지는 재사용하고 전체 서비스를 배포 대상으로 기록한다. 발행·배포 실행은 `queue: max`로 대기 실행을 보존한다. 같은 실행을 재시도하면 계획·JAR·이미지 digest 산출물을 교체한다.
3. 이미지 저장소는 `catus-prod/<service>`이며 릴리스에는 재사용 이미지를 포함한 네 서비스의 digest 조합을 기록한다. 불변 산출물은 S3 `releases/<소스 SHA>-<실행 ID>-<시도 번호>/bundle.zip`·`release.json`, 버전 참조는 `versions/catus-vX.Y.Z.json`이다.
4. 기존 Catus Git 태그·S3 `versions/`의 불변 예약·실제 운영 성공 상태 `deployments/current.json` 중 가장 큰 버전을 기준으로 `release` 대상 릴리스 PR의 `release:major`·`release:minor`·`release:patch` 중 하나로 증가하고, 미지정은 patch다. 세 기준 모두 없을 때만 최초 버전 `catus-v2.0.0`을 사용한다. 현재 운영자 전환 버전이 `catus-v2.0.0`이므로 정식 Git 태그가 없어도 첫 자동 patch 발행은 `catus-v2.0.1`이다. 수동 발행은 `version_bump` 입력을 사용한다. 같은 버전을 Git 태그와 네 서비스 ECR 태그로 기록한다. 기존 Gromo `vX.Y.Z` 태그는 버전 계산에 포함하지 않는다. 정규 발행 전 Infra PR #11의 `versions/` 경로 한정 `s3:ListBucket` 권한을 적용해야 한다.

계산한 버전은 S3 발행 전에 `catus-release-version` Actions 산출물에 소스·Infra SHA와 실행 ID를 함께 고정한다. 같은 실행의 재시도는 산출물 존재 여부를 먼저 확인한다. 보관 전 실패로 산출물이 없으면 버전을 새로 고정하고, 있으면 복구해 입력을 검증하고 기존 S3 릴리스 메타데이터와 checksum 확인을 이어간다. Git 태그가 이미 있으면 같은 커밋인지 확인하며 중복 생성하지 않는다. 산출물이 만료됐거나 입력이 달라졌으면 버전을 추측하지 않고 실패한다. 새 수동 실행의 강제 재빌드·Infra 변경은 같은 소스 SHA여도 새 버전을 계산한다.

대기열은 커밋 순서를 보장하지 않으므로 버전 계산 전과 매 시도의 S3 발행 직전에 최신 Catus 태그의 소스가 현재 소스의 조상인지 검사한다. 고정 버전을 복구하는 재시도도 이 검사를 생략하지 않는다. 후속 커밋이 먼저 발행됐다면 뒤늦은 이전 커밋·분기 커밋은 더 높은 버전으로 발행하지 않고 실패한다.

### 배포와 롤백

GitHub Actions에서 `prod-cd.yml`을 수동 실행한다. 브랜치는 `release`, `release_id`는 발행된 `catus-vX.Y.Z` 또는 `<소스 SHA>-<실행 ID>-<시도 번호>`를 지정한다. `operation`은 최초 준비 `bootstrap`, 일반 배포 `deploy`, 호환되는 기존 릴리스 복구 `rollback` 중 하나다. `catus-production` 승인 후 고정 SSM 문서 `catus-prod-deploy`를 호출하고 최종 결과를 기다린다. 발행 성공만으로 자동 배포되지는 않는다. 롤백은 해당 Infra 실행 구성의 호환 조건을 확인한 릴리스만 선택하며, DB 변경을 자동으로 되돌리는 절차로 취급하지 않는다.

Infra PR #11의 배포 역할에 `ssm:ListCommands` 권한을 적용한 뒤 승인 CD를 실행한다. CD의 `catus-deploy.py`는 자격·릴리스 메타데이터·사전 명령 조회를 검증한 뒤 `catus-ssm-send-intent` Actions 산출물을 보관하고 명령을 전송한다. 이 준비 단계에서 실패하면 전송 의도가 없으므로 재실행에서 새 명령을 보낼 수 있다. 전송 의도가 있으면 요청이 같은지 검증하고 `catus:<저장소 ID>:<Actions 실행 ID>` Comment로 기존 명령의 결과 대기만 재개한다. AWS CLI의 자동 재전송은 끈다. 전송 응답 유실이나 전송 의도 기록 직후 중단으로 기존 명령이 확인되지 않으면 운영자가 SSM 접수 여부를 확인한 뒤 필요하면 새 workflow_dispatch 실행을 만든다. 사전·결과 조회 시간 초과도 재시도하며 성공이 확인된 경우에만 배포 배지를 기록한다.

### 배포 상태 배지

`ops-deployment-badges.yml`은 신뢰한 원본 워크플로의 결과 산출물을 검증해 `deployment-status` 브랜치에 JSON을 게시한다. dev는 Data·Realtime·Business·Notification의 최근 결과를 합산한다. prod는 마지막 성공 버전을 유지하므로 실패·취소 후에도 이전 성공 버전이 표시된다. 최신 실행 성공 여부는 Actions에서 별도로 확인한다.

결과 산출물 이름은 `deployment-status-<dev|prod>-<run_attempt>`이며 현재 재실행 시도의 결과만 반영한다. dev 실패·취소 시 현재 결과가 없으면 실패로 기록하되, Satellite CI는 `satellite-deploy-plan`, CD는 `satellite-deploy-record`에 남긴 선택 서비스를 사용한다. CD의 원본 SHA도 해당 기록에서 복원한다. 계획·대상 기록도 없으면 서비스 범위를 추측하지 않고 기존 배지를 유지한다.

2026-10-14 기준 상태 브랜치는 아직 없다. main 반영 후 「서버 배포 상태 배지」 워크플로를 수동 실행하면 초기 JSON을 만들며, 기록이 없는 서비스·환경은 배포 확인 전으로 표시한다. 이미 운영 중인 서버도 기록 전에는 확인 전으로 표시하며, 서버가 미배포되거나 중단됐다는 뜻은 아니다. 이후 실제 배포 완료 결과가 배지를 갱신한다. 검증은 `python3 -m unittest discover -s .github/scripts -p 'test_catus*.py' -v`와 `python3 .claude/pr-gate.py --selftest`를 사용한다.
