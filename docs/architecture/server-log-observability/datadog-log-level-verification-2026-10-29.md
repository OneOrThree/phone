# Datadog 로그 심각도 오분류 검증 — 2026-10-29

검증일: 2026-10-29. GCP dev 호스트의 Docker 원본 로그·실행 설정과 Datadog us5의 저장 로그·실제 파이프라인 설정을 읽기 전용으로 대조했다. 서버, 수집기, Datadog 파이프라인 설정은 변경하지 않았다. 부하 테스트·부하용 데이터 생성·컨테이너 재시작은 실행하지 않았다.

## 결론

`I1029 … kafka_exporter.go:678] [kafka:9092]`와 PostgreSQL checkpoint 로그가 Datadog에서 `error`로 분류되는 문제를 확인했다. 두 소스 모두 원본 Docker 로그는 `stream=stderr`이고, 실제 심각도를 추출·보정할 파이프라인이 적용되지 않는다. Kafka 브로커 장애 건수로 해석하면 안 된다.

다만 다른 시간대의 실제 Kafka 연결 실패와 Datadog profiler 관련 오류도 확인했다. 모든 에러를 정상 로그로 바꾸거나 Exporter 로그를 통째로 제외하는 방식은 적절하지 않다.

사용자가 전달한 **956건**은 원 조회의 절대 시작·종료 시각이 없어 동일 집합을 재현하지 못했다. 아래는 별도로 고정한 시간 범위에 대한 검증이며 그 956건을 직접 전수 확인했다고 주장하지 않는다.

## 1. 동일한 한 시간의 전수 집계

시간: **2026-10-29 17:00:00~18:00:00 KST** (`08:00:00Z~09:00:00Z`). Datadog Agent가 실행 중이었던 구간이다.

| 실제 컨테이너 | 원문 분류 | Docker 스트림 | Datadog status | 건수 |
| --- | --- | --- | --- | ---: |
| `gromo-kafka-exporter` | `I1029 … kafka_exporter.go:678] [kafka:9092]` | stderr | error | 960 |
| `phone-db` | `LOG: checkpoint starting/complete` | stderr | error | 24 |
| `phone-kafka` | INFO | stdout | info | 8 |

Datadog의 위 구간 호스트 전체 로그를 서비스·컨테이너·status별로 집계했다. error로 집계된 것은 위 Exporter 960건과 DB 24건뿐이었다. 메시지 조건부 합계도 각각 960·24로 일치했다. Docker 원본 로그를 독립적으로 같은 시간 버킷으로 집계한 결과도 일치했다.

