# 멀티 스테이지 — 아키텍처는 여기 하드코딩하지 않고 각 파이프라인이 결정한다:
#   prod-ci: platforms: linux/arm64 (AWS t4g) / dev cd.yml·로컬: platforms 미지정
#   → 빌드 머신 네이티브(dev 러너 x86=amd64, Apple Silicon=arm64)로 빠르게 빌드
# builder는 $BUILDPLATFORM(빌드 머신 네이티브)에서 실행 — gradle을 QEMU 에뮬레이션 없이 돌리고,
# 산출물 JAR는 아키텍처 무관이라 최종 스테이지만 타깃 아키텍처의 JRE 베이스로 조립된다.
# ⚠️ temurin의 alpine 태그는 amd64 전용(arm64 매니페스트 없음) — t4g·Apple Silicon 대응으로 jammy 사용
# 기본값은 기존 소스 빌드. CI는 같은 실행에서 검증한 JAR를 prebuilt로 전달한다.
ARG JAR_SOURCE=builder

FROM --platform=$BUILDPLATFORM eclipse-temurin:17-jdk-jammy AS builder

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

FROM eclipse-temurin:17-jre-jammy

WORKDIR /app

ENV JAVA_OPTS="-Djava.security.egd=file:/dev/./urandom"

# Datadog APM 에이전트 내장(비활성) — overlay 가 -javaagent 로 켤 때만 로드. 평소 배포엔 영향 없음.
# 버전 고정(재현성) + sha256 체크섬 핀(공급망 무결성, BuildKit 필요). 갱신 시 Maven Central 최신·체크섬·OWASP CVSS9 게이트 재확인.
ADD --checksum=sha256:aeb74b05314e21211b55af13240723dd9014e18dd70422f8501fa180b1b3113b \
    https://repo1.maven.org/maven2/com/datadoghq/dd-java-agent/1.64.0/dd-java-agent-1.64.0.jar /opt/datadog/dd-java-agent.jar

COPY --from=artifact /app/app.jar app.jar

# Datadog Autodiscovery — Micrometer /actuator/prometheus 를 OpenMetrics 로 스크레이프 (GROMO-1489).
# 이미지 라벨에 두는 이유: Agent 설정 파일(conf.d/openmetrics.d)로 두면 호스트에 그 파일이 있어야 하는데,
# prod 는 docker-compose.prod.yml 만 S3 로 배포하고 레포를 체크아웃하지 않아 마운트할 파일이 없다.
# 이미지에 구우면 dev·prod 가 같은 이미지로 같은 배선을 갖는다 — 정본이 여기 하나다.
# %%host%% 는 Agent 가 컨테이너 IP 로 치환한다. 9091 은 호스트 미공개 관리 포트(application-{dev,prod}.yml).
# 비용: 커스텀 메트릭은 timeseries 당 과금 → .* 대신 대시보드가 쓰는 것만 큐레이트.
# ⚠️ OpenMetrics(agent:7)는 카운터의 _total 접미사를 떼고 매칭 → logback_events 처럼 접미사 없이 적는다.
LABEL com.datadoghq.ad.checks='{"openmetrics":{"init_config":{},"instances":[{"openmetrics_endpoint":"http://%%host%%:9091/actuator/prometheus","namespace":"gromo","metrics":["http_server_requests_seconds.*","hikaricp_connections.*","jvm_memory_used_bytes","jvm_memory_max_bytes","jvm_gc_pause_seconds.*","jvm_threads_live_threads","process_cpu_usage","system_cpu_usage","logback_events"]}]}}'

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
