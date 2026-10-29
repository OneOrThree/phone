# Datadog 로그 심각도 파이프라인 — Kafka Exporter·PostgreSQL (GROMO-2572)

> 작성: 2026-10-29. 상태: **정의·fixture·운영 스크립트 완성, 로컬 근사 검증 통과.**
> **Datadog 원격 validation·apply 는 수행하지 않았다(미적용).** Datadog Agent 가 정지된 상태라 적용 후 신규 유입도 검증할 수 없다.
> Python 정규식 근사 검증은 Datadog Grok 실행 결과가 아니다.

## 1. 문제

[검증 보고서](datadog-log-level-verification-2026-10-29.md)에서 확인한 내용이다. Kafka Exporter 의 정상 `I` 줄과 PostgreSQL checkpoint `LOG` 줄은 Docker `stderr` 로 나온다. 그래서 Datadog 이 수집 시 `status=error` 로 분류한다.
두 source 에 맞는 파이프라인이 없어 심각도가 보정되지 않는다. 같은 날 실제 Exporter `E` 2건과 `F` 20건도 있었다. 따라서 로그를 통째로 info 로 내리거나 제외하면 안 된다.

## 2. 파일

| 파일 | 역할 |
| --- | --- |
| [`kafka-exporter.json`](../../../server/observability/datadog/pipelines/kafka-exporter.json) | Logs Pipelines API 생성 본문. filter `source:kafka-exporter` |
| [`postgres.json`](../../../server/observability/datadog/pipelines/postgres.json) | 생성 본문. filter `source:(postgres OR postgresql)` |
| [`fixtures/kafka-exporter.jsonl`](../../../server/observability/datadog/pipelines/fixtures/kafka-exporter.jsonl), [`fixtures/postgres.jsonl`](../../../server/observability/datadog/pipelines/fixtures/postgres.jsonl) | 줄별 원래 status·기대 status. `origin` 은 `docker-real`(증거 원문) 또는 `synthetic`(합성) |
| [`test_pipelines.py`](../../../server/observability/datadog/pipelines/test_pipelines.py) | stdlib unittest. JSON 의 grok 규칙과 lookup 표를 읽어 **근사** 실행한다. 외부 연결은 없다 |
| [`manage.py`](../../../server/observability/datadog/pipelines/manage.py) | `backup`·`plan`·`apply`·`rollback`. 기본은 dry-run 이며 stdlib `urllib` 만 쓴다 |

## 3. 처리 흐름

두 파이프라인 모두 프로세서 3개를 이 순서로 둔다.

1. **Grok Parser**(`source: message`): 머리 형식이 맞는 줄에서만 원문 레벨을 속성으로 뽑는다.
2. **Lookup Processor**: 원문 레벨을 Status Remapper 가 정확히 해석하는 단어로 바꾼다. **`default_lookup` 은 두지 않는다.**
3. **Status Remapper**: lookup 결과 속성 하나만 source 로 쓴다.

원문 레벨을 Status Remapper 에 바로 넘기지 않는 이유가 있다. 문서 규칙에서 `E` 는 `err` 로 시작하지 않아 info 가 된다. `F`·`FATAL` 은 `f` 로 시작해 emerg 가 되고, `PANIC` 은 어느 규칙에도 맞지 않아 info 가 된다(§12 근거 3).

날짜 remapper 는 두지 않는다. glog 머리에는 연도가 없다. Docker 수집 시각이 이미 공식 시각이다.

## 4. 매핑 표

### Kafka Exporter (klog — glog 형식)

`danielqsj/kafka-exporter:v1.8.0` 은 `k8s.io/klog/v2 v2.130.1` 을 쓴다. 머리 형식은 `Lmmdd hh:mm:ss.uuuuuu threadid file:line] msg` 이다(§12 근거 9).

| 원문 `glog.level` | lookup → `glog.severity` | 최종 status | 원문을 그대로 넘겼다면 |
| --- | --- | --- | --- |
| `I` | `info` | info | info |
| `W` | `warning` | warning | warning |
| `E` | `error` | error | **info (하향)** |
| `F` | `critical` | critical | emerg |
| 그 밖 / 머리 없음 | 속성 없음 | **수집 status 유지** | — |

