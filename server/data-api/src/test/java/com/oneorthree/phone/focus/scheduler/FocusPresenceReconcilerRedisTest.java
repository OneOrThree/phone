package com.oneorthree.phone.focus.scheduler;

import com.oneorthree.phone.common.port.RedisFocusPresence;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.transaction.support.TransactionOperations;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class FocusPresenceReconcilerRedisTest {
    @Test
    @DisplayName("복구 쓰기의 응답이 유실되어도 종료 리스를 다음 회차에 회수한다")
    void restoresExecutedBeforeResponseTimeoutMustStillBeRechecked() {
        try (GenericContainer<?> container = new GenericContainer<>(
                DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379)) {
            container.start();
            LettuceConnectionFactory factory = new LettuceConnectionFactory(
                    container.getHost(), container.getFirstMappedPort());
            factory.afterPropertiesSet();
            try {
                StringRedisTemplate observer = new StringRedisTemplate(factory);
                StringRedisTemplate timeoutAfterExecution = new StringRedisTemplate(factory) {
                    private boolean first = true;
                    @Override
                    public <T> T execute(RedisScript<T> script, List<String> keys, Object... args) {
                        T result = super.execute(script, keys, args);
                        if (first) {
                            first = false;
                            throw new QueryTimeoutException("실제 Redis Lua 실행 뒤 응답 타임아웃 주입");
                        }
                        return result;
                    }
                };
                Instant now = Instant.parse("2026-09-11T00:00:00Z");
                UUID userId = UUID.randomUUID();
                UUID sessionId = UUID.randomUUID();
                String key = "presence:focus:" + userId;
                FocusSession session = FocusSession.builder().id(sessionId)
                        .user(User.builder().id(userId).build()).startedAt(now.minusSeconds(60)).build();
                FocusSessionRepository repository = mock(FocusSessionRepository.class);
                // 종료 DEL 실패로 표식이 없고, 첫 조회 뒤 DB 종료가 커밋된 경우.
                when(repository.findByEndedAtIsNullAndStartedAtAfter(any()))
                        .thenReturn(List.of(session), List.of());
                when(repository.findByIdInAndEndedAtIsNotNull(any()))
                        .thenThrow(new IllegalStateException("첫 회차 재확인 조회 실패"))
                        .thenReturn(List.of(session));
                RedisFocusPresence presence = new RedisFocusPresence(timeoutAfterExecution,
                        Clock.fixed(now, ZoneOffset.UTC));
                FocusPresenceReconciler reconciler = new FocusPresenceReconciler(repository, presence,
                        TransactionOperations.withoutTransaction(), Runnable::run,
                        Clock.fixed(now, ZoneOffset.UTC));

                reconciler.reconcilePeriodically();
                assertThat(observer.opsForValue().get(key)).isEqualTo(sessionId.toString());
                reconciler.reconcilePeriodically();
                assertThat(observer.hasKey(key))
                        .as("종료한 세션의 응답 타임아웃 리스도 다음 회차에서 회수되어야 한다")
                        .isFalse();
            } finally {
                factory.destroy();
            }
        }
    }
}
