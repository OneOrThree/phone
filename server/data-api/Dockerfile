# 멀티 스테이지 — 아키텍처는 여기 하드코딩하지 않고 각 파이프라인이 결정한다:
#   prod-ci: platforms: linux/arm64 (AWS t4g) / dev cd.yml·로컬: platforms 미지정
#   → 빌드 머신 네이티브(dev 러너 x86=amd64, Apple Silicon=arm64)로 빠르게 빌드
# builder는 $BUILDPLATFORM(빌드 머신 네이티브)에서 실행 — gradle을 QEMU 에뮬레이션 없이 돌리고,
# 산출물 JAR는 아키텍처 무관이라 최종 스테이지만 타깃 아키텍처의 JRE 베이스로 조립된다.
# ⚠️ temurin의 alpine 태그는 amd64 전용(arm64 매니페스트 없음) — t4g·Apple Silicon 대응으로 jammy 사용
# 기본값은 기존 소스 빌드. CI는 같은 실행에서 검증한 JAR를 prebuilt로 전달한다.
ARG JAR_SOURCE=builder

FROM --platform=$BUILDPLATFORM eclipse-temurin:17.0.20.1_1-jdk-jammy AS builder

WORKDIR /app

COPY gradlew .
COPY gradle gradle
COPY build.gradle .
COPY settings.gradle .

# 의존성 해석을 소스 COPY보다 먼저 — 이 레이어는 build.gradle 변경 시에만 무효화되어
# 소스만 바뀐 반복 빌드에서 의존성 재다운로드를 건너뛴다 (gha 캐시와 조합 시 효과 큼).
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon --quiet || true

COPY src src

RUN ./gradlew bootJar -x test --no-daemon \
    && cp build/libs/*.jar /app/app.jar

# 별도 경로를 써서 .dockerignore의 build/ 제외와 충돌하지 않는다.
FROM scratch AS prebuilt
COPY ci-artifact/app.jar /app/app.jar

FROM ${JAR_SOURCE} AS artifact

FROM eclipse-temurin:17.0.20.1_1-jre-jammy

WORKDIR /app

ENV JAVA_OPTS="-Djava.security.egd=file:/dev/./urandom"

# Datadog APM 에이전트 내장(비활성) — overlay 가 -javaagent 로 켤 때만 로드. 평소 배포엔 영향 없음.
# 버전 고정(재현성) + sha256 체크섬 핀(공급망 무결성, BuildKit 필요). 갱신 시 Maven Central 최신·체크섬·OWASP CVSS9 게이트 재확인.
ADD --checksum=sha256:aeb74b05314e21211b55af13240723dd9014e18dd70422f8501fa180b1b3113b \
    https://repo1.maven.org/maven2/com/datadoghq/dd-java-agent/1.64.0/dd-java-agent-1.64.0.jar /opt/datadog/dd-java-agent.jar

COPY --from=artifact /app/app.jar app.jar

# 호스트가 같은 digest 이미지에서 추출하는 DB 전환 묶음. 실행 이미지에 Python/DB client는 넣지 않는다.
COPY docs/db/deploy-v0.py docs/db/rebase-v0.py /opt/catus-db/docs/db/
COPY docs/db/v0-rebase /opt/catus-db/docs/db/v0-rebase
COPY src/main/resources/db/migration /opt/catus-db/src/main/resources/db/migration
COPY src/main/resources/db/v0 /opt/catus-db/src/main/resources/db/v0
COPY src/main/resources/db/seed /opt/catus-db/src/main/resources/db/seed

# Datadog Autodiscovery — Micrometer /actuator/prometheus 를 OpenMetrics 로 스크레이프 (GROMO-1489).
# 이미지 라벨에 두는 이유: Agent 설정 파일(conf.d/openmetrics.d)은 호스트에 그 파일이 있어야 하는데 운영 호스트에는
# 이 레포가 체크아웃되지 않는다. 이미지에 구우면 dev·prod 가 같은 이미지로 같은 배선을 갖는다.
# 이 라벨이 Data API(namespace gromo)의 정본이다. 다른 서비스의 라벨은 각자 compose 에 있다:
#   Realtime = docker-compose.realtime.yml · Business/Notification = docker-compose.satellites.yml ·
#   kafka/jmx exporter = docker-compose.observability.yml (운영 Business/Notification 은 Infra 저장소 compose-V2.yml).
# %%host%% 는 Agent 가 컨테이너 IP 로 치환한다. 9091 은 호스트 미공개 관리 포트(application-{dev,prod}.yml).
# 비용: 커스텀 메트릭은 timeseries 당 과금 → .* 가 아니라 대시보드가 쓰는 이름만 적는다(GROMO-2196).
#   출처는 Datadog 대시보드 «CATUS · PROD 통합 관측»(z2h-qq5-8vk)·«CATUS · DEV 통합 관측»(hav-c4v-rkm)의 gromo.* 지표와
#   outbox_relay_backlog(GROMO-2406)다. 새 지표를 쓰려면 이름을 여기에 더한다.
# metrics 작성 규칙 — .github/scripts/test_datadog_openmetrics_labels.py 가 CI 에서 막는다.
#   · 정규식이 아니라 «정확한 이름»이다. 영문·숫자·_ 만 쓴 항목은 Agent(OpenMetrics V2)가 이름 그대로 비교한다(.*·^…$ 금지).
#   · 카운터는 _total 을 뗀 이름이다: hikaricp_connections_timeout_total → hikaricp_connections_timeout.
#   · Micrometer 의 *_max 는 별도 게이지라 이름을 따로 적어야 온다: jvm_gc_pause_seconds 만 적으면 jvm_gc_pause_seconds_max 는 오지 않는다.
LABEL com.datadoghq.ad.checks='{"openmetrics":{"init_config":{},"instances":[{"openmetrics_endpoint":"http://%%host%%:9091/actuator/prometheus","namespace":"gromo","metrics":["executor_active_threads","executor_queued_tasks","hikaricp_connections_acquire_seconds","hikaricp_connections_active","hikaricp_connections_idle","hikaricp_connections_pending","hikaricp_connections_timeout","hikaricp_connections_usage_seconds","jdbc_connections_max","jvm_gc_overhead","jvm_gc_pause_seconds","process_uptime_seconds","spring_kafka_template_seconds","outbox_relay_backlog"],"health_service_check":true,"send_distribution_buckets":true,"collect_counters_with_distributions":true}]}}' \
      com.datadoghq.ad.logs='[{"source":"java"}]'

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