[Datadog 해당 시간 Kafka 로그](https://us5.datadoghq.com/logs?from_ts=1793260800000&to_ts=1793264400000&live=false&query=host%3Agromo-dev%20service%3Agromo-kafka-dev)

전수 집계 SQL:

```sql
SELECT service, container_name, status, COUNT(*) AS total,
       SUM(CASE WHEN message LIKE 'I1029%kafka_exporter.go:678]%[kafka:9092]%'
                THEN 1 ELSE 0 END) AS exporter_info,
       SUM(CASE WHEN message LIKE '%LOG:%checkpoint starting:%'
                     OR message LIKE '%LOG:%checkpoint complete:%'
                THEN 1 ELSE 0 END) AS checkpoint_log
FROM logs
GROUP BY service, container_name, status
ORDER BY total DESC
```

`analyze_datadog_logs`의 filter는 `host:gromo-dev`, from/to는 위 UTC 범위, 추가 컬럼은 `container_name`(varchar)이다. 기본 indexed logs 범위다. raw log 샘플의 일부 개수를 전체 건수로 사용하지 않았다.

## 2. 같은 메시지의 원본과 수집 결과 대조

Exporter 원문:

```text
I1029 08:59:57.086769       1 kafka_exporter.go:678] [kafka:9092]
```

- Docker: `time=2026-10-29T08:59:57.086911603Z`, `stream=stderr`.
- Datadog: 동일한 메시지, `status=error`, `source:kafka-exporter`, `container_name:gromo-kafka-exporter`, `datadog.pipelines:false`.

PostgreSQL 원문의 `2026-10-29 08:56:03.094 UTC [26] LOG: checkpoint complete: …`도 동일 메시지를 대조했다. Docker는 `stream=stderr`, Datadog는 `status=error`, `source:postgres`, `container_name:phone-db`, `datadog.pipelines:false`였다.

Datadog Docker 수집은 stderr를 기본 error로 분류한다. 실제 스트림과 최종 status를 대조했고, 다음 절에서 매칭 파이프라인 부재도 확인했다. [Datadog Docker 로그 수집 문서](https://docs.datadoghq.com/containers/docker/log/)

## 3. 실제 실행 설정과 파이프라인

dev VM은 GCP `oneorthree2`의 `gromo-dev-app`이다. 저장소 YAML만 추정에 사용하지 않고 `docker inspect`로 실행 설정을 확인했다.

| 설정 | 실제 값 |
| --- | --- |
| `DD_HOSTNAME` | `gromo-dev` |
| Exporter `com.datadoghq.tags.service` | `gromo-kafka-dev` |
| 브로커 `com.datadoghq.tags.service` | `gromo-kafka-dev` |
| DB `com.datadoghq.tags.service` | `gromo-db-dev` |
| `DD_LOGS_ENABLED` | true |
| `DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL` | true |
| `DD_LOGS_CONFIG_DOCKER_CONTAINER_USE_FILE` | true |
| 원본 로그 | Docker `json-file`, 10m × 3 |
| 컨테이너 로그 디렉터리 | Agent에 `/var/lib/docker/containers` 읽기 전용 마운트 |

따라서 `gromo-dev`와 `gromo-kafka-dev`는 두 서비스가 아니라 host와 service라는 서로 다른 차원이다. 같은 service 안에서도 실제 컨테이너를 구분해야 한다.

Datadog `LogsPipelinesApi.getLogsPipelineOrder()`와 `listLogsPipelines()`로 확인한 활성 파이프라인은 다음 5개였다.

| 이름 | 필터 |
| --- | --- |
| Nginx | `source:nginx` |
| AWS CloudTrail | `source:cloudtrail` |
| Java | `source:java` |
| Kafka | `source:kafka` |
| Redis | `source:redis` |

Exporter의 `source:kafka-exporter`와 DB의 `source:postgres`에 맞는 파이프라인이 없다. Kafka 파이프라인이 존재한다는 사실만으로 Exporter 로그도 처리된다고 볼 수 없다. 이번 확인은 `datadog.pipelines:false` 표시에만 의존하지 않았다.

## 4. 정상으로 덮어쓰면 안 되는 실제 오류

Docker 원본의 2026-10-29 로그에서 다음을 별도로 확인했다.

| KST 시각 | 레벨·건수 | 내용 |
| --- | --- | --- |
| 09:51:27 | E 1건 | `realtime-events.DLT`의 current offset 조회 실패, available brokers 없음 |
| 12:53:59~12:57:15 | F 20건 | Kafka client 초기화 실패, `connection refused` |
| 14:04:37 | E 1건 | `__consumer_offsets` oldest offset 조회 실패, `broken pipe` |

브로커의 현재 컨테이너 `StartedAt`은 12:55:47 KST다. F 로그 구간과 재기동 시점은 겹치지만, 재기동의 원인·주체나 업무 영향은 이번 검증에서 확정하지 않았다.

더 최근 구간(18:09:28~19:09:28 KST)에는 Kafka·DB 외에도 Business 14건, Notification 5건, Realtime 1건이 Datadog error로 집계됐다. 패턴 조회에서 profiler의 `UnsatisfiedLinkError`, crash tracking 초기화 실패, telemetry 전송 실패와 함께 INFO·WARN의 error 오분류도 관측됐다. 해당 20건 전체를 정상 또는 업무 장애로 단정하지 않는다. **“Exporter 외에는 전부 PostgreSQL checkpoint뿐”이라는 결론은 원래 시간 범위를 벗어나 일반화할 수 없다.**

## 5. 별도 발견: 수집 중단

`gromo-datadog-agent`는 **2026-10-29 18:43:21 KST**에 종료됐다(`ExitCode=0`, `OOMKilled=false`). 검증 시점에도 exited 상태였다. 종료 원인과 의도된 중지 여부는 확인하지 않았다.

Datadog에서 `host:gromo-dev`의 18:09:28~19:09:28 로그를 집계했을 때 마지막 수신 timestamp는 **18:43:17 KST**였다. 이후에도 Exporter의 Docker 로그는 생성되고 있었다. 예를 들어 Docker에는 19:03:56의 INFO 로그가 있다.

따라서 수신 건수나 에러 건수 감소를 장애 해소 증거로 사용하면 안 된다. 확인 시각을 고정한 원본 최근 1시간(18:09:28~19:09:28)에는 Exporter INFO 856건, DB checkpoint 16건이 있었지만 Datadog에는 같은 구간 Kafka 서비스 error 542건, DB error 14건만 집계됐다. 로그의 수집 timestamp와 원본 timestamp 차이도 있으므로 이 차이를 정확한 유실 건수로 단정하지 않는다.

## 6. 수정 시 완료 기준 — 이번에는 미적용

1. Exporter 전용 파서로 I/W/E/F를 추출하고 **명시적으로** 심각도를 매핑한 뒤 Status Remapper에 연결한다. 특히 E 한 글자는 Datadog 기본 매핑의 `err` 조건과 다르므로 그대로 넘기면 안 된다. [Status Remapper 규칙](https://docs.datadoghq.com/api/latest/logs-pipelines/create-a-pipeline/)
2. PostgreSQL은 정상 LOG와 ERROR/FATAL/PANIC을 구분한다. 공식 integration의 로그 source는 `postgresql`이다. 현재 `source:postgres`와의 차이를 반영해 source 설정 또는 전용 파이프라인 필터를 맞춰야 한다. [Postgres integration](https://docs.datadoghq.com/integrations/postgres/)
3. 브로커와 Exporter는 별도 service 태그 또는 명시적인 container/source 필터로 구분한다. 서비스명을 바꾸면 기존 대시보드·모니터 쿼리도 함께 점검한다.
4. 저장된 실로그와 로컬 fixture로 INFO·WARN·ERROR·FATAL, checkpoint·DB ERROR의 양방향 분류를 검증한다. 파싱 실패를 무조건 info로 내리지 않는다.
5. 수집기 중지가 의도된 것인지 확인하고, 이후 승인된 정상 운영 상태에서 신규 로그 유입·정상 분류·실제 오류 유지 여부를 별도로 검증한다. 이번 작업에서는 Agent나 앱을 시작하지 않았다.

검증 결과는 **오분류 원인 확인 완료 / 수정·배포 후 검증 미완료**다. Kafka 전체 정상이나 시스템 전체 무장애를 증명한 검사는 아니다.

## 증거 위치

로컬 원본·쿼리 결과: `/tmp/gromo-log-level-audit-20261029/`.

- `host-audit.jsonl`: 실행 설정·컨테이너 상태. 초기 로그 집계는 원격 Python의 나노초 파싱 차이로 누락되어 사용하지 않는다.
- `host-logs-corrected.jsonl`: 초 단위 timestamp로 재집계한 결과. 읽은 모든 로그의 JSON·시각 파싱 실패 0건.
- `exact-message-cross-check.jsonl`: Docker와 Datadog 동일 메시지 대조.
- `exporter-real-errors.jsonl`: 날짜 내 E/F 원문.
- `counts-stable-hour-result.json`, `counts-latest-hour-result.json`: Datadog 전수 집계.
- `sample-exporter-result.json`, `sample-postgres-result.json`: raw log 속성·태그.
- `pipelines-summary.json`, `pipelines-result.json`: 실제 활성 파이프라인.
- `recent-app-errors-result.json`: 최근 앱 오류 패턴 일부. 토큰 제한으로 잘린 결과이므로 전체 오류 원인 분류에는 사용하지 않는다.

인증 토큰·API 키는 이 문서나 증거 파일에 저장하지 않았다.
