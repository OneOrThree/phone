# 원본 로그 S3 보관과 수집 장애 복구 런북 (GROMO-2556)

> 2026-10-29 작성. 로컬 Docker(Fluent Bit 4.2.8, Loki 3.3.2, MinIO)로만 시험했다. **AWS·dev·prod 에는 요청을 보낸 적이 없다.** 실제 S3·IAM·Infra·dev 호스트가 필요한 단계는 아래 「미확인·차단」에 «미실행 — 배포 게이트»로 적었다. 이 문서는 무유실·exactly-once 를 약속하지 않는다.

관련: [아키텍처 §3·§5](README.md) · [구현 계획 §4·§5·§7](implementation-plan.md) · [실행 중 수집 경로 조사(2554)](runtime-inventory.md) · 설정 [`server/observability/fluent-bit/`](../../../server/observability/fluent-bit/) · 하네스 `server/observability/fluent-bit/local-test/s3/run-s3.sh`

## 1. 구성 요약

| 항목 | 내용 |
| --- | --- |
| 수집기 | Fluent Bit 4.2.8 한 프로세스(overlay 서비스 `fluent-bit`). 입력 3종: Docker `*-json.log`(allowlist 4서비스 + `nginx`), dev 호스트 Nginx 파일(선택), `dummy` canary |
| 출력 | A: Loki(`Match_Regex ^(docker\|nginx_host\|canary)$`). B: S3(선택 모듈) — 같은 레코드를 `rewrite_tag`(keep)로 `s3.<env>.<service>` 로 복제해 S3 출력만 받게 한다. 두 출력은 청크·재시도·디스크 한도가 따로다 |
| 상태 볼륨 | `fluent_bit_state`: `tail.db`(Docker), `nginx-tail.db`(호스트 Nginx), `storage/`(엔진 버퍼), `s3/`(S3 `store_dir`) |
| 스위치(기본 모두 꺼짐) | `OBS_LOG_S3=on` → `modules/s3-on`, `OBS_LOG_NGINX_HOST=on` → `modules/nginx-host-on` 이 `/fluent-bit/etc/modules/<이름>` 에 마운트된다. 값 `off`(또는 미설정)는 주석뿐인 `off.conf`. 필수 `${VAR:?}` 없음(`compose config -q` 확인) |
| S3 설정 변수 | `OBS_LOG_S3_BUCKET`(켤 때 필수), `OBS_LOG_S3_REGION`(기본 `ap-northeast-2` — **미확인 가정**), `OBS_LOG_S3_TOTAL_FILE_SIZE`(10M), `OBS_LOG_S3_UPLOAD_TIMEOUT`(5m), `OBS_LOG_S3_STORE_LIMIT`(64M: 2554 dev 산정 52 MB 올림) |
| 자격 | `s3-on` 에는 `endpoint` 와 키가 없다 — AWS 기본 엔드포인트와 자격 체인(인스턴스 역할)을 쓴다. 새 장기 액세스 키를 기본으로 두지 않는다 |
| dev | **S3 자격이 없다(2554 실측).** dev overlay 에서 `OBS_LOG_S3` 를 켜지 않는다. 켜면 업로드가 실패한다 |

### 스위치 방식 판단

- `@INCLUDE` 대상 디렉터리를 마운트로 갈아 끼우는 방식을 택했다. 환경변수로 Match 를 바꾸거나 `endpoint` 를 빈 값으로 두는 방식은 AWS 없이 동작을 확인할 수 없어 피했다.
- `/fluent-bit/etc/modules/*` 가 etc 안에 있어 마운트 없이도(2555 하네스 등) `off.conf` 로 설정이 완성된다.
- 켜는 쪽은 환경변수가 compose 에 도달해야 한다. `ops-monitor.dev.yml` 이 만드는 env 에 변수를 넣는 방법은 워크플로 수정이 필요해 이번 범위 밖이다(요청 항목 §9).

## 2. S3 키, 시간 의미, lifecycle 범위

