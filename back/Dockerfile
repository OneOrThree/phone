# 멀티 스테이지 — 아키텍처는 여기 하드코딩하지 않고 각 파이프라인이 결정한다:
#   dev cd.yml: platforms: linux/amd64 (GCP dev VM) / prod-ci: platforms: linux/arm64 (AWS t4g)
#   로컬은 platforms 미지정 → 호스트 네이티브(Apple Silicon이면 arm64)로 빠르게 빌드
# builder는 $BUILDPLATFORM(빌드 머신 네이티브)에서 실행 — gradle을 QEMU 에뮬레이션 없이 돌리고,
# 산출물 JAR는 아키텍처 무관이라 최종 스테이지만 타깃 아키텍처의 JRE 베이스로 조립된다.
FROM --platform=$BUILDPLATFORM eclipse-temurin:17-jdk-alpine AS builder

WORKDIR /app

COPY gradlew .
COPY gradle gradle
COPY build.gradle .
COPY settings.gradle .

# 의존성 해석을 소스 COPY보다 먼저 — 이 레이어는 build.gradle 변경 시에만 무효화되어
# 소스만 바뀐 반복 빌드에서 의존성 재다운로드를 건너뛴다 (gha 캐시와 조합 시 효과 큼).
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon --quiet || true

COPY src src

RUN ./gradlew bootJar -x test --no-daemon

FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

ENV JAVA_OPTS="-Djava.security.egd=file:/dev/./urandom"

# Datadog APM 에이전트 내장(비활성) — overlay 가 -javaagent 로 켤 때만 로드. 평소 배포엔 영향 없음.
# 버전 고정(재현성) + sha256 체크섬 핀(공급망 무결성, BuildKit 필요). 갱신 시 Maven Central 최신·체크섬·OWASP CVSS9 게이트 재확인.
ADD --checksum=sha256:aeb74b05314e21211b55af13240723dd9014e18dd70422f8501fa180b1b3113b \
    https://repo1.maven.org/maven2/com/datadoghq/dd-java-agent/1.64.0/dd-java-agent-1.64.0.jar /opt/datadog/dd-java-agent.jar

COPY --from=builder /app/build/libs/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
