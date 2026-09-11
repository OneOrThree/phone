# CI 검증 도구는 러너 호스트에 설치하지 않는다.
FROM eclipse-temurin:17-jdk-jammy AS test
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils util-linux \
    && rm -rf /var/lib/apt/lists/*

FROM --platform=$BUILDPLATFORM eclipse-temurin:17-jdk-jammy AS builder
WORKDIR /app
COPY gradlew build.gradle settings.gradle ./
COPY gradle gradle
COPY config config
COPY src src
RUN chmod +x gradlew && ./gradlew bootJar --no-daemon

FROM eclipse-temurin:17-jre-jammy
# PDF는 prlimit으로 제한한 별도 Poppler 프로세스에서 처리한다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl poppler-utils util-linux fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 business && useradd -u 10001 -g business -M business \
    && mkdir -p /app/logs && chown -R business:business /app
WORKDIR /app
COPY --from=builder /app/build/libs/business-api.jar app.jar
USER business
ENV JAVA_TOOL_OPTIONS="-Xmx512m -XX:ActiveProcessorCount=2 -Djava.awt.headless=true"
EXPOSE 8082
ENTRYPOINT ["java", "-jar", "app.jar"]