`F` 는 klog `Fatal`·`Exit` 계열이다. 로그를 남긴 뒤 프로세스를 끝낸다. 한 프로세스 종료이므로 emerg 대신 critical 로 둔다.

### PostgreSQL

| 원문 `postgresql.level` | lookup → `postgresql.severity` | 최종 status | 원문을 그대로 넘겼다면 |
| --- | --- | --- | --- |
| `DEBUG1`~`DEBUG5` | `debug` | debug | debug |
| `LOG`, `INFO` | `info` | info | info |
| `NOTICE` | `notice` | notice | notice |
| `WARNING` | `warning` | warning | warning |
| `ERROR` | `error` | error | error |
| `FATAL` | `critical` | critical | emerg |
| `PANIC` | `emergency` | emerg | **info (하향)** |
| `DETAIL`·`HINT`·`STATEMENT`·`CONTEXT`·`QUERY`·`LOCATION`·그 밖 | 표에 없음 → 속성 없음 | **수집 status 유지** | — |
| 접두 없는 줄(연속 줄·entrypoint 출력) | grok 불일치 → 속성 없음 | **수집 status 유지** | — |

PostgreSQL 의 syslog 대응표는 ERROR→WARNING, FATAL→ERR, PANIC→CRIT 로 한 단계씩 낮다(§12 근거 10). 여기서는 따르지 않는다. 기존 `status:error` 조회·모니터가 ERROR 를 계속 잡아야 하기 때문이다. FATAL 은 세션 하나, PANIC 은 모든 세션을 중단시킨다. 그래서 FATAL 은 critical, PANIC 은 emergency 로 ERROR 보다 위에 둔다.

## 5. 미인식·multiline 정책

- 머리 형식이 맞지 않는 줄은 grok 이 속성을 만들지 않는다. lookup 표에 없는 레벨도 target 이 생기지 않는다. 결과적으로 Status Remapper 가 적용되지 않아 **수집 시 status 가 그대로 남는다**(stderr → error, stdout → info).
  - 이유: 이런 줄은 오류 맥락인 경우가 많다. 예를 들어 Exporter `E` 뒤의 go-multierror 항목(`\t* dial tcp …`), klog `F` 뒤의 goroutine 스택, PostgreSQL ERROR·FATAL 뒤의 `DETAIL`·`STATEMENT` 가 있다. 무조건 info 로 내리면 오류 맥락이 사라진다.
  - 비용: 정상 줄 뒤의 맥락 줄은 error 로 남는다(예: `LOG` 뒤의 `DETAIL`). 줄 단위 처리에는 앞 줄 상태가 없으므로 남는 오탐이다.
- 근본 대책은 Agent 쪽 multi_line 규칙이다. PostgreSQL integration 문서에 날짜 시작 패턴 예가 있다(§12 근거 8). Agent 설정 변경과 재시작이 필요하므로 이번 범위에서는 **하지 않았다**(후속 후보).
- PostgreSQL `lc_messages` 가 영어가 아니면 레벨 단어가 번역되어 lookup 에 맞지 않는다. 이 경우에도 status 는 유지된다. 현재 dev 원문은 영어(`LOG`)다.
- `log_line_prefix` 를 기본값 `'%m [%p] '` 에서 바꾸면 grok 이 맞지 않는다. 이 경우에도 status 는 유지된다. 접두를 바꿀 때는 규칙을 함께 고친다.

## 6. 필터와 이유

- **`source:kafka-exporter`**: Exporter 컨테이너에는 `com.datadoghq.ad.logs` 라벨이 없다. 그래서 Agent 기본값인 short image 이름이 source 가 된다(§12 근거 7). 증거의 실제 태그도 `source:kafka-exporter`, `short_image:kafka-exporter` 다. 기존 `Kafka` integration 파이프라인(`source:kafka`)은 브로커 로그용이고 이 값과 다르다.
- **`source:(postgres OR postgresql)`**: 현재 `phone-db` 의 실제 source 는 short image 기본값인 `postgres` 다. 공식 integration 의 source 는 `postgresql` 이다(§12 근거 8). 나중에 라벨로 source 를 `postgresql` 로 바꿔도 계속 처리하도록 두 값을 함께 둔다. 문법은 검색 문서의 `env:(prod OR test)` 형식을 따랐다(§12 근거 6).
- `service`·`container_name` 은 필터에 넣지 않는다. Exporter 와 브로커가 같은 service(`gromo-kafka-dev`)를 쓰고, 컨테이너 이름은 환경마다 다를 수 있다.
- source 값은 compose 라벨이 아니라 Agent 기본값(이미지 short name)이다. 이미지가 바뀌면 이 파이프라인 필터와 대시보드 Kafka 로그 링크(`kafka-log-links.md`)를 함께 점검한다.

