package com.oneorthree.phone.common.port;

import com.fasterxml.uuid.Generators;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * 프레즌스 리스 — <b>실제 Redis</b> 위에서 본다.
 *
 * <p>이 클래스의 핵심은 Lua 두 줄의 조건이고, 그건 목으로는 <b>한 글자도 검증되지 않는다</b>.
 * 특히 「커밋 이후 콜백이 어긋난 순서로 도착하는」 경우가 그렇다 — 값 비교·표식이 실제로 그 순서를
 * 바로잡는지는 Redis 가 스크립트를 돌려 봐야 안다.
 *
 * <p>세 규율을 본다: <b>커밋 이후에만</b>, <b>실패를 삼킨다</b>, <b>순서가 어긋나도 상태가 맞다</b>.
 * 셋 다 «없어도 정상으로 보이는» 성질이라 여기서 못 박는다.
 */
class RedisFocusPresenceTest {

    @SuppressWarnings("resource")
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redis;

    private UUID userId;
    private String key;

    @BeforeAll
    static void startRedis() {
        REDIS.start();
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getFirstMappedPort());
        connectionFactory.afterPropertiesSet();
        redis = new StringRedisTemplate(connectionFactory);
        redis.afterPropertiesSet();
    }

    @AfterAll
    static void stopRedis() {
        connectionFactory.destroy();
        REDIS.stop();
    }

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        key = "presence:focus:" + userId;
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Nested
    @DisplayName("정상 경로")
    class HappyPath {

        @Test
        @DisplayName("시작하면 리스가 생기고, 그 세션이 끝나면 사라진다")
        void setAndClear() {
            UUID session = sessionId();

            presence().focusStarted(userId, session);
            assertThat(redis.hasKey(key)).isTrue();

            presence().focusEnded(userId, session);
            assertThat(redis.hasKey(key)).isFalse();
        }

        @Test
        @DisplayName("리스에는 «반드시» 수명이 있다 — 종료가 유실돼도 스스로 풀려야 한다")
        void leaseAlwaysExpires() {
            presence().focusStarted(userId, sessionId());

            assertThat(redis.getExpire(key)).isNotNull().isPositive();
        }

        @Test
        @DisplayName("세션 id 가 없으면 아무것도 하지 않는다 — 어느 리스인지 모르는 채로 건드리지 않는다")
        void nullSessionIsNoop() {
            presence().focusStarted(userId, sessionId());

            presence().focusEnded(userId, null);

            assertThat(redis.hasKey(key)).isTrue();
        }
    }

    @Nested
    @DisplayName("커밋 경계")
    class CommitBoundary {

        @Test
        @DisplayName("트랜잭션 안에서는 «아직» 쓰지 않는다 — 롤백되면 세션 없이 리스만 남는다")
        void defersUntilCommit() {
            TransactionSynchronizationManager.initSynchronization();

            presence().focusStarted(userId, sessionId());

            assertThat(redis.hasKey(key)).isFalse();
            assertThat(TransactionSynchronizationManager.getSynchronizations()).hasSize(1);
        }

        @Test
        @DisplayName("커밋 콜백이 돌면 그때 쓴다")
        void writesOnCommit() {
            TransactionSynchronizationManager.initSynchronization();
            presence().focusStarted(userId, sessionId());

            TransactionSynchronizationManager.getSynchronizations().forEach(s -> s.afterCommit());

            assertThat(redis.hasKey(key)).isTrue();
        }

        @Test
        @DisplayName("롤백되면(콜백 미실행) 아무것도 쓰지 않는다")
        void writesNothingOnRollback() {
            TransactionSynchronizationManager.initSynchronization();

            presence().focusStarted(userId, sessionId());
            // afterCommit 을 부르지 않는다 = 롤백된 상황.

            assertThat(redis.hasKey(key)).isFalse();
        }
    }

    @Nested
    @DisplayName("순서가 어긋나 도착해도 상태가 맞다")
    class OutOfOrder {

        @Test
        @DisplayName("«이미 끝난 세션»의 지연된 시작은 리스를 되살리지 못한다 — 되살면 13시간 차단이다")
        void lateStartCannotResurrect() {
            UUID session = sessionId();
            presence().focusStarted(userId, session);
            presence().focusEnded(userId, session);

            // 그 세션의 시작 콜백이 «종료 뒤에» 뒤늦게 도착한 상황.
            presence().focusStarted(userId, session);

            assertThat(redis.hasKey(key)).isFalse();
        }

        @Test
        @DisplayName("옛 세션의 지연된 종료는 «새 집중»의 리스를 지우지 못한다")
        void lateEndCannotClearNewerLease() {
            UUID older = sessionId();
            UUID newer = sessionId();
            presence().focusStarted(userId, older);
            presence().focusStarted(userId, newer);

            presence().focusEnded(userId, older);

            assertThat(redis.hasKey(key)).isTrue();
            assertThat(redis.opsForValue().get(key)).isEqualTo(newer.toString());
        }

        @Test
        @DisplayName("옛 세션의 지연된 시작은 «새 집중»의 리스를 덮어쓰지 못한다")
        void lateStartCannotOverwriteNewerLease() {
            UUID older = sessionId();
            UUID newer = sessionId();
            presence().focusStarted(userId, newer);

            presence().focusStarted(userId, older);

            assertThat(redis.opsForValue().get(key)).isEqualTo(newer.toString());
        }

        @Test
        @DisplayName("회전 중 쓰기가 실패해 남은 «이미 닫힌» 옛 리스를, 새 세션의 종료가 치운다")
        void newerEndClearsStaleOlderLease() {
            // 뽀모도로 회전: 이전 마커를 닫고 새 마커를 여는데, 그 사이 새 세션의 SET 이 실패해
            // 키에 «이미 닫힌» 이전 세션 id 가 남은 상황을 만든다. 그 마커는 종료됐으니 고아 스윕
            // 대상도 아니라, 엄격한 동일 비교로는 아무도 이 키를 못 지운다 — 최대 13시간 차단이다.
            UUID stale = sessionId();
            presence().focusStarted(userId, stale);

            UUID current = sessionId();
            // (current 의 SET 이 실패했다고 가정 — 일부러 부르지 않는다)
            presence().focusEnded(userId, current);

            assertThat(redis.hasKey(key)).isFalse();
        }

        @Test
        @DisplayName("종료 → 새 시작 순서는 정상적으로 새 리스를 놓는다 — 표식이 정상 재시작을 막으면 안 된다")
        void restartAfterEndStillWorks() {
            UUID first = sessionId();
            presence().focusStarted(userId, first);
            presence().focusEnded(userId, first);

            UUID second = sessionId();
            presence().focusStarted(userId, second);

            assertThat(redis.opsForValue().get(key)).isEqualTo(second.toString());
        }

        @Test
        @DisplayName("같은 세션의 재시작은 TTL 을 갱신한다 — 순서 역전 방어 경로가 그렇게 부른다")
        void sameSessionRefreshesLease() {
            UUID session = sessionId();
            presence().focusStarted(userId, session);

            assertThatCode(() -> presence().focusStarted(userId, session)).doesNotThrowAnyException();

            assertThat(redis.opsForValue().get(key)).isEqualTo(session.toString());
            assertThat(redis.getExpire(key)).isNotNull().isPositive();
        }
    }

    @Nested
    @DisplayName("실패는 집중을 막지 않는다")
    class FailureIsSwallowed {

        @Test
        @DisplayName("Redis 가 닿지 않아도 예외가 올라가지 않는다")
        void swallowsFailures() {
            LettuceConnectionFactory dead = new LettuceConnectionFactory("127.0.0.1", 1);
            dead.afterPropertiesSet();
            StringRedisTemplate deadTemplate = new StringRedisTemplate(dead);
            deadTemplate.afterPropertiesSet();
            RedisFocusPresence presence = new RedisFocusPresence(deadTemplate);

            assertThatCode(() -> presence.focusStarted(userId, sessionId())).doesNotThrowAnyException();
            assertThatCode(() -> presence.focusEnded(userId, sessionId())).doesNotThrowAnyException();

            dead.destroy();
        }

        @Test
        @DisplayName("커밋 «콜백 안»에서 죽어도 삼킨다 — 이미 커밋된 요청을 실패로 보이게 하면 안 된다")
        void swallowsFailuresInsideCommitCallback() {
            LettuceConnectionFactory dead = new LettuceConnectionFactory("127.0.0.1", 1);
            dead.afterPropertiesSet();
            StringRedisTemplate deadTemplate = new StringRedisTemplate(dead);
            deadTemplate.afterPropertiesSet();

            TransactionSynchronizationManager.initSynchronization();
            new RedisFocusPresence(deadTemplate).focusEnded(userId, sessionId());

            assertThatCode(() -> TransactionSynchronizationManager.getSynchronizations()
                    .forEach(s -> s.afterCommit()))
                    .doesNotThrowAnyException();

            dead.destroy();
        }
    }

    private RedisFocusPresence presence() {
        return new RedisFocusPresence(redis);
    }

    /**
     * 세션 id 는 <b>UUID v7 이어야</b> 하고, <b>생성기를 공유해야</b> 한다.
     *
     * <p>v4 면 「문자열 사전순 = 시간 순서」가 성립하지 않아 순서 테스트가 무의미해지고,
     * v7 이라도 <b>호출마다 새 생성기를 만들면 같은 밀리초 안에서 절반이 역전한다</b>(실측: 20,000건 중
     * 9,993건). 이 클래스의 테스트는 연속 두 호출의 대소를 단언하므로, 그러면 무작위로 깨진다.
     */
    private static final com.fasterxml.uuid.impl.TimeBasedEpochGenerator ID_GENERATOR =
            Generators.timeBasedEpochGenerator();

    private static UUID sessionId() {
        return ID_GENERATOR.generate();
    }
}
