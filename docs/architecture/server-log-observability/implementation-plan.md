# 구현 계획과 검증 기준

> 2026-10-29 작성. **전체 구현·운영 검증 계획**이다. 착수한 범위와 실제 결과는 [티켓·구현 현황](implementation-status.md)에 분리한다. 코드·공식 문서 검토 결과는 [아키텍처](README.md)와 [조사 기록](research.md)에 남긴다.

Logback XML·custom provider 계약, 실제 executor별 문맥 전달, Loki/Athena 연결 조회 예시는 [구현 상세](implementation-details.md)를 따른다.

## 1. 구현 순서

운영 활성화는 P0 → P1 → P2 → P3 → P4 순서로 적용한다. 원격 상태를 바꾸지 않는 P1 요청 ID 코드 구현·로컬 검증은 P0 조사와 병행한다. 각 단계는 이전 완료 조건을 확인한 뒤 진행한다. 로그·APM·원본 보관을 한 번에 전체 서비스에 켜지 않는다.

| 단계 | 작업과 산출물 | 완료 조건 |
| --- | --- | --- |
| P0: 실제 기준 확정 | 서비스별 유효 compose·agent 버전·trace 전파·로그량·호스트 여유·업로더·S3 lifecycle 조사표. 수집기 버전 고정 및 dev→S3 자격 방식 결정 | 대표 요청의 실제 DD trace ID 표현·전파·샘플링을 확인. 비용/디스크 예산과 필터 적용 범위를 기록 |
| P1: HTTP 한 경로 연결 | Business·Data 공통 JSON, OBS metadata 명시 주입, request/origin ID 유지, agent trace/span 출력, 인증 실패 포함 access 로그, executor 문맥 처리, dev 수집기→Loki | 정상·500·401·403·413·timeout 요청에서 실제로 진입한 서비스들의 로그를 요청 번호로 탐색. metadata가 컨테이너 출력과 일치. 한 trace의 APM 구간과 로그 ID 일치. 요청 간 문맥 누출 없음 |
| P2: S3와 수집 내구성 | Fluent Bit dual output, 영속 cursor/buffer, IAM·S3 prefix/lifecycle, old/new 업로더 전환 절차, Athena 최소 조회, canary와 경보 | 정상 상태 S3 p95 가시성 ≤5분 목표 검증. 재시작·전송 중단·회전 실험에서 누락/중복 수량 보고. 7일 이전 원본 조회 경로 검증 |
| P3: 비동기·나머지 서버 | Outbox 추적 metadata migration, Kafka/내부 HTTP 전파, Notification 기기별 발송 시도 operation 연결, Realtime Redis 내부 carrier·message ID, infra source/parser | 원요청→Outbox→소비→기기별 발송 시도·Redis 인스턴스 간 전달을 탐색. 복수 원인·구버전 행/wire·재시도·DLT 정상 처리 |
| P4: 운영 사용 완성 | 서버 로그·오류·느린 API·수집 상태 대시보드, APM 링크, 지표 연계, prod 배치/런북, 보존 정책 정합 | 대표 부하·장애 실험 통과 후 점진 배포. 운영자가 로그에서 원인 구간과 당시 자원 상태에 도달 가능 |

P1 종료 시 첫 가치를 확인할 수 있다. 최초 S3 포함 배포 단위는 P1+P2이며, 전체 서버와 비동기 흐름의 완료는 P3/P4까지다. 실제 배포 일정은 P0에서 환경 접근·인프라 변경 범위를 확인한 후 산정한다.

## 2. 변경 예상 위치

아래는 전체 구현 시 변경 후보다. 실제 변경한 파일·테스트는 구현 현황을 따른다.

