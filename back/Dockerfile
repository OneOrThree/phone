FROM --platform=linux/amd64 eclipse-temurin:17-jdk-alpine AS builder

WORKDIR /app

COPY gradlew .
COPY gradle gradle
COPY build.gradle .
COPY settings.gradle .
COPY src src

RUN chmod +x gradlew && ./gradlew bootJar -x test

FROM --platform=linux/amd64 eclipse-temurin:17-jre-alpine

WORKDIR /app

ENV JAVA_OPTS="-Djava.security.egd=file:/dev/./urandom"

# Datadog APM 에이전트 내장(비활성) — overlay 가 -javaagent 로 켤 때만 로드. 평소 배포엔 영향 없음.
# 버전 고정(재현성). 갱신 시 Maven Central 최신 + OWASP CVSS9 게이트 재확인.
ADD https://repo1.maven.org/maven2/com/datadoghq/dd-java-agent/1.64.0/dd-java-agent-1.64.0.jar /opt/datadog/dd-java-agent.jar

COPY --from=builder /app/build/libs/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
