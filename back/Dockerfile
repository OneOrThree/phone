# Gradle은 CI runner에서 bootJar로 미리 빌드 → Docker는 JAR만 복사
# cd.yml에서 ./gradlew bootJar 실행 후 docker compose up --build 순서로 동작
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

# 컨테이너 기동 속도 향상 (SecureRandom blocking 방지)
ENV JAVA_OPTS="-Djava.security.egd=file:/dev/./urandom"

COPY build/libs/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