| 영역 | 파일/경로 | 책임 |
| --- | --- | --- |
| JSON·마스킹 | `server/*/src/main/resources/logback-spring.xml`, 각 `build.gradle`, logging package | 공통 필드·stack trace·log ID, JSON 라이브러리 호환. 기존 Data 전용 encoder를 다른 서비스에 도입 시 각 JVM 라이브러리 조합 검증 |
| HTTP 문맥 | Data `TraceIdFilter`·`FilterConfig`, Business `RequestEnvelopeFilter`·`InternalHttpClient`·executor 구성 | request/trace 분리, 인증 전후 문맥, 전체 HTTP 경로와 thread 전파 |
| 비동기 문맥 | Data `EventOutbox`·command DTO·Relay·Kafka/HTTP transport·Flyway, Notification/Realtime consumers 및 후속 작업 저장 | nullable metadata, 기존 봉투·checksum·멱등·트랜잭션 경계 보존 |
| 발송 시도·인스턴스 간 연결 | Notification `DispatchService`, Realtime `ChatFanoutEvent`·`RealtimeEventFanoutEvent`·subscriber·`RedisConfig` | 복수 원인→operation 연결, Redis carrier·message ID·구버전 wire 호환 |
| 수집 | `server/observability/fluent-bit/` 신규, `server/scripts/docker-compose.*.yml` | source·parser·routing·영속 볼륨·자원 제한·두 출력 |
| 조회 | `server/observability/loki/`, `grafana/`, `prometheus/` | labels·retention·대시보드·경보·APM 링크 |
| 인프라 | 별도 `OneOrThree/Infra` 저장소의 `terraform/`·`prod/catus/runtime` 및 S3 설정 기록 | IAM·버킷·lifecycle·실제 배치. 2288의 정본 확인에 따라 구 OneOrThree/terraform은 신규 수정 대상으로 사용하지 않음 |
| 문서 | `docs/architecture/decisions.md`, `system-architecture.md`, 계정 정책, observability/scripts README | 채택 결정·구성도·보존·운영 절차를 실제 구현과 맞춤 |

## 3. P0에서 반드시 확인할 항목

1. 배포 image digest·compose 합성 결과와 실제 JVM 옵션, agent 버전, `DD_SERVICE`·환경·revision. 출력에 시크릿을 남기지 않는다.
2. HTTP client, executor, Kafka producer/consumer, JDBC 자동 계측 지원. 수동 계측은 자동 계측과 중복 span을 만들지 않게 필요한 구간에만 적용한다.
3. DD 64/128-bit ID와 W3C `traceparent`의 대응, JSON의 문자열 출력, Grafana→Datadog URL 실제 동작. 앱 UUID를 `dd.trace_id`로 remap하는 방식은 사용하지 않는다.
4. 서버별 로그 bytes/sec·peak·최대 한 줄 크기·예외 크기·회전 주기. Docker가 7일을 보장한다는 가정은 사용하지 않는다.
5. 현재 S3 업로더의 실행 파일·systemd timer·마지막 성공 객체, lifecycle·versioning·암호화·IAM·미완료 multipart. 저장소 README의 과거 적용 기록을 실측으로 대신하지 않는다.
6. dev/prod Loki·Datadog의 실제 사용 여부, 로그/APM 보존, 메트릭 수집, 환경별 egress 비용. 운영 서비스와 관측 스택의 메모리 합계를 확인한다.
7. S3 결과·canary·실험 로그의 별도 저장 위치와 만료 정책. 개인 식별값 없이 합성 데이터로 실험한다.
8. source inventory: Docker JVM/infra, dev 호스트 Nginx 파일 또는 journal, prod 컨테이너 Nginx, RDS를 구분한다. 각각 경로·회전·권한·input·cursor·재수집 시작점·담당자를 기록하고 collector 자체 로그 재수집을 제외한다.
9. 실제 배포의 amd64/arm64에 맞는 고정 Fluent Bit 이미지와 두 output plugin, OBS metadata 주입·allowlist·APM 서비스명 매핑을 확인한다.
10. 수집기·Loki의 과대 로그 한도, stream별 지연 수용창, 미래 시각 허용 범위, host clock 오차, 조회 행 상한을 확인한다. buffer 예산과 수용창을 별도 표로 맞춘다.

P0 산출물은 설정값·증거 경로·확인 시각·담당자·미확인 항목이 있는 표다. 원격 정보 확인이 안 된 항목은 미확인으로 남기고 해당 배포만 보류한다.

## 4. 데이터 신뢰성과 용량 설계

### 저장 경계별 보장

| 경계 | 가능한 손실·중복 | 필요한 조치 |
| --- | --- | --- |
| 애플리케이션→stdout | AsyncAppender 큐 포화, JVM 종료 직전 유실, 동기 console의 지연 | 큐/종료 동작 계측, DEBUG 억제, 부하 비교. ERROR도 무조건 무유실이라고 하지 않음 |
| Docker→tail | 수집 전 회전, 파일 세대 혼동, 과대 메시지 skip | 실제 source 회전·read 재개·큰 줄 정책 검증, parse/drop 카운터 |
| tail→engine | offset과 buffer의 crash 지속성 차이 | 영속 DB·disk buffer·동기화 설정별 강제 종료 검증 |
| engine→Loki | 재시도, 거절, queue 상한 도달 | bounded disk buffer, 오류/지연 알림, 포화 시 폐기 동작 문서화 |
| engine→S3 plugin→S3 | plugin 자체 버퍼, multipart 미완료, 재업로드 중복 | 전용 `store_dir_limit_size`, S3 실객체 확인, 고유 key, incomplete upload 정리 |
| 호스트 손실 | 같은 디스크의 source·tail DB·buffer 모두 손실 | 로컬 버퍼가 호스트 상실까지 보호하지 않음을 명시. RPO 요구가 더 높으면 원격 내구 큐를 별도 설계 |

