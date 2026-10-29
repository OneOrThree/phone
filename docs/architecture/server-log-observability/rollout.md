# 로그 통합 전환·롤백 절차 (GROMO-2560)

> 2026-10-29. **절차 문서이며 아무 단계도 실행하지 않았다.** 2553~2559 는 피처 브랜치 `feat/GROMO-2562-log-observability` 에 병합됐을 뿐 main 에 반영되지도, dev·prod 에 배포되지도 않았다. 2556 은 PR #1390 리뷰 중이다. 아래 «확인» 열은 배포 뒤 사람이 할 일이고, 결과는 [검증 결과](verification-results.md)의 «현장» 항목으로 옮긴다.
> AWS 에 요청을 보내는 부하·시험은 하지 않는다(사용자 지시 2026-10-29). 아래의 읽기 전용 확인도 dev·prod 에 부하를 가하지 않는 범위로 한정한다.

관련: [구현 계획 §7](implementation-plan.md) · [수집 런북](ingestion-runbook.md)(S3·Nginx·기존 업로더 중단) · [조회 안내](query-guide.md) · [구현 현황](implementation-status.md)

## 1. 순서 원칙

1. **dev 에서 먼저, prod 는 dev 확인 뒤.** dev 는 Data·Realtime 공동 배포(`data-api-ci.dev.yml` → `data-api-cd.dev.yml`), 위성 배포(`satellite-cd.dev.yml`), 관측 스택(`ops-monitor.dev.yml`)으로 나뉜다. prod 는 `prod-ci.yml`(release 이미지 발행)과 승인 후 수동 `prod-cd.yml`(SSM 배포·버전 지정 롤백)이며, prod 실행 구성은 Infra 저장소(`OneOrThree/Infra`)가 소유한다. 이 저장소 변경만으로는 prod 에 적용되지 않는다.
2. **스키마는 먼저, 모두 additive.** Data Flyway `V5`(`event_outbox` 의 `origin_request_id`·`origin_trace_id`·`trace_context_version`)와 Notification `V15`(`deliveries` 의 `origin_*`)는 nullable 열 추가뿐이다. 앱 이미지와 함께 적용되며 prod 의 DB 적용 절차는 `server/data-api/docs/db/README.md` 를 따른다(이 문서는 그 절차를 바꾸지 않는다).
3. **혼합 배포에 순서 제약이 없는 것**: Outbox carrier 헤더(Kafka·내부 HTTP)와 Realtime Redis wire. 구버전은 모르는 헤더·`telemetry` 키를 무시하고 새 버전은 없는 값을 «문맥 없음»으로 읽는다(`KafkaInboundTest`, Realtime `InboundEventServiceTest` 가 양방향 확인). 실제 롤링 배포에서의 확인은 미실행.
4. **수집기는 앱 JSON 이 나온 뒤에.** Fluent Bit 은 JSON 이 아닌 줄도 `log_kind=raw`·`parse_error=true` 로 보관하므로 순서를 어겨도 줄을 잃지는 않지만, 구조화 필드는 앱 JSON 이 먼저 있어야 조회된다.
5. **한 번에 하나**: 앱 JSON → 수집기 → S3 출력 → Nginx 입력 순으로 하나씩 켜고, 각 단계의 판정 지표(§4)를 보고 다음으로 간다. 판정 기준값은 dev 관찰 뒤에 정한다 — **현재 정해진 수치 기준은 없다**.

## 2. dev 검증 순서

