# 서비스 배포와 V0 동시 전환

Data의 V0 전환과 Realtime의 내부 API 전환은 하나의 중단 창에서 수행한다. dev는 같은
main SHA의 Data·Realtime 공동 CI/CD를 사용하고, prod는 고정 Infra 구성의 승인 SSM 배포를
사용한다. 배포 중 DB 상태는 `deploy-v0.py`가 판별하며, 상세 검증·보존 범위·저수준 복구는
[Data V0 문서](../../../../server/data-api/docs/db/README.md)를 따른다.

## 서비스별 설정 준비

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

`docker-compose.satellites.data.yml`을 마지막 `-f`로 넣는다. `env_file: !override`로 prod의 공유 `.env.prod`를 교체하고 `environment: !override`로 dev의 관리자 DB 자격 덮어쓰기를 제거한다. Data 이미지는 `APP_IMAGE`의 검증된 digest를 사용한다. 전용 파일의 `dev,satellites,realtime-authorization` 또는 `prod,satellites,realtime-authorization` 프로파일을 검사한다. `!override`를 지원하는 Compose가 필요하며 `config --quiet` 실패 시 진행하지 않는다.

공유 SecretString의 `SPRING_PROFILES_ACTIVE`·`DEPLOY_ENV`·`DATA_API_PROFILES`·`DD_ENV`·`DD_SERVICE`·`DD_VERSION`은 공개 설정 키로 분류해 compose 누출 후보에서 제외한다. 같은 문자열을 가진 실제 자격 키와 미분류 키는 계속 검사하며, 자격을 포함할 수 있는 URL·접속 문자열도 제외하지 않는다.

`--data-image`를 지정하면 `--data-profiles`의 선택값을 Data env의 `SPRING_PROFILES_ACTIVE`와 오버레이의 `DATA_API_PROFILES`에 동일하게 전달한다. 생략 시 기본값은 `<environment>,satellites,realtime-authorization`이며 `--data-profiles=prod,satellites,realtime-authorization,foo`처럼 추가할 수 있다. 쉼표로 구분한 정확한 `satellites`와 `realtime-authorization` 항목이 필수이고, 선택값과 다른 셸 `DATA_API_PROFILES`는 준비 단계에서 거부한다. 이 선택값은 Business·Notification에 전달하지 않는다.

생성된 `deploy-plan.txt`는 서비스별 설정 검토 자료다. Data나 Realtime을 독립 재생성하는 일반 배포 진입점으로 사용하지 않는다. 기존 스택의 네트워크·볼륨과 프로젝트명은 유지한다. Data의 prod APM JVM 옵션도 준비한 보간 파일에 포함한다. 운영 DB 초기화·서비스 토큰·A18 입력은 기동 전에 준비한다.

## 라우팅

nginx·인증서는 Infra 소유다. `nginx-satellites.include.conf.example`과 `nginx-satellites-proxy-headers.conf.example`를 검토한 뒤 실제 upstream과 프록시 시크릿을 주입한다.

- 준비된 Business 경로만 라우팅하고 나머지 기존 Data 경로를 유지한다.
- Notification은 시스템 §2.1대로 `/internal/admin/`만 공개하며 서비스가 콘솔 전용 Bearer와 actor를 검증한다. 나머지 `/internal/`과 management 9091은 공개하지 않는다.
- 게스트 요청의 IP 신뢰 검증은 현재 nginx·Business 계약과 `LINK_PROXY_SECRET`을 유지한다. 이 이름의 시크릿은 폐기된 독립 Link 서비스의 배포 자격이 아니다.
- 독립 Link 이관·export/freeze·호환 match 전환 단계는 폐기됐다. 현재 섬 초대 공유 주소의 `LINK_BASE_URL`은 유지한다. Data 내부 API와 관리 포트를 공개 라우팅에 추가하지 않는다.

## 실패 복구

준비 단계의 실패는 기존 서비스를 변경하지 않는다. 개발 자동 배포는 이미지·runtime·DB 읽기 전용 검증을 모두 통과한 뒤 트래픽과 writer를 중지한다. `deploy-v0.py`는 검증한 원본 이력 prefix에 대해 전체 백업 후 V138 보완 → V0 전환을 실행한다. 빈 DB에는 V0를 적용하고, 현재 V0 체인은 필요한 후속 migration과 기본 데이터 콜백을 실행한다.