버퍼 초기 크기는 실측으로 계산한다.

```text
필요 버퍼 ≈ 수집 peak bytes/sec × 견딜 중단 시간(sec) × 여유 계수
필요 호스트 디스크 = Docker 회전본 + engine buffer + S3 store_dir + 임시 파일 + 운영 여유
```

engine과 S3에 같은 데이터가 동시에 존재할 수 있으므로 한 번만 계산하지 않는다. P0에서 30분 일시 중단을 초기 시험 조건으로 산정하고 확보 가능 여부를 기록한다. 가용 디스크 20% 이하 또는 버퍼 예산 80% 이상을 초기 경보 후보로 둔다. 최종값은 실측 후 고정한다. `storage.total_limit_size`와 S3 `store_dir_limit_size`는 역할이 다르다([공식 조사](research.md)).

### 상태를 확인하는 지표

- source별 마지막 수집 시각, parse 실패·drop·과대 로그 수, tail backlog.
- Loki 전송 실패·재시도·buffer 사용량, ingester 거절, 최근 canary 조회 지연.
- S3 buffer bytes·가장 오래된 대기 데이터의 나이, 마지막으로 확인된 canary object 시각과 내부 `log_id`.
- 로그 생산량 대비 `log_id` unique 수·중복 수·누락 수. 도메인 `event_id`만으로 dedup하지 않는다.
- 수집 프로세스 CPU·RSS·디스크 I/O, 앱 p95/p99·GC 변화.

Fluent Bit 일반 output success 지표만 보고 S3 업로드가 성공했다고 판정하지 않는다. 주기적으로 합성 canary 로그를 발생시키고 **Loki 검색과 S3 객체 내용을 각각 확인**한다. canary가 없는 정상 저트래픽과 수집 단절을 구분한다.

합성 시험은 외부 드라이버가 예상 log ID 집합을 보유한 상태에서 sink별 집합을 대조한다. 운영에서 원천 생성량을 별도로 측정하지 않았다면 sink 데이터만 보고 발생 전·encoder 이전의 유실 수를 정확히 알 수는 없다. canary 성공을 모든 실제 로그의 무유실 증명으로 취급하지 않는다.

## 5. 검증 매트릭스

모든 행은 현재 **미실행**이다. 구현 PR에서 입력 수·예상 ID·관측 결과·실행 환경·버전·증거를 기록한다.