| 단계 | 작업 | 확인 | 상태 |
| --- | --- | --- | --- |
| D0 | 피처 PR 들이 main 에 반영됨(사람이 머지). dev VM(`gromo-dev-app`)의 Loki 는 현재 가동하지 않는다(2554 조사) — 관측 스택을 올리는 D4 가 선행돼야 조회가 된다 | main 의 해당 SHA | 미실행 |
| D1 | 배포 전 검사: `deploy-core-dev.py`·`prepare-satellite-deploy.py` 가 렌더된 `OBS_SERVICE`(서비스 이름)·`OBS_ENV`(`dev`)·`OBS_VERSION`(배포 커밋)이 비었거나 다르면 배포를 멈춘다. `OBS_*` 는 비밀이 아니라 compose `environment:` 로 넣고 Secrets Manager 를 쓰지 않는다 | CD 로그의 검사 통과 | 미실행 |
| D2 | dev CD 로 네 서비스 배포. dev 프로필 콘솔이 JSON 한 줄(`schema_version` 1)로 바뀐다. 텍스트 `app.log`·`logging.file.name` 파일은 그대로(컷오버 전) | `docker logs` 한 줄이 JSON, `service`·`env`·`version`·`instance_id` 가 컨테이너 env 와 일치(V20), 헬스 통과 | 미실행 |
| D3 | `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED=true` 가 네 서비스 compose 에 있다. agent 1.64.0 기본이 켜져 있어 출력 변화를 기대하지 않는다 | 컨테이너 env 에 값 존재, 요청 하나의 `dd.trace_id` 가 32자리 hex 이고 canonical `trace_id` 와 같음. 10진이 보이면 상위 64비트가 0인 경우 외에는 원인을 조사 | 미실행 |
| D4 | `ops-monitor.dev.yml` `action=up`: Loki·Grafana·Fluent Bit(4.2.8) 기동. 워크플로가 15초 뒤 Fluent Bit 이 `Running=true`·`RestartCount=0` 인지 보고 아니면 **Promtail 을 남기고 실패**한다. 정상이면 `gromo-promtail` 을 제거한다. 기동 직후 Promtail 과 Fluent Bit 이 겹쳐 도는 짧은 구간에는 같은 줄이 두 수집기로 들어올 수 있다 | `gromo-fluent-bit` 실행, Promtail 없음, §4 의 canary 도착, 허용 밖 label 0 | 미실행 |
| D5 | Data 마이그레이션(V5)·Notification(V15) 적용 확인 후 Outbox 경로 동작. 이벤트 하나가 `outbox.delivery` → `consumer.accept` → `operation.link` → `transport.result` → `dispatch.settle` 로 이어지고 `event_id`·origin 이 유지되는지 | [조회 안내 §1](query-guide.md) 의 ②~④ 패널 | 미실행 |
| D6 | Realtime 두 인스턴스: A → Redis → B 의 `fanout.publish` / `fanout.receive`, 구·신 인스턴스 혼합 | `message_id`·`event_id` 조회, 자기 echo 중복 없음 | 미실행(인스턴스 2개가 dev 에 있는지 미확인) |
| D7 | 관찰: 일정 기간(길이는 미정) canary·`dropped_records`·`parse_error` 를 보고 §4 기준을 정해 기록 | 아래 §4 | 미실행 |
| D8 | (선택, **dev 에서는 켜지 않는다**) S3 출력 `OBS_LOG_S3=on`, Nginx 호스트 `OBS_LOG_NGINX_HOST=on`: dev 에는 S3 자격이 없다(2554 실측)고 [런북 §1](ingestion-runbook.md)이 정한다. `ops-monitor.dev.yml` 이 `OBS_LOG_*` 를 넘기는 경로도 아직 없다(후속) | — | 차단(자격 결정 대기) |

## 3. prod 전환 순서

dev D2~D7 이 끝나고 §4 기준이 기록된 뒤에만 시작한다. prod 는 **Infra 변경 요청이 선행**이다.

