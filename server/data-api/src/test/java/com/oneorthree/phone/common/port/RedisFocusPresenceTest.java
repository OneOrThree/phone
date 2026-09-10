package com.oneorthree.phone.common.port;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 프레즌스 어댑터의 세 가지 규율 — <b>커밋 이후에만</b>, <b>실패를 삼킨다</b>, <b>TTL 은 백스톱</b>.
 *
 * <p>세 가지 전부 «없어도 정상으로 보이는» 성질이다. 커밋 전에 써도 대부분의 요청은 커밋되니 잘
 * 돌아가고, 예외를 안 삼켜도 Redis 가 멀쩡하면 아무 일도 안 나며, TTL 이 없어도 종료가 지워 주면
 * 문제가 없다. 셋 다 «드문 경로»에서만 드러나므로 여기서 못 박는다.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class RedisFocusPresenceTest {

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final String KEY = "presence:focus:" + USER_ID;

    @Mock
    private StringRedisTemplate redis;

    @Mock
    private ValueOperations<String, String> valueOperations;

    @AfterEach
    void clearSynchronization() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    @DisplayName("트랜잭션 밖에서는 즉시 리스를 놓는다")
    void writesImmediatelyOutsideTransaction() {
        given(redis.opsForValue()).willReturn(valueOperations);

        presence().focusStarted(USER_ID);

        // 값이 아니라 «존재»가 신호다 — 읽는 쪽은 값을 보지 않기로 약속했다.
        verify(valueOperations).set(eq(KEY), any(), eq(Duration.ofHours(13)));
    }

    @Test
    @DisplayName("트랜잭션 안에서는 «아직» 쓰지 않는다 — 롤백되면 세션 없이 리스만 남는다")
    void defersUntilCommit() {
        given(redis.opsForValue()).willReturn(valueOperations);
        TransactionSynchronizationManager.initSynchronization();

        presence().focusStarted(USER_ID);

        verifyNoInteractions(valueOperations);
        assertThat(TransactionSynchronizationManager.getSynchronizations()).hasSize(1);
    }

    @Test
    @DisplayName("커밋 콜백이 돌면 그때 쓴다")
    void writesOnCommitCallback() {
        given(redis.opsForValue()).willReturn(valueOperations);
        TransactionSynchronizationManager.initSynchronization();
        presence().focusStarted(USER_ID);

        TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCommit());

        verify(valueOperations).set(eq(KEY), any(), eq(Duration.ofHours(13)));
    }

    @Test
    @DisplayName("종료는 리스를 지운다")
    void deletesOnEnd() {
        presence().focusEnded(USER_ID);

        verify(redis).delete(KEY);
    }

    @Test
    @DisplayName("Redis 가 죽어도 예외가 올라가지 않는다 — 부가 기능이 집중을 죽이면 안 된다")
    void swallowsFailures() {
        given(redis.opsForValue()).willReturn(valueOperations);
        willThrow(new org.springframework.dao.QueryTimeoutException("redis down"))
                .given(valueOperations).set(any(), any(), any(Duration.class));

        assertThatCode(() -> presence().focusStarted(USER_ID)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("커밋 «콜백 안»에서 죽어도 삼킨다 — 이미 커밋된 요청을 실패로 보이게 하면 안 된다")
    void swallowsFailuresInsideCommitCallback() {
        willThrow(new org.springframework.dao.QueryTimeoutException("redis down"))
                .given(redis).delete(KEY);
        TransactionSynchronizationManager.initSynchronization();
        presence().focusEnded(USER_ID);

        assertThatCode(() -> TransactionSynchronizationManager.getSynchronizations()
                .forEach(sync -> sync.afterCommit()))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("롤백되면(콜백 미실행) 아무것도 쓰지 않는다")
    void writesNothingOnRollback() {
        given(redis.opsForValue()).willReturn(valueOperations);
        TransactionSynchronizationManager.initSynchronization();

        presence().focusStarted(USER_ID);
        // afterCommit 을 부르지 않는다 = 롤백된 상황.

        verify(valueOperations, never()).set(any(), any(), any(Duration.class));
    }

    private RedisFocusPresence presence() {
        return new RedisFocusPresence(redis);
    }
}
