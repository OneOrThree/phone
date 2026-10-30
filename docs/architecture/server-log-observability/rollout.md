# 로그 통합 전환·롤백 절차 (GROMO-2560)

> 2026-10-29 작성, 2026-10-30 현행화. 에픽 PR #1407 은 main 에 머지됐고(`ec7d74695`) `release` 에 포함돼 prod 는 커밋 `340d81567`(V2 태그 `catus-v2.0.1-V2`, 2026-10-30 기준)을 실행한다. 그 안에서 prod 에 반영된 것은 앱 JSON 로그와 Datadog 수집이고, `OBS_*`·Fluent Bit·Loki·Grafana·S3·Nginx JSON 은 에픽 2619 로 아직 적용 전이다. dev 단계(§2)의 실행 여부는 2026-10-30 재확인 필요하다. 아래 «확인» 열은 사람이 할 일이고, 결과는 [검증 결과](verification-results.md)의 «현장» 항목으로 옮긴다.
> AWS 에 요청을 보내는 부하·시험은 하지 않는다(사용자 지시 2026-10-29). 아래의 읽기 전용 확인도 dev·prod 에 부하를 가하지 않는 범위로 한정한다.

관련: [구현 계획 §7](implementation-plan.md) · [수집 런북](ingestion-runbook.md)(S3·Nginx·기존 업로더 중단) · [조회 안내](query-guide.md) · [구현 현황](implementation-status.md)

## 1. 순서 원칙

1. **dev 에서 먼저, prod 는 dev 확인 뒤.** dev 는 Data·Realtime 공동 배포(`data-api-ci.dev.yml` → `data-api-cd.dev.yml`), 위성 배포(`satellite-cd.dev.yml`), 관측 스택(`ops-monitor.dev.yml`)으로 나뉜다. prod 는 `prod-ci-V2.yml`(release 이미지 발행)과 승인 후 수동 `prod-cd-V2.yml`(SSM 배포·버전 지정 롤백)이며(`prod-ci.yml`·`prod-cd.yml` 은 V1), prod 실행 구성은 Infra 저장소(`OneOrThree/cattus-infra`, `prod/catus-v2/`)가 소유한다. 이 저장소 변경만으로는 prod 에 적용되지 않는다.
2. **스키마는 먼저, 모두 additive.** Data Flyway `V7`(`event_outbox` 의 `origin_request_id`·`origin_trace_id`·`trace_context_version`)와 Notification `V16`(`deliveries` 의 `origin_*`)는 nullable 열 추가뿐이다. 앱 이미지와 함께 적용되며 prod 의 DB 적용 절차는 `server/data-api/docs/db/README.md` 를 따른다(이 문서는 그 절차를 바꾸지 않는다). 2026-10-29 12:1xZ 읽기 조회로 dev data-api DB 는 V3 까지(main 의 V4 도 미적용, 18:43 KST 공동 배포 실패), notification 은 V14 까지라 에픽 마이그레이션은 그 시점에 어디에도 적용되지 않았다(2026-10-30: prod 는 V2 배포로 적용됐을 가능성이 있으나 DB 를 보지 않아 미확인, dev 는 재확인 필요).
3. **혼합 배포에 순서 제약이 없는 것**: Outbox carrier 헤더(Kafka·내부 HTTP)와 Realtime Redis wire. 구버전은 모르는 헤더·`telemetry` 키를 무시하고 새 버전은 없는 값을 «문맥 없음»으로 읽는다(`KafkaInboundTest`, Realtime `InboundEventServiceTest` 가 양방향 확인). 실제 롤링 배포에서의 확인은 미실행.
4. **수집기는 앱 JSON 이 나온 뒤에.** Fluent Bit 은 JSON 이 아닌 줄도 `log_kind=raw`·`parse_error=true` 로 보관하므로 순서를 어겨도 줄을 잃지는 않지만, 구조화 필드는 앱 JSON 이 먼저 있어야 조회된다.
5. **한 번에 하나**: 앱 JSON → 수집기 → S3 출력 → Nginx 입력 순으로 하나씩 켜고, 각 단계의 판정 지표(§4)를 보고 다음으로 간다. 판정 기준값은 dev 관찰 뒤에 정한다 — **현재 정해진 수치 기준은 없다**.

## 2. dev 검증 순서