```text
system_log/v2/env=<env>/service=<service>/date=YYYY-MM-DD/hour=HH/<수집기 HOSTNAME>-<$UUID 8자>.json.gz
```

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 형식 | gzip JSONL(`compression gzip`, 레코드 한 줄당 JSON 한 개). Fluent Bit 의 `date` 키는 끈다(`json_date_key false`) | 로컬 MinIO 객체 읽기(gunzip) |
| env·service | 키 값은 레코드의 `env`·`service`. **S3 레코드 본문에도 `env`·`service`·`log_kind` 가 남는다**(Loki 출력만 라벨로 옮기며 본문에서 뺀다) | 객체 내용 확인 |
| service allowlist | `rewrite_tag` 규칙이 `data-api\|business-api\|notification\|realtime\|nginx\|canary` 만 통과시킨다 | 설정 |
| 시간 | **객체 «첫 레코드» 의 event time(UTC)**. 한 객체 안에 다른 시간대 레코드가 섞일 수 있다 — 정확한 발생·수집 시간 파티션이 아니다. 시험 k: event time 이 3시간 전인 레코드가 첫 레코드인 객체에 5분 전 레코드가 함께 들어가 `hour=03`(현재 06시대) 키가 만들어졌다 | 하네스 k |
| event time 의 출처 | 실제 파이프라인은 Docker json-file 이 줄에 찍은 시각(앱 `timestamp` 와 밀리초~초 차)이다. 앱 `timestamp` 를 event time 으로 쓰도록 parser 에 `Time_Key` 를 주지 않았다(Loki 시각을 바꾸는 2555 설정과 충돌) | `parsers.conf` |
| 고유성 | `${HOSTNAME}`(컨테이너 id) + `$UUID`(플러그인이 만드는 **무작위 8자**). 정말 전역 UUID 가 아니다. 같은 컨테이너·같은 접두 안에서 8자 충돌은 이론상 가능하나 시험 중 관찰되지 않았다(수십 개 객체 규모, 충돌 확률은 계산하지 않음) | 키 목록 |
| 업로드 | `total_file_size` 10M 미만이면 PutObject. `upload_timeout` 5m 이 지나면 크기와 무관하게 닫는다. 하네스는 20s 로 줄였다. 10 MiB 크기 트리거는 **미실행** | 로그 "will use PutObject API" |
| lifecycle | `system_log/` 규칙(90일, 미완료 multipart 1일)의 범위에 들어간다. 규칙 파일([`s3-log-archive-lifecycle.json`](../../../server/scripts/s3-log-archive-lifecycle.json))은 바꾸지 않았다. **실제 버킷 적용 여부는 미확인(2554)**. PutObject 방식이라 미완료 multipart 는 평소 생기지 않는다 | 파일 |
| 보존 기준 | S3 만료는 업로드 시각 기준이다. 오래된 로그를 다시 올리면 만료가 늦어진다(구현 계획 §4와 동일) | — |

## 3. 켜는 순서

| 단계 | 작업 | 확인 | 상태 |
| --- | --- | --- | --- |
| 1 | 2555 의 Fluent Bit→Loki 가 dev 에 올라가 있고 Promtail 제거는 2555 에서 끝난 상태 | `docker ps` 에 `gromo-fluent-bit`, Promtail 없음 | 2555 소관 |
| 2 | **S3 자격 결정**(2554 결정 대기): GCP dev→S3 단기 자격 연동 또는 dev 용 별도 버킷. 결정 전에는 `OBS_LOG_S3` 를 켜지 않는다 | 자격 체인으로 대상 prefix PutObject 성공, 타 환경 prefix 쓰기 거부 | **미실행 — 배포 게이트** |
| 3 | dev candidate: `OBS_LOG_S3=on`, `OBS_LOG_S3_BUCKET=<dev 버킷>` 으로 ops-monitor 재배포. 기존 업로더는 그대로 둔다 | §6 canary 가 Loki·S3 양쪽에 도착, `s3.0` 지표 `errors`·`dropped_records` 0 | **미실행 — 배포 게이트** |
| 4 | 비교: 같은 시간대에 `system_log/` 기존 업로더 객체와 `system_log/v2/` 객체의 로그 수·마스킹·시간 범위를 대조(기존 업로더는 `app.log` 텍스트, v2 는 stdout JSON 이라 필드가 다르다 — 수량은 이벤트 수가 아니라 «시간대별 줄 수 추세» 로 본다) | 로그량·canary·마스킹 원문 부재 | **미실행** |
| 5 | **기존 업로더 중단**(§5)과 전환 기준 시각·source 파일 위치 기록 | §5 점검표 | **미실행** |
| 6 | prod(Catus): Infra `prod/catus/runtime` 변경으로 Fluent Bit·모듈·IAM 을 적용(§9). 이 저장소로는 못 한다 | — | **Infra 소유** |

## 4. Nginx 입력

### 4.1 공통 정제 (`logs.lua`, 하네스 i 에서 검증)

