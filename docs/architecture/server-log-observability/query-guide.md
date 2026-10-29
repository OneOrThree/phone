# 서버 로그 조회 안내 (GROMO-2560)

장애 하나를 원인 키에서 기기별 발송 결과까지 따라가는 방법이다. 최근 7일은 Grafana(Loki)에서, 그보다 오래됐거나 Loki 줄 수 상한에 막히면 S3 원본을 Athena로 조회한다.

| 자료 | 위치 |
| --- | --- |
| Grafana 대시보드 `log-investigation` | [`server/observability/grafana/dashboards/log-investigation.json`](../../../server/observability/grafana/dashboards/log-investigation.json) |
| Athena 테이블·질의 템플릿 | [`server/observability/athena/`](../../../server/observability/athena/) — `create-table.sql`, `by-request.sql`, `by-operation.sql`, `by-window.sql`, `render.py` |
| 로컬 검증 하네스 | [`server/observability/log-query/local-test/`](../../../server/observability/log-query/local-test/) — `run.sh`, `check.py`, `fixture/` |

로그 필드는 [README §4](README.md#4-이벤트-스키마와-연결-규칙), 연결 규칙은 [구현 상세 §4](implementation-details.md#4-각-로그는-어떻게-join하나), S3 키는 2556 수집 런북을 따른다. Loki 라벨은 `env`·`service`·`log_kind` 셋뿐이고, ID는 `| json`으로 꺼낸 필드다. 중첩 필드 `dd.trace_id`는 `dd_trace_id`로 보인다.

## 1. Grafana 사용 순서

대시보드 상단 변수는 env·service·level과 원인 키 입력란(`request_id`, `origin`, `event_id`, `message_id`)이다. 원인 키는 입력한 것들의 합집합으로 찾는다. 비운 입력란은 아무 줄도 고르지 않는다.

| 순서 | 패널 | 하는 일 |
| --- | --- | --- |
| ① | 일반 로그 | 서비스·시간·level로 거른 로그. 옆 패널은 범위 안 줄 수다 |
| ② | 원인 키로 찾은 로그(표) | `request_id`는 `request_id`와 `origin_request_id`를, `origin`은 `origin_trace_id`·`dd_trace_id`·`trace_id`를 찾는다. `event_id`와 `message_id`는 같은 이름의 필드를 찾는다. 결과는 시간순 표로 보인다 |
| ③ | operation 목록(표) | ②의 원인 키로 걸러진 `operation.link`에서 `operation_id`·Notification `delivery_id`를 뽑는다. 행의 `operation_id`를 누르면 ④의 변수가 채워진다 |
| ④ | operation 결과(표) | 같은 `operation_id`의 모든 구성원(다른 원인의 구성원 포함, 아래 참고) 연결 로그, `transport.result`, FCM 오류 로그에 클릭한 `(delivery_id, attempt)`의 `dispatch.settle`을 더한다. Notification 코드는 `dispatch.settle`에 `operation_id`를 남기지 않아서 `delivery_id`로 찾는다. 재시도는 `delivery_id`를 유지하고 `attempt`·`operation_id`만 바뀌므로, `attempt`로 좁히지 않으면 실패한 시도를 눌러도 뒤 성공 결과가 함께 보인다 |
| ⑤ | 상한 안내·서비스별 분할 | 아래 2절 |

②·④ 표의 열 링크:

- `dd_trace_id`를 누르면 `https://$dd_site/apm/trace/<값>`(Datadog APM)이 열린다. 사이트 호스트는 변수 `dd_site`(기본 `us5.datadoghq.com`, 저장소의 `DD_SITE` 기본값)로 정한다. 조직 값은 넣지 않았다. trace ID가 10진이면 상위 64비트를 잃었을 수 있다([README §4](README.md#4-이벤트-스키마와-연결-규칙)). 이때 APM에서 찾지 못할 수 있다.
- `Time`을 누르면 `gromo-overview`가 그 줄의 시각을 중심으로 10분 범위로 열린다(`time`·`time.window` URL 인자). 대시보드 상단 링크 «Prometheus 지표»는 지금 시간 범위를 그대로 가져간다.
- `operation_id`(②·③)를 누르면 ④가 그 operation으로 채워진다(`delivery_id`·`attempt`도 함께). 다른 변수와 시간 범위는 유지된다.

Loki는 같은 `log_id`의 수집 사본을 지우지 않는다. 표에 같은 `log_id`가 두 줄 보이면 재전송 사본이다. 같은 `event_id`의 다른 단계·재시도는 `log_id`가 서로 다른 별개 로그다.

같은 operation에 다른 원인의 구성원이 있으면 ④에 그 구성원의 `operation.link`도 보인다. ④에는 SQL의 `relation`·`shared_member` 같은 구분 표시가 없다. 각 줄의 `origin_request_id`가 원래 원인이다. 결과 전체를 한 원요청의 사건으로 읽지 않는다. `dispatch.settle`은 `operation_id`가 없어 `(delivery_id, attempt)` 단위로만 고른다. 같은 attempt를 쓰는 다른 operation(다중 기기)의 settle과는 구분되지 않는다. 묶음 발송은 티켓 2421로 제거돼 지금 main 경로의 구성원은 1개다. 대시보드와 SQL은 구성원 N개를 가정한다.

## 2. 결과가 일부일 때(조회 상한)

로그 패널의 줄 상한은 1000줄이다(target `maxLines`). 각 표 옆의 줄 수 패널이 같은 필터로 `count_over_time`을 센다. 1000 이상이면 빨강이고, 이때 표는 결과 일부다.

빨강이 아니라고 결과가 완전한 것은 아니다. 줄 수 패널은 패널 상한(1000)과만 비교한다. 다음은 표시 없이 일부만 나올 수 있다(로컬 fixture로는 확인하지 못했다).

- Loki 서버의 `max_entries_limit`이 패널 상한보다 낮게 걸린 경우
- 같은 시각의 줄이 조회 방향(forward/backward)에 따라 잘려 나가는 경우

의심스러우면 시간 범위를 좁히거나 Athena로 같은 키를 조회해 줄 수를 맞춰 본다.

1. 시간 범위를 좁힌다.
2. 1초 안쪽으로 좁혀도 빨강이면 같은 timestamp에 상한보다 많은 줄이 몰린 것이다. 시간으로는 더 나눌 수 없다. Loki API로 페이지를 넘길 때도 마지막 시각에서 다시 시작하므로 같은 자리에 머문다. ⑤의 «② 서비스별 분할» 패널은 `service` 변수로 반복되고, 서비스마다 상한이 따로다.
3. 그래도 넘치거나 Loki 보관(7일) 밖이면 Athena `by-request.sql`·`by-window.sql`로 조회한다. 줄 수 상한이 없다.

## 3. Athena 조회

### 3.1 준비와 실행

```bash
cd server/observability/athena
python3 render.py create-table.sql --bucket <로그 버킷> --start-date <보관 시작일>   # 한 번. 출력 DDL을 Athena에서 실행
python3 render.py by-request.sql --env prod --from 2026-10-29T13:15:00Z --to 2026-10-29T13:30:00Z --request-id <R1>
python3 render.py by-operation.sql --env prod --from ... --to ... --operation-id <OP>
python3 render.py by-window.sql --env prod --from ... --to ... --services data-api --levels ERROR,WARN
```

`render.py`는 SQL 텍스트만 출력한다. AWS에 요청하지 않는다. 출력을 Athena 콘솔에 붙여 실행한다. ID 값은 스키마의 ID 형식(`[A-Za-z0-9_.:-]{1,128}`)만 받는다. 그래서 따옴표를 넣어 SQL을 깨뜨릴 수 없다. 원인 키는 `--request-id`·`--trace`·`--event-id`·`--message-id` 중 하나 이상 필요하다. 테이블 이름은 `ops_logs`, 파티션 열은 `env`·`service`·`archive_date`·`archive_hour`다(S3 키의 `date=`·`hour=`).

### 3.2 파티션을 먼저 제한하는 이유

Athena는 읽은 바이트만큼 비용을 받는다. 파티션 조건이 없으면 보관된 객체 전체를 읽는다. 그래서 모든 템플릿이 가장 안쪽 스캔에서 `env`·`service`·`archive_date`·`archive_hour`를 먼저 제한한다. 그 뒤에 본문 시각으로 최종 필터링한다.

객체 시간 파티션은 레코드 발생 시각이 아니다. **객체 첫 레코드의 event time(UTC)**이다. 수집기가 밀린 로그를 한꺼번에 읽으면 한 객체에 다른 시각 레코드가 섞인다. 레코드는 앞 시간 객체에도 뒤 시간 객체에도 들어갈 수 있다(2556 시험 k: 3시간 전 레코드가 첫 레코드인 객체에 5분 전 레코드가 함께 들어가 `hour=03`). 그래서 `render.py`는 조회 범위 앞뒤로 `--margin-hours`(기본 1)만큼 시간 파티션을 넓힌다. 기본값을 1로 둔 이유는 비용이다. 여유가 한 시간 늘 때마다 읽는 바이트가 그만큼 는다.

**수집기 재시작·S3 장애가 있던 구간이면 `--margin-hours`를 장애 길이 이상으로 올린다.** 재시작 뒤 복구 파일은 키의 hour가 복구 시각이고, 안의 레코드는 장애 이전 시각이다. 기본 여유 1시간으로는 놓칠 수 있고, 놓치면 조용히 빈 결과가 나온다. 결과가 0행이면 «없다»로 읽지 말고 여유를 넓혀 다시 조회한다. 지연 상한을 모르면 보관 기간 전체로 넓혀야 빠짐이 없다. `render.py`는 실제로 쓴 파티션 범위(env·service·date·hour)를 출력 SQL의 첫 주석 줄에 적는다. 결과가 이상하면 그 줄로 어디까지 봤는지 먼저 확인한다. 로컬 fixture에서 여유를 0으로 두면 R1의 15개 결과 행 중 10개(12시·14시 객체에 든 줄)를 놓쳤다(5절).

raw 줄(`parse_error=true`)에는 `timestamp`가 없다. 질의는 `observed_at`으로 시각을 대신한다.

### 3.3 `log_id` 중복 제거와 null `log_id` 보존

같은 `log_id`는 같은 로그 한 건의 수집 재전송 사본이다. `row_number() OVER (PARTITION BY log_id ORDER BY observed_at, "$path")`로 가장 먼저 수집된 사본 하나만 남기고, `copies` 열에 사본 수를 적는다.

`log_id`가 없는 줄은 지우지 않는다. raw 줄과 `log_id` 없이 나온 구형 줄은 같은 로그인지 판정할 키가 없다. 내용이 같다고 지우면 정상적으로 반복된 다른 로그까지 사라진다. 그래서 `log_id IS NULL` 행은 `UNION ALL`로 전부 남긴다. 재수집으로 생긴 사본도 남으므로 그런 행은 2벌 이상 보일 수 있다.

### 3.4 결과 열 읽기

| 열 | 뜻 |
| --- | --- |
| `relation` | `direct` = 원인 키로 직접 찾은 줄. `operation` = 직접 찾은 `operation.link`의 `operation_id`로 한 번 더 찾은 줄(semijoin. 행끼리 곱하지 않는다) |
| `shared_member` | `operation`으로만 들어온 `operation.link`. 같은 발송을 함께 쓴 **다른 원인의 구성원**이다. 그 줄의 `origin_request_id`가 그 구성원의 원인이다 |
| `operation_members` | 결과 안에서 그 operation의 `operation.link` 수. 2 이상이면 공유 발송이다 |
| `arrival_lag_s`, `late_arrival` | `observed_at − timestamp`(초)와 그 값이 `--late-seconds`(기본 300, **경험적 기본값이며 근거 측정은 없다**)를 넘는지. **늦은 도착**은 발생 시각이 맞다. 시간순 정렬을 그대로 믿고, 다른 시간 객체에 들어 있을 수 있다는 뜻으로 읽는다. `observed_at`은 초 단위라 1초 안쪽 차이는 의미가 없다 |
| `other_hour_object` | 줄이 자기 발생 시각과 다른 시간 파티션 객체에 들어 있었는지. 여유 파티션 덕에 찾은 줄이다 |
| `skew_ms`, `skew_status`, `clock_skew_suspect` | 같은 `event_id`의 data-api `outbox.delivery` 중 가장 이른 줄과 비교한 data-api 밖 줄의 시각 차이다. `--skew-ms`(기본 1000, **경험적 기본값이며 근거 측정은 없다**)보다 더 앞서면 **시계 차이 의심**(`skew_status=suspect`)이다. 비교했고 허용 안이면 `ok`다. **결과에 `outbox.delivery` 줄이 없으면 `unknown`(판정 불가)이고 `skew_ms`·`clock_skew_suspect`는 NULL이다. «의심 없음»이 아니다.** `event_id`가 없거나 data-api 줄이면 모두 NULL(대상 아님)이다. 이 줄은 서비스 간 시각 순서를 믿지 말고 단계 순서(`outbox.delivery` → `consumer.accept` → `operation.link` → `transport.result` → `dispatch.settle`)로 읽는다 |

시계 차이 판정의 한계:

- `outbox.delivery`는 브로커 ack 뒤에 남는다. 소비 쪽 줄이 ack 지연만큼 앞설 수 있다. 허용 오차 안쪽 음수(로컬 fixture f04는 −20ms)는 정상이다.
- 생산 쪽 줄이 결과 안에 있을 때만 계산한다. `--request-id`만 주거나 `--services`에서 data-api를 뺐으면 `unknown`이 나온다. 생산자 `outbox.delivery`가 조회 구간(`--from`) 밖에 있어도 `unknown`이다. `--event-id`를 주거나 서비스·구간을 넓혀 다시 조회한다.
- 시계 차이로 거를 때는 `clock_skew_suspect = false`가 아니라 `skew_status`로 건다. NULL은 3값 논리라 `clock_skew_suspect = false`는 `unknown` 행을 조용히 뺀다.
- 채팅(`message_id`)에는 생산 기준 줄이 없어 계산하지 않는다.

## 4. 로컬 검증 방법

`server/observability/log-query/local-test/run.sh`가 Loki 3.3.2·Grafana 11.4.0(dev와 같은 이미지·설정)과 Trino 476을 띄운다. 모든 컨테이너는 `internal` 네트워크에만 붙어 밖으로 나가지 못한다. 호스트 포트도 열지 않는다. 끝나면 `down -v`로 정리한다.

- fixture: [`fixture/records.jsonl`](../../../server/observability/log-query/local-test/fixture/records.jsonl) 30행에 `check.py`가 만드는 같은 시각 1200행(`req-bulk`)을 더한다. 내용은 원요청 2개(R1·R2), 같은 `log_id` 재수집 사본, `log_id` 없는 구형 줄 2벌, raw 줄 2벌, 무관 요청(R3·접두가 같은 R10), 늦은 도착 줄, 시계가 5초 느린 Realtime 호스트, 구성원 2개(R1·R2)의 operation이다. 기대 집합은 [`fixture/expected.json`](../../../server/observability/log-query/local-test/fixture/expected.json)에 있다.
- S3: fixture를 2556 키 레이아웃 그대로 gzip JSONL 객체로 쓴다. 객체 시간 파티션은 첫 레코드 시각이다(12시·13시·14시 객체).
- Loki: Fluent Bit Loki 출력과 같은 모양(라벨 3개, 나머지 JSON 줄)으로 push한다. 대시보드 JSON에서 패널 LogQL을 그대로 꺼내 변수만 치환해 실행한다.
- Grafana: 프로비저닝한 대시보드 4개가 API로 열리는지 본다. ② LogQL이 Grafana 백엔드(`/api/ds/query`)로도 같은 줄 수를 내는지 본다.
- SQL: `create-table.sql`의 열 목록·위치 템플릿·투영 값으로 Trino 테이블을 만든다. `render.py`로 채운 `by-*.sql`을 그대로 실행한다.

## 5. 로컬 검증 결과 (2026-10-29, 1회 실행)

`run.sh` 종료 코드 0, 실패 0건. Grafana 프로비저닝 오류 로그 없음.

| 시험 | 기대 = 실제 |
| --- | --- |
| Loki ② `request_id=req-r1` | 12줄(f03 사본 2·f10 2벌 포함). 줄 수 패널 12 |
| Loki ② `req-r2` / `origin=T1` / `event_id=evt-e1` / `message_id=msg-m1` | 6 / 10 / 7 / 2줄. 각 줄 수 패널 값과 같음 |
| Loki ② 원인 키 없음 | 0줄 |
| Loki ① `service=data-api` / `level=ERROR` | 612줄(bulk 600 포함) / 1줄 |
| Loki ③ `req-r1` / `req-r2` / `evt-e3` | `(op-1, nt-del-1)` / `(op-1, nt-del-2)` / `(op-2, nt-del-3)` |
| Loki ④ `op-1` + `nt-del-1` / + `nt-del-2` | 5줄씩(두 구성원 연결·transport.result·FCM 오류 + 그 구성원의 settle) |
| Loki ④ `op-3` + `nt-del-1` + `attempt 2` (같은 delivery 재시도) | 3줄(연결·transport.result·attempt 2 의 settle). attempt 1 의 settle 은 섞이지 않는다. `attempt` 를 비우면 settle 은 나오지 않는다 |
| 상한: 같은 시각 1200줄 | 표 1000줄, 줄 수 패널 1200(빨강 기준 1000). 1ms 창으로 좁혀도 1000줄. 서비스별 분할 data-api 600·notification 600 |
| Grafana | 대시보드 4개 로드. `/api/ds/query` ② R1 10줄. 프레임 필드 `labels, Time, Line, tsNs, labelTypes, id` |
| Trino 테이블 | 데이터 열 37, 파티션 7, 행 1236(깨진 JSON 줄 시험용 canary 객체 포함) |
| SQL `by-request req-r1` | 15행: f03 1벌(`copies=2`), f10 2벌(`log_id` null), g05 `shared_member=true`, `operation_members=2`, f09 `late_arrival`·`other_hour_object`, f04 `skew_ms=-20`·`skew_status=ok` |
| SQL `by-request req-r1 --margin-hours 0` | 5행(12시·14시 객체의 10행 누락) |
| SQL `by-request req-r2` | 9행: g04·g04b `skew_ms` −5000·−4900 `skew_status=suspect`·`clock_skew_suspect=true`, f05 `shared_member=true` |
| SQL `by-request event_id=evt-e1 --services notification` | 9행. 결과에 `outbox.delivery`가 없어 f04·g05는 `skew_status=unknown`, `clock_skew_suspect`는 NULL |
| SQL `trace=T1` / `evt-e1` / `msg-m1` / `req-bulk` | 13 / 10 / 2 / 1200행 |
| SQL `by-operation op-1` | 6행(구성원 연결 2·transport.result·FCM 오류·settle 2) |
| SQL `by-window data-api` / `--levels ERROR` | 610행(f03 1벌·x01 2벌·bulk 600) / 1행 |

검사가 실제로 실패하는지 변형본으로 확인했다. 5가지를 일부러 망가뜨린 복사본(null 보존 `UNION ALL` 제거, 시계 차이 부호 반전, `by-window` 중복 제거 제거, `by-operation` settle 조건 제거, ② 패널의 `request_id` 빈 값 방어 제거)을 실행했다. 실패 15건이 나왔고 종료 코드는 1이었다.

## 6. 로컬(Trino)과 Athena의 차이

| 항목 | 로컬 | Athena | 영향 |
| --- | --- | --- | --- |
| DDL | 같은 열 목록을 Trino DDL로 옮김(`format = 'OPENX_JSON'`, `string→varchar`, `int→integer`, `struct→row`) | `create-table.sql` 원문(Hive DDL, `org.openx.data.jsonserde.JsonSerDe`) | Hive DDL 문법 자체는 로컬에서 실행하지 않았다 |
| 파티션 | `system.register_partition`으로 있는 객체 디렉터리만 등록. 위치는 DDL의 `storage.location.template`으로 만들고 값이 투영 enum 안인지 확인 | partition projection(enum·date 범위·템플릿) | 투영의 날짜 범위(`start_date,NOW`)와 `archive_date IN … AND (… OR …)` 조건의 가지치기는 실행하지 않았다 |
| 저장소·카탈로그 | 로컬 파일시스템(`local://`), 파일 메타스토어 | S3, Glue Data Catalog | `"$path"` 값의 접두가 다르다(`local:///…` / `s3://…`) |
| 엔진 | Trino 476 | Athena 엔진 v3(Trino 기반, AWS 버전) | 쓴 함수: `from_iso8601_timestamp`, `try`, `coalesce`, `row_number`·`count`·`min`·`sum` 윈도, `date_diff`, `format_datetime`, `AT TIME ZONE`, `IS NOT DISTINCT FROM`, 상관 `EXISTS`, `IN (subquery)`, `"$path"`. Athena에서 같은 결과인지는 실행하지 않았다 |
| JSON SerDe | Trino의 OpenX JSON 구현. `create-table.sql`의 `SERDEPROPERTIES`는 Trino `extra_properties`로 옮겨 같은 옵션(`ignore.malformed.json`)을 읽게 했다 | OpenX JSON SerDe | 반영됨: 깨진 JSON 줄이 든 객체를 조회해도 실패하지 않고 그 줄은 전부 NULL인 행이 된다(옵션 없이는 질의가 실패함을 탐침으로 확인). 차이: Trino가 옵션을 읽는 경로가 Athena의 SerDe와 같은지는 모른다. 타입이 다른 값(예: `attempt`가 문자열)의 동작은 시험하지 않았다. 깨지거나 잘린 gzip은 이 옵션과 무관하게 객체 단위로 실패할 수 있다. `extra_properties`가 Athena SerDe와 같은 키 이름을 읽는다는 가정은 탐침으로만 확인했다. 이 옵션으로 생긴 전부 NULL 행은 템플릿의 `event_time` 필터에서 조용히 빠지므로, 결과만 봐서는 «건너뛴 줄이 있었다»를 알 수 없다. 실제 Athena에서 조용히 NULL이 될 수 있어 첫 실조회 때 NULL 비율을 본다([전환 절차 §4](rollout.md#4-전환-판정-지표와-확인-쿼리)) |
| Loki 적재 | API push. 줄 모양은 Fluent Bit Loki 출력을 흉내 냈다. Loki 시각 = 레코드 `timestamp`(raw는 `observed_at`) | Fluent Bit이 Docker 시각으로 적재 | 실제 수집 경로는 2555·2556 하네스가 검증한다 |

## 7. 실행하지 않은 것

- 실제 Athena·Glue·S3 조회. AWS 요청 금지(사용자 지시 2026-10-29)라 테이블 생성·질의·스캔 바이트·비용을 측정하지 않았다.
- dev Grafana 반영. 배포 게이트이고 dev Loki는 현재 가동하지 않는다.
- 브라우저 화면. API로 대시보드 로드와 백엔드 질의까지만 봤다. 표 변환(`extractFields`·`organize`·`labelsToFields`·`merge`), 데이터 링크 클릭, `time`·`time.window` URL 인자, 반복 패널 렌더링은 화면에서 확인하지 않았다.
- Datadog APM URL. 10진 또는 32자리 hex trace ID로 실제 trace가 열리는지 확인하지 않았다.
- 실제 서비스가 낸 로그. fixture는 코드의 로그 지점(`DispatchService`·`InboundTrace`·`OutboxRelayService`·Realtime `LogContext`)을 따라 손으로 만든 것이다.