| ID | 시나리오 | 통과 기준 |
| --- | --- | --- |
| V01 | Business→Data 정상 요청·병렬 호출·HTTP 재시도 | 같은 요청의 trace/request ID 일치, 하위 span과 retry attempt 구분, 요청 간 문맥 누출 0 |
| V02 | 401/403/413·500·timeout·취소·클라이언트 연결 종료 | 처리된 경계의 오류 로그에 요청 ID 존재. 상태·결과 불명 구분. 미진입 서비스 로그를 있다고 가정하지 않음 |
| V03 | executor 재사용·future 실패·예약 작업 | tracer와 MDC 함께 전파/복원. 다음 작업에 이전 사용자·trace ID 없음 |
| V04 | Data commit 후 프로세스 종료·Relay 재시작 | Outbox 원인 문맥으로 추적 재개. 기존 domain commit·fencing·멱등 동작 유지 |
| V05 | Kafka 중단·재전달·DLT·과거 문맥 없는 이벤트 | event ID 유지, 시도별 span 구분, DLT 실패 시 기존 offset 보장 유지, 구버전 행도 처리 |
| V06 | Notification 예약 발송·재시도·Realtime 재접속 | 후속 저장 경계를 지나 원인 event ID 탐색 가능. 긴 연결 전체를 단일 trace로 만들지 않음 |
| V07 | 예외 중첩·줄바꿈·Docker 분할·큰 JSON·파싱 실패 | 이벤트 경계와 stack trace 보존, 정책상 잘림/격리 명시, 조용한 skip 없음 |
| V08 | 토큰·비밀번호·이메일·전화번호 합성 입력 | message·exception·MDC·구조화 값·Nginx access/error의 query/referrer에 민감값 원문 없음. 원본 archive도 동일 정책 |
| V09 | Fluent Bit 강제 종료·컨테이너 재생성·source 회전 | 예산 내 실험의 expected `log_id`와 sink unique ID 대조. 유실 0 목표, 중복 수와 재수집 범위 보고 |
| V10 | Loki만 중단 / S3만 거부 / 네트워크 차단 후 복구 | 정상 sink의 지연 목표 유지, 실패 sink 복구 후 예산 내 backlog 전송. sink 간 독립성이 안 되면 배포 중단. **2556 로컬(MinIO) 계수: 런북 §7** — 한쪽 정지가 다른 쪽에 영향 없음, `Retry_Limit` 설정에 따라 S3 유실 구간이 달라짐 |
| V11 | buffer 상한·디스크 부족·재시도 상한 | 폐기/정지 지점이 문서와 일치, 경보 확인. 무유실 통과 기준을 적용하지 않고 손실 범위를 정량화. **2556 로컬 계수: 런북 §7**(Loki·S3 한도 도달 시 오래된 청크 폐기와 S3 중복 수량) |
| V12 | S3 객체·retention·Athena·권한 | 압축 JSON 정상, unique key·파티션·스키마 조회, 타 환경 쓰기 차단, 90일 규칙 적용 범위·multipart 정리 확인 |
| V13 | APM 샘플 제외·전송 실패·보존 만료 | trace 부재를 표시하고 일반 로그 조회는 계속 가능. agent sampling=1도 backend 보존 완료와 같다고 하지 않음 |
| V14 | 대표 부하에서 전후 비교 | 동일 이미지/부하 조건의 반복 측정. p95 악화 5% 이하를 초기 목표로 검토하고 RSS·I/O·저장비 예산 충족 여부 보고 |
| V15 | 신규/구버전 혼합 배포·롤백 | nullable schema·headers 부재 허용, 이중 수집/기존 파일 누락 없음, domain API 계약 변화 없음 |
| V16 | 서로 다른 원요청의 사건 2개를 한 푸시로 병합·다중 기기 전송 | 각 원요청→연결 로그→공통 operation 결과에 도달. 기기별 외부 호출과 DB 반영 결과 구분, 임의 대표 origin 없음 |
| V17 | Realtime 두 인스턴스·Redis Pub/Sub·구버전 wire·단절 | event/message ID로 A→Redis→B→outbound 추적. 자기 메아리 중복 없음, carrier 부재/손상에도 업무 처리는 기존 계약 유지 |
| V18 | T1→T2→T3 후속 이벤트·비동기→내부 HTTP·HTTP Outbox·멱등 재요청·agent 미활성 | HTTP/Kafka/저장 경계에서 최초 origin 유지, origin_request_id로 탐색 가능, 재요청이 기존 행의 원인 덮어쓰지 않음 |
| V19 | dev host Nginx·prod container Nginx·upstream 미접속 | 실제 source의 ingress 4xx/5xx access 수집·edge ID 조회, 앱 미진입과 구분. error는 connection/시간의 보조 연계 한계 명시. **2556 로컬: 두 경로 도착·정제 확인, 실제 dev/prod 설정은 미실행** |
| V20 | 컨테이너 env 합성·실기동 JSON·APM 링크 | 네 서비스의 OBS_SERVICE/ENV/VERSION이 실제 container env와 로그에 존재, unknown/다른 서비스 fallback 없음 |
| V21 | 30분 backlog·수용창 초과·시계 오차·기존 정상 stream | 예산 내 replay 수용, 창 밖 거절을 계측하고 S3 도착 확인. timestamp 변경으로 은폐하지 않음. **2556 로컬: 수용창 59분 수용·61분 거절 실측, 30분 backlog는 3분으로 축소** |
| V22 | 한 timestamp에 조회 상한 이상 로그·live tail 단절 | UI 결과 일부임을 인지하고 source/시간 분할 또는 archive 조회로 전체 수량 대조 |
| V23 | 외부 trace spoof·인증 거절·error/async dispatch | ingress에서 새 신뢰 문맥, 내부 전파 유지. 완료 로그 중복 없음, 미확정 오류를 200 성공으로 기록하지 않음 |

S3 lifecycle 삭제 완료는 규칙 조회만으로 검증됐다고 하지 않는다. 설정 검증과 실제 만료 이력 확인을 구분한다. V14의 수치와 5분 업로드 목표는 합의 전 제안값이며 결과에 맞춰 조용히 완화하지 않는다.

