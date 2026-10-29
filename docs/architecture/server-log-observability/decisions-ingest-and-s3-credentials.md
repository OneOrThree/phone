# 로그 이중 적재·dev S3 자격 방식 결정 문서 (GROMO-2588)

> 상태: **제안 — 재영님 확정 전.** 이 문서의 어떤 문장도 결정을 뜻하지 않는다. 확정되면 아래 «결정 기록» 절에 재영님이 정한 값과 날짜를 적고, 그때 [rollout.md](rollout.md)·[runtime-inventory.md](runtime-inventory.md)의 «결정 대기» 표시를 값으로 바꾼다.
> 작성: 2026-10-29. 조회는 모두 읽기 전용이다(Datadog MCP 읽기, 공식 가격 페이지 읽기). AWS에는 어떤 요청도 보내지 않았고 S3 비용은 계산식만 적는다.

## 0. 배경 (사실)

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| dev 현재 수집 | Datadog Agent가 전 컨테이너 stdout을 Datadog Logs로 보낸다. 2026-10-29 18:43 KST 이후 Agent는 중지 상태 | [runtime-inventory §2.3](runtime-inventory.md), [collection-stop-2026-10-29.md](collection-stop-2026-10-29.md) |
| 에픽 2562 추가분 | Fluent Bit → dev Loki(`ops-monitor.dev.yml`로 켜야 가동, 현재 미가동), S3 원본 보관(`OBS_LOG_S3`, 기본 꺼짐) | [rollout.md D4·D8](rollout.md) |
| 이중 적재 | Fluent Bit과 Datadog Agent가 같은 stdout을 읽으면 같은 로그가 두 경로로 간다 | [runtime-inventory §2.3](runtime-inventory.md) |
| dev 서버 위치 | GCP VM `gromo-dev-app`. S3는 AWS. dev에는 AWS 자격 경로가 없다(`aws` CLI만 설치) | [runtime-inventory §6](runtime-inventory.md) |
| 정책 문구 | AWS에서는 인스턴스 역할 우선, GCP dev→S3는 단기 자격 연동을 P0에서 결정, 새 장기 키를 기본값으로 두지 않는다 | [README §보안](README.md) 120행 |
| Infra 소유 | IAM·버킷은 `OneOrThree/Infra` 저장소 | [implementation-plan.md](implementation-plan.md) |

## 1. 조회 결과 (읽기 전용, 2026-10-29)

### 1.1 Datadog Logs 유입량 (dev 서비스, 이름이 `*-dev`)

지표 `datadog.estimated_usage.logs.ingested_bytes`·`ingested_events`를 `get_datadog_metric`(scalar, sum, `.as_count()`)으로 조회했다. 이 지표의 `env` 태그가 비어 있어 `service` 이름으로 dev를 구분했다. Datadog이 **받은** 크기이며 Docker 원본 크기와 같지 않다.

| 구간 | 대상 | 값 |
| --- | --- | --- |
| 최근 30일 | `service:*-dev` 바이트 합 | 1,456,045,695 B |
| 최근 30일 | `service:*-dev` 이벤트 합 | 1,472,526 |
| 최근 30일 | 전체(`*`, prod 포함) 바이트 합 | 4,568,885,930 B |

최근 7일 dev 서비스별 바이트(합 약 233.1 MB):

| 서비스 | 7일 바이트 |
| --- | --- |
| gromo-kafka-dev | 122,409,012 |
| gromo-business-dev | 91,205,232 |
| gromo-back-dev | 4,990,627 |
| gromo-notification-dev | 3,985,374 |
| gromo-db-dev | 3,545,457 |
| gromo-data-dev | 3,145,218 |
| gromo-realtime-dev | 3,141,837 |
| gromo-redis-dev | 604,226 |
| gromo-business-redis-dev | 13,685 |

읽는 법: dev 로그의 약 91%가 Kafka와 Business API 두 서비스다(7일 기준 계산). 30일 구간에는 Agent 중지 이전만 들어 있고, 중지 이후 유입은 0에 가깝다.

### 1.2 Datadog 가격 (출처: 공식 페이지)

출처 <https://www.datadoghq.com/pricing/?product=log-management>, 조회 2026-10-29. 페이지에 갱신일은 없다. 페이지 앞 100,000자만 읽었다.

| 항목 | 월 청구 기준 가격 | 단위 |
| --- | --- | --- |
| 수집(Standard·Flex) | $0.10 부터 | GB당 |
| Standard 색인, 15일 보존 선택 시 | $1.70 | 100만 이벤트당 |
| 3·7·30일 보존 가격 | 페이지에서 확인하지 못함 | — |

**우리 계약(약정·할인·실제 색인 보존 일수·제외 필터)은 확인하지 못했다.** 아래 산식은 목록 가격으로 규모감만 보이는 것이다.

### 1.3 규모 산식 (계약 미확인, 목록 가격 기준)