- access: query string 은 JSON `log_format` 이 `$uri` 만 써서 애초에 없다. 경로의 20자 이상 영숫자 세그먼트(UUID 제외)는 `:redacted`. client IP·referrer·user-agent 는 형식에 넣지 않으며, 기본 combined 줄이 들어오면 IP·identd·user·referrer·agent 를 읽지 않고 버린다.
- error: `request: "GET /path?query HTTP/1.1"` 의 query, `upstream: "http://…?query"` 의 query, `referrer: "…"` 전체, `client: <ip>`, `"/경로"` 로 감싼 파일 경로의 토큰 세그먼트를 정제한다. 그 뒤 `mask()`(토큰·인증·이메일·휴대폰 규칙)를 적용한다. 줄은 마스킹 전에 32 KiB 로 먼저 자른다.
- 필드: `log_kind` = `access`(요청) \| `infrastructure`(error). 계약 §5 의 `application\|access\|raw` 에 `infrastructure` 를 더했다. `service=nginx`, `env`. `log_id` 는 수집기가 부여하는 무작위 UUID(원천에 안정 커서가 없다 — 수집기가 같은 파일을 처음부터 다시 읽으면 새 id 가 붙어 중복이 된다). trace 필드는 없다 — **trace 없는 로그도 그대로 보관된다**(S3·Loki 모두 도착 확인).
- 연결: access 는 `edge_request_id`(Nginx `$request_id`)와 upstream 응답 헤더 `X-Request-Id`(`request_id`, Business 가 응답에 주는 자기 UUID)를 함께 남긴다. 502/413 처럼 upstream 에 닿지 않은 요청은 `request_id` 가 없다. **error 로그는 요청 단위 연결을 주장하지 않는다** — `connection`(`*<번호>`)과 시간으로만 보조 연계한다. error 시각은 서버 로컬 시간인데 UTC 로 간주해 `timestamp` 를 만든다(dev VM 시간대 **미확인**).

### 4.2 dev 호스트 Nginx (systemd, Nginx 1.18)

| 단계 | 작업 |
| --- | --- |
| 1 | `server/scripts/nginx-log-format.conf.example` 의 `log_format gromo_json …` 을 **http 수준**(`/etc/nginx/nginx.conf` 의 `http {}` 또는 `conf.d/*.conf`)에 넣는다. 이 파일은 저장소 밖이라 수작업이다. `nginx-dev-2.0-routes.conf.example` 은 location include 라 `log_format` 을 넣을 수 없다 |
| 2 | server 블록(또는 http 수준)에 `access_log /var/log/nginx/access.json.log gromo_json;` 를 **추가**한다(기존 `access.log` combined 는 유지 — 수집기는 읽지 않는다) |
| 3 | `sudo nginx -t` → `sudo systemctl reload nginx`. 새 파일에 JSON 줄이 한 줄씩 생기는지 확인 |
| 4 | logrotate: 기존 설정(daily·rotate 14·compress·delaycompress·`create 0640 www-data adm`)이 `/var/log/nginx/*.log` 를 덮으므로 새 파일도 회전한다(**2554 실측은 `access.log` 기준 — 새 파일 회전은 적용 뒤 확인**). postrotate 의 `nginx -s reopen` 이 새 파일을 만든다 |
| 5 | `OBS_LOG_NGINX_HOST=on` 으로 ops-monitor 재배포. 컨테이너는 root 라 `0640 www-data:adm` 파일을 읽는다 |
| 롤백 | `OBS_LOG_NGINX_HOST` 제거 후 재배포(수집 중지), 필요하면 `access_log …json.log` 줄을 지우고 reload. 이미 보낸 객체·Loki 줄은 남는다 |

수집기 동작(하네스 i 에서 검증): `Read_From_Head On` + 파일별 DB offset, 회전(rename 후 새 파일) 뒤에도 따라간다. 회전된 `.1` 은 읽기 대상이 아니며(Path 정확 지정) 이미 읽은 부분만 보냈다. **압축된 `.gz` 는 읽지 않는다**: 회전 직후 `delaycompress` 덕에 `.1` 이 하루 압축되지 않지만, 수집기가 멈춘 채 하루 넘게 방치되면 그 사이 회전된 내용은 읽지 못한다.

### 4.3 prod 컨테이너 Nginx