## 6. 대시보드와 운영 절차

| 화면 | 주요 내용 | 이동 |
| --- | --- | --- |
| 서버 로그 | 시간·환경·서비스·배포·레벨·키워드, live tail | request/trace/event ID 검색 |
| 요청·사건 상세 | 서비스별 로그, 처리 결과, 재시도, 원인 trace | Datadog trace, 해당 시간의 메트릭 |
| 오류·성능 | HTTP 오류율·p95/p99, 예외 유형, DB 풀·GC·CPU·Kafka lag | 관련 서비스 로그 범위 |
| 수집 상태 | Loki/S3 각각의 canary, buffer, drop, lag, 디스크 | 업로더/수집기 진단 런북 |

S3 원본을 Loki에 다시 넣는 것은 초기 조회 경로로 삼지 않는다. 과거 로그는 Athena 또는 기간 제한 다운로드로 확인해 최근 retention과 과거 timestamp 거절 정책에 영향을 주지 않는다. Athena 결과 버킷과 운영자 다운로드 사본에도 별도 만료를 둔다.

## 7. 배포·전환·복구

1. dev 대표 두 서비스에서 P1 검증. 기존 수집 경로와 짧게 비교하되 후보 경로에는 임시 고정 label `collector_variant="candidate"`를 붙여 stream을 나누고 기존 대시보드에서 제외한다. 현재 Loki는 `auth_enabled: false`이므로 tenant 헤더만으로 격리된다고 가정하지 않는다. 비교 종료 시 수집기를 한 경로로 전환하고 임시 label을 제거한다.
2. P2 S3는 새 `system_log/v2/` prefix에 적재하고 기존 업로더와 비교한다. 로그량·canary·마스킹·원본 조회를 확인한 뒤 전환 기준 시각과 source 파일 위치를 기록한다.
3. APP 업로더 중단은 v2의 backlog 해소·S3 확인 후 수행한다. 같은 타이머가 user-activity도 올리면 APP 경로만 분리하고 user-activity 적재를 유지한다.
4. P3 additive schema를 먼저 배포하고 문맥 없는 행 허용 상태로 생산자·소비자를 순차 배포한다. 관측 변경으로 domain 이벤트 재발행을 강제하지 않는다.
5. prod는 한 인스턴스/서비스부터 적용하고 P4 경보·부하·용량 확인 후 확장한다. 기존 Grafana 접근 인증·수집기 IAM을 함께 확인한다.
6. 실패 시 수집 출력 설정·JSON encoder를 각각 이전 설정으로 복구한다. 이전 text parser도 전환 기간 유지한다. 원본·tail DB·buffer를 삭제하지 않고, 이전 업로더 재개 시 중복 범위와 cursor를 기록한다. 신규 nullable DB 필드는 롤백 시 파괴적으로 삭제하지 않는다.

완료 후 정책 정본·아키텍처 결정·README·실제 설정이 같은 값을 설명해야 한다. 채택되지 않은 제안을 적용 완료로 바꾸지 않는다.

## 8. 문서 작업의 검증 기록

- 코드·설정 검토: 기준 커밋과 최초 작업 폴더 차이, trace 헤더·필터·Outbox·마스킹·sampling·retention 경계 확인.
- 공식 자료: [조사 기록](research.md)에 출처·제약 정리.
- 독립 검토: 공식 문서 조사 담당이 아키텍처·계획을 재검토했다. S3 시간 파티션 오해, 단일 테넌트 Loki에서의 후보 경로 격리, 인증 거절 시 미진입 서비스까지 로그를 요구한 문구를 수정했다.
- Mermaid 검증: Mermaid CLI `12.0.0`으로 후속 검토에서 확장한 8개 도표를 모두 SVG 렌더링했다. [그림 목록](README.md)의 정적 사본과 본문의 Mermaid는 같은 소스다.
- 로컬 링크·형식: 문서 내부 상대 링크 대상 존재와 코드 블록 닫힘을 검사하고 `git diff --check`를 통과했다.
- 미실행: 애플리케이션 빌드/테스트, Docker 기동, AWS/Datadog 조회, 부하·장애 실험, 실제 배포. 문서 추가만으로 이 항목의 성공을 주장하지 않는다.

### 후속 재검토

[재검토 기록](review-2026-10-29.md)의 공백을 반영해 P1/P3, metadata 계약, source inventory, 조회 확장과 V16~V23을 추가했다. 문서 검증 결과와 구현 착수 전 남은 배포 조건은 재검토 기록에 구분한다.
