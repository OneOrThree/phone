---
name: prod-logs
description: 운영 로그·지표·모니터를 조사할 때 쓴다(Datadog, 운영 V2). 이름 대응, 쿼리 함정, 모니터 번호가 있다.
---

# prod-logs — 운영 로그·지표 조사

조회만 한다. 운영 서버에 요청을 보내 재현하지 않는다. 남은 로그·지표·모니터로 답한다.

## 어디를 보나

- Datadog us5, 필터 `env:prod`. 서비스·호스트 이름 대응의 정본은 [파이프라인 지도](../../../docs/engineering/pipeline-map.md) 「모니터링 이름」 표다.
- 운영 V2 서버 4종의 서비스 이름(`data-api`·`business-api`·`realtime`·`notification`)은 2026-10-31 이후의 이름이다. 그 전 기간은 이름이 다를 수 있으니 서비스 목록부터 본다(옛 이름은 미확인).
- 운영 V1 호스트 `catus-prod` 의 로그는 2026-10-29 23:49Z 에 멈췄다. 그 전 기간을 볼 때는 V1 호스트도 함께 본다.
- Gromo 1.x 는 `gromo-*-prod`(호스트 `gromo-prod`), 앱 RUM 은 `cattus-app` 이다.
- 모니터: `23468982`(운영 V2 ERROR 로그), `23469020`(없는 경로 404 — 앱이 서버보다 먼저 나간 신호), `23469271`(API 5xx).
- 링크 목록의 정본은 [monitoringLinkList.ts](../../../backoffice/src/monitoringLinkList.ts)다. 앱 크래시는 Sentry, 앱 사용 지표는 PostHog 로 본다.

## 조사 순서

1. 범위를 정한다. 완료 조건: 쿼리에 `env:prod`, 서비스나 호스트, UTC 기간이 다 있다.
2. 앱 오류를 센다. `@level:ERROR` 로 세고 WARN 까지 읽는다. 완료 조건: ERROR·WARN 건수와 대표 메시지가 있다.
3. HTTP 응답을 센다. `service:nginx` 로그를 `@status`·`@uri`·`@method` 로 묶는다. 완료 조건: 상태 코드별 건수와 상위 경로가 있다.
4. 원인 문구를 찾는다. 스팬과 로그 패턴에서 찾는다. 완료 조건: 원인 후보마다 근거 로그 한 줄이 있다.
5. 보고한다: 쿼리 원문, 기간(UTC·KST), 건수, 확인 못 한 것.

## 함정

- `status:error` 만 세면 부풀어 보인다. JVM·도구의 stderr 가 error 로 잡힌다. 앱 ERROR 는 `@level:ERROR` 다.
- WARN 을 건너뛰지 않는다. 설정이 꺼진 사실이 기동 WARN 한 줄로만 드러난 적이 있다.
- nginx 로그는 2026-10-31 08:05Z 부터 JSON 이다. `message` 가 비고 모든 응답이 `status:info` 다. 4xx·5xx 는 `@status` 로 본다.
- `aggregateLogs` 는 순차로 불러도 429 가 난다. SQL 분석(`analyze_datadog_logs`)과 패턴 검색을 쓴다. 패턴 결과는 잘리므로 `total_patterns` 까지 본다.
- 스팬은 sample_rate 0.2 다. 합계에 쓰지 않고 원인 문구 확인에만 쓴다. 합계는 nginx 전수 로그로 낸다.
- 임시 `docker run` 컨테이너의 stdout 도 수집된다. `service:postgres` 가 갑자기 늘면 이것부터 의심한다.

## 설정·시크릿이 의심될 때

- 운영 값은 Infra 저장소 `OneOrThree/cattus-infra` 의 `prod/catus-v2/runtime/env_writer-V2.py`·`compose-V2.yml` 과 대조한다.
- phone 의 `.github/scripts/write-compose-env.py` 는 dev 의 정본이다. 운영 값의 근거로 쓰지 않는다.