- 수집: 2555 와 같은 Docker 입력. `nginx` 서비스를 allowlist 에 넣었고(`FLB_COMPOSE_PROJECT` 일치 조건 그대로), stdout 은 access, stderr 는 error 로 취급한다. 공식 이미지는 `access.log→stdout`, `error.log→stderr` 심볼릭 링크다.
- 하네스 i 의 `nginx` 서비스(compose 서비스명 `nginx`, `nginx:1.28-alpine`)로 JSON access·error 모두 검증했다.
- **설정 변경은 Infra 소유**(`prod/catus/runtime`): `log_format gromo_json` 추가, `access_log /dev/stdout gromo_json;`. 적용 전의 기본 combined 줄도 수집기가 정제해 `service=nginx` 로 보관한다(요청 단위 `edge_request_id` 는 JSON 형식에서만).
- 서비스 이름이 `nginx` 가 아니면 `logs.lua` 의 ALLOWED 와 `rewrite_tag` 규칙을 맞춰야 한다. prod 의 실제 compose 서비스명·프로젝트명은 **미확인**.

## 5. 기존 업로더 중단·롤백 순서 (implementation-plan §7 구체화)

기존 경로: 호스트 systemd 타이머(티켓 590, 매시간 `system_log/app-N/`·`user_log/app-N/`)와 새 prod 호스트 업로더(2288). dev 에는 업로더가 없다(2554 실측).

| 순서 | 작업 | 점검 |
| --- | --- | --- |
| 0 | 두 업로더(590 타이머, 2288)가 같은 호스트에서 **같은 prefix 에 이중으로 쓰는지** 확인한다. `systemctl list-timers`, 최근 객체의 `LastModified`, 2288 산출물 | 공존 여부는 **미확인** |
| 1 | v2 를 켠 채 기존 업로더는 그대로 둔다. 새 접두 `system_log/v2/` 와 기존 `system_log/app-N/` 은 키가 겹치지 않는다 | v2 객체가 매 `upload_timeout` 마다 늘어남, canary S3 도착 |
| 2 | v2 backlog 가 없음(`store_dir` 비어 있음, `s3.0` `errors` 0)과 canary 연속 도착을 확인한 뒤 **전환 기준 시각**과 source 파일 위치를 기록한다 | 기록 |
| 3 | **APP 업로더만 중단**: 타이머의 `app.log` 대상만 막는다. 같은 타이머가 `user-activity.log`(`user_log/`)도 올리면 APP 경로만 분리하고 user-activity 적재는 유지한다(790 의 전환 예정 접두는 이 작업 범위가 아니다) | 중단 뒤 `system_log/app-N/` 에 새 객체 없음, v2 계속 증가 |
| 4 | Promtail 제거는 2555 에서 완료(이 작업에서 다시 하지 않음) | — |
| 롤백 | ① S3 출력만 끈다: `OBS_LOG_S3` 제거 후 재배포(Loki 는 계속 동작 — 두 출력 독립) ② 기존 업로더 타이머 재개. **중복 범위 기록**: 전환 기준 시각 ~ 재개 시각 사이는 v2 와 기존 업로더에 같은 줄이 있을 수 있다 ③ `fluent_bit_state` 볼륨·`store_dir`·tail DB 는 지우지 않는다(남은 backlog 를 다시 보낼 수 있다) |

## 6. Canary 운영

- 생성: Fluent Bit `dummy` 입력이 **60초마다** 합성 레코드 1건(`service=canary`, `logger=fluent-bit.canary`, 고유 `log_id`, `canary_seq`; 개인정보 없음)을 만든다. Loki 에는 항상, S3 모듈이 켜져 있으면 S3(`service=canary` 접두)에도 간다.
- 확인(하네스 `canary.py`): **Loki 조회와 S3 객체 조회를 각각 따로** 한다 — Loki 결과와 무관하게 S3 객체를 직접 읽어 `log_id` 를 찾는다. 한쪽 sink 에만 늦으면 그쪽만 `MISSING_IN` 으로 표시한다.
- 운영 적용 설계(**미구현·미실행**): 별도 주기 작업(관측 호스트 cron 또는 Grafana 쪽 쿼리)이 ① Loki `{service="canary"}` 의 마지막 canary 시각 ② S3 `service=canary/` 의 최신 객체 내용의 마지막 canary 시각을 각각 지표로 내고, 각 sink 에서 «마지막 canary 나이 > 임계» 이면 따로 경보한다. S3 는 `upload_timeout` 만큼 늦게 보이므로 임계는 `upload_timeout` + 여유(초기 후보 10분, 하네스 20s 환경 측정과 별개). 저트래픽 시간대의 정상(canary 만 있음)과 수집 단절(canary 도 없음)이 구분된다. canary 도착이 모든 실제 로그의 무유실 증명은 아니다.
- 추가 경보 후보: `s3.0` `errors`·`dropped_records`, `store_dir` 사용량 80%(64M 기준 51 MB), 로그에 `will not retry`(§7 d).