| 단계 | 작업 | 확인 | 상태 |
| --- | --- | --- | --- |
| D0 | 피처 PR 들이 main 에 반영됨(사람이 머지). dev VM(`gromo-dev-app`)의 Loki 는 2554 조사 당시 가동하지 않았다 — 관측 스택을 올리는 D4 가 선행돼야 조회가 된다 | main 의 해당 SHA | **완료**(main `ec7d74695`). dev 반영은 2026-10-30 재확인 필요(dev CD 다수 `disabled_manually`) |
| D1 | 배포 전 검사: `deploy-core-dev.py`·`prepare-satellite-deploy.py` 가 렌더된 `OBS_SERVICE`(서비스 이름)·`OBS_ENV`(`dev`)·`OBS_VERSION`(배포 커밋)이 비었거나 다르면 배포를 멈춘다. `OBS_*` 는 비밀이 아니라 compose `environment:` 로 넣고 Secrets Manager 를 쓰지 않는다 | CD 로그의 검사 통과 | 미실행 |
| D2 | dev CD 로 네 서비스 배포. dev 프로필 콘솔이 JSON 한 줄(`schema_version` 1)로 바뀐다. 텍스트 `app.log`·`logging.file.name` 파일은 그대로(컷오버 전) | `docker logs` 한 줄이 JSON, `service`·`env`·`version`·`instance_id` 가 컨테이너 env 와 일치(V20), 헬스 통과 | 미실행 |
| D3 | `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED=true` 가 네 서비스 compose 에 있다. agent 1.64.0 기본이 켜져 있어 출력 변화를 기대하지 않는다 | 컨테이너 env 에 값 존재, 요청 하나의 `dd.trace_id` 가 32자리 hex 이고 canonical `trace_id` 와 같음. 10진이 보이면 상위 64비트가 0인 경우 외에는 원인을 조사 | 미실행 |
| D4 | `ops-monitor.dev.yml` `action=up`: Loki·Grafana·Fluent Bit(4.2.8) 기동. 워크플로가 5초 간격 12회(60초) 동안 Fluent Bit 이 매번 `Running=true`·`RestartCount=0` 인지 보고 한 번이라도 아니면 **Promtail 을 남기고 실패**한다. 정상이면 `gromo-promtail` 을 제거한다. 기동 직후 Promtail 과 Fluent Bit 이 겹쳐 도는 짧은 구간에는 같은 줄이 두 수집기로 들어올 수 있다 | `gromo-fluent-bit` 실행, Promtail 없음, §4 의 canary 도착, 허용 밖 label 0 | 미실행 |
| D5 | Data 마이그레이션(V7)·Notification(V16) 적용 확인 후 Outbox 경로 동작. 이벤트 하나가 `outbox.delivery` → `consumer.accept` → `operation.link` → `transport.result` → `dispatch.settle` 로 이어지고 `event_id`·origin 이 유지되는지 | [조회 안내 §1](query-guide.md) 의 ②~④ 패널 | 미실행 |
| D6 | Realtime 두 인스턴스: A → Redis → B 의 `fanout.publish` / `fanout.receive`, 구·신 인스턴스 혼합 | `message_id`·`event_id` 조회, 자기 echo 중복 없음 | 미실행(인스턴스 2개가 dev 에 있는지 미확인) |
| D7 | 관찰: 일정 기간(길이는 미정) canary·`dropped_records`·`parse_error` 를 보고 §4 기준을 정해 기록 | 아래 §4 | 미실행 |
| D8 | (선택, **dev 에서는 켜지 않는다**) S3 출력 `OBS_LOG_S3=on`, Nginx 호스트 `OBS_LOG_NGINX_HOST=on`: dev 에는 S3 자격이 없다(2554 실측)고 [런북 §1](ingestion-runbook.md)이 정한다. `ops-monitor.dev.yml` 이 `OBS_LOG_*` 를 넘기는 경로도 아직 없다(후속) | — | **dev 미사용 결정(2026-10-30)** — [decisions-ingest-and-s3-credentials.md §5](decisions-ingest-and-s3-credentials.md). S3 실측은 prod ③에서 처음 한다 |

## 3. prod 전환 순서

dev 관찰(D2~D7)이 끝나고 §4 기준이 기록되기 전에는 ②(Fluent Bit·Loki 켜기)를 시작하지 않는다. prod 실행 구성은 Infra 저장소 `OneOrThree/cattus-infra` 의 `prod/catus-v2/` 이고, 아래 코드 변경은 에픽 2619(하위 2620~2627·2630)가 만든다. 이 절은 절차이며 에픽 2619 항목은 아직 실행하지 않았다.

