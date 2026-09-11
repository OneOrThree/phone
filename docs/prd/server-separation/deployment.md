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

입력은 실제 배포의 SecretString과 기존 compose 보간 env다. 이미지 태그·누락 자격·존재하지 않는 기존 env는 거부한다. prod에서는 현재 스택과 같은 `--project-name`을 명시한다. 출력은 0700 디렉터리의 0600 파일이며 값은 로그에 남기지 않는다. 입력의 relay·스케줄 설정은 그대로 전달하므로 준비 도구가 이를 꺼 준다고 가정하지 않는다.

## Data 전용 환경 연결

`docker-compose.satellites.data.yml`을 마지막 `-f`로 넣는다. `env_file: !override`로 prod의 공유 `.env.prod`를 교체하고 `environment: !override`로 dev의 관리자 DB 자격 덮어쓰기를 제거한다. Data 이미지는 `APP_IMAGE`의 검증된 digest를 사용한다. 전용 파일의 `dev,satellites` 또는 `prod,satellites` 프로파일을 검사한다. `!override`를 지원하는 Compose가 필요하며 `config --quiet` 실패 시 진행하지 않는다.

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