## 7. 장애 시나리오 결과 (로컬 하네스, 측정 그대로)

환경: 로컬 Docker, Fluent Bit 4.2.8, Loki 3.3.2(dev 와 같은 설정), MinIO `RELEASE.2026-10-23T20-06-51Z`(Chainguard 빌드, digest 고정 — 공식 `minio/minio` 는 Docker Hub·Quay 에서 받을 수 없었다), `upload_timeout` 20s(운영 후보 5m), `total_file_size` 10M. 기대 `log_id` 집합은 외부 생성기가 들고(`uuid5(RUN-i)`) 2초 간격 watcher 가 Loki·S3 를 따로 조회해 처음 본 시각을 기록한다. **지연은 2초 해상도**이고 `emitted_ms`(생성기 시각) 기준이다. Loki 는 같은 스트림·시각·본문을 저장 시 합치므로 Loki 쪽 중복은 과소 계수될 수 있다. 시나리오마다 1회(b1 은 3회, 아래) 실행한 값이라 분포는 모른다.

| ID | 시나리오 | sink | 기대 | 수신 | 누락 | 중복 | 지연 p50 / p95 / 최대(초) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| a | 정상, 600건 | Loki | 600 | 600 | 0 | 0 | 1.8 / 2.7 / 2.8 |
| | | S3 | 600 | 600 | 0 | 0 | 20.7 / 26.4 / 27.0 |
| b1 | 전송 중 `docker restart`(SIGTERM) 1000건 | Loki | 1000 | 1000 | 0 | 0 | 2.0 / 5.3 / 6.9 |
| | | S3 | 1000 | 1000 | 0 | 0 | 8.7 / 21.7 / 23.2 |
| b2 | 전송 중 SIGKILL 후 재기동 1000건 | Loki | 1000 | 1000 | 0 | 0 | 1.7 / 5.6 / 7.2 |
| | | S3 | 1000 | 1000 | 0 | 0 | 16.1 / 30.1 / 31.7 |
| c | 수집기를 Loki·MinIO 네트워크에서 30초 분리 1200건 | Loki | 1200 | 1200 | 0 | 0 | 2.8 / 53.7 / 62.4 |
| | | S3 | 1200 | 1200 | 0 | 0 | 20.3 / 38.3 / 41.3 |
| d | MinIO 정지 50초(Loki 정상) 1800건, `Retry_Limit no_limits`(=5회) | Loki | 1800 | 1800 | 0 | 0 | 1.6 / 2.7 / 4.9 |
| | | S3 | 1800 | 1296 | **504** | 0 | 16.8 / 32.7 / 36.0 |
| d (수정 후) | 같은 시험, `Retry_Limit 60` | Loki | 1800 | 1800 | 0 | 0 | 1.5 / 2.9 / 6.9 |
| | | S3 | 1800 | 1800 | 0 | 0 | 23.9 / 65.1 / 69.6 |
| d2 | S3 403(잘못된 비밀키) 60초 후 올바른 키로 수집기 재생성 1200건 | Loki | 1200 | 1200 | 0 | 0 | 1.6 / 3.7 / 6.7 |
| | | S3 | 1200 | 1200 | 0 | 0 | 33.1 / 60.7 / 63.8 |
| d3 | MinIO 정지 90초, 복구 60초 뒤, `Retry_Limit no_limits` | S3 | 2400 | 1539 | **861** | 0 | 26.9 / 62.3 / 66.2 |
| | 같은 시험에서 수집기 재시작 뒤 150초 | S3 | 2400 | 1539 | **861** | 0 | (재시작이 누락분을 되살리지 못함) |
| d3 (수정 후) | 같은 시험, `Retry_Limit 60`, 복구 60초 뒤 | Loki | 2400 | 2400 | 0 | 0 | 1.6 / 2.6 / 3.0 |
| | | S3 | 2400 | 2400 | 0 | 0 | 45.8 / 100.9 / 107.0 |
| d4 | MinIO 정지 5분, `Retry_Limit 60`, 4800건 | Loki | 4800 | 4800 | 0 | 0 | 1.6 / 2.7 / 5.0 |
| | | S3 | 4800 | 4800 | 0 | 0 | 113.9 / 332.1 / 356.4 |
| e | Loki 정지 3분(S3 정상), 복구 후 200초 | Loki | 2400 | 2350 | **50** | 0 | 91.6 / 270.9 / 369.4 |
| | | S3 | 2400 | 2400 | 0 | 0 | 12.4 / 21.5 / 23.4 |
| e2 | 같은 시험, 복구 후 최대 900초 | Loki | 2400 | 2390 | **10** | 0 | 88.0 / 338.8 / 436.0 |
| | | S3 | 2400 | 2400 | 0 | 0 | 12.3 / 22.0 / 26.8 |
| f1 | 두 sink 정지 + Loki 엔진 1M·S3 `store_dir` 2M·total_file_size 1M, 6000건 | Loki | 6000 | 2151 | **3849** | 0 | 52.2 / 90.8 / 91.4 |
| | | S3 | 6000 | 3477 | **2523** | 165 | 48.1 / 77.9 / 78.9 |
| f2 | f1 + 생성기 Docker 로그 500k×2 회전 | Loki | 6000 | 2027 | **3973** | 0 | 40.9 / 61.9 / 62.5 |
| | | S3 | 6000 | 3527 | **2473** | 334 | 48.5 / 59.5 / 60.6 |
| h | 수집기 정지 중 생성기 컨테이너 신규 생성, 재기동 뒤 400건 | Loki | 400 | 400 | 0 | 0 | 16.8 / 20.6 / 21.3 |
| | | S3 | 400 | 400 | 0 | 0 | 41.9 / 45.8 / 46.5 |

