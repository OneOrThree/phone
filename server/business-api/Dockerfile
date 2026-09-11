# Business API 이미지 — 멀티 스테이지 + jammy 베이스.
# ⚠️ temurin 의 alpine 태그는 amd64 전용(arm64 매니페스트 없음) — t4g·Apple Silicon 대응으로 jammy 를 쓴다.

# CI 검증 도구는 러너 호스트에 설치하지 않는다. 이 스테이지 안에서 gradle 을 돌려야
# ThumbnailRendererTest 계열이 pdftoppm·prlimit 을 찾을 수 있다.
FROM eclipse-temurin:17-jdk-jammy AS test
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils util-linux \
    && rm -rf /var/lib/apt/lists/*

# builder 는 $BUILDPLATFORM(빌드 머신 네이티브)에서 돌려 gradle 을 QEMU 에뮬레이션 없이 실행한다.
# 산출 JAR 는 아키텍처 무관이라 최종 스테이지만 타깃 아키텍처의 JRE 로 조립한다.
FROM --platform=$BUILDPLATFORM eclipse-temurin:17-jdk-jammy AS builder
WORKDIR /app
COPY gradlew build.gradle settings.gradle ./
COPY gradle gradle
COPY config config
# 의존성 해석을 소스 COPY 보다 먼저 — 소스만 바뀐 반복 빌드에서 재다운로드를 건너뛴다.
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon --quiet || true
COPY src src
RUN ./gradlew bootJar -x test --no-daemon

FROM eclipse-temurin:17-jre-jammy
# curl — compose 헬스체크가 쓴다. 이 베이스에 지금은 들어 있지만 «보장»된 것이 아니다: 17-jre-jammy 는
#        움직이는 태그라 베이스가 한 번 슬림해지는 것만으로 매 검사가 `curl: not found` 가 되어 앱이
#        멀쩡한데도 컨테이너가 계속 unhealthy 로 판정된다. 그 의존을 이미지 안에 못 박는다.
# poppler-utils·util-linux — PDF 썸네일은 prlimit 으로 제한한 별도 pdftoppm 프로세스에서 처리한다.
# fonts-noto-cjk — 한글이 들어간 PDF 첫 페이지가 두부(□)로 렌더되지 않게 한다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl poppler-utils util-linux fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 business && useradd -u 10001 -g business -M business \
    && mkdir -p /app/logs && chown -R business:business /app
WORKDIR /app
COPY --from=builder /app/build/libs/business-api.jar app.jar
USER business
# headless — ImageIO 축소 경로가 X11 을 찾지 않게 한다.
ENV JAVA_TOOL_OPTIONS="-Xmx512m -XX:ActiveProcessorCount=2 -Djava.awt.headless=true"
# 8080 — compose 가 SERVER_PORT=8080 을 주고 /health 를 검사한다. 위성 배포에서 8082 는 알림 서버 몫이다.
# 관리 포트 9091 은 EXPOSE 하지 않는다: 포트 격리가 /actuator/* 를 사설로 유지하는 유일한 수단이다.
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