## 7. 파이프라인 순서

증거 시점의 파이프라인은 아래 5개다. 모두 `isReadOnly=true` 인 integration 파이프라인이다.

| 순서 | 이름 | 필터 | 겹침 |
| ---: | --- | --- | --- |
| 1 | Nginx | `source:nginx` | 없음 |
| 2 | AWS CloudTrail | `source:cloudtrail` | 없음 |
| 3 | Java | `source:java` | 없음 |
| 4 | Kafka | `source:kafka` | 없음 (`kafka-exporter` 와 다른 값) |
| 5 | Redis | `source:redis` | 없음 |

- 지금은 겹치는 필터가 없다(`manage.py plan` 결과 「겹침 없음」). 따라서 새 파이프라인의 위치가 결과에 영향을 주지 않는다. `manage.py` 는 pipeline-order 를 바꾸지 않는다.
- Status Remapper 는 **처음 만난 것 하나만 적용된다.** 같은 파이프라인 안에서도, 매칭되는 여러 파이프라인 사이에서도 마찬가지다(§12 근거 3·5).
- **이중 처리 위험**: DB source 를 `postgresql` 로 바꾸면 공식 PostgreSQL integration 파이프라인이 자동 설치된다(§12 근거 5·7). 그러면 두 파이프라인이 같은 로그를 처리한다. grok·lookup 속성은 양쪽에서 붙고(last write wins), status 는 순서상 먼저인 쪽이 정한다. 그때는 다음 중 하나를 고른다.
  1. integration 파이프라인을 비활성화한다(삭제는 불가, §12 근거 5).
  2. 이 파이프라인을 integration 앞으로 옮긴다.
  3. 이 필터를 `source:postgres` 로 좁힌다.
- 생성된 파이프라인이 목록의 어디에 놓이는지는 문서에서 확인하지 못했다(**미확인**). `apply --execute` 가 적용 후 순서를 다시 조회해 기록에 남긴다.
- Auto-Processing(Preview)은 기존 파이프라인 필터에 맞는 로그를 처리하지 않는다(§12 근거 5). 이 조직에서 Auto-Processing 이 켜져 있는지는 확인하지 않았다.

## 8. 적용 절차 (사람이 실행 — 이번 작업에서는 미실행)

필요한 것: `logs_write_pipelines` 권한이 있는 Application key(§12 근거 4). 조직의 Datadog MCP 는 write 권한이 꺼져 있다. 키 값은 셸 환경변수로만 넘기고 파일·로그에 남기지 않는다.

```bash
cd server/observability/datadog/pipelines
export DD_SITE=us5.datadoghq.com   # 공식 사이트 목록(datadoghq.com·us3/us5/ap1/ap2/uk1.datadoghq.com·datadoghq.eu·ddog-gov.com·us2.ddog-gov.com)만 허용. DD_API_KEY·DD_APP_KEY 는 별도로 export
# 1) 백업 (읽기)
python3 manage.py backup --out /안전한/경로/dd-pipelines-backup-$(date +%Y%m%dT%H%M%S).json
# 2) 계획 (읽기, 네트워크 없음)
python3 manage.py plan --backup-file <백업>
# 3) 리뷰: 동작이 create 2건인지, 겹침이 '없음'인지, 정의 diff·이 문서 §4 표를 확인. 첫 --execute 전 plan 이 update 로 낸 항목은 실제 응답과 로컬 정의의 차이 키를 확인해, 목록 밖 기본값이면 SERVER_DEFAULTS 에 더한다
# 4) 적용 (쓰기 — 이중 확인). GROMO_DD_PIPELINE_APPLY=yes 는 export 하지 말고 이 명령 앞에 한 번만 붙인다
GROMO_DD_PIPELINE_APPLY=yes python3 manage.py apply --execute --record-out /안전한/경로/dd-apply-record.json
```