수집기 지표(`/api/v1/metrics`, 시나리오 끝): a·b1·e·h 에서 `dropped_records` 0. d: `s3.0` `dropped_records` 60·`errors` 4. e: `loki.1` `retried_records` 7594(`dropped_records` 0). f1: `loki.1` `dropped_records` **3849**(= 누락 수), `s3.0` `dropped_records` 168. f2: `loki.1` 3973, `s3.0` 167.

### 해석과 한계

위 표의 «수정 후» 행은 r1 에서 `Retry_Limit 60` 으로 바꾼 뒤 다시 돌린 값이다(병합된 2555 최종 `logs.lua`·`fluent-bit.conf` 기준). 같은 병합본에서 a 와 Nginx 시나리오(i)도 다시 돌려 누락·중복 0, 민감값 0 이었다(a: Loki 600/600 p50 1.5s, S3 600/600 p50 20.9s).

- **a·b·c·h**: 이 규모에서 누락·중복 0. b1(SIGTERM 재시작)은 같은 시험을 3회 돌려 **1회에서 S3 누락 1건**(1000 중 999)이 나왔고 2회는 0 이었다. 원인은 확인하지 못했다 — 재시작 순간의 S3 버퍼 파일 처리로 추정하지만 **미확정**이다. SIGKILL(b2)은 3회 시험에서 누락·중복이 나오지 않았으나 표본이 작다.
- **d·d3·d4 (원인 확인과 완화)**: 수집기 로그 `Chunk file failed to send 5 times, will not retry` 의 한도는 설정으로 바뀐다. 4.2.8 `plugins/out_s3/s3.c` 는 초기화에서 `if(ctx->ins->retry_limit < 0) { ctx->ins->retry_limit = MAX_UPLOAD_ERRORS; }`(`s3.c:620-621`)로 `Retry_Limit no_limits`(-1)를 `#define MAX_UPLOAD_ERRORS 5`(`s3.h:51`)로 바꾼다. 업로드 큐는 `upload_contents->retry_counter >= ctx->ins->retry_limit` 이면 «will not retry» 를 찍고 파일을 `s3_store_file_inactive` 로 버리고(`s3.c:1908-1914`), 실패마다 `2 * retry_counter` 초 뒤로 미룬다(`s3.c:1920-1925`). 같은 한도가 flush 경로(`s3.c:3837-3841`)·put_all_chunks(`s3.c:1374-1380`)·멀티파트(`s3.c:1662`, `3309`, `3324`)에도 쓰인다. 그래서 `Retry_Limit` 를 양수로 주면 그 값이 쓰이고, 기본 `no_limits` 는 사실상 5회(약 20~30초)다. **`s3-on` 은 `Retry_Limit 60` 으로 바꿨다**(재시도 간격이 2n초씩 늘어 N 번이면 대략 N(N-1)초 → 약 1시간). 같은 d·d3 시험이 누락 0 이 됐고 5분 정지(d4)도 누락 0 이었다. 정지가 이 한도를 넘으면 같은 유실이 생기므로 «S3 정지 약 1시간 이상 → 그 구간 원본 유실» 이 한계다. 상한은 `store_dir_limit_size`(64M)가 따로 잡는다 — 정지 중 쌓이는 양이 이를 넘으면 새 데이터가 버려진다(f1/f2 의 S3 `dropped_records`). 수집기 지표 `s3.0 dropped_records` 는 이 시험에서 누락과 무관하게 올랐다(d 수정 후 40, d4 168, 유실 0) — 이 값만으로 유실을 판정하지 않는다.
- **d2 와 d3 의 차이**: d2 는 수집기를 재생성해 «will not retry» 로 버려진 파일까지 되살린 것처럼 보였다. 소스상 파일별 실패 횟수(`chunk->failures`)는 프로세스 메모리에 있어 재시작하면 0 이고, 재시작 때 로컬 버퍼를 다시 읽는다(`s3_store.c:211-250` `set_files_context`, 로그 «Sending locally buffered data from previous executions»). 그런데 d3(5회 한도)에서는 같은 재시작이 861건을 되살리지 못했다. 둘의 차이를 소스로 설명하지 못했다 — **미규명**. 따라서 «재시작하면 복구된다» 를 복구 절차로 믿지 않는다. 재시작으로 복구된 파일의 객체 키 시간은 복구 시각이다(`set_files_context` 가 `first_log_time = time(NULL)`).
- **c** 는 30초 분리라 한도 안이었다. 분리를 늘린 시험은 하지 않았다(**미실행**).
- **e·e2 (Loki 누락, 판정 부분 확정)**: 수집기는 `dropped_records` 0 으로 보고했지만 Loki 에는 연속 10~148건이 없었다(e2 의 누락은 idx 190~199 연속 10건, Loki 정지 직후 구간). Loki 설정은 dev(`server/observability/loki/loki-config.yml`)와 하네스가 **같은 파일**이다. 효과 설정(`/config`)은 `ingester.wal.enabled: true`, `wal.dir: /loki/wal`(컨테이너 파일시스템, 볼륨 아님), `checkpoint_duration: 5m`, **`flush_on_shutdown: false`**, `chunk_idle_period: 30m`, `max_chunk_age: 2h` 다. 별도 확인: 같은 설정의 Loki 에 100건을 push 한 직후 `docker stop`(SIGTERM) 후 재시작하면 100/100 이 보였고, push 직후 `docker kill`(SIGKILL) 후 재시작하면 **0/100** 이 보였다. 즉 Loki 는 «받았다» 고 응답한 항목을 WAL 에 동기화하기 전에 SIGKILL 되면 잃는다. e 의 `docker stop` 은 기본 10초 유예 뒤 SIGKILL 이라, 종료가 느린 Loki 가 SIGKILL 되었을 가능성이 있다 — **e·e2 에서 실제로 SIGKILL 되었는지는 확인하지 못했다(미확정)**. 이 구간은 S3 에는 있다. Loki 복구 뒤 backlog 는 3분 중단에 최대 약 6~7분(369~436초) 걸렸다(수집기 재시도 backoff).
- **f1·f2**: 한도 도달 시 오래된 청크부터 버려진다. Loki 는 지표 `dropped_records` 와 누락 수가 일치했다. S3 는 누락과 함께 **중복(165, 334)** 이 생겼다. 소스 회전(f2)은 두 sink 가 막힌 동안에도 수집기가 계속 읽어서 추가 손실로 나타나지 않았다. 숫자는 한도를 일부러 작게 한 시험값이며 dev 64M/128M 에서의 손실량이 아니다.
- **수용창 g (Loki 3.3.2, dev 설정)**: 별도 push 시험에서 스트림 최신 항목보다 **59분 오래된 항목은 수용(204), 61분 이상은 400 `entry too far behind`** 로 거절됐다(1·10·30·59분 수용, 61·90·180분 거절). 3분 backlog(e/e2)는 수용창 안이었다. 30분 backlog 실측은 **미실행**(3분으로 축소). 거절된 항목은 시각을 바꿔 넣지 않고 S3 확인으로 본다.

