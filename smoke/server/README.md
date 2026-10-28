# 서버 스모크 실행

[GROMO-2285](https://romance.atlassian.net/browse/GROMO-2285) · [TC 명세](TCL.md) · [전체 실행 흐름](../README.md#전체-실행-흐름) · [로그인 AS IS / TO BE](login-retry.md)

## 실행

dev 자동 스모크는 CD 완료·게스트 생성 제한 창 대기 후 `dev-vm-deploy` 잠금 안에서 실행한다.
먼저 오래된 미사용 이미지를 정리하고, Data·Business·Realtime·Notification이 모두 healthy인지 확인한다.
이후 **300초 대기한 뒤** 전체 검사를 시작한다.
이 대기는 초기 지연의 완화책이며, 요청으로 예열되지 않은 경로까지 준비됐음을 보장하지 않는다.
실제 unhealthy 판정이나 HTTP 제한은 완화하지 않는다. prod 워크플로에는 적용하지 않는다.

스모크 전 `.github/scripts/dev-image-retention.py --apply`가 기존 성공 이력으로 로컬 이미지를 정리한다.
이번 실행 이미지·서비스별 서로 다른 최근 스모크 성공 이미지 두 개·모든 컨테이너(중지 상태 포함)의 참조 이미지를 보존한다.
새 이미지는 아직 성공으로 기록하지 않으며, 전체 검사가 통과한 뒤에만 `--record-success`로 이력을 갱신한다.
삭제 대상은 dev GAR의 네 앱 저장소에만 속하고 생성 후 7일 지난 미사용 이미지다.
성공 이력은 `${runner.tool_cache}/phone-dev-images/successful-images.json`에 저장하며 비밀을 포함하지 않는다.
최초 실행이나 이력 초기화 후 성공 이미지가 두 개 쌓이지 않은 서비스는 삭제를 건너뛴다.
손상된 이력·보존 이미지 누락·서비스 변경은 정리를 중단한다. 정리 실패는 경고로 남기고 스모크 검증은 진행한다.
강제 삭제·컨테이너/볼륨/registry 정리는 하지 않는다. 여러 태그 때문에 ID 삭제가 거부된 이미지도 보존한다.

dev 러너에서 삭제 없이 후보만 보려면 아래처럼 실행한다. `--apply` 없이 실행하면 성공 이력도 갱신하지 않는다.

```bash
DEPLOY_ENV=dev DEV_IMAGE_HISTORY="$RUNNER_TOOL_CACHE/phone-dev-images/successful-images.json" \
  python3 .github/scripts/dev-image-retention.py
```

필수 도구는 Bash·curl·jq·Node ≥22·Python 3다. 내부 검사는 Docker 접근 권한도 필요하다. 앱 코드나 DB 스키마를 바꾸지 않고 현재 배포된 dev 환경을 검사한다.

```bash
# 공개 기본 TC: 001~007·009·010. 내부 DB 준비 없이 실행한다.
BASE_URL=https://oneorthree.dev.mooo.com \
  SMOKE_BASIC_ONLY=1 RESULTS_FILE=/tmp/smoke-basic.tsv \
  smoke/server/run.sh

# 검사 대상 서버에서: 008·017·018.
RESULTS_FILE=/tmp/smoke-internal.tsv smoke/server/internal.sh

# 검사 대상 서버에서: 공개 기본 검사 + 014·015·016, 전체 API 흐름.
# 접속 값은 기존 컨테이너 환경에서 가져오고 stdout에 출력하지 않는다.
export SMOKE_DB_CONTAINER=phone-db
SMOKE_DB_USER=$(docker exec "$SMOKE_DB_CONTAINER" sh -c 'printf "%s" "$POSTGRES_USER"')
SMOKE_DB_NAME=$(docker exec "$SMOKE_DB_CONTAINER" sh -c 'printf "%s" "$POSTGRES_DB"')
export SMOKE_DB_USER SMOKE_DB_NAME
BASE_URL=https://oneorthree.dev.mooo.com SMOKE_CORE_ENABLED=1 \
  RESULTS_FILE=/tmp/smoke-api.tsv smoke/server/run.sh
```

기본은 매 실행 새 기기 UUID로 로그인한다. `SMOKE_DEVICE_ID`를 명시하면 현재 게스트 복구 창(5분) 안에서만 같은 계정을 다시 받을 수 있다. 날짜를 넘겨 같은 기기를 재사용하면 영구 고정 계정이 되는 것이 아니다.

014·015·016의 DB 초기 준비는 내부에서만 한다. 014는 게스트 상태를 유지하고 실제 집중 적립·회관 착공 후 구매 403 SOCIAL_LOGIN_REQUIRED와 지갑·주문·인벤토리 무변경을 검증한다. 빈 카탈로그면 유효한 형식의 fixture 상품 ID로 회원 gate를 확인한다. 015는 독립 도서관 fixture, 016은 두 전용 계정의 친구 관계 fixture를 사용한다. 게스트 구매·친구 요청 제한은 변경하지 않는다.

## 로그인이 늦을 때

[AS IS / TO BE 차트](login-retry.md) · [작업 티켓](https://romance.atlassian.net/browse/GROMO-2543)

게스트 로그인만 같은 기기 UUID로 **매번 5초 기다린 뒤 최대 두 번 더 요청**한다(최초 포함 3회).
첫 요청부터 요청·대기를 합해 40초 안에 끝내고, 각 HTTP·연결 제한은 기존 값과 남은 전체 시간 중 작은 값을 쓴다.
마지막 실패 후에는 더 기다리지 않는다. 타임아웃이 계속되면 해당 TC는 FAIL, 그 로그인에 의존한 TC는 SKIP이다.

다시 시도하는 오류는 `504 / UPSTREAM_TIMEOUT`, `503 / SERVICE_UNAVAILABLE`, 앱 오류 봉투가 없는 gateway 502·503·504,
curl의 연결 실패·시간 초과·빈 응답·수신 단절(7·28·52·56)이다.
429·400·401·403 등, `UPSTREAM_AUTH_FAILED`·`UPSTREAM_CONTRACT_ERROR`, 알 수 없는 앱 오류,
201 응답의 필수 필드 누락과 인증서 오류는 한 번에 실패한다. 섬 생성·집중·건설 등 다른 API에는 재시도를 추가하지 않는다.

전체 모드는 `main`, `friend-owner`, `friend-peer`, `core`, `statistics`의 첫 요청 최대 5회를 예약한다.
부모와 자식은 임시 경로 `SMOKE_GUEST_STATE_DIR`의 잠긴 파일에서 실제 요청을 차감하며,
재시도를 합해 **전체 10회 이하**로 제한한다. 아직 시작하지 않은 로그인의 첫 요청 몫은 재시도에 쓰지 않는다.
기본 공개 모드는 `main`만 예약한다. 서버의 5분 기기 복구 창 안 재시도는 같은 userId의 **새 세션**을 받을 수 있다.
기기 UUID도 복구 자격이므로 기록에 남기지 않는다.

자동 실행의 기존 3,601초 생성 제한 창 대기는 유지하며 모든 시도 직전에 마지막 요청 시각을 갱신한다.
이 예산은 서버의 기본 IP별 10회/1시간 제한을 올리거나 같은 IP의 다른 트래픽까지 예약하는 기능이 아니다.
429는 계속 요청하지 않고 실패로 보고한다.

`results.tsv`의 기존 5열과 최종 판정을 유지한다. TC002 사유에는 `attempts`(실제 요청 수), `retries`(추가 요청 수),
`elapsed_ms`(대기를 포함한 전체 시간), `first_error`를 표시한다. 다른 게스트 준비도 같은 로그와 진단을 남긴다.
Actions의 `auth-attempts.jsonl`에는 역할·횟수·허용한 오류 코드·시도/전체 시간만 담고,
본문·헤더·토큰·기기 UUID·사용자 ID·원문 curl 오류를 보관하지 않는다.
전체 TC가 PASS이면 재시도 후 성공도 실행은 성공이지만, 요약에서 **재시도 후 통과**로 구분한다.
중간 timeout을 별도 TC FAIL로 남겨 최종 성공과 중복 집계하지 않는다.

## 환경변수

| 변수 | 기본값·역할 |
|---|---|
| `BASE_URL` | 필수. 공개 Business API를 통과하는 주소 |
| `RESULTS_FILE` | `results.tsv`. 실행마다 이전 결과를 제거. append가 꼭 필요하면 `SMOKE_APPEND_RESULTS=1` |
| `SMOKE_BASIC_ONLY` | `1`이면 공개 기본 TC만 실행. 미지정 시 DB 설정 유무에 따라 기본/전체 자동 선택 |
| `SMOKE_CORE_ENABLED` | `1`이면 014와 독립된 015 준비도 실행. DB 설정 시 전체 모드 기본 1 |
| `SMOKE_DEVICE_ID` | 미지정 시 새 UUID. 실사용자의 기기 값을 넣지 않음 |
| `SMOKE_WS_URL` | 미지정 시 BASE_URL의 `/ws/realtime`, https→wss/http→ws |
| `SMOKE_HTTP_TIMEOUT` | 10초. HTTP 요청 상한. 로그인은 남은 전체 시간으로 제한 |
| `SMOKE_AUTH_MAX_RETRIES` | `2`. 게스트 로그인 추가 시도 수(0·1·2). `0`이면 단발 요청 |
| `SMOKE_AUTH_TOTAL_TIMEOUT_SECONDS` | 40초. 로그인 요청·대기의 총 제한(0보다 크고 40 이하) |
| `SMOKE_AUTH_DIAGNOSTICS_FILE` | 선택. 자격을 제외한 JSONL 경로. Actions는 `smoke-results/api/auth-attempts.jsonl`, 로컬 미지정 시 임시 파일 |
| `SMOKE_CONNECT_TIMEOUT` | 2초. HTTP 연결 상한 |
| `SMOKE_HEALTH_TIMEOUT_MS` | 2000ms. 공개 health 판정 |
| `SMOKE_WS_CONNECT_TIMEOUT_MS` | 5000ms. STOMP 연결·구독 준비 |
| `SMOKE_EVENT_TIMEOUT_MS` | 3000ms. 세션에 일치하는 집중 이벤트 수신 |
| `SMOKE_DB_CONTAINER` | Data DB 컨테이너. 지정 시 `docker exec`로 psql 실행 |
| `SMOKE_DB_USER`, `SMOKE_DB_NAME` | 기존 DB 접속 정보. 자격·환경 전체를 출력하지 않음 |
| `SMOKE_DATABASE_URL` | Docker 대신 직접 psql을 사용할 때 libpq DB 접속값. argv 대신 환경으로 전달 |
| `SMOKE_CONTAINER_NAMES` | health 대상 컨테이너 5개. 공백으로 구분 |
| `SMOKE_REDIS_CONTAINER` | `phone-redis` |
| `SMOKE_REDIS_ENV_CONTAINER` | `phone-data-api`. Redis 접속 설정의 읽기 원천 |
| `SMOKE_BUSINESS_REDIS_CONTAINER` | `phone-business-redis-1` |
| `SMOKE_BUSINESS_REDIS_ENV_CONTAINER` | `phone-business-api-1`. business Redis 설정의 읽기 원천 |
| `SMOKE_DOCKER` | `docker`. 검사 시 Docker 실행기의 경로를 변경할 때 사용 |

컨테이너가 없는 별도 환경에서는 health 컨테이너 이름과 Redis 설정을 그 환경에 맞춰 명시해야 한다. 이 실행기는 로컬 Docker 환경을 자동 기동하지 않는다.

## 판정·데이터 준비

`TCL.md`의 15개 TC가 정본이다. TSV는 `id/status/http_code/ms/reason` 5열이며 API 응답 원문·JWT·DB/Redis 자격은 담지 않는다. TCP 연결만으로 Redis 읽기·쓰기 성공을 판정하지 않는다. 공유 Redis는 저장·조회·TTL·삭제를, business Redis는 기존 ACL이 허용한 EXPIRE·GET으로 실제 만료·재저장·삭제를 확인한다.

DB SQL은 30분 이내 신규 게스트·활성 로그인 세션·테스트 이름·방장 소속·단독 섬·기존 사용 이력 부재를 대조한다. 다른 사용자나 이미 사용한 섬은 거절한다. 보상·건설 비용 정책은 현재 활성 데이터를 읽으며 테스트가 전역 publication을 만들지 않는다. 초기 잔액에는 준비용 원장을 함께 남긴다. 집중 구간 시각은 조작하지 않는다.

014는 실시간으로 유효 집중 1분을 채운다(현재 정책의 secondsPerFish 사용). 크론이 먼저 적립할 수 있으므로 종료 직전이 아닌 집중 시작 전 잔액과 비교한다. 건설은 착공과 차감을 확인하고 완공 대기는 생략한다. 구매 거절 후 지갑 잔액·version, 주문·인벤토리를 전후 비교한다. 회원 구매·장착 성공은 이번 검증 범위에서 제외한다.

종료 시 진행 중 세션·친구 관계·주민 가입을 정리하고, 이번 실행에서 만든 섬은 마지막 주민 퇴장 API로 닫는다. 014 섬은 015가 재사용한 뒤 닫는다. 중간 실패에도 정리를 시도하며 섬 정리 실패는 FAIL이다. 전용 게스트 계정과 개인 집중 기록은 보존되지만, 섬 종료 시 공동 통장·건설 상태와 기여·공동 구매 기록은 삭제된다. 일괄 삭제·전체 테이블 초기화·Redis FLUSH는 하지 않는다. 테스트 계정 삭제 정책은 별도 범위를 확정한 뒤 적용한다.

## 검증 명령

```bash
# 실제 HTTP와 native WebSocket을 사용하는 성공·실패·타임아웃·정리 회귀 검사
bash smoke/server/tests/api-runner.sh
# 비정상 UUID·fixture·SQL 모드가 DB 접속 전에 차단됨
bash smoke/server/tests/seed-guards.sh
# 로그인 retry·실제 curl timeout/응답 유실·공유 예산, 내부 health/Redis·정리·자격 비노출
python3 -m unittest discover -s smoke/server/tests -p 'test_*.py' -v
# Actions 결과 보고·누락, main 주기·배지·무배포 판정, 배포 대기 회귀 검사
# 기존 Satellite CI의 test_*.py 수집 대상 중 스모크 검사만 실행한다. GitHub 요청은 mock.
python3 -m pip install 'pyyaml==6.0.2'
python3 -m unittest discover -s .github/scripts -p 'test_*smoke*.py' -v
```

mock 검사는 실행기 자체의 회귀를 검증한다. GCP dev의 실제 검사 결과와는 구분하며 [검증 기록](verification.md)에 실행일·TC 결과·차단 조건을 남긴다.

## GCP에서 격리된 014 게스트 흐름 검증

공유 dev의 반복 생성 제한이나 cold start 영향과 분리해 기능 흐름을 확인할 때, 배포된 Data·Business 이미지로 빈 DB·Redis·서비스를 만들어 게스트 적립·건설·구매 거절 흐름을 별도로 검사할 수 있다. 이 검사는 공유 dev 상품 가격을 바꾸지 않으며, 테스트 DB에만 5마리 상품을 넣는다. 사용자 시나리오와 API 흐름을 검증하는 fixture 가격이며 출시 상품 가격을 검증하는 것은 아니다.

```bash
# GCP dev VM에서 Docker 권한으로 실행. Node ≥22·curl·jq·Python 3 필요.
SMOKE_ALLOW_ISOLATED_TEST=1 RESULTS_FILE=/tmp/smoke-isolated-core.tsv \
  python3 smoke/server/tests/isolated-core.py
```

격리 스크립트는 loopback 포트만 publish하고 무작위 이름·소유권 라벨이 있는 컨테이너만 정리한다. 임시 DB는 tmpfs이며 실행 종료 시 제거된다. 신규 서비스의 relay와 예약 작업은 꺼 두고, 출력은 TC 결과와 자격을 제거한 시작 진단으로 제한한다. 격리 Business JVM은 cold start 기능 검사용으로 Data read timeout 10초·전체 deadline 20초, curl 25초를 적용한다. 공유 dev 지연 조건을 검증하는 결과는 아니다. 공유 환경의 실제 실패는 별도로 유지한다.

## main 병합 후 결과 배지

자동 실행은 main push당 한 번, 해당 SHA의 실제 생성된 CI·dev 배포 완료 후 전체 15개를 검사한다. 실행 등록 관찰은 최소 120초, 배포 대기 제한은 180분이다. 자동·수동 실행 모두 이전 스모크의 마지막 게스트 생성 요청부터 3,601초를 기다리며, 대기 중에는 배포 잠금을 잡지 않는다. 연속 병합은 즉시 검사하지 않고 이 제한 창 이후 차례로 검사한다. 매일 실행·서비스별 중복 호출은 없다. 결과는 [공통 README의 배지](../README.md)로 확인한다. 수동 workflow_dispatch도 전체 15개를 실행하며 main 자동 결과 배지를 바꾸지 않는다.
