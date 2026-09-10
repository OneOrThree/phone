# 채팅 서비스 이미지 — server/data-api/Dockerfile 과 같은 구조다(멀티 스테이지 + jammy 베이스).
#
# 아키텍처는 여기 하드코딩하지 않고 파이프라인이 정한다. builder 는 $BUILDPLATFORM(빌드 머신 네이티브)
# 에서 돌려 gradle 을 QEMU 에뮬레이션 없이 실행하고, 산출 JAR 는 아키텍처 무관이라 최종 스테이지만
# 타깃 아키텍처의 JRE 로 조립한다.
# ⚠️ temurin 의 alpine 태그는 amd64 전용(arm64 매니페스트 없음) — t4g·Apple Silicon 대응으로 jammy 를 쓴다.
FROM --platform=$BUILDPLATFORM eclipse-temurin:17-jdk-jammy AS builder

WORKDIR /app

COPY gradlew .
COPY gradle gradle
COPY build.gradle .
COPY settings.gradle .
COPY config config

# 의존성 해석을 소스 COPY 보다 먼저 — 소스만 바뀐 반복 빌드에서 의존성 재다운로드를 건너뛴다.
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon --quiet || true

COPY src src

RUN ./gradlew bootJar -x test --no-daemon

FROM eclipse-temurin:17-jre-jammy

# 헬스체크가 curl 을 쓴다(docker-compose.chat.yml). 이 베이스 이미지에 지금은 curl 이 들어 있지만
# «보장»된 것이 아니다 — 17-jre-jammy 는 움직이는 태그라, 베이스가 한 번 슬림해지는 것만으로
# 매 검사가 `curl: not found` 가 되어 앱과 readiness 가 멀쩡한데도 컨테이너가 계속 unhealthy 로
# 판정된다. 그 의존을 이미지 안에 못 박는다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV JAVA_OPTS="-Djava.security.egd=file:/dev/./urandom"

COPY --from=builder /app/build/libs/*.jar app.jar

# 8081 — data-api(8080)와 한 호스트에 같이 뜨므로 겹치지 않게 잡았다.
# 관리 포트 9091 은 EXPOSE 하지 않는다: 포트 격리가 /actuator/* 를 사설로 유지하는 유일한 수단이다.
EXPOSE 8081

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