**중지 이후의 실패는 유지보수 상태를 유지한다.** V138 보완 또는 V0 commit이 이미 끝났을 수 있으므로 구 이미지를 자동으로 다시 시작하지 않는다. 미완료 배포 기록·DB 기록·백업을 보존한다. 개발은 같은 배포를 재실행하거나, DB가 `current`이며 트래픽·writer가 중지된 것을 확인한 새 SHA의 수정 이미지로 재개한다. 운영은 아래 최초 수동 전환 절차를 따른다. 실행기는 실제 DB 상태를 다시 검사하며, 이전 일회성 DB 작업이 아직 실행 중이면 재진입을 거부한다. V0 DB에 구 이미지를 연결하는 방식은 복구가 아니다. 전환 이전으로 돌아가야 한다면 별도 빈 DB에 검증된 전체 백업을 복원하고 구 이미지와 함께 검증하는 수동 복구 절차를 사용한다.

`prepare-satellite-deploy.py --phase final`은 env 분리 계획을 생성하는 옵션이며 DB 전환·자격 회수·트래픽 교체를 대신 수행하지 않는다.

## 개발 자동 배포

`data-api-ci.dev.yml`이 main의 Data·Realtime 배포를 함께 소유한다. 어느 한쪽 입력이 바뀌어도 같은 SHA의 두 이미지를 검사·발행한 뒤 digest를 공동 CD에 직접 넘긴다. Realtime CI는 PR 검사와 재사용 빌드만 제공하며 독립 Realtime CD는 없다.

공동 CD 진입 전에 push의 실제 변경 경로와 위성 CI의 경로 필터로 선행 배포 필요 여부를 정한다. 위성 대상이면 같은 main SHA·원본 workflow·최신 실행 시도의 CI와 CD 성공을 기다린다. 등록 지연이나 누락을 시간 경과만으로 성공 처리하지 않는다. 이 대기는 `dev-vm-deploy` 잠금을 잡기 전에 수행한다.