### 도착 지연 (canary, 2초 해상도, 60초 간격)

| 실행 | sink | canary 수 | p50(초) | 최대(초) |
| --- | --- | --- | --- | --- |
| 전체 시나리오 중 | Loki | 6 | 2.1 | 27.1 |
| | S3 | 6 | 25.0 | 67.7 |
| d3·e2·i 시나리오 중 | Loki | 5 | 1.8 | 2.9 |
| | S3 | 6 | 26.2 | 79.2 |

S3 지연은 `upload_timeout` 20s + 업로드 타이머 주기가 지배한다. 운영 후보 5m 에서의 p95 ≤5분 목표(구현 계획 P2)는 **미검증**이다 — 5m 이면 정의상 객체가 닫히는 데 5분이 걸려 p95 가 5분 근처 또는 초과할 수 있다. 목표와 `upload_timeout` 을 함께 조정해야 한다.

### Nginx (시나리오 i)

| 입력 | 요청 | Loki 수신 | S3 수신 | 누락 | 중복 | 비고 |
| --- | --- | --- | --- | --- | --- | --- |
| prod 컨테이너 Nginx(Docker 입력) | 200건 | 200 | 200 | 0 | 0 | 정상·upstream·502·413·404 5종 ×40 |
| dev 호스트 Nginx(파일 tail) | 400건(회전 전 200, 회전 후 200) | 400 | 400 | 0 | 0 | 중간에 `mv` + `nginx -s reopen` |