### 3.1 사람이 하는 4단계

| 순서 | 작업 | 확인 |
| --- | --- | --- |
| 1 | `terraform apply`: 로그 버킷 수명 규칙(`system_log/` 90일)과 IAM(쓰기 접두 `system_log/v2/env=prod/*`) 적용 | 적용 결과의 변경 목록 |
| 2 | Infra `main` 에 머지된 커밋 SHA 로 phone 저장소 Actions 변수 `CATUS_PROD_INFRA_REVISION_V2` 를 변경. 변수만 바꿔서는 아무것도 실행되지 않는다 | 40자리 SHA, 그 SHA 의 Infra `catus-config.prod-V2` 발행 성공 |
| 3 | `prod-ci-V2` 를 `release` 브랜치에서 `workflow_dispatch` 로 수동 실행 | 이미지 발행·구성 SHA 검증 통과, 새 태그 `catus-vX.Y.Z-V2` 생성 |
| 4 | `prod-cd-V2` 실행(승인 후 수동, SSM 배포). 입력은 `version`(필수: 3단계에서 생긴 `catus-vX.Y.Z-V2` 태그)과 `rollback` 뿐이고 배포는 `--role app` 전체다 | 앱 4종 헬스 통과 |

배포 엔진은 `up -d --no-deps <앱 4종>` 을 호출하고 compose 가 설정이 바뀐 서비스만 재생성한다. 그래서 스위치만 바꾸면 앱은 재시작되지 않고, 앱의 env·이미지·라벨이 바뀐 배포에서만 재시작된다(`infra_revision` 비교로 앱을 재시작하지 않는다). 3단계 전에 phone `main` → `release` 승격(`AGENTS.md` 「main → release 운영 승격」)이 끝나 있어야 한다.

### 3.2 켜는 순서 (Infra 기능 스위치)

스위치는 `prod/catus-v2/runtime/env-V2.py` 의 `OBSERVABILITY = {'fluent_bit', 'loki', 'grafana', 's3'}` 이고 기본값은 모두 False 다. 하나를 켤 때마다 §3.1 의 2~4단계(Infra 커밋 → `CATUS_PROD_INFRA_REVISION_V2` 변경 → `prod-ci-V2` → `prod-cd-V2`)를 한 번 돈다.

| 단계 | 켜는 것 | 확인 | 상태 |
| --- | --- | --- | --- |
| ① | 스위치 전부 꺼진 채로 배포. `OBS_*`·Datadog 서비스 이름(`data-api`·`business-api`·`realtime`·`notification`)·Nginx JSON 접근 로그가 반영되고 새 서비스는 뜨지 않는다 | 컨테이너 env 의 `OBS_SERVICE`·`OBS_ENV`·`OBS_VERSION`, 앱 로그 한 줄의 `service`·`env`·`version`, Nginx 로그가 JSON 한 줄, 서비스 목록이 이전과 같음 | 미실행 |
| ② | `fluent_bit` + `loki`. dev 관찰이 끝난 뒤에만 | canary 가 Loki 에 도착, `dropped_records`, 호스트 디스크·메모리 여유(Loki 7일 보존) | 미실행 |
| ③ | `s3`. dev 는 S3 를 쓰지 않기로 했으므로(D8) S3 실측(IAM·업로드·수명 규칙)은 prod 가 처음이다. 실패하면 ③만 되돌린다(§3.4). 머리글의 규칙대로 dev 관찰이 끝난 뒤에만 시작한다 | `system_log/v2/env=prod/` 객체 도착, canary 가 S3 에도 도착, Athena 조회 | 미실행 |
| ④ | Cloudflare 설정(§3.3)을 마친 뒤 `grafana` | 미인증 요청이 Access 로그인으로 이동, 원본 직접 요청은 401 | 미실행 |

각 단계의 판정은 §4 지표로 하고, 앞 단계를 통과해야 다음으로 간다. 켠 뒤 디스크·메모리의 판정 기준 숫자는 §1-5 의 기존 규칙대로 dev 관찰 뒤에 정한다(지금 정해진 숫자는 없고, 이 절은 «무엇을 보는가»만 적는다). 관측 서비스(Fluent Bit·Loki·Grafana) 기동은 앱 검증이 끝난 뒤 별도 단계이며 실패해도 앱 롤백을 일으키지 않게 설계한다(에픽 2619 계약, 구현은 하위 티켓).

### 3.3 Cloudflare 수동 단계 (④ 전)