공동 CD는 이미지·토큰·프로파일·DB 사전 검사 후 nginx와 Data·Realtime·Business·Notification 및 Data DB 관측 연결을 중지하고 실제 중지 상태를 확인한다. DB·Redis·Kafka는 유지한다. DB 전환, 두 새 컨테이너의 digest·readiness, 기존 위성 복원을 검증한 뒤 nginx를 재개한다. 실패한 동일 공동 CD job의 재실행과 기록·백업 경로는 [개발 배포 실행 문서](../../../../server/scripts/README.md#catus-v0-전환과-datarealtime-동시-교체)를 따른다. 일반 ops·위성 배포는 미완료 공동 전환을 우회하지 못한다.

## 검증

`python3 -m unittest discover -s .github/scripts -p 'test_*.py' -v`로 서비스별 값·파일 권한·누락 입력과 실제 compose 병합 결과를 검증한다. compose 전체 출력에는 비밀이 포함될 수 있으므로 운영 로그에 남기지 않는다. nginx 예시는 합성 upstream으로 syntax 검사하고 운영에서는 실제 Infra 설정과 합쳐 `nginx -t`를 통과한 뒤 reload한다.

## 기존 Business 미리보기 통합

Business 전용 `BUSINESS_REDIS_PASSWORD`를 SecretString에 추가한다. 선택적인 `GOOGLE_DRIVE_API_KEY`도 Business env에만 전달한다. 준비 도구는 `business-redis.acl`과 그 경로 `BUSINESS_REDIS_ACL_FILE`을 생성한다. ACL에는 원문 비밀번호 대신 SHA-256이 들어가며, 0700 디렉터리 안의 ACL 파일만 Redis 컨테이너 UID가 읽도록 0644다. 다른 env 파일은 0600을 유지한다.

Redis는 Business 전용 내부 네트워크에서 `cache:business:*`만 읽고 쓴다. default 계정·다른 키·CONFIG/ACL/FLUSHALL은 거부하며 health 계정은 PING만 수행한다. 기존 미리보기의 2 GiB 컨테이너 한도, PDF 도구와 CPU·PID·tmpfs·비특권 실행을 보존한다. 대상 EC2의 전체 메모리 실측 뒤 기동한다.

단독 로컬 실행도 `write-compose-env.py --service business-api --redis-acl-output <경로>`가 생성한 env와 ACL을 사용한다. `BUSINESS_API_ENV_FILE`·`BUSINESS_REDIS_ACL_FILE`을 지정해 `server/business-api/compose.yml`을 실행하면 호스트 `127.0.0.1:8082`가 컨테이너 8080으로 연결된다. 시크릿이 포함된 파일은 커밋하지 않는다.


## Catus 2.0 운영 발행·배포

위의 준비 도구·기존 prod Compose 설명과 별도로, Catus 실행 구성·nginx·SSM 배포 문서는 Infra 저장소의 `prod/catus/runtime`에서 관리한다. Phone은 네 서비스의 애플리케이션 이미지와 릴리스를 발행한다. 구성은 `CATUS_PROD_INFRA_REVISION`의 40자리 Infra 커밋 SHA로 고정하며, S3의 `configurations/<Infra SHA>/configuration.zip`·`configuration.json`을 검증한 뒤 사용한다.

### 운영 선행 조건

- `CATUS_PROD_INFRA_REVISION`에는 실제 게시된 구성의 40자리 SHA를 고정한다. 별도 V0 자동 전환용 Infra PR·SSM 변경은 요구하지 않는다. 기존 실행기는 DB를 자동으로 전환하지 않으므로 최초 V0 배포는 아래 수동 전환 순서를 따른다.
- runtime의 Data 프로파일은 `prod,satellites,realtime-authorization`여야 하며, Data·Realtime에 동일한 `SVC_TOKEN_REALTIME_TO_DATA`와 내부 주소를 주입한다. 기존 Infra 설정 생성기가 요구하는 시크릿도 기동 전에 검증한다.
- Realtime 이동·바다 기능에는 Redis의 `movement:*`·`sea:*` 키와 `TIME` 권한이 필요하다. 이 권한은 V0 DB 전환과 별개다. 게시된 Infra 구성이 해당 ACL을 생성하는지 확인하고, 최초 중단 전환과 인프라·ACL 구성이 바뀔 때는 `operation=bootstrap`을 사용한다. 기존 구성 그대로 bootstrap을 반복하는 것으로 누락 권한이 추가되지는 않는다.
- Phone의 `catus-production` 환경에 배포 승인자와 배포 허용 브랜치 `release`를 설정하고, `release` 보호 규칙을 확인한다. 발행 역할은 `catus-prod-publish`, 수동 배포 역할은 `catus-prod-deploy`다. 대상 설정은 Secrets Manager `catus/prod/cicd`에서 읽는다.
- 제품명을 Catus로 정정해 Infra의 `prod/catus`에 새 state·새 AWS 스택을 준비한다. 신규 스택의 적용 완료와 운영 검증을 확인한 뒤 다음 단계로 진행한다. 기존 FocusCat은 전환 검증 후 별도 정리하며, Gromo 1.x는 계속 유지한다. 이전 스택의 성공 상태나 이미지·버전 참조를 Catus로 복사하지 않는다.
- Infra의 private GitHub 저장소에서 required reviewers 설정은 API 422, main 보호 설정은 API 403으로 실패했다. 사용자는 내장 승인자를 유지하고 지원 플랜 준비 전까지 정규 GitHub 구성 발행 잠금을 유지하기로 결정했다. 이후 FocusCat→Catus 교체 지시로 이번 전환은 운영자 직접 작업으로 수행했다. Phone은 public 저장소이므로 별도 승인 환경·release 제한을 설정한다. `CATUS_PROD_INFRA_REVISION`에는 실제 승인 발행된 구성의 SHA만 등록한다.
- `catus/prod/env`의 필요한 앱 설정·FCM·Google·Apple·JWT·서비스 caller 자격은 `gromo/dev/env`의 키와 값을 그대로 따른다. DB 접속 키·POSTGRES 관리 값·관리형 서비스 URL·파일 경로 키는 복사 대상에서 제외한다. 운영 DB 자격은 별도로 생성한 `catus/prod/database`에서 공급하고, 개발 env에 없는 채팅 DB 자격도 여기에 따로 준비한다. Redis·프록시·Datadog의 운영 설정과 자격은 Infra에서 별도 보충한다. 앱의 OAuth audience/bundle ID(`com.oneorthree.focuscat`)는 스택 이름 변경으로 바꾸지 않는다. 관리형 RDS 시크릿의 AWS 자동 생성 이름도 변경 대상이 아니다.
- 현재 섬 초대 공유 주소 `LINK_BASE_URL`은 prod에서 `https://catus-api.oneorthree.world`를 사용하며 dev는 기존 주소를 유지한다. 폐기된 독립 Link migration이나 호환 endpoint를 복구하지 않는다. DB·로그 장애 알람 수신처는 별도 운영 구성 항목이다.

### 2026-10-14 운영 전환 확인

`https://catus-api.oneorthree.world`에 배포했고 기존 `focuscat-api.oneorthree.world`도 Catus로 연결했다. 기존 Gromo 1.x는 유지한다. 쓰기 중지 후 세 DB를 복원해 앱 시작 전에 모든 public 테이블의 행 수를 대조했고, 컨테이너 9개 health·앱 digest/ARM64·DB 계정 격리·Datadog·로그 아카이브·두 주소 HTTPS health를 확인했다. 세부 AWS 상태와 복구 자료는 Infra의 `prod/catus/cutover-2026-10-14.md`에서 관리한다.

배포 메타데이터 버전과 prod 배지는 `catus-v2.0.0`이며 이번 운영자 작업에서 정식 Git 버전 태그는 만들지 않았다. Phone PR #1139는 draft를 유지한다. 정규 버전 태그·승인 CD는 PR 반영과 `release` 승격 후 위 절차를 따른다. 후속 검증에서 같은 이미지·스키마·Secret의 검증용 릴리스를 배포한 뒤 SSM rollback으로 원래 릴리스 복구를 확인했다. 서로 다른 앱 버전의 동작 복구와 GitHub 승인 CD 검증은 별도다. 운영 스모크 결과는 `smoke/server/verification.md`를 참고한다.

### 발행과 버전

1. `main`·`release` 대상 PR에서 `prod-ci.yml`은 변경 서비스 검사·이미지 빌드를 수행하며 ECR에 발행하지 않는다. 공통 빌드 입력이 바뀌면 전체 서비스가 검사 대상이다.
2. `release` push 또는 `release`를 선택한 `prod-ci.yml` 수동 실행에서 발행한다. 마지막 prod 성공 상태 `deployments/current.json`의 소스 지문과 비교해 변경 서비스만 `linux/arm64`로 빌드한다. 최초 발행과 수동 `rebuild_all=true`는 전체 빌드다. V0 최초 전환 릴리스는 `rebuild_all=true`로 네 이미지를 발행한다. Data 또는 Realtime의 변경은 두 서비스를 함께 빌드·배포 대상으로 묶는다. Infra SHA만 바뀌면 이미지는 재사용하고 전체 서비스를 배포 대상으로 기록한다. 발행·배포 실행은 `queue: max`로 대기 실행을 보존한다. 같은 실행을 재시도하면 계획·JAR·이미지 digest 산출물을 교체한다.
3. 이미지 저장소는 `catus-prod/<service>`이며 릴리스에는 재사용 이미지를 포함한 네 서비스의 digest 조합을 기록한다. 불변 산출물은 S3 `releases/<소스 SHA>-<실행 ID>-<시도 번호>/bundle.zip`·`release.json`, 버전 참조는 `versions/catus-vX.Y.Z.json`이다.

수동 실행은 소스·Infra 변경이 없어도 `version_bump`를 처리하며 기존 이미지 조합을 재사용한 새 버전을 발행한다. 이 경우 빌드·배포 대상은 비어 있고 실제 배포는 별도 승인 CD로 수행한다. 자동 push는 변경이 없으면 발행을 건너뛴다.
4. 기존 Catus Git 태그·S3 `versions/`의 불변 예약·실제 운영 성공 상태 `deployments/current.json` 중 가장 큰 버전을 기준으로 증가한다. 그 기준 소스 이후 현재 소스까지 포함된 `release` 대상 PR의 `release:major`·`release:minor`·`release:patch`를 누적해 가장 큰 증가폭 하나를 적용하고, 미지정은 patch다. 실패한 실행이 예약 전에 중단돼도 major/minor 의도를 후속 커밋이 이월한다. 수동 `version_bump`도 누적된 증가폭보다 낮추지 않는다. 세 기준 모두 없을 때만 최초 버전 `catus-v2.0.0`을 사용한다. 현재 운영자 전환 버전이 `catus-v2.0.0`이므로 정식 Git 태그가 없어도 첫 자동 patch 발행은 `catus-v2.0.1`이다. 같은 버전을 Git 태그와 네 서비스 ECR 태그로 기록한다. 기존 Gromo `vX.Y.Z` 태그는 버전 계산에 포함하지 않는다. 정규 발행 전 Infra PR #11의 `versions/` 경로 한정 `s3:ListBucket` 권한을 적용해야 한다.

계산한 버전은 S3 발행 전에 `catus-release-version` Actions 산출물에 소스·Infra SHA와 실행 ID를 함께 고정한다. 같은 실행의 재시도는 산출물 존재 여부를 먼저 확인한다. 보관 전 실패로 산출물이 없으면 버전을 새로 고정하고, 있으면 복구해 입력을 검증하고 기존 S3 릴리스 메타데이터와 checksum 확인을 이어간다. Git 태그가 이미 있으면 같은 커밋인지 확인하며 중복 생성하지 않는다. 산출물이 만료됐거나 입력이 달라졌으면 버전을 추측하지 않고 실패한다. 새 수동 실행의 강제 재빌드·Infra 변경은 같은 소스 SHA여도 새 버전을 계산한다.

대기열은 커밋 순서를 보장하지 않으므로 버전 계산 전과 매 시도의 S3 발행 직전에 최신 Catus 태그·예약의 소스가 현재 소스의 조상인지 검사한다. 고정 버전을 복구하는 재시도도 이 검사를 생략하지 않는다. 버전 번호도 최신 태그·예약·운영 버전보다 커야 하며, 동일 소스·Infra·Actions 실행에 이미 예약된 버전만 같은 번호의 복구를 허용한다. 고정 번호가 뒤늦게 낡아졌으면 새 발행 실행이 필요하다. 후속 커밋이 먼저 발행됐다면 뒤늦은 이전 커밋·분기 커밋은 더 높은 버전으로 발행하지 않고 실패한다.

### 배포와 롤백

운영 승격 PR은 반드시 **head=`main`, base=`release`**로 만든다. 작업 브랜치의 변경과 충돌 해결은 먼저 main 대상 PR로 통합한다. 과거 squash 승격 때문에 release에만 남은 이력이 있다면, 현재 main의 파일을 유지하면서 release 이력을 연결하는 별도 main 대상 PR을 준비한다. 이 이력 동기화 PR과 실제 main → release 승격 PR은 모두 **Create a merge commit**으로 병합해야 한다. 동기화 PR의 squash/rebase는 release 부모 이력을 잃으므로 충돌 해결 효과가 없다. 승격 PR의 squash/rebase도 main 부모를 잃으므로 버전 계산에서 거부한다. main 반영 후 release가 main의 조상인지 확인하고, 기존 main → release PR의 충돌·CI·리뷰를 다시 확인한다. 배포를 위해 작업 브랜치를 release로 직접 병합하지 않는다.

GitHub Actions에서 `prod-cd.yml`을 수동 실행한다. 브랜치는 `release`, `release_id`는 발행된 `catus-vX.Y.Z` 또는 `<소스 SHA>-<실행 ID>-<시도 번호>`를 지정한다. `operation`은 최초 준비 `bootstrap`, 일반 배포 `deploy`, 호환되는 기존 릴리스 복구 `rollback` 중 하나다. `catus-production` 승인 후 고정 SSM 문서 `catus-prod-deploy`를 호출하고 최종 결과를 기다린다. 발행 성공만으로 자동 배포되지는 않는다. 롤백은 해당 Infra 실행 구성의 호환 조건을 확인한 릴리스만 선택하며, DB 변경을 자동으로 되돌리는 절차로 취급하지 않는다.

최초 V0 전환은 사용자가 없는 운영 환경의 일회성 작업으로 처리한다. 네 이미지를 같은 Phone SHA로 발행한 뒤 다음 순서를 운영 호스트에서 수행한다.

1. 게시된 릴리스의 이미지 digest와 runtime·시크릿·Redis ACL을 확인한다. 새 Data 이미지에서 `/opt/catus-db`를 추출하고 아래 `preflight`를 실행한다. 아직 앱을 교체하지 않는다.
2. Catus nginx와 Data·Realtime·Business·Notification 및 Data DB 관측 연결을 중지하고 실제 중지를 확인한다. RDS·Redis·Kafka와 볼륨은 유지한다.
3. 동일 이미지의 DB 도구를 `apply --writers-stopped`로 실행한다. 빈 DB는 V0·기본 데이터를 생성하고 기존 DB는 검증·백업 후 전환한다. 완료 결과가 `current`·`complete`인지 확인한다.
4. 발행한 릴리스의 기존 `prod-cd.yml`을 **`operation=bootstrap`**으로 실행한다. 기존 실행기는 앱을 순서대로 시작하므로 이 최초 전환에서는 네 앱을 모두 미리 중지한다. bootstrap은 기반 서비스를 준비하고 네 앱 health를 확인한 뒤 nginx를 시작한다. 일반 deploy는 변경이 없는 nginx를 재시작하지 않으므로 이 최초 중단 전환에 사용하지 않는다. 전체 앱의 새 digest·health와 nginx·관측의 복원을 확인한다. 기존 bootstrap에는 실패 시 자동 정지 처리가 없으므로, CD 실패 시 운영자가 nginx·네 앱·Data DB 관측을 다시 중지하고 확인한 뒤 재시도한다. 구 앱을 임의로 재시작하지 않는다.

DB 도구 호출 형식은 다음과 같다. `data_image`는 발행된 Data digest, `data_env_file`은 같은 DB를 가리키는 `API_DB_URL`·`API_DB_USERNAME`·`API_DB_PASSWORD`가 담긴 권한 0600의 임시 파일이다. 시크릿은 로그나 명령행 인자로 출력하지 않는다.

```bash
# 검증한 Data 이미지의 /opt/catus-db를 이 경로에 추출한 뒤 실행
python3 /opt/catus/db-package/docs/db/deploy-v0.py \
  --phase preflight --environment prod --data-image "$data_image" \
  --network catus_app-network --env-file "$data_env_file" \
  --backup-dir /opt/catus/backups/data-v0 \
  --state-file /opt/catus/runtime/data-v0-db.json

# 위 2번의 중지 확인 뒤 같은 인자로 apply 실행
python3 /opt/catus/db-package/docs/db/deploy-v0.py \
  --phase apply --writers-stopped --environment prod --data-image "$data_image" \
  --network catus_app-network --env-file "$data_env_file" \
  --backup-dir /opt/catus/backups/data-v0 \
  --state-file /opt/catus/runtime/data-v0-db.json
```

DB 기록과 백업은 호스트에 보존하며 S3 자동 업로드는 없다. 실패하면 실제 DB를 다시 검증해 재시도한다. 기존 SSM 실행기는 V0 세대나 이 DB 기록으로 구 이미지를 차단하지 않으므로, 운영 롤백 대상으로는 V0 이후 호환 릴리스만 선택한다. 후속 일반 배포에서는 앱의 Flyway가 V0 체인과 기본 데이터 콜백을 실행한다. Data·Realtime 이미지는 함께 발행하지만, 기존 운영 CD의 순차 기동까지 자동 동시 교체로 바뀌는 것은 아니다.

Infra PR #11의 배포 역할에 `ssm:ListCommands` 권한을 적용한 뒤 승인 CD를 실행한다. CD의 `catus-deploy.py`는 자격·릴리스 메타데이터·사전 명령 조회를 검증한 뒤 `catus-ssm-send-intent` Actions 산출물을 보관하고 명령을 전송한다. 이 준비 단계에서 실패하면 전송 의도가 없으므로 재실행에서 새 명령을 보낼 수 있다. 전송 의도가 있으면 요청이 같은지 검증하고 `catus:<저장소 ID>:<Actions 실행 ID>` Comment로 기존 명령의 결과 대기만 재개한다. AWS CLI의 자동 재전송은 끈다. 전송 응답 유실이나 전송 의도 기록 직후 중단으로 기존 명령이 확인되지 않으면 운영자가 SSM 접수 여부를 확인한 뒤 필요하면 새 workflow_dispatch 실행을 만든다. 사전·결과 조회 시간 초과도 재시도하며 성공이 확인된 경우에만 배포 배지를 기록한다. 이전 SSM 명령이 실패로 종료된 것을 확인한 뒤 같은 릴리스를 재배포하려면 새 `prod-cd.yml` 수동 실행을 만들어 승인한다. 기존 Actions 실행의 재실행은 같은 SSM 명령의 결과 조회를 재개하므로 DB 작업을 새로 전송하는 절차와 구분한다.

### DB 전환이 든 V2 배포

release에 각 서비스의 `src/main/resources/db/{migration,v0,seed}` SQL이나 Data 전환 도구(`docs/db/deploy-v0.py`·`rebase-v0.py`·`v0-rebase/`)의 변경이 있으면 V2 릴리스의 `migration_fingerprints`가 직전 성공 기록과 달라진다(`.github/scripts/catus-plan.py`의 `fingerprints()`). 이때 `prod-cd-V2`를 평소처럼 실행하면 Infra `deploy-V2.py`가 `Schema compatibility requires explicit migration plan`으로 컨테이너를 건드리기 전에 멈춘다. 아래 절차를 거친 정방향 앱 배포만 `allow_migration`으로 통과시킨다.

선행 조건(발행 전): Infra의 SSM 문서에 `AllowMigration` 파라미터가 적용돼 있고(`terraform apply`), `CATUS_PROD_INFRA_REVISION_V2`가 `--allow-migration`을 아는 `deploy-V2.py`를 담은 Infra 커밋을 가리킨다. 이 변수는 발행 때 릴리스에 고정되므로 3번 전에 갱신한다. `terraform apply` 전에 `allow_migration`을 켜면 SSM이 알 수 없는 파라미터라며 전송을 거부하고 운영은 바뀌지 않는다.

1. **호환 검토(승격 PR 머지 전).** 승격으로 들어갈 마이그레이션을 확인한다. `git diff --name-only --diff-filter=AM origin/release origin/main -- 'server/*/src/main/resources/db/*'`. 이미 승격했다면 직전 V2 태그와 비교한다: `git diff --name-only --diff-filter=AM <직전 catus-vX.Y.Z-V2> origin/release -- 'server/*/src/main/resources/db/*'`. 각 파일이 이전 코드가 무시할 수 있는 변경(nullable 열 추가, 새 테이블, 기본값 변경)인지 파일 하나하나 본다. 열 삭제·이름 변경·NOT NULL 추가처럼 이전 이미지를 깨는 변경이면 자동 복구가 동작하지 않으므로 이 절차로 배포하지 않는다.
2. **발행.** `prod-ci-V2`로 새 `catus-vX.Y.Z-V2` 태그를 만든다. 발행은 DB를 건드리지 않는다.
3. **백업(배포 직전).** RDS 수동 스냅샷을 만들고 `available`을 확인한다. 자동 백업(보존 7일, 시점 복구)과 별개로 둔다. 스냅샷 식별자는 영문·숫자·하이픈만 쓰므로 태그의 점을 하이픈으로 바꾼다(예: `catus-prod-before-catus-v2-1-0-v2-20261031-1700`). 운영자 자격(`rds:CreateDBSnapshot`·`rds:DescribeDBSnapshots`)으로 실행한다.
   ```bash
   aws rds create-db-snapshot --region ap-northeast-2 --db-instance-identifier catus-prod-db \
     --db-snapshot-identifier catus-prod-before-<태그의 점을 하이픈으로>-<YYYYMMDD-HHMM>
   aws rds wait db-snapshot-available --region ap-northeast-2 \
     --db-snapshot-identifier catus-prod-before-<태그의 점을 하이픈으로>-<YYYYMMDD-HHMM>
   ```
   `wait`가 기본 대기 시간(약 30분)을 넘겨 실패하면 `aws rds describe-db-snapshots`로 상태를 보고 다시 `wait`한다.
4. **배포.** `prod-cd-V2`를 `version`=새 태그, `allow_migration`=true, `rollback`=false로 실행한다. phone은 `allow_migration`을 `rollback`과 함께 주거나 `app` 외 역할에 주면 조회·전송 전에 거부한다.
5. **확인.** SSM 출력의 `Schema change approved` 한 줄, 앱 4종 health, 각 DB `flyway_schema_history`의 최신 버전(읽기 전용 조회)을 확인하고 실행 번호·스냅샷 ID·적용 버전을 지라에 남긴다.

실패 시:
- **앱 health 실패.** 배포기가 직전 릴리스를 자동 복구한다. 이전 이미지는 DB에 이미 적용된 새 마이그레이션을 Flyway 기본값(`ignoreMigrationPatterns=*:future`)에 따라 건너뛰고 기동하므로, 1번 검토를 통과한 변경이어야 이 복구가 동작한다.
- **마이그레이션 실패.** PostgreSQL은 마이그레이션 한 건을 한 트랜잭션으로 실행해 실패한 버전만 되돌리고 이력도 남기지 않는다(`CREATE INDEX CONCURRENTLY` 같은 비트랜잭션 구문은 예외). 한 릴리스에 여러 건이 있으면 앞선 버전은 이미 커밋된 채 직전 릴리스로 복구될 수 있으므로, 1번 호환 검토는 파일 하나하나에 대해 한다. 원인을 고친 새 마이그레이션으로 정방향 해결한다.
- **스키마를 되돌려야 할 때.** 가능하면 스냅샷 복원 대신 스키마를 되돌리는 마이그레이션을 담은 새 정방향 릴리스로 해결한다. CD에는 복원한 DB에 맞춰 직전 릴리스로 되돌리는 자동 경로가 없다. Infra는 지문이 다른 `rollback`을 승인 여부와 상관없이 거부하고, 직전 태그의 일반 배포는 배포 기록 기준이 맞지 않아(`Stale deployment base`) 거부한다. 그래도 복원해야 하면 V1 데이터까지 바꾸는 파괴적 작업이므로 운영 책임자가 결정하고, Infra 배포 기록(`current-app-V2.json`)을 다루는 복구 계획을 함께 세운다. `catus-prod-db`는 V1과 V2가 함께 쓰는 인스턴스라 **복원 기준 시각 이후의 V1·V2 쓰기가 모두 사라진다.** 기준은 3번 스냅샷(배포 직전)이다. 스냅샷이 없거나 스냅샷 이후 마이그레이션 직전까지의 쓰기를 살려야 하면, 배포 SSM 출력에서 마이그레이션 적용 직전 시각을 찾아 자동 백업의 시점 복구(`restore-db-instance-to-point-in-time`, 2026-10-31 기준 보존 7일)로 그 시각을 지정한다. 그보다 늦은 시각은 새 스키마가 그대로 돌아오므로 쓰지 않는다. 절차: V1·V2 쓰기를 멈춘다 → **새 인스턴스**로 복원하고 서브넷 그룹·VPC 보안 그룹·파라미터 그룹을 원본과 같게 지정한다 → 새 인스턴스에서 각 DB의 `flyway_schema_history`와 주요 테이블을 읽기 전용으로 확인한다 → 접속 정보(V2 `catus/prod/database-V2`, V1 `catus/prod/database`의 DB 주소)를 새 인스턴스로 바꾼다. 원본 `catus-prod-db`는 전환이 끝날 때까지 지우지 않아 문제가 생기면 되돌아갈 수 있게 둔다.

### 배포 상태 배지

`ops-deployment-badges.yml`은 신뢰한 원본 워크플로의 결과 산출물을 검증해 `deployment-status` 브랜치에 JSON을 게시한다. dev는 Data·Realtime·Business·Notification의 최근 결과를 합산한다. prod는 마지막 성공 버전을 유지하므로 실패·취소 후에도 이전 성공 버전이 표시된다. 최신 실행 성공 여부는 Actions에서 별도로 확인한다.

결과 산출물 이름은 `deployment-status-<dev|prod>-<run_attempt>`이며 현재 재실행 시도의 결과만 반영한다. dev 실패·취소 시 현재 결과가 없으면 실패로 기록하되, Satellite CI는 `satellite-deploy-plan`, CD는 `satellite-deploy-record`에 남긴 선택 서비스를 사용한다. CD의 원본 SHA도 해당 기록에서 복원한다. 계획·대상 기록도 없으면 서비스 범위를 추측하지 않고 기존 배지를 유지한다.

2026-10-14 기준 상태 브랜치는 아직 없다. main 반영 후 「서버 배포 상태 배지」 워크플로를 수동 실행하면 초기 JSON을 만들며, 기록이 없는 서비스·환경은 배포 확인 전으로 표시한다. 이미 운영 중인 서버도 기록 전에는 확인 전으로 표시하며, 서버가 미배포되거나 중단됐다는 뜻은 아니다. 이후 실제 배포 완료 결과가 배지를 갱신한다. 검증은 `python3 -m unittest discover -s .github/scripts -p 'test_catus*.py' -v`와 `python3 .claude/pr-gate.py --selftest`를 사용한다.
