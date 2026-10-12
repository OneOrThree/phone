# 서버 스모크 실행

[GROMO-2285](https://romance.atlassian.net/browse/GROMO-2285) · [TC 명세](TCL.md) · [공통 계획](../README.md)

## 실행

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

## 환경변수

| 변수 | 기본값·역할 |
|---|---|
| `BASE_URL` | 필수. 공개 Business API를 통과하는 주소 |
| `RESULTS_FILE` | `results.tsv`. 실행마다 이전 결과를 제거. append가 꼭 필요하면 `SMOKE_APPEND_RESULTS=1` |
| `SMOKE_BASIC_ONLY` | `1`이면 공개 기본 TC만 실행. 미지정 시 DB 설정 유무에 따라 기본/전체 자동 선택 |
| `SMOKE_CORE_ENABLED` | `1`이면 014와 독립된 015 준비도 실행. DB 설정 시 전체 모드 기본 1 |
| `SMOKE_DEVICE_ID` | 미지정 시 새 UUID. 실사용자의 기기 값을 넣지 않음 |
| `SMOKE_WS_URL` | 미지정 시 BASE_URL의 `/ws/realtime`, https→wss/http→ws |
| `SMOKE_HTTP_TIMEOUT` | 10초. HTTP 요청 상한 |
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

종료 시 진행 중 세션·친구 관계·주민 가입은 API로 정리한다. 전용 테스트 게스트·섬과 보상·건설 이력은 보존된다. 일괄 삭제·전체 테이블 초기화·Redis FLUSH는 하지 않는다. 테스트 계정 삭제 정책은 별도 범위를 확정한 뒤 적용한다.

## 검증 명령

```bash
# 실제 HTTP와 native WebSocket을 사용하는 성공·실패·타임아웃·정리 회귀 검사
bash smoke/server/tests/api-runner.sh
# 비정상 UUID·fixture·SQL 모드가 DB 접속 전에 차단됨
bash smoke/server/tests/seed-guards.sh
# 내부 health/Redis 실패·정리·자격 비노출
python3 smoke/server/tests/test_internal.py
# Actions 결과 보고·누락 검사 (GitHub 요청은 mock)
python3 .github/scripts/test-report-smoke.py
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