| 단계 | 작업 | 확인 | 소유·상태 |
| --- | --- | --- | --- |
| P0 | Infra 요청(PR #1390 본문 「Infra 요청 항목」, [런북 §9](ingestion-runbook.md)): ① 환경별 prefix 쓰기 권한이 있는 Fluent Bit 호스트 역할, `system_log/v2/` PutObject, 타 환경 prefix 거부, lifecycle(`system_log/` 90일·미완료 multipart 1일) 실제 적용 확인. ② Catus 런타임에 Fluent Bit 4.2.8 서비스(`/var/lib/docker/containers` 읽기 전용, 상태 볼륨, `FLB_COMPOSE_PROJECT`·`FLB_ENV=prod`, `OBS_LOG_S3=on`, 버킷·리전·`store_dir` 한도), Nginx 컨테이너의 `gromo_json` `log_format` 과 `access_log /dev/stdout gromo_json;`. ③ `OBS_LOG_NGINX_HOST`·`OBS_LOG_S3*` 변수를 넘기는 경로. ④ Datadog 컨테이너 로그 수집 제외 목록의 `gromo-promtail` → `gromo-fluent-bit` | Infra 저장소의 변경 이력 | **미실행 — Infra 소유** |
| P1 | prod 실행 구성에 `OBS_SERVICE`·`OBS_ENV`·`OBS_VERSION`·`DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED` 를 넣는다(Infra). 없으면 JSON 에서 해당 필드가 생략된다 | 컨테이너 env 와 로그의 일치 | **미실행 — Infra 소유** |
| P2 | main → release 승격 PR(`AGENTS.md` 「main → release 운영 승격」). `prod-ci.yml` 이 이미지를 발행하고 `prod-cd.yml` 을 승인 후 수동 실행한다. 한 서비스·한 인스턴스부터 적용 가능한지는 `prod-cd.yml` 입력에 따른다(**미확인**). Data·Realtime 은 같은 SHA 로 함께 빌드된다 | §4 지표 | 미실행 |
| P3 | Fluent Bit 기동(Infra) 뒤 canary 가 Loki 에 도착. 이어 S3 출력을 켜고 canary 가 **S3 객체에도** 도착하는지 따로 본다([런북 §6](ingestion-runbook.md)) | canary 두 sink | 미실행 |
| P4 | 기존 업로더(티켓 590 타이머·2288)와 `system_log/v2/` 를 일정 기간 병행하고 로그량·마스킹을 대조한 뒤 APP 업로더만 중단([런북 §5](ingestion-runbook.md)). 두 업로더가 같은 호스트에서 같은 prefix 로 중복 쓰는지는 미확인 | 런북 §5 점검표 | 미실행 |
| P5 | Grafana 접근 인증과 수집기 IAM 확인, 경보 연결 | — | 미실행 |

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
| 앱 JSON 출력 | 이전 이미지로 되돌린다(dev: 이전 SHA 재배포, prod: `prod-cd.yml` 의 버전 지정 롤백). JSON 은 프로필(`logback-spring.xml`·`application-{dev,prod}.yml`)에 고정돼 있어 런타임 스위치가 없다 | 되돌린 뒤 stdout 은 텍스트라 Fluent Bit 이 `raw` 로 보관하고 구조화 필드(`request_id` 등)는 조회되지 않는다. JSON 기간의 줄은 남는다 |
| `OBS_*` | 이전 커밋을 재배포한다. 값을 지우면 배포 전 검사가 dev 배포를 멈춘다 | prod 는 Infra 가 값을 되돌린다 |
| `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED` | compose 에서 제거 | agent 1.64.0 기본이 켜져 있어 출력이 달라지지 않는다(2557 조사) |
| Flyway V5(data)·V15(notification) | **되돌리지 않는다.** nullable 열이 남는다 | Data V5 는 이전 번들로 migrate·validate 가 통과하는 것을 테스트한다(`OutboxOriginV5MigrationTest`) |
| Outbox carrier (Kafka·HTTP 헤더) | 이전 이미지. 구버전은 모르는 헤더를 무시한다. 이미 저장된 `origin_*` 는 남는다 | 도메인 이벤트 봉투·`envelope_hash`·멱등 키는 바뀌지 않았다 |
| Realtime Redis wire (`telemetry`) | 이전 이미지. 혼합 배포 양방향 무순서 | 롤백 중에도 클라이언트 DTO·7필드 봉투는 불변 |
| Fluent Bit → Promtail (dev) | `ops-monitor.dev.yml` 을 Promtail 이 포함된 이전 커밋으로 `action=up`. **미검증** — Promtail 복귀 시 읽기 위치와 중복 범위는 기록해 둔다 | Fluent Bit 의 `fluent_bit_state` 볼륨·tail DB 는 지우지 않는다 |
| S3 출력 | `OBS_LOG_S3` 를 제거하고 재배포. Loki 는 계속 동작(두 출력 독립). 기존 업로더 타이머 재개 | 전환 기준 시각 ~ 재개 시각은 v2 와 기존 업로더에 같은 줄이 있을 수 있다 — 범위를 기록([런북 §5](ingestion-runbook.md)). `store_dir`·`tail.db` 는 지우지 않는다 |
| Nginx 호스트 입력 | `OBS_LOG_NGINX_HOST` 제거 후 재배포. 필요하면 `access_log …json.log` 줄을 지우고 reload | 이미 보낸 객체·Loki 줄은 남는다 |
| prod Nginx `log_format` | Infra 가 되돌린다 | 기본 combined 줄도 수집기가 정제한다 |

롤백 판단 기준도 §4 지표로 보되 임계값은 §1-5 와 같이 미정이다. 지연이나 일부 sink 장애 때문에 **다른 sink 를 끄지 않는다**(sink 독립이 깨지면 배포를 중단한다 — V10).

## 6. 이 문서가 확인하지 않은 것

- 모든 단계의 실제 실행(전부 미실행).
- `prod-cd.yml` 의 서비스 단위 적용 가능 여부, prod 의 Nginx compose 서비스명, 실제 S3 리전(`ap-northeast-2` 는 가정), 두 업로더의 공존.
- Promtail 복귀 절차의 실제 동작.
- §4 LogQL 의 실제 실행 결과.
