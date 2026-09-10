package com.oneorthree.chat;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 테스트가 붙을 실물 두 개 — Postgres 와 Redis.
 *
 * <p><b>Redis 를 목으로 대체하지 않는다.</b> 이 서비스에서 Redis 는 캐시 부속이 아니라 팬아웃·프레즌스가
 * 얹힌 핵심 배선이라, 목으로 바꾸면 정작 검증하고 싶은 것(Pub/Sub 왕복, SET 의 빈 집합 성질,
 * 키 존재 판정)이 전부 사라진다.
 *
 * <p>{@code @ServiceConnection} 은 컨테이너의 주소를 <b>속성이 아니라 빈</b>으로 주입한다 — 그래서
 * {@code application.yml} 에 datasource·redis 플레이스홀더를 두면 안 된다(그 설명은 그 파일에 있다).
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

    /**
     * 운영과 같은 메이저 버전을 쓴다. 버전이 갈리면 «로컬에선 되는데» 가 생기고, 특히
     * {@code ON CONFLICT … WHERE} 같은 문법은 버전에 민감하다.
     */
    @Bean
    @ServiceConnection
    PostgreSQLContainer<?> postgresContainer() {
        return new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"));
    }

    /** {@code name = "redis"} 가 있어야 Boot 가 이 범용 컨테이너를 Redis 로 알아본다. */
    @Bean
    @ServiceConnection(name = "redis")
    GenericContainer<?> redisContainer() {
        return new GenericContainer<>(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);
    }
}