- 수집: 1.456 GB × $0.10 = 약 $0.15 (GB를 10^9 B로 가정. 1 GiB 기준이면 약간 줄어든다).
- 색인(15일 가격 가정): 1.4725 M × $1.70 = 약 $2.50.
- 즉 dev 30일 분량은 목록 가격으로 월 한 자릿수 달러다. 전체(prod 포함) 4.57 GB 중 dev는 약 32%다. **prod는 별도 결정이며 이 숫자를 prod로 늘려 쓰지 않는다.**
- S3 비용: 저장량 × 단가 + 요청 수 단가로 계산한다. 저장량은 위 1.456 GB/30일(압축 전)을 상한 참고값으로 쓸 수 있으나 AWS 단가는 이번에 조회하지 않았다(**가격 미확인**).
- Loki dev: 디스크만 쓴다(7일 보존 설정, [runtime-inventory §5](runtime-inventory.md)). 별도 사용료 없음.

## 2. 결정 1 — Datadog Logs 이중 적재

선택지 비교(dev 기준):

| | A. 둘 다 | B. Datadog만 | C. Loki·S3만 | D. 분할(서비스·기간별) |
| --- | --- | --- | --- | --- |
| 구성 | Agent 재가동 + Fluent Bit | Agent만(Fluent Bit 수집 중단) | Agent 로그 수집 끄기(`DD_LOGS_ENABLED=false`), APM은 유지 | 예: 앱 4종은 Loki, Kafka·DB·Redis는 Datadog 또는 제외 |
| 비용 | §1.3의 Datadog 분 + Loki 디스크 | §1.3의 Datadog 분 | Datadog Logs 0, Loki 디스크 | 일부만 |
| 보존 | Datadog 보존(계약 미확인) + Loki 7일 | Datadog 보존만 | Loki 7일(S3는 dev 미사용이면 없음) | 혼합 |
| 조회 용도 | 기존 Datadog 화면 유지 + 요청 타임라인(Loki) | 에픽 목표(요청 타임라인·Grafana)를 dev에서 못 씀 | 앱 4종·Nginx는 에픽 목표 충족. **Kafka·PostgreSQL·Redis 등 인프라 로그는 중앙 수집이 끊긴다** — Fluent Bit `logs.lua` 의 `ALLOWED` 가 앱 4종과 Nginx만 허용하고 나머지는 `select_container()` 에서 버린다. Fluent Bit에 인프라 수집을 더하는 일이 선행 조건이거나, 그 로그의 중앙 보관·조회를 포기하는 선택이다. Datadog APM trace에서 로그로 이동 불가 | 서비스마다 다름 |
| 운영 부담 | 두 곳을 맞춰 봐야 함, 파이프라인(severity 등) 이중 관리 | 가장 적음 | 중간 | 가장 큼 |
| 보안 | 마스킹을 두 경로에서 모두 검증 | 기존 그대로 | Loki 접근 통제 필요 | 두 경로 모두 |
| 되돌림 | 쉬움(한쪽 중지) | 쉬움 | Agent 설정 복원 필요 | 복잡 |

**추천 1개 (제안): A, 단 dev 한정·기간 한정.** 이유: 에픽의 가치(Loki 요청 타임라인)를 검증하려면 Fluent Bit이 필요하고, Datadog APM↔로그 연결은 Datadog 쪽에 이미 있다. 심각도 파이프라인([datadog-severity-pipeline.md](datadog-severity-pipeline.md))은 **정의·도구만 있고 Datadog에 적용하지 않은 상태**다(원격 검증·적용 미수행 — 그 문서 상단). 적용 전에는 정상 Kafka Exporter·PostgreSQL 로그가 여전히 `status=error` 로 분류되므로, Agent 재가동만으로 보정된 결과를 비교할 수 없고 파이프라인 원격 검증·적용이 별도로 필요하다. 또 C안과 달리 인프라 로그는 Datadog 쪽에서만 계속 볼 수 있다. dev 분량의 목록 가격 비용은 §1.3 수준이라 비교 검증 기간의 중복 비용이 작다. 검증 뒤 Kafka·Business 두 서비스(약 91%)만 Datadog에서 제외하는 D로 줄이는 판단은 그때 §1.1 수치를 다시 조회해서 한다. prod는 이 추천에 포함하지 않는다.

재영님이 정할 질문:
1. dev 로그를 Datadog에도 계속 보낼 것인가(Agent 재가동 시점 포함)? 현재 중지 상태를 유지할 것인가?
2. 이중 적재를 허용하는 기간(관찰 기간 D7과 같이 정할지)은?
3. 특정 서비스(Kafka·Business)를 Datadog Logs에서 제외할 것인가?
4. prod에 대해서는 별도 조회·결정 티켓을 만들 것인가?
5. Datadog Logs의 실제 계약·색인 보존은 누가 확인하는가(이번에 확인하지 못함)?

## 3. 결정 2 — dev S3 자격 방식

