# Kafka 브로커와 Exporter 로그 조회 경로 분리 (GROMO-2573)

## host 와 service 는 다른 차원이다

- host: `gromo-dev` (`DD_HOSTNAME`). 모든 컨테이너가 같다.
- service: Exporter(`gromo-kafka-exporter`), JMX Exporter(`gromo-kafka-jmx-exporter`), 브로커(`phone-kafka`)가 모두 `com.datadoghq.tags.service=gromo-kafka-dev` 를 쓴다.

그래서 `service:gromo-kafka-dev` 로 로그를 열면 브로커와 Exporter 줄이 섞인다. 사용자 지시에 따라 service 를 일괄 바꾸지 않는다. service 태그가 `kafka.*` 메트릭의 `service:gromo-kafka-dev` 인스턴스 태그와 같은 값이어서, 바꾸면 기존 메트릭 필터가 끊길 수 있다. 대신 로그 링크의 조건만 컨테이너·source 로 나눈다.

## 구분 조건

| 구성요소 | 컨테이너 | source (검증 보고서 §3) | 링크 쿼리 |
|---|---|---|---|
| 브로커 | `phone-kafka` | `kafka` | `env:dev service:gromo-kafka-dev (container_name:phone-kafka OR source:kafka)` |
| Exporter | `gromo-kafka-exporter` | `kafka-exporter` | `env:dev service:gromo-kafka-dev (container_name:gromo-kafka-exporter OR source:kafka-exporter)` |

`source:kafka` 는 정확히 일치하는 값만 고르므로 `kafka-exporter` 를 포함하지 않는다. 컨테이너 이름과 source 중 하나만 맞아도 걸리게 OR 로 묶어 둔다. 괄호는 URL 에서 `%28 %29` 로 인코딩해 마크다운 링크를 깨지 않게 했다. 문법은 Datadog 로그 검색 문서의 불리언 연산자·`key:value` 규칙을 따랐다. 실제 Datadog 화면에서 열어 본 확인은 하지 않았다.

`gromo-kafka-jmx-exporter` 는 이번 범위가 아니며 두 링크 어디에도 잡히지 않는다(컨테이너·source 조건 불일치). 로그 링크가 필요하면 별도 조건을 추가한다.

## 바꾼 링크 (`gromo-dev-architecture.json` 위젯 18 「상세 조사」)

- 전: `[Kafka 로그](https://us5.datadoghq.com/logs?query=env%3Adev%20service%3Agromo-kafka-dev)`
- 후: `[Kafka 브로커 로그](…query=env%3Adev%20service%3Agromo-kafka-dev%20%28container_name%3Aphone-kafka%20OR%20source%3Akafka%29)` · `[Kafka Exporter 로그](…query=env%3Adev%20service%3Agromo-kafka-dev%20%28container_name%3Agromo-kafka-exporter%20OR%20source%3Akafka-exporter%29)`

대시보드 JSON 은 생성기가 없어 직접 고쳤다. 메트릭 위젯(위젯 5·6·7 의 `kafka_cluster:gromo-dev` 쿼리)과 APM 링크는 건드리지 않았다.

## 영향 점검

저장소 안 `gromo-kafka-dev` 사용처:

| 위치 | 용도 | 영향 |
|---|---|---|
| `server/scripts/docker-compose.kafka.yml:33` | 브로커 service 태그 | 없음(변경 안 함) |
| `server/scripts/docker-compose.kafka.yml:36` | Kafka JMX 인스턴스 tags | 없음 |
| `server/scripts/docker-compose.observability.yml:153,170` | Exporter·JMX Exporter service 태그 | 없음 |
| `server/observability/datadog/dashboards/gromo-dev-architecture.json` 위젯 18 | 로그 링크 | 변경됨(위 표) |

저장소 안에 `gromo-kafka-dev` 를 쓰는 모니터·알림 정의는 없다. 메트릭 쿼리 집합은 변경 전과 같음을 `test_log_links.py` 가 확인한다.

## 외부(저장소 밖) 확인 범위

Datadog MCP 읽기 도구로 조회했다(쓰기 없음).

- 모니터 검색 `gromo-kafka-dev`: 결과 없음.
- 대시보드 검색 `kafka`: Datadog 통합 기본 대시보드 3개(143, 2149, 2626)만 나왔고 GROMO 사용자 대시보드는 나오지 않았다.

검색은 제목·위젯 중심이라 모니터 쿼리 본문이나 노트북·SLO·로그 파이프라인·저장된 뷰 안의 사용은 **미확인**이다. 외부 설정 전체가 영향 없음이라고 주장하지 않는다. service 태그를 바꾸지 않았으므로 외부 설정도 영향이 없을 것으로 보이지만 확인한 것은 아니다.

## Datadog 반영 (실행하지 않음)

이번 작업은 저장소 JSON 만 바꿨다. Datadog 에 대시보드를 올리거나 수정하지 않았다. 반영하려면:

1. 현재 대시보드 JSON 을 내려받아 백업한다(Datadog UI Export 또는 API GET).
2. 저장소의 `gromo-dev-architecture.json` 을 import 한다(기존 대시보드를 덮어쓸지 새로 만들지 먼저 정한다).
3. 대시보드 「상세 조사」의 두 링크를 열어 각각 브로커·Exporter 줄만 나오는지 본다.
4. 문제가 있으면 1 에서 받은 백업 JSON 으로 되돌린다.

## 남은 범위

- `gromo-kafka-jmx-exporter` 로그는 브로커·Exporter 두 링크 어디에도 잡히지 않는다(같은 `gromo-kafka-dev` service 이지만 컨테이너·source 조건이 다르다). 필요하면 별도 링크를 추가한다.

## 검증

`python3 -m unittest discover -s server/observability/datadog/dashboards -p 'test_*.py'` 는 두 링크의 `query` 를 디코드해 서로 다르고, 각 조건이 상대 컨테이너·source 를 포함하지 않음을 확인한다. 메트릭 쿼리는 변경 전 대시보드에서 뽑아 저장한 `dashboards/fixtures/metric-queries-before.json`(정렬된 목록)과 현재 JSON 의 집합이 같은지 비교한다. git 을 호출하지 않으므로 커밋 뒤에도 의미가 유지된다.
