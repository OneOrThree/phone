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

`--data-image`를 지정하면 `--data-profiles`의 선택값을 Data env의 `SPRING_PROFILES_ACTIVE`와 오버레이의 `DATA_API_PROFILES`에 동일하게 전달한다. 생략 시 기본값은 `<environment>,satellites`이며 `--data-profiles=prod,satellites,foo`처럼 추가할 수 있다. 쉼표로 구분한 정확한 `satellites` 항목이 필수이고, 선택값과 다른 셸 `DATA_API_PROFILES`는 준비 단계에서 거부한다. 이 선택값은 Business·Notification에 전달하지 않는다.

Business/Notification만 기동하는 단계와 Data(app)를 재생성하는 단계는 생성된 `deploy-plan.txt`에서 분리한다. 기존 스택의 네트워크·볼륨과 프로젝트명은 유지한다. Data의 prod APM JVM 옵션도 준비한 보간 파일에 포함한다. 운영 DB 초기화·서비스 토큰·A18 입력은 기동 전에 준비한다.

## 라우팅

nginx·인증서는 Infra 소유다. `nginx-satellites.include.conf.example`과 `nginx-satellites-proxy-headers.conf.example`를 검토한 뒤 실제 upstream과 프록시 시크릿을 주입한다.

- 준비된 Business 경로만 라우팅하고 나머지 기존 Data 경로를 유지한다.
- Notification은 시스템 §2.1대로 `/internal/admin/`만 공개하며 서비스가 콘솔 전용 Bearer와 actor를 검증한다. 나머지 `/internal/`과 management 9091은 공개하지 않는다.
- Cloudflare CIDR·방화벽·realip 설정으로 검증한 방문자 IP를 전용 `X-Link-Client-IP`로 보낸다. 프록시 시크릿은 nginx·Business·Link에서 일치해야 한다.
- §7.2 3~4단계에는 랜딩을 닫고 Business 호환 match를 사용한다. `IMPORT_CLOSED`·import drain 후 예시의 final 블록으로 랜딩과 match를 같은 reload에서 Link로 넘긴다. claim 목적지 전환·큐 처리도 같은 정지 창에서 확인한다.
- 라우팅 교체 후 호환 인플라이트를 drain하고 `COMPAT_MATCH_HANDLER_ENABLED`를 끈다. 구 앱의 `/l/match` URL은 제거하지 않는다. DNS 이전은 두 경로가 Neon을 본 뒤에 한다.

## 실패 복구

준비 단계의 실패는 기존 서비스를 변경하지 않는다. 신규 쓰기 전 기동 실패는 해당 서비스의 직전 검증 digest로 복구한다. Link §7.2 3단계 이후에는 Neon을 정본으로 유지하며 실패한 import·검증·라우팅 단계를 재개한다. Notification의 최초 gate 개방 이후에는 close/drain → 새 경로 수정·검증 → 재개 순서다. 이 단계 이후 구 Data FCM이나 구 클릭 원장으로 자동 복귀하지 않는다. DB·이관 원장·서비스별 env를 보존한다.

`--phase final`은 구 빈 제거·트래픽 전환·롤백 창 종료가 확인된 뒤에만 사용한다. 현재 최소 Business 어댑터는 전체 인증 이전을 완료하지 않았으므로 이 배치만으로 final 자격 회수를 실행하지 않는다.

## 검증

`python3 -m unittest discover -s .github/scripts -p 'test_*.py' -v`로 서비스별 값·파일 권한·누락 입력과 실제 compose 병합 결과를 검증한다. compose 전체 출력에는 비밀이 포함될 수 있으므로 운영 로그에 남기지 않는다. nginx 예시는 합성 upstream으로 syntax 검사하고 운영에서는 실제 Infra 설정과 합쳐 `nginx -t`를 통과한 뒤 reload한다.

## 기존 Business 미리보기 통합

Business 전용 `BUSINESS_REDIS_PASSWORD`를 SecretString에 추가한다. 선택적인 `GOOGLE_DRIVE_API_KEY`도 Business env에만 전달한다. 준비 도구는 `business-redis.acl`과 그 경로 `BUSINESS_REDIS_ACL_FILE`을 생성한다. ACL에는 원문 비밀번호 대신 SHA-256이 들어가며, 0700 디렉터리 안의 ACL 파일만 Redis 컨테이너 UID가 읽도록 0644다. 다른 env 파일은 0600을 유지한다.

Redis는 Business 전용 내부 네트워크에서 `cache:business:*`만 읽고 쓴다. default 계정·다른 키·CONFIG/ACL/FLUSHALL은 거부하며 health 계정은 PING만 수행한다. 기존 미리보기의 2 GiB 컨테이너 한도, PDF 도구와 CPU·PID·tmpfs·비특권 실행을 보존한다. 대상 EC2의 전체 메모리 실측 뒤 기동한다.

단독 로컬 실행도 `write-compose-env.py --service business-api --redis-acl-output <경로>`가 생성한 env와 ACL을 사용한다. `BUSINESS_API_ENV_FILE`·`BUSINESS_REDIS_ACL_FILE`을 지정해 `server/business-api/compose.yml`을 실행하면 호스트 `127.0.0.1:8082`가 컨테이너 8080으로 연결된다. 시크릿이 포함된 파일은 커밋하지 않는다.

Link/MMP는 `OneOrThree/mmp-custom`의 별도 배포다. 여기서 Vercel·Neon 연결이나 DNS 전환을 수행하지 않는다.