1. DNS 에 Grafana 호스트를 만든다(호스트 이름은 미정 — 값은 `env-V2.py` 의 `GRAFANA_HOST`).
2. Cloudflare Access 앱을 만든다.
3. Access 앱의 `aud` 태그와 팀 도메인(`<team>.cloudflareaccess.com`)을 확인한다.
4. 원본 서버 인증서가 새 호스트를 포함하는지 확인한다(미확인).
5. `env-V2.py` 의 `GRAFANA_HOST`·`GRAFANA_ACCESS_TEAM`·`GRAFANA_ACCESS_AUD` 를 채운다. 스위치가 True 인데 값이 비어 있으면 `generate` 가 실패한다.
6. Secrets Manager `catus/prod/env` 에 `GRAFANA_ADMIN_PASSWORD` 를 추가한다. 시크릿 값은 서비스 env 에 넣지 않으므로(Grafana 전용 env 파일) 그 값 때문에 앱이 재시작되지는 않는다. 다만 시크릿 버전이 바뀌므로 다음 배포에서 앱 4종이 재시작될 수 있다(기존 규칙).

Grafana 는 Access 가 붙인 JWT(`Cf-Access-Jwt-Assertion`)를 JWKS 로 직접 검증하고 `aud` 를 확인하며 로그인 폼은 끈다. Host 헤더 우회로 Access 를 건너뛰어도 원본에서 막기 위해서다.

### 3.4 되돌리기

**끄는 순서.** `grafana` → `s3` → `loki` + `fluent_bit`. `loki` 와 `fluent_bit` 은 함께 끈다. Loki 만 끄면 수집기가 재시도하며 버퍼가 쌓인다.

**경로 두 가지.**
- 스위치 끄기: 해당 스위치를 False 로 하는 Infra 커밋 → `CATUS_PROD_INFRA_REVISION_V2` 변경 → `prod-ci-V2`(새 태그) → `prod-cd-V2`(`version`=새 태그). 새 Infra 커밋과 새 태그가 생기고, 꺼진 스위치의 서비스는 배포가 내린다.
- `prod-cd-V2` 의 `rollback`: 이전 태그의 번들을 그대로 적용하므로 스위치 상태도 그 태그 시점으로 돌아간다. 앱 자동 롤백 때 관측 단계는 건너뛴다.

**되돌린 뒤 확인.** 꺼진 서비스의 컨테이너가 없음, 앱 4종 헬스 통과, Datadog 수집이 계속 동작.

**되돌려도 남는 것.** S3 `system_log/v2/env=prod/` 객체, 버킷 수명 규칙·IAM, Nginx JSON 형식, `GRAFANA_ADMIN_PASSWORD`, Cloudflare DNS·Access 앱, 데이터 볼륨(`loki_data`·`fluent_bit_state`). 볼륨은 지우지 않는다.

**디스크 응급 절차(미검증 — 실제로 실행해 보지 않았다).** 호스트 디스크가 차면 배포를 기다리지 않고 관리자가 SSM 세션으로 `docker stop catus-app-v2-fluent-bit-1 catus-app-v2-loki-1` 을 실행한다. 볼륨은 지우지 않는다. 그 뒤 스위치 끄기 커밋을 낸다.

### 3.5 이전 P0~P5 항목의 현재 상태

| 이전 항목 | 현재 |
| --- | --- |
| P0 Infra 요청(IAM·lifecycle·Fluent Bit 서비스·Nginx `gromo_json`·Datadog 제외 목록) | 에픽 2619 하위 2623~2627·2630 이 코드로 만든다. 머지·`terraform apply` 전 |
| P1 `OBS_SERVICE`·`OBS_ENV`·`OBS_VERSION`·`DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED` | 2623 이 만든다. 2026-10-30 재확인 필요 — 이 환경 변수가 prod 실행 구성에 이미 있는지 확인하지 않았다 |
| P2 main → release 승격 | **실행 완료.** 에픽 PR #1407(`ec7d74695`)이 `release` 에 포함돼 prod 가 커밋 `340d81567`(V2 태그 `catus-v2.0.1-V2`, 2026-10-30 기준)을 실행한다. `prod-cd-V2.yml` 입력은 `version`(필수)과 `rollback` 뿐이고 배포는 `--role app` 전체라 서비스 단위 적용은 불가능하다. 마지막 성공 실행은 2026-10-29T23:11Z 이고 쓴 태그는 태그와 실행 시각으로 추정한 값이다(2026-10-30 기준) |
| P3 Fluent Bit 기동·canary | §3.2 ②. 미실행 |
| P4 기존 업로더(590·2288)와 `system_log/v2/` 병행 후 APP 업로더 중단([런북 §5](ingestion-runbook.md)) | 미실행. 두 업로더가 같은 호스트에서 같은 prefix 로 중복 쓰는지는 미확인 |
| P5 Grafana 접근 인증·수집기 IAM·경보 | 인증은 §3.2 ④, 경보는 미정 |

