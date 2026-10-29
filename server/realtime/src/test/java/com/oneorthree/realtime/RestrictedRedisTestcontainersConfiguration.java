package com.oneorthree.realtime;

import org.springframework.boot.data.redis.autoconfigure.DataRedisConnectionDetails;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

/** 운영과 같은 ACL로 제품의 Redis 경로를 검증한다. 자격 증명은 테스트 전용이다. */
@TestConfiguration(proxyBeanMethods = false)
public class RestrictedRedisTestcontainersConfiguration {

    @Bean
    @ServiceConnection
    PostgreSQLContainer<?> postgresContainer() {
        return new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"));
    }

    @Bean
    GenericContainer<?> redisContainer() {
        return new GenericContainer<>(DockerImageName.parse("redis:7.4.11-alpine"))
                .withExposedPorts(6379)
                .withCopyFileToContainer(MountableFile.forClasspathResource("redis/presence-production.acl"),
                        "/etc/redis/users.acl")
                .withCommand("redis-server", "--aclfile", "/etc/redis/users.acl", "--save", "", "--appendonly", "no");
    }

    /** 익명 Redis ServiceConnection 대신 제한 계정까지 명시하여 실제 자동 구성을 사용한다. */
    @Bean
    DataRedisConnectionDetails redisConnectionDetails(GenericContainer<?> redisContainer) {
        return new DataRedisConnectionDetails() {
            @Override
            public String getUsername() {
                return "realtime";
            }

            @Override
            public String getPassword() {
                return "acl-test-realtime-password";
            }

            @Override
            public Standalone getStandalone() {
                return Standalone.of(redisContainer.getHost(), redisContainer.getMappedPort(6379));
            }
        };
    }
}