| | 가. IAM 사용자 정적 키 | 나. GCP→AWS 웹 ID 연동 역할 | 다. dev는 S3 미사용 |
| --- | --- | --- | --- |
| 구성 | Infra에서 `system_log/v2/env=dev/*` 쓰기 전용 사용자·키 발급, dev 비밀 저장소(`gromo/dev/env`)에 보관, 컨테이너로 주입 | AWS에 Google을 신뢰하는 OIDC 공급자·역할 생성, VM 서비스 계정 토큰으로 `AssumeRoleWithWebIdentity` | Fluent Bit S3 모듈을 dev에서 끄고 prod에서만 검증 |
| 비용 | S3 사용료만 | S3 사용료만 | 0 |
| 보안 | 장기 키 유출·회전 부담. [README §보안](README.md)의 «장기 키를 기본값으로 두지 않는다»와 충돌 | 단기 자격. 신뢰 조건(대상 서비스 계정·audience) 설계 필요 | 자격 없음 |
| 운영 부담 | 키 회전 절차, `write-compose-env.py` 허용 키 추가 | 토큰 갱신 방식 필요. Fluent Bit 4.2.8 이미지의 웹 ID 자격 지원 여부는 **미확인**(로컬 시험 필요) | 없음 |
| 되돌림 | 키 비활성화 | 역할 신뢰 제거 | — |
| 에픽 검증 영향 | dev에서 S3 경로 실측 가능 | 동일, 단 선행 작업이 큼 | S3 경로는 prod 전환 전 검증 불가 → [runtime-inventory §6](runtime-inventory.md) 차단 항목은 prod에서 해소해야 함 |

**추천 1개 (제안): 다. dev는 S3 미사용**, 현재 상태 유지. 이유: [rollout D8](rollout.md)이 이미 dev에서 S3를 켜지 않는 것으로 정리돼 있고, dev Loki가 7일 보존이라 dev에 원본 장기 보관이 필요하다는 근거가 없다. 장기 키는 정책 문구와 충돌하고, 연동 역할은 Infra 선행 작업과 이미지 지원 확인이 필요한 데 비해 얻는 것이 dev S3 시험 하나다. 대가: S3 업로드 실측(IAM 범위·multipart·lifecycle)은 prod 전환 전 별도 경로가 필요하다. 그 경로(예: AWS 인스턴스 역할로 쓰는 prod 사전 점검)는 이 문서가 정하지 않는다. 재영님이 dev S3 실측이 필요하다고 판단하면 나를 선택한다.

재영님이 정할 질문:
1. dev에서 S3 업로드를 실측해야 하는가, 아니면 prod 사전 점검으로 대신하는가?
2. 장기 키를 dev 한정으로라도 허용하는가(정책 문구의 예외)?
3. 연동 역할을 택하면 Infra 작업 일정과 담당은?
4. 롤백 소유자(S3 설정 롤백 담당)는? ([runtime-inventory §6](runtime-inventory.md)에 미지정)

### Infra 요청 초안 (나 선택 시에만 필요. 가·다는 아래 일부 또는 없음)

`OneOrThree/Infra`에 다음을 요청한다. **아직 요청하지 않았다.** 계정 ID·키 원문은 적지 않는다.

1. AWS IAM OIDC 공급자(Google 발급자) 추가와 역할 1개: 신뢰 조건을 dev VM 서비스 계정 1개와 audience 1개로 고정.
2. 역할 권한: 버킷의 `system_log/v2/env=dev/*` 에 `s3:PutObject`·`s3:AbortMultipartUpload`, 필요 시 버킷 단위 `s3:ListBucketMultipartUploads`. 삭제·수명주기·버킷 정책 변경 권한은 주지 않는다. 버킷이 SSE-KMS면 해당 키 한 개의 `GenerateDataKey`·`Decrypt`만.
3. 검증 요청: [runtime-inventory §6](runtime-inventory.md)의 (A) 정책 시뮬레이션과 (B) 버킷 정책 검토 결과를 각각 회신.
4. 가 선택 시: 같은 권한의 사용자 1개, 키 회전 주기와 폐기 절차 명시.
5. 환경 간 쓰기 차단: `env=dev` 외 접두 쓰기가 `implicitDeny`인지 확인.

## 4. 결정에 따라 바뀌는 줄 (결정 대기 표시만 연결)

| 문서 | 줄 | 결정 전 상태 |
| --- | --- | --- |
| [rollout.md](rollout.md) | D8 | 결정 대기 표시 연결, 값 미변경 |
| [runtime-inventory.md](runtime-inventory.md) | §2.3 이중 적재 문단, §6 «dev -> S3 자격 방식», 추가 확인 표의 이중 적재 행 | 결정 대기 표시 연결, 값 미변경 |
| [implementation-status.md](implementation-status.md) | S3 출력 선택 모듈 문단 | 조정자 몫(후속 PR이 고치지 않음) |

## 5. 결정 기록 (재영님 확정 후 작성)

| 결정 | 선택 | 날짜 | 비고 |
| --- | --- | --- | --- |
| 1. 이중 적재 | (미정) | | |
| 2. dev S3 자격 | (미정) | | |

## 6. 이 문서가 하지 않은 것

Datadog 계약·색인 보존 확인, prod 로그 비용 판단, AWS 단가 조회, Fluent Bit 웹 ID 자격 시험, Infra 요청 제출.