5. Datadog UI 의 각 grok parser 샘플 미리보기를 확인한다. sample 5개 중 마지막 하나(Exporter 의 `\t* dial tcp …`)는 **No Match** 가 정상이다. PostgreSQL 의 `DETAIL` 샘플은 Match 이지만 lookup 표에 없다. 그 밖의 결과가 다르면 바로 롤백한다.
6. **dev 유입 확인**: Agent 가 정상 운영 상태로 돌아온 뒤 §11 의 쿼리를 적용 시각 이후 범위로 실행한다.
7. **판정**: 아래 조건이 모두 맞으면 완료로 본다. 하나라도 어긋나면 롤백한다.
   - Exporter `I` 줄과 PG `LOG` 줄의 error 가 0건이다.
   - 실제 `E`/`F`·`ERROR`/`FATAL`/`PANIC` 이 info 이하로 내려가지 않았다.
   - 속성이 없는 줄은 수집 status 를 유지했다.

`plan` 은 현재 정의와 로컬 정의를 필드 단위로 비교하되, `manage.py` 의 `SERVER_DEFAULTS`(`description`="" · `samples`=[] · `support_rules`="" · `default_lookup`=null, API 문서 기준이고 실제 응답 캡처로 확인한 값은 아님)에 적힌 필드의 그 값(`default_lookup` 의 null 포함)만 «없음»으로 보고, 목록 밖 필드의 null 이나 `is_enabled` 같은 값은 무시하지 않는다(GROMO-2586, 테스트 `ServerDefaultsComparisonTest`). 목록에 없는 기본값을 서버가 채우면 내용이 같아도 `update` 로 표시될 수 있고, 그때 PUT 은 같은 정의로 교체하므로 결과는 같다. `DD_SITE` 허용 목록은 Datadog 사이트 문서(https://docs.datadoghq.com/getting_started/site/, 2026-10-29 확인)의 Site Parameter 이며, 새 사이트가 생기면 `manage.py` 의 `SITES` 에 추가한다.

## 9. 롤백

```bash
python3 manage.py rollback --record /안전한/경로/dd-apply-record.json                 # dry-run
GROMO_DD_PIPELINE_APPLY=yes python3 manage.py rollback --record … --execute         # 생성분 DELETE, 갱신분 이전 정의 PUT
GROMO_DD_PIPELINE_APPLY=yes python3 manage.py rollback --record … --execute --disable-only   # 삭제 대신 is_enabled=false
```

- 순서 복원은 다음과 같이 계산한다. 기록의 `order_before` 순서를 기준으로 지금 남아 있는 ID 만 배치하고, 백업 이후 생긴 ID 는 뒤에 붙인다. 현재 순서와 다를 때만 `PUT pipeline-order` 를 보낸다. 이 API 는 전체 순서를 교체한다(§12 근거 4).
- dry-run 으로 만든 기록(`"dry_run": true`)으로는 `--execute` 를 할 수 없다.
- **부분 적용**: `apply --execute` 는 쓰기(생성·갱신·순서 조회) 하나가 성공할 때마다 `--record-out` 파일을 임시 파일 후 rename 으로 갱신한다. 중간에 실패하면 지금까지의 기록(`steps` 의 ok/failed/not-run, 생성된 ID, 갱신 전 원본, `order_before`)을 남기고 0 이 아닌 코드로 끝나며 «부분 적용 — `rollback --record <파일>`» 을 출력한다. 자동으로 되돌리지 않는다. 사람이 상태를 확인한 뒤 같은 기록으로 `rollback` 하면 성공한 단계만 되돌린다.
- **실패 종류별 안내**: 아무것도 바뀌지 않은 실패(`created`·`updated` 비어 있음)는 «변경 없음 — 롤백 불필요», 일부가 반영된 실패만 «부분 적용 — rollback». 쓰기 요청이 응답 없이 끝나면(타임아웃·연결 끊김) 단계를 `unknown` 으로 기록하고 «서버 상태를 직접 조회해 같은 이름 파이프라인이 있는지 확인»하라고 안내한다. `apply` 는 POST **전에** `created` 에 `{name, id: null, pending: true}` 를 저장한다. 성공하면 id 를 채우고 pending 을 지우며, 확실한 실패(HTTP 4xx)면 항목을 뺀다. 쓰기의 5xx(502·503·504 등)는 게이트웨이가 서버 처리 뒤에도 낼 수 있어 결과 불명으로 취급한다. 결과 불명이면 pending 이 남는다. `rollback` 은 id 없는 pending 항목을 목록 GET 으로 **같은 이름**을 찾아 회수한다. 정확히 1개이고 read-only 가 아니며 정의가 로컬과 같을 때만 삭제(서버 기본값 채움 등으로 정의가 달라 중단되면 직접 삭제한다)(`--disable-only` 면 비활성)한다. 0개면 «생성 안 됨 — 건너뜀», 2개 이상이거나 정의가 다르면 그 항목을 중단·보고한다. dry-run 도 회수 계획을 출력한다. 같은 이름이 있으면 같은 `apply` 를 다시 실행해도 `plan_actions` 가 `update`(정의가 같으면 `noop`)로 처리하므로 중복 생성되지 않는다. 이때 `--previous-record <이전 기록>` 을 주면 «이전 기록의 결과 불명 생성 — 그 기록으로 rollback 가능» 을 안내하고 새 기록에 경로를 남긴다. noop 이어도 첫 파이프라인은 그 이전 기록으로 롤백해야 회수된다.
- **갱신 결과 불명**: `apply` 는 PUT **전에** `updated` 에 `{id, name, previous}` 를 기록하고 저장한다. PUT 이 서버에 반영된 뒤 응답만 유실돼도(`unknown`) 항목이 남아 롤백이 이전 정의로 복원한다. 확실한 실패(HTTP 4xx)면 서버가 그대로이므로 항목을 뺀다. `rollback --execute` 는 updated 항목을 GET 해 이미 `previous` 와 같으면 건너뛰고(`already-previous`, 재실행 멱등) 다르면 `previous` 로 PUT 한다. GET 이 404 면 «복원 대상 없음» 경고를 출력한다.
- **동명 중복**: 로컬 정의와 같은 이름의 서버 파이프라인이 2개 이상이면 어느 쪽을 갱신할지 알 수 없다. `plan` 은 «동명 중복 — 중단» 을 출력하고 비정상 종료하며, `apply` 는 쓰기 전에 중단하고 `--record-out` 에 `aborted` 사유만 남긴다. 필터 겹침 경고는 이번에 갱신할 그 ID 하나만 빼고 같은 이름의 다른 파이프라인도 보여 준다.
- **중단 기록**: `aborted` 가 있는 기록(쓰기 전 중단)으로 `rollback` 하면 «중단 기록 — 되돌릴 것 없음» 을 출력하고 종료 코드 0 으로 끝난다. 서버 조회도 하지 않는다(GROMO-2586, 테스트 `AbortedRecordRollbackTest`).
- 롤백 모드(삭제/비활성)를 바꾸려면 기록 파일을 복사해서 쓴다(`rollback` 필드의 완료 표시가 id 기준이라 같은 기록으로 모드를 바꾸면 건너뛴다).
- 순서 복원 PUT 은 직전에 조회한 순서를 기준으로 전체를 덮어쓴다. 그 사이 다른 사람이 순서를 바꿨다면 덮어쓴다.
- **롤백 안전장치**: `--execute` 는 각 ID 를 먼저 GET 해 이름이 기록과 같은지 확인한다. 다르면 그 항목은 건드리지 않고 순서 복원 없이 비정상 종료한다(나머지 항목은 계속 진행). 404 는 «이미 없음»으로 건너뛴다. 항목마다 끝난 결과를 같은 기록 파일의 `rollback` 필드에 저장하므로, 중간에 실패해도 같은 명령을 다시 실행하면 끝난 항목은 건너뛰고 이어간다. dry-run 도 이 GET 확인을 계획으로 출력한다. `order-after` 조회만 실패했다면 생성·갱신은 이미 반영된 상태이므로 롤백 여부를 §8 판정 기준으로 정한다.

## 10. 검증 범위

| 항목 | 결과 |
| --- | --- |
| 로컬 근사 검증 `python3 -m unittest discover -s server/observability/datadog/pipelines -p 'test_*.py'` | **통과** 46 tests(중단 기록 rollback·aborted 경계·서버 기본값 비교 포함, 동명 중복 중단·겹침 경고 쓰기 5xx 결과 불명·부분 적용 기록·응답 없음 `unknown`·POST 응답 유실 pending 회수(이름 1개/2개/정의 불일치/0개)·갱신 PUT 응답 유실 뒤 `previous` 복원·롤백 재실행/404/이름 불일치·`DD_SITE` 거절 포함). fixture 28줄(실로그 7, 합성 21) 전부 기대 status 와 일치 |
| 근사 변환기 자체 점검 | 문서의 glog 예(`W0424 … authorization.go:47] …`)를 같은 결과로 해석한다. 모르는 matcher·filter 는 실패한다 |
| 고장 주입 | 원문 레벨 직결, `default_lookup: info`, `FATAL` 원문 매핑, 모르는 matcher 각각에서 테스트 실패를 확인했다 |
| `manage.py` | 증거의 `pipelines-result.json`·`pipeline-order-result.json` 으로 `plan`·`apply` dry-run·`rollback` dry-run 을 오프라인 실행했다. create 2건, 겹침 없음, 롤백 DELETE 2건, 순서 PUT 없음 |
| 가정 의존 단언 | `default_lookup` 생략 시 target 미생성, source 속성 부재 시 remapper 무동작은 문서에 명시 문장이 없는 가정이다. 이에 기대는 테스트(이름에 «assumption_dependent» 표기)의 통과는 Datadog 동작의 증거가 아니다 |
| Datadog Grok 실행(UI 샘플 미리보기 포함) | **미수행** |
| Datadog 원격 validation | **미수행.** MCP SDK 카탈로그의 `LogsPipelinesApi` 에는 get·list·order 조회만 있다(증거 `sdk-grok-validation-result.json`). v2 `ObservabilityPipelinesApi.validatePipeline` 은 다른 제품이라 대체로 쓰지 않았다 |
| apply | **미수행(미적용)** |
| 적용 후 신규 유입 | **검증 불가.** `gromo-datadog-agent` 가 2026-10-29 18:43:21 KST 에 종료된 상태다(보고서 §5). 이번 작업은 Agent·앱·컨테이너를 시작·재시작하지 않는다 |

## 11. Agent 재개 뒤 확인할 쿼리 (읽기 전용)

범위는 적용 시각 이후, `host:gromo-dev` 다. 속성 검색에 facet 은 필요 없다(§12 근거 6). 쿼리마다 status 별로 집계한다.

| 쿼리 | 기대 |
| --- | --- |
| `source:kafka-exporter @glog.level:I` | 전부 info. error 0 |
| `source:kafka-exporter @glog.level:(E OR F)` | E→error, F→critical. info 0 |
| `source:kafka-exporter -@glog.level:*` | 수집 status 유지(stderr 이면 error). 메시지 표본을 확인해 새 형식이 있으면 규칙 보강을 검토 |
| `source:(postgres OR postgresql) @postgresql.level:LOG` | 전부 info |
| `source:(postgres OR postgresql) @postgresql.level:(ERROR OR FATAL OR PANIC)` | error·critical·emerg. info 0 |
| `source:(postgres OR postgresql) -@postgresql.severity:*` | 수집 status 유지. DETAIL·STATEMENT 등과 접두 없는 줄 |
| `host:gromo-dev status:error`(service·container_name 별) | 보고서 §1 의 Exporter 960건·DB 24건 같은 정상 줄 오탐이 사라졌는지 |

- 건수 비교는 같은 범위의 Docker 원본(읽기 전용 `docker logs`)과 한다. 수집 지연·누락이 있을 수 있으므로 건수 감소만으로 해소를 판정하지 않는다.
- `datadog.pipelines` 태그 값은 참고만 한다.
- 대시보드의 Exporter 로그 링크(`(container_name:gromo-kafka-exporter OR source:kafka-exporter)`)에서 보이는 `status:error` 비율은 적용 전후로 달라진다. 적용 전 error 에는 Exporter stderr INFO 가 포함되어 있다. 링크가 보여 주는 줄 집합은 같고 status 만 바뀐다.

## 12. 공식 문서 근거

| # | 문서 | 확인한 문장(원문) | 쓴 곳 |
| ---: | --- | --- | --- |
| 1 | [Grok Parser](https://docs.datadoghq.com/logs/log_configuration/processors/grok_parser/) | 필드 `type`·`name`·`is_enabled`·`source`·`samples`·`grok.support_rules`·`grok.match_rules`, "List of (up to 5) sample logs for this grok parser." | 정의 형식, sample 5개 제한(테스트) |
| 2 | [Parsing](https://docs.datadoghq.com/logs/log_configuration/parsing/) | "Only one can match any given log. The first one that matches, from top to bottom, is the one that does the parsing." / "You must define your parsing rule to match the entire log entry" / `data`: "Matches any string including spaces and newlines. Equivalent to `.*`" / `notSpace`: "Matches any string until the next space." / `integer`, `regex("pattern")` / Glog format 예 `%{regex("\\w"):level}%{date("MMdd HH:mm:ss.SSSSSS"):timestamp}\s+%{number:logger.thread_id} %{notSpace:logger.name}:%{number:logger.lineno}\] %{data:msg}` | grok 규칙, 근사 변환기(전체 일치·첫 규칙), 변환기 점검 |
| 3 | [Log Status Remapper](https://docs.datadoghq.com/logs/log_configuration/processors/log_status_remapper/) | "Strings beginning with **emerg** or **f** (case-insensitive) map to **emerg (0)**", "… **c** … **critical (2)**", "… **err** … **error (3)**", "… **w** … **warning (4)**", "… **n** … **notice (5)**", "… **i** … **info (6)**", "… **d**, **t**, **v**, **trace**, or **verbose** … **debug (7)**", "All others map to **info (6)**" / "for all pipelines that match the log, only the first status remapper encountered (from all applicable pipelines) is applied." | lookup 이 필요한 이유, 순서 위험, 근사 remapper |
| 4 | [Logs Pipelines API](https://docs.datadoghq.com/api/latest/logs-pipelines/) ([create](https://docs.datadoghq.com/api/latest/logs-pipelines/create-a-pipeline/)·[update](https://docs.datadoghq.com/api/latest/logs-pipelines/update-a-pipeline/)·[order](https://docs.datadoghq.com/api/latest/logs-pipelines/update-pipeline-order/)) | create: "This endpoint requires the `logs_write_pipelines` permission.", 필드 `name`(required)·`filter.query`·`is_enabled`·`description`·`processors` / update: "updates your pipeline configuration by **replacing** your current configuration" / order: "updates your pipeline order by replacing your current order with the new one" / status remapper: "If multiple log status remapper processors can be applied to a given log, only the first one (according to the pipelines order) is taken into account." | `manage.py` 엔드포인트·본문·권한, 롤백 순서 |
| 5 | [Pipelines](https://docs.datadoghq.com/logs/log_configuration/pipelines/) | "Each log that comes through the pipelines is tested against every pipeline filter. If it matches a filter, then all the processors are applied sequentially before moving to the next pipeline." / 표: Lookup processor·Grok parser 는 "Last write wins", Log status remapper 는 "First write wins … across multiple matching pipelines, the first one encountered applies." / "Integration pipelines cannot be deleted, only disabled." / "Auto-Processing only handles logs that do not match the filter of any existing integration or custom pipeline." | 순서·이중 처리 |
| 6 | [Search Syntax](https://docs.datadoghq.com/logs/explorer/search_syntax/) | "`env:(prod OR test)` matches all logs with the tag `env:prod` or the tag `env:test`" / "It is **not** required to define a facet to search on attributes and tags." | postgres 필터, 확인 쿼리 |
| 7 | [Docker Log Collection](https://docs.datadoghq.com/containers/docker/log/) | "`source` and `service` default to the `short_image` tag value in Datadog Agent 6.8+. … Setting the `source` value to an integration name results in the installation of integration Pipelines" / "Logs coming from container `Stderr` have a default status of `Error`." | 필터 근거, 수집 status |
| 8 | [Postgres integration](https://docs.datadoghq.com/integrations/postgres/) | `source: postgresql`, `LABEL "com.datadoghq.ad.logs"='[{"source":"postgresql","service":"postgresql"}]'`, multi_line `pattern: \d{4}\-(0?[1-9]\|1[012])\-(0?[1-9]\|[12][0-9]\|3[01])` | 필터의 `postgresql`, multiline 후속 |
| 9 | [klog v2.130.1 `klog.go`](https://github.com/kubernetes/klog/blob/v2.130.1/klog.go), [kafka_exporter v1.8.0 `go.mod`](https://github.com/danielqsj/kafka_exporter/blob/v1.8.0/go.mod) | "Lmmdd hh:mm:ss.uuuuuu threadid file:line] msg…", "L  A single character, representing the log level (eg 'I' for INFO)", "Log line format: [IWEF]mmdd hh:mm:ss.uuuuuu threadid file:line] msg" / "Fatal logs to the FATAL, ERROR, WARNING, and INFO logs, prints stack trace(s), then calls OsExit(255)." / `k8s.io/klog/v2 v2.130.1` | Exporter 형식·`[IWEF]`·F 의미 |
| 10 | [PostgreSQL 16 Error Reporting and Logging](https://www.postgresql.org/docs/16/runtime-config-logging.html) | Table 20.2: ERROR "Reports an error that caused the current command to abort.", FATAL "…current session to abort.", PANIC "…all database sessions to abort."(syslog 대응 ERROR→WARNING, FATAL→ERR, PANIC→CRIT) / `log_line_prefix` "The default is `'%m [%p] '`" / `log_error_verbosity`: "TERSE excludes the logging of DETAIL, HINT, QUERY, and CONTEXT error information." | PG 매핑·grok 접두·맥락 줄 |

Lookup Processor 근거: [문서](https://docs.datadoghq.com/logs/log_configuration/processors/lookup_processor/)의 동작 설명은 "Looks if the current log contains the source attribute." 와 "Checks if the source attribute value exists in the mapping table. If it does, creates the target attribute with the corresponding value in the table." 이다. 기본값은 "Optionally, if it does not find the value in the mapping table, it creates a target attribute with the default fallback value" 라고만 적혀 있다. `lookup_table` 형식은 `["source_key1,target_value1", …]` 이고 `default_lookup` 은 "Required: No" 다.

## 13. 미확인

- **lookup 에 `default_lookup` 이 없을 때 target 을 만들지 않는지**: 문서는 기본값 생성을 "Optionally" 로만 설명한다. 생략할 때의 동작은 명시하지 않는다.
- **Status Remapper 의 source 속성이 없을 때 status 를 그대로 두는지**: 문서에 명시 문장이 없다. 「처음 만난 status remapper 하나만 적용」에서 속성이 없는 remapper 도 「만난」 것으로 세는지도 명시되어 있지 않다.

  이 두 가지가 §5 정책의 전제다. 근사 테스트는 문서의 함의대로 가정했다. 적용 후 §11 의 `-@glog.level:*`·`-@postgresql.severity:*` 쿼리로 확인해야 한다.
- `regex("…")` 인자 안의 `{n}` 반복자와 `}` 문자를 토큰 경계로 어떻게 해석하는지는 문서로 확인하지 못했다. 그래서 규칙에는 `[0-9][0-9]…`·`[.]` 만 써서 중괄호와 역슬래시를 피했다. `regex(…)` 밖의 `\s+`·`\[`·`\]` 는 문서의 glog 예와 증거의 Kafka integration 규칙(`\s+`)에도 쓰인 형식이다.
- API 개요의 주의 문구("configure all escaped spaces as `%{space}` to use in the body data")가 어떤 상황을 뜻하는지 확인하지 못했다. `%{space}` 는 matcher 목록에 없다. 실제 생성 시 Datadog 이 규칙을 거부하거나 바꾸는지는 원격 적용 때 확인한다.
- pipeline filter 가 검색 문법의 `source:(a OR b)` 를 그대로 받는지. 검색 문서 기준으로 작성했고 원격 validation 은 미수행이다.
- 새로 생성한 파이프라인이 순서상 어디에 놓이는지.
- 공식 PostgreSQL integration 파이프라인의 규칙·status 매핑. source `postgresql` 로그가 없어 자동 설치되지 않았고 내용을 보지 못했다.
- 맥락 줄이 접두를 달고 별도 줄로 나오는 PostgreSQL 동작은 공식 문서 문장으로 확인하지 못했다. fixture 의 `DETAIL`·`STATEMENT` 등은 **합성**이다.
- 실로그가 없는 Exporter `W`, PostgreSQL `ERROR`·`FATAL`·`PANIC`·`WARNING`·`NOTICE`·`DEBUG`·맥락 줄은 모두 **합성**이다.