## 4. 전환 판정 지표와 확인 쿼리

수치 임계값은 dev 관찰 뒤에 정한다(§1-5). 아래는 «무엇을 어디서 보는가»이다. LogQL 은 [조회 안내](query-guide.md)의 label 규칙(`env`·`service`·`log_kind` 셋, ID 는 `| json` 필드)을 따른 예시이고 **dev Loki 가 가동하지 않아 실행하지 않았다**.

| 판정 지표 | 보는 곳 | 확인 방법 | 이상 신호 |
| --- | --- | --- | --- |
| canary 도착 | Loki, S3 각각 따로 | `count_over_time({service="canary"}[5m])`(60초마다 1건이 기대). S3 는 `system_log/v2/env=<env>/service=canary/` 의 최신 객체 내용(객체가 `upload_timeout` 만큼 늦게 보임) | 한 sink 에만 마지막 canary 나이가 임계를 넘음. canary 만 있고 앱 줄이 없으면 저트래픽이 아니라 수집 단절을 의심 |
| 수집기 `dropped_records`·`errors`·`retried_records` | Fluent Bit `/api/v1/metrics`(컨테이너 포트 2020) | 출력별 값. 값만으로 유실을 판정하지 않는다(런북 §7: S3 에서 누락과 무관하게 오른 사례) | 시나리오 밖 증가 |
| `parse_error` / raw 줄 | Loki | `sum by (service) (count_over_time({env="dev", log_kind="raw"}[5m]))`(`parse_error=true` 줄은 `log_kind=raw`) | 앱 서비스의 raw 비율 증가 — JSON 출력 실패나 새 텍스트 출력 |
| Loki 거절 | Loki `/metrics` | `loki_discarded_samples_total{reason="too_far_behind"}`(수용창 59분 수용·61분 거절, 런북 §7 g). 수집기 쪽은 `dropped_records` | 증가 → 시각을 바꿔 넣지 않고 S3 로 확인 |
| 메타데이터 일치 | Loki | `count_over_time({env="dev", service=~"data-api\|business-api\|notification\|realtime"} \| json \| version="" [5m])` | 0 이 아님 → `OBS_*` 누락 |
| trace ID 형식 | Loki | `{service="data-api"} \| json \| dd_trace_id != "" \| dd_trace_id !~ "[0-9a-f]{32}"` | 대부분의 줄에서 나옴 → 128-bit 로그가 꺼진 것 |
| 원인 키 조회 | Grafana `log-investigation` | 요청·이벤트 하나를 [조회 안내 §1](query-guide.md) 순서로 ②~④ | 표가 비거나 `log_id` 사본 폭증 |
| Athena 첫 실조회(사람이, 배포 뒤) | Athena 콘솔 | `create-table.sql` 실행 뒤 `SELECT count(*), count(log_id), count("timestamp"), count(request_id), count(attempt) FROM ops_logs WHERE env='dev' AND service='data-api' AND archive_date='<오늘>' AND archive_hour='<시>'` 로 주요 열 NULL 비율을 본다. 타입이 안 맞는 값(예: `attempt` 가 문자열)은 오류 없이 조용히 NULL 이 된다. 깨진 JSON 줄도 `ignore.malformed.json` 때문에 오류 없이 NULL 행이 된다 — `count(*)` 와 `count(log_id)` 의 차이가 크면 의심 | `log_id`·`timestamp` NULL 비율이 raw 줄(`parse_error`) 비율을 넘음. 이 문서는 실행하지 않았다(AWS 요청 금지) |
| 서비스 영향 | Grafana `gromo-overview`·`gromo-components` | 배포 전후 같은 창의 요청 p95/p99, 서비스·컨테이너 CPU, 메모리 working set, 호스트 디스크 I/O([검증 결과 §5](verification-results.md#5-요청-p95p99-전후-비교-배포-뒤-저장-지표로-미실행)) | 새 부하를 만들지 않고 저장된 지표만 읽는다 |

## 5. 롤백

원칙: **원본·tail DB·버퍼·볼륨을 지우지 않는다.** 신규 nullable DB 열은 파괴적으로 삭제하지 않는다(additive 라 이전 이미지가 무시한다).

| 대상 | 롤백 | 남는 것·주의 |
| --- | --- | --- |
| 앱 JSON 출력 | 이전 이미지로 되돌린다(dev: 이전 SHA 재배포, prod: `prod-cd-V2.yml` 의 버전 지정 롤백). JSON 은 프로필(`logback-spring.xml`·`application-{dev,prod}.yml`)에 고정돼 있어 런타임 스위치가 없다 | 되돌린 뒤 stdout 은 텍스트라 Fluent Bit 이 `raw` 로 보관하고 구조화 필드(`request_id` 등)는 조회되지 않는다. JSON 기간의 줄은 남는다 |
| `OBS_*` | 이전 커밋을 재배포한다. 값을 지우면 배포 전 검사가 dev 배포를 멈춘다 | prod 는 Infra 가 값을 되돌린다 |
| `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED` | compose 에서 제거 | agent 1.64.0 기본이 켜져 있어 출력이 달라지지 않는다(2557 조사) |
| Flyway V7(data)·V16(notification) | **되돌리지 않는다.** nullable 열이 남는다 | Data V7 은 이전 번들로 migrate·validate 가 통과하는 것을 테스트한다(`OutboxOriginV7MigrationTest`) |
| Outbox carrier (Kafka·HTTP 헤더) | 이전 이미지. 구버전은 모르는 헤더를 무시한다. 이미 저장된 `origin_*` 는 남는다 | 도메인 이벤트 봉투·`envelope_hash`·멱등 키는 바뀌지 않았다 |
| Realtime Redis wire (`telemetry`) | 이전 이미지. 혼합 배포 양방향 무순서 | 롤백 중에도 클라이언트 DTO·7필드 봉투는 불변 |
| Fluent Bit → Promtail (dev) | `ops-monitor.dev.yml` 을 Promtail 이 포함된 이전 커밋으로 `action=up`. **미검증** — Promtail 복귀 시 읽기 위치와 중복 범위는 기록해 둔다 | Fluent Bit 의 `fluent_bit_state` 볼륨·tail DB 는 지우지 않는다 |
| S3 출력 | `OBS_LOG_S3` 를 제거하고 재배포. Loki 는 계속 동작(두 출력 독립). 기존 업로더 타이머 재개 | 전환 기준 시각 ~ 재개 시각은 v2 와 기존 업로더에 같은 줄이 있을 수 있다 — 범위를 기록([런북 §5](ingestion-runbook.md)). `store_dir`·`tail.db` 는 지우지 않는다 |
| Nginx 호스트 입력 | `OBS_LOG_NGINX_HOST` 제거 후 재배포. 필요하면 `access_log …json.log` 줄을 지우고 reload | 이미 보낸 객체·Loki 줄은 남는다 |
| prod Nginx `log_format` | Infra 가 되돌린다 | 기본 combined 줄도 수집기가 정제한다 |

롤백 판단 기준도 §4 지표로 보되 임계값은 §1-5 와 같이 미정이다. 지연이나 일부 sink 장애 때문에 **다른 sink 를 끄지 않는다**(sink 독립이 깨지면 배포를 중단한다 — V10).

## 6. 이 문서가 확인하지 않은 것

- 단계의 실제 실행(P2 의 prod 반영만 실행됨 — §3.5. 나머지는 미실행).
- prod 의 Nginx compose 서비스명, 실제 S3 리전(`ap-northeast-2` 는 가정), 두 업로더의 공존.
- Promtail 복귀 절차의 실제 동작.
- 알려진 수집 결함: 16 KiB 넘는 줄의 Docker 조각이 json-file 회전 경계에 걸리면 그 줄이 Loki·S3 에서 빠진다(로컬 재현, [런북 §7 해석과 한계](ingestion-runbook.md#해석과-한계)). dev 전환 판정에서 큰 예외 줄 누락을 이 경우와 구분한다.
- §4 LogQL 의 실제 실행 결과.
- Catus V2 운영 경로에는 수집기·S3 업로더·버킷 수명 규칙·Datadog Agent 수집 제외 목록이 없다(2026-10-30 조사). 도입은 에픽 2619 의 Infra 변경이며 §3 의 순서를 따른다.