- upstream `X-Request-Id` 연결 120/120, 502 120건, 413 120건 확인. error 로그 879건(하네스는 `error_log info` 레벨이라 많다).
- 민감값 검사: query(`token=`·`email=`·`code=`·`phone=`)·Referer 토큰·이메일 도메인·경로 토큰·`phone` 값 원문이 Loki·S3 에서 **0건**(최종 실행). 첫 실행에서 `open() "…/PATHTOKEN…" failed` 형태의 error 로그에 경로 토큰이 남아 `logs.lua` 를 고쳤다(따옴표 경로 정제 추가).
- 앱 로그 마스킹의 일부(`Bearer`·`token`·`authorization`·`refresh` 키, 마스킹 전 사전 자르기)는 2555 리뷰 반영분과 같게 맞췄다.

## 8. 미확인·차단 조건

| 항목 | 상태 |
| --- | --- |
| 실제 S3 업로드·IAM·버킷 정책·lifecycle 적용 | **미실행 — 배포 게이트**(AWS 요청 금지) |
| dev→S3 자격 방식(2554 결정 대기) | 차단: 결정 전 dev 에서 `OBS_LOG_S3` 금지 |
| AWS 에서의 `endpoint` 없는 설정 동작, 리전 값(`ap-northeast-2` 는 가정) | 미확인 |
| prod Nginx 의 compose 서비스명·`log_format` 적용 | Infra 소유, 미확인 |
| dev 호스트 `nginx.conf` 수정·새 `access.json.log` 의 logrotate 회전 | 미실행(저장소 밖) |
| dev 호스트 시간대(error.log 시각 해석) | 미확인 |
| 기존 업로더(590·2288) 공존 여부 | 미확인 |
| 10 MiB 크기 트리거, 5분 `upload_timeout` 실측, 30분 backlog, 30초 초과 네트워크 분리, 호스트 디스크 포화 | 미실행 |
| 첫 기동 시 기존 `*-json.log` 전체 재읽기(Read_From_Head) 규모와 Loki 수용창 밖 거절 | 로컬 소량만 확인, 실제 dev 규모 미확인 |
| S3 폐기 한도 | 원인은 소스로 확정, `Retry_Limit 60` 으로 완화(약 1시간 한도). d2/d3 재시작 복구 차이는 미규명 |
| b1(SIGTERM 재시작) 3회 중 1회 S3 1건 누락 | 원인 미확정 — 운영 전 재현 필요 |
| Loki 정지 시 연속 10~148건 누락 | WAL 은 켜져 있으나 `flush_on_shutdown: false`, SIGKILL 시 0/100 별도 확인. e 의 실제 SIGKILL 여부는 미확정 |

## 9. Infra(prod) 요청 항목

1. S3: 환경별 prefix 쓰기 권한이 있는 인스턴스 역할(Fluent Bit 호스트), `system_log/v2/` 에 대한 PutObject, 타 환경 prefix 거부. lifecycle `system_log/` 90일·미완료 multipart 1일이 실제 버킷에 적용돼 있는지 확인.
2. Catus 런타임: Fluent Bit 4.2.8 서비스 추가(`/var/lib/docker/containers` 읽기 전용, 상태 볼륨, `FLB_COMPOSE_PROJECT`·`FLB_ENV=prod`, `OBS_LOG_S3=on`, 버킷·리전·`store_dir` 한도 — 용량 확인 전 2554 산정 약 2 GB), Nginx 컨테이너에 `gromo_json` `log_format` 과 `access_log /dev/stdout gromo_json;`.
3. `ops-monitor.dev.yml`(또는 env 렌더)에 `OBS_LOG_NGINX_HOST`·`OBS_LOG_S3*` 변수를 넘기는 경로.
4. `OBS_*`·`DD_*` 와 별개로 Datadog 컨테이너 로그 수집 제외 목록의 `gromo-promtail` → `gromo-fluent-bit`(계약 §6, 2555 소관).
