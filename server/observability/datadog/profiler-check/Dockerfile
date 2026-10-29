# GROMO-2574 profiler 오류 로컬 재현 — 앱 대신 빈 Java 프로그램에 실제와 같은 베이스·dd-java-agent·JAVA_TOOL_OPTIONS 를 붙인다.
FROM eclipse-temurin:17.0.20.1_1-jdk-jammy AS build
COPY Idle.java /src/Idle.java
RUN javac -d /out /src/Idle.java

# business-api·notification·realtime 최종 스테이지와 같은 베이스(glibc)·같은 에이전트 버전
FROM eclipse-temurin:17.0.20.1_1-jre-jammy
ADD --checksum=sha256:aeb74b05314e21211b55af13240723dd9014e18dd70422f8501fa180b1b3113b \
    https://repo1.maven.org/maven2/com/datadoghq/dd-java-agent/1.64.0/dd-java-agent-1.64.0.jar /opt/dd-java-agent.jar
RUN chmod 0644 /opt/dd-java-agent.jar \
    && groupadd -g 10001 business && useradd -u 10001 -g business -M business
COPY --from=build /out /app
WORKDIR /app
ENV JAVA_TOOL_OPTIONS="-Xmx512m -XX:ActiveProcessorCount=2 -Djava.awt.headless=true -javaagent:/opt/dd-java-agent.jar"
ENTRYPOINT ["java", "-cp", "/app", "Idle"]
