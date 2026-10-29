# 서버 로그 통합 설계의 공식 문서 검증

- 조회일: 2026-10-29
- 목적: Logback 로그 연결, 일반 서버 로그 조회, 장애·성능 추적, S3 보관 계획의 기술 전제 검증.
- 범위: 공개 공식 문서만 조사했다. 운영 AWS·Datadog 상태, 실제 로그 발생량, 배포 버전과 성능은 확인하지 않았다.
- 구분: **확인된 사실**은 출처의 기능·제약이며, **설계 제안**은 이 프로젝트에 적용할 선택이다. 실제 도입 버전을 고정한 뒤 해당 버전에서 재현해야 한다.

## 1. 로그 연결과 APM ID

**확인된 사실:** W3C Trace Context는 `traceparent`와 `tracestate`를 정의한다. `trace-id`는 32자리 소문자 16진수이며 전체 0은 유효하지 않다. 요청 구간의 부모 식별자와 trace ID는 서로 다른 값이다. [W3C Trace Context](https://www.w3.org/TR/trace-context/)

Datadog Java는 `datadog`, `tracecontext` 전파 형식을 지원하고, 추출·주입 형식을 각각 지정할 수 있다. Datadog 헤더의 `x-datadog-trace-id`는 128비트 ID 하위 64비트의 십진수 표현이며 상위 비트는 별도 문맥에 포함된다. 따라서 헤더 문자열과 W3C trace ID를 그대로 문자열 비교하면 같은 trace도 다르게 보일 수 있다. [Datadog 전파 문서](https://docs.datadoghq.com/tracing/trace_collection/trace_context_propagation/?tab=java)

Java tracer는 Logback MDC에 로그 연결 ID를 주입할 수 있다. `DD_LOGS_INJECTION=true`를 사용하고 JSON encoder가 필드를 출력하는지 확인해야 한다. `dd.trace_id`, `dd.span_id`는 숫자가 아닌 문자열로 파싱해야 한다. [Java 로그 연결 문서](https://docs.datadoghq.com/tracing/other_telemetry/connect_logs_and_traces/java/)

`DD_TRACE_128_BIT_TRACEID_GENERATION_ENABLED`와 `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED`는 별도 옵션이다. 조회 시점 Java 설정 문서는 둘을 지원하지만, 저장소가 사용하는 tracer 버전의 지원·기본값까지 증명하지는 않는다. [Java 설정 문서](https://docs.datadoghq.com/tracing/trace_collection/library_config/java/)

Datadog은 128비트와 하위 64비트 trace의 호환 처리를 설명한다. 이는 같은 trace에서 파생한 표현 간 호환이며, 애플리케이션이 별도 생성한 UUID를 Datadog trace로 바꿔 주는 기능이 아니다. [Datadog Trace IDs](https://docs.datadoghq.com/opentelemetry/reference/trace_ids/)

**설계 제안:**

1. 기존 Datadog Java agent를 유지하고 두 번째 OTel Java agent를 설치하지 않는다. W3C 전파를 위해 OTel agent가 필요한 것은 아니다.
2. `request_id`는 문의·응답 조회용 식별자로 유지한다. 기존 임의 UUID `trace_id`를 `dd.trace_id`로 이름만 바꾸지 않는다.
3. 새 공통 `trace_id`는 실제 활성 tracer의 W3C 128비트 ID로 정한다. `dd.trace_id`·`dd.span_id` 원문도 별도 보존하며 표현 차이를 검사한다. 64비트 문자열을 임의로 잘라 붙여 128비트 값이라고 주장하지 않는다.
4. 고정 tracer 버전에서 다음 설정을 검증한다. 기존 명시적 `INJECT`·`EXTRACT` 설정이 있으면 공통 설정보다 우선하는지도 확인한다.

   ```text
   DD_LOGS_INJECTION=true
   DD_TRACE_128_BIT_TRACEID_GENERATION_ENABLED=true
   DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED=true
   DD_TRACE_PROPAGATION_STYLE_INJECT=datadog,tracecontext
   DD_TRACE_PROPAGATION_STYLE_EXTRACT=datadog,tracecontext
   ```

5. 애플리케이션 UUID, HTTP `traceparent`, Logback JSON, Datadog APM 화면을 실제 요청 하나로 대조한다. Grafana→Datadog 링크가 올바른 trace를 여는지까지 완료 기준에 포함한다.
6. trace가 없는 기동·스케줄러 로그도 저장한다. 샘플링된 trace가 없어도 로그 조회가 가능해야 하며, trace ID 존재만으로 상세 APM 데이터 보존을 단정하지 않는다.

## 2. Fluent Bit의 두 출력과 보관 보장

**확인된 사실:** Tail의 `db`는 읽던 파일·offset을 기억한다. DB는 input마다 고유 경로를 권장하며, WAL 모드는 공유 네트워크 파일시스템과 호환되지 않는다. 긴 로그가 `buffer_max_size`를 넘으면 추적 중단 또는 설정에 따른 건너뛰기가 발생할 수 있다. [Tail 문서](https://docs.fluentbit.io/manual/data-pipeline/inputs/tail)

Fluent Bit은 filesystem buffering을 지원한다. 일반 출력의 `storage.total_limit_size`에 도달하면 그 출력 큐의 오래된 chunk가 버려진다. 디스크 버퍼는 메모리보다 손실 위험을 줄이지만 무유실 보장은 아니다. [버퍼링 문서](https://docs.fluentbit.io/manual/data-pipeline/buffering)

출력은 `OK`·`Retry`·`Error`를 반환하며, `Error`는 재시도하지 않는다. 재시도 정책도 별도 설정이다. [재시도 문서](https://docs.fluentbit.io/manual/administration/scheduling-and-retries)

S3 출력은 자체 `store_dir`와 `store_dir_limit_size`를 사용한다. 일반 HTTP success/retry/error 지표는 S3 업로드 성공을 나타내지 않는다. flush 성공은 로컬 버퍼 기록일 수 있다. S3 버퍼 한도에 도달하면 데이터가 폐기될 수 있다. `total_file_size`·`upload_timeout`으로 파일 크기와 업로드 시점을 제어하며, 기본 레코드 형식은 JSON Lines다. `$UUID` 등으로 객체 키 충돌을 방지한다. `log_key`를 지정하면 해당 필드만 저장되므로 공통 메타데이터가 빠질 수 있다. [Fluent Bit 4.2 S3 문서](https://docs.fluentbit.io/manual/4.2/data-pipeline/outputs/s3)

**설계 제안:**

- Tail DB, engine storage, S3 store를 서로 구분한 영속 로컬 경로에 둔다. 컨테이너 재생성으로 초기화되는 `/tmp`를 사용하지 않는다.
- Loki와 S3는 독립적으로 성공·실패하는 두 출력이다. 한쪽 성공을 다른 쪽 저장 완료로 취급하지 않는다. 공유 디스크 고갈은 두 경로 모두 영향을 줄 수 있다.
- 재전송 중복을 허용하는 설계로 명시한다. 전체 경로에 exactly-once 또는 조건 없는 at-least-once를 보장한다고 쓰지 않는다. 로그 생성 단계의 `log_id`를 재수집 후에도 유지해 중복·누락을 측정한다. 업무 이벤트의 `event_id`와는 구분한다.
- 수집 버퍼에서 이미 버려진 로그를 S3가 복구해 주지 않는다. Logback 큐 포화·프로세스 강제 종료·호스트 디스크 소실도 별도 손실 지점이다.
- Loki 큐 용량, S3 store 사용량, 가장 오래된 미전송 로그 나이, 실제 S3 객체 도착 시각을 각각 감시한다. 정기 canary 로그의 S3 도착 검사로 실제 저장 경로를 검증한다.
- S3 업로드 목표 5분은 초기 제안값이다. 정상 트래픽·객체 크기·요금·장애 허용시간을 측정해 확정한다. 타임아웃은 네트워크 장애 때의 최대 도착시간 보장이 아니다. 시스템 로그 S3 90일은 [기존 보존 정책](../../prd/fishcat/account/policy.md#로그분석-보존-기간)을 유지하는 안이며, 실제 버킷 적용 여부는 별도 확인한다.
- 두 버퍼와 원본 로그 회전 공간을 합산해 디스크를 산정한다. 초기 산식은 `피크 수집 bytes/s × 허용 단절 초 × 여유계수`이며, 각 버퍼의 실제 내부 표현 크기와 복구 처리율을 측정해 보정한다.

## 3. Loki의 검색 모델과 보존

**확인된 사실:** Loki는 레이블 조합마다 stream을 만든다. trace ID·request ID처럼 값이 계속 늘어나는 필드를 레이블로 사용하면 stream·index·작은 chunk가 늘어난다. 낮은 cardinality 레이블을 사용하고 상세 필드는 JSON 본문 또는 지원되는 structured metadata에 둔다. [레이블 문서](https://grafana.com/docs/loki/latest/get-started/labels/), [레이블 모범 사례](https://grafana.com/docs/loki/latest/get-started/labels/bp-labels/)

Fluent Bit에는 내장 Loki output이 있으며, Grafana가 제공하는 별도 Golang plugin과 설정이 다르다. 구현 시 둘의 설정을 섞으면 안 된다. [Fluent Bit 4.2 Loki 문서](https://docs.fluentbit.io/manual/4.2/data-pipeline/outputs/loki)

Loki의 현대식 보존 처리는 Compactor가 담당한다. `retention_enabled`를 켜야 하고 TSDB/BoltDB single-store index 주기는 24시간이어야 한다. object-store lifecycle은 Loki 보존보다 길어야 하며 chunk/index를 함께 무작정 지우면 조회가 깨질 수 있다. [Loki 보존 문서](https://grafana.com/docs/loki/latest/operations/storage/retention/)

**설계 제안:**

- 초기 레이블은 `env`, `service`, `log_kind` 정도로 제한한다. `trace_id`, `request_id`, `event_id`, 사용자 ID, 인스턴스 ID, 전체 URL은 JSON 필드로 검색한다.
- `trace_id`로 서비스 전체를 검색할 때 먼저 환경과 시간 범위를 좁힌다. S3 보관기간 전체를 대상으로 즉시 조회 가능한 전역 trace index를 제공하는 구조는 아니다.
- dev Loki 7일은 [기존 정책](../../prd/fishcat/account/policy.md#로그분석-보존-기간)과 [저장소 설정](../../../server/observability/loki/loki-config.yml)에 있는 값이며, prod 신규 Loki의 7일은 제안이다. 설치된 Loki 버전·schema·Compactor·영속 marker 경로를 확인한 뒤 적용한다. structured metadata는 실제 버전과 schema가 지원할 때 사용하고, 초기에는 JSON query만으로도 시작할 수 있다.
- 장시간 Loki 장애 후 재전송하는 로그는 out-of-order·최대 수집 나이 제한을 별도로 검증한다. 재시도만 반복한다고 오래된 로그가 반드시 수용되는 것은 아니다.

## 4. 두 종류의 S3 데이터와 장기 검색

**확인된 사실:** Loki object storage에는 chunk와 TSDB/BoltDB index가 저장된다. 이는 수집기의 JSON Lines 원본과 다른 저장 형식이다. [Loki 아키텍처](https://grafana.com/docs/loki/latest/get-started/architecture/)

Athena는 JSON SerDe를 제공한다. Hive/OpenX JSON SerDe는 레코드마다 한 줄의 JSON을 기대한다. [Athena JSON SerDe](https://docs.aws.amazon.com/athena/latest/ug/json-serde.html)

**설계 제안:**

| 데이터 | 용도 | 보존 책임 | 조회 경로 |
| --- | --- | --- | --- |
| Fluent Bit → S3 JSONL.gz | 장기 원본 보관 | 원본 버킷 lifecycle | 날짜·서비스 범위 다운로드 또는 Athena |
| Loki → object storage chunk/index | 최근 검색 서비스의 내부 저장 | Compactor와 Loki 설정 | Grafana/LogQL |

버킷을 분리하는 것을 기본안으로 삼는다. 같은 버킷을 쓸 경우에도 prefix·IAM·lifecycle을 분리해야 하며, Loki 내부 경로를 원본 archive처럼 직접 Athena로 읽는 계획은 사용하지 않는다.

원본 키는 `env/service/date/hour/unique-id.json.gz` 형태로 정의하고, UTC 기준을 명시한다. S3 출력 키의 시간은 파일 첫 레코드 기준이므로 한 객체에 다음 시간대 또는 늦게 도착한 레코드가 섞일 수 있다. [S3 키 형식 문서](https://docs.fluentbit.io/manual/4.2/data-pipeline/outputs/s3#s3-key-format-and-tag-delimiters)

수집 시각 기준 키를 채택하면 S3 출력 경로의 내부 레코드 timestamp를 `observed_at`에 명시적으로 매핑해야 한다. Loki용 발생 시각과 JSON의 `timestamp`는 유지한다. 파티션 경계가 발생 시각 경계와 항상 같다고 가정하지 않는다. 초기 archive 검색은 객체가 시간 경계를 넘는 범위와 수집 지연을 반영해 후보 파티션을 넓히고 본문 `timestamp`로 최종 필터링한다. 지연 상한을 모르면 인접 한 시간만으로 완전 검색을 보장하지 않는다. 정확한 시간별 재파티셔닝이 필요하면 후속 변환 작업으로 분리한다.

Athena를 도입할 때는 테이블·파티션·JSON schema·스캔 비용 제한·조회 예제를 별도 작업으로 완료한다. JSONL.gz 객체가 있다는 사실만으로 장기 검색 화면이 완성되지는 않는다.

## 5. Promtail 전환

**확인된 사실:** Promtail은 2026-03-02 EOL에 도달했다. Grafana는 Alloy 또는 다른 지원되는 클라이언트로 전환하도록 안내한다. [Promtail 문서](https://grafana.com/docs/loki/latest/send-data/promtail/)

**설계 제안:** Loki와 S3에 직접 보내는 이번 범위에서는 Fluent Bit을 검증 후보로 삼는다. 이전 수집기를 즉시 제거하지 말고 dev 대표 서비스에서 JSON 파싱·로그 수량·순서를 비교한 후 전환한다. 동일 로그를 같은 Loki stream으로 두 번 보내는 이중 수집 기간은 피한다.

## 6. 구현 전 재현할 검증 항목

아래는 공식 제품의 보장 목록이 아니라 계획의 인수 조건이다.

| 실험 | 통과 기준 |
| --- | --- |
| HTTP 요청 및 외부 문맥 없음 | Business·Data의 실제 tracer ID가 연결되고 요청 ID와 혼동되지 않음 |
| 128비트 및 기존 64비트 문맥 | 전파 헤더·JSON·APM의 표현을 구분하고 올바른 trace 링크 확인 |
| executor·Outbox·Kafka·재시도 | 작업 경계에서 문맥 연결, `event_id`/attempt 보존, 다음 요청으로 MDC 누출 없음 |
| JSON 예외·긴 로그·Docker 분할 | 한 이벤트로 복원, 마스킹 유지, 잘림/건너뛰기 계수 확인 |
| Loki만 중단 / S3만 중단 | 각 버퍼와 다른 출력의 진행 확인, 저장 성공을 독립 판정 |
| collector 재시작·로그 회전 | tail offset·버퍼 복원, 중복/누락을 `log_id`로 계산 |
| 버퍼 포화·디스크 부족 | 실제 폐기 동작과 알림 확인, 무유실 주장 금지 |
| Loki 보존기간 경과 | 최근 조회에서 삭제 확인, S3 원본의 별도 보존·검색 확인 |
| 부하 및 낮은 로그 발생량 | API 지연·CPU·디스크 증가 측정, 작은 트래픽에서도 업로드 목표 확인 |

성능 수치, 비용, 운영 적용 여부는 위 실험과 운영 설정 확인 전까지 미검증으로 남긴다.
