# GROMO Datadog dev 연동 (Phase 1+2)

dev 서버의 **인프라·컨테이너 메트릭 + 로그 + 앱 APM(분산 트레이싱)**을 Datadog(us5)로 push.
기존 OSS 관측 스택(Prometheus/Grafana/Loki) 옆에 **토글 가능한 overlay**로 얹는다.
설계: `docs/superpowers/specs/2026-07-16-datadog-dev-design.md`.

## 구성

| 파일 | 역할 |
|---|---|
| `docker-compose.datadog.yml` | `datadog-agent` 서비스(인프라·로그·APM 수신) + `app` override(-javaagent 로 APM 활성) |
| `observability/datadog/openmetrics.d/conf.yaml` | 앱의 기존 `/actuator/prometheus`(9091)를 OpenMetrics 로 스크레이프(app 무수정) |
| `back/Dockerfile` | `dd-java-agent.jar` 내장(비활성 — overlay 켤 때만 로드) |
| `.github/workflows/dev-datadog.yml` | up/down/restart 토글 워크플로우 |

## 실행 (GitHub Actions)

리포 → Actions → **"Dev Datadog"** → Run workflow → `action` 선택:

- `up` — `datadog-agent` 기동 + `app` 을 APM overlay 로 재생성(-javaagent 활성).
- `restart` — 재시작.
- `down` — Datadog Agent 제거 + `app` 을 dev 파일 단독으로 재생성(평문, javaagent 없음) 복원.

> `up`/`restart`/`down` 은 `dev-monitor.yml` 과 동일하게 self-hosted 러너·OIDC·AWS Secrets Manager 를 재사용한다.

## 시크릿

- `DD_API_KEY` — **GitHub Actions 리포 시크릿**. `gh secret set DD_API_KEY` 또는 Settings → Secrets and variables → Actions. checkout·AWS 인증에는 노출하지 않고 compose 실행·확인 step에만 주입한다.
- `DD_SITE` — `us5.datadoghq.com`(비밀 아님, 워크플로우 job env 하드코딩). Agent·APM 일치 필수.
- DB/app 시크릿(`POSTGRES_*`·`JWT_SECRET` 등) — 신 AWS 계정(`808715036056`), 서울 리전(`ap-northeast-2`)의 Secrets Manager `gromo/dev/env` 사용.

GitHub Actions는 장기 AWS 키를 저장하지 않고 OIDC로 `gromo-dev-github-actions` 롤을 인계한다. 이 롤의
Secrets Manager 권한은 `gromo/dev/env` 조회로 제한한다. VM 부트스트랩용 `gromo/dev/app-server`와
`gromo/dev/ci-runner`는 각 호스트의 인스턴스 롤만 읽으며 이 워크플로의 입력이 아니다. dev 이미지는
ECR이 아니라 GAR(`asia-northeast3-docker.pkg.dev/oneorthree2/ci-cache`)을 사용한다.

## 확인 위치 (Datadog UI, us5)

- **Infrastructure** > Host Map: `gromo-dev` 호스트 + `phone-app`/`phone-db` 컨테이너.
- **Logs**: `phone-app` stdout 로그(컨테이너 tail). ⚠️ 아래 "로그↔트레이스 상관" 참고 — 자동 상관은 Phase 1+2 미완.
- **APM** > Services: `gromo-back` 서비스·트레이스·플레임그래프.
- **Metrics Explorer**: `gromo.*`(OpenMetrics 브리지 — http RED, HikariCP, JVM).

### 로그↔트레이스 상관 (Phase 1+2 미완, 알려진 한계)

`DD_LOGS_INJECTION=true` 로 dd-java-agent 가 `dd.trace_id`/`dd.span_id` 를 MDC 에 넣어두지만, 앱의
`logback-spring.xml` CONSOLE appender 는 **텍스트 패턴**이고 앱 자체 `trace_id` 키만 찍는다. 따라서 Agent 가
tail 하는 stdout 로그에는 Datadog 이 상관에 쓰는 `dd.trace_id` 가 구조화되어 담기지 않아 **자동 로그↔트레이스
상관은 아직 동작하지 않는다.** 완성하려면 둘 중 하나 필요 (Phase 3 후보):
- **JSON 콘솔**: `datadog` 전용 springProfile 에서 `dd.trace_id`/`dd.span_id` 를 포함한 JSON encoder 로 stdout 출력.
- **Datadog 로그 파이프라인(서버측)**: 텍스트 패턴을 Grok 파서로 파싱해 `trace_id` 예약 속성으로 remap.

## 비용 레버 (최소비용)

- dev 1 호스트. `DD_CONTAINER_EXCLUDE` 로 OSS 관측 컨테이너 수집 제외(이중 과금 방지).
- `DD_TRACE_SAMPLE_RATE=0.2`(dev 저부하). 안 볼 땐 `down`.
- OpenMetrics 는 `.*` 대신 큐레이트된 메트릭만(커스텀 메트릭 timeseries 과금).

## 다음 (Phase 3 — 별도 결정)

만족 시 cd.yml 상시 내장으로 승격 + Prometheus/Grafana/Loki 스택 폐기(`dev-monitor.yml` down).
