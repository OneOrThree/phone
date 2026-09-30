package com.oneorthree.realtime.block;

import com.oneorthree.realtime.block.client.BlockClient;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.common.redis.RedisKeys;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 차단 세대 캐시의 판정 규칙 (GROMO-2182) — 세대가 같을 때만 캐시를 믿고, 실패는 전부 fail-closed 다.
 * 실제 Redis·실제 소켓 경로는 {@code ChatBlockFilterIntegrationTest} 가 본다.
 */
class BlockedUsersTest {

    private final UUID viewer = UUID.randomUUID();
    private final UUID blocked = UUID.randomUUID();
    private final BlockClient client = mock(BlockClient.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> values = mock(ValueOperations.class);
    private final BlockedUsers blockedUsers = new BlockedUsers(client, redis, 120);

    @BeforeEach
    void setUp() {
        when(redis.opsForValue()).thenReturn(values);
    }

    @Test
    @DisplayName("발신자가 없거나 본인이면 조회하지 않는다")
    void nullOrSelfSenderIsNotLookedUp() {
        assertThat(blockedUsers.hasBlocked(viewer, null)).isFalse();
        assertThat(blockedUsers.hasBlocked(viewer, viewer)).isFalse();
        verifyNoInteractions(redis, client);
    }

    @Test
    @DisplayName("캐시 세대가 현재 세대와 같으면 Data 를 부르지 않는다")
    void sameGenerationCacheIsTrusted() {
        cached("3", "3|" + blocked);

        assertThat(blockedUsers.hasBlocked(viewer, blocked)).isTrue();
        assertThat(blockedUsers.hasBlocked(viewer, UUID.randomUUID())).isFalse();
        verifyNoInteractions(client);
    }

    @Test
    @DisplayName("세대가 올랐으면 옛 캐시를 버리고 정본을 다시 읽어, 조회 전에 읽은 세대로 적재한다")
    void staleGenerationIsReloaded() {
        // 캐시는 «차단 없음»이던 세대 1, 차단 사건이 세대를 2 로 올렸다.
        cached("2", "1|");
        when(client.fetchBlockedIds(viewer)).thenReturn(Set.of(blocked));

        assertThat(blockedUsers.hasBlocked(viewer, blocked)).isTrue();
        verify(values).set(RedisKeys.blockCache(viewer), "2|" + blocked, Duration.ofSeconds(120));
    }

    @Test
    @DisplayName("세대 키가 없으면 0 이고, 깨진 캐시 값은 믿지 않고 다시 읽는다")
    void missingGenerationIsZeroAndCorruptCacheIsReloaded() {
        cached(null, "garbage");
        when(client.fetchBlockedIds(viewer)).thenReturn(Set.of());

        assertThat(blockedUsers.hasBlocked(viewer, blocked)).isFalse();
        verify(values).set(RedisKeys.blockCache(viewer), "0|", Duration.ofSeconds(120));

        cached("0", "0|not-a-uuid");
        when(client.fetchBlockedIds(viewer)).thenReturn(Set.of(blocked));
        assertThat(blockedUsers.hasBlocked(viewer, blocked)).isTrue();
    }

    @Test
    @DisplayName("Data 조회 실패는 판정 불가로 올리고 캐시하지 않는다(fail-closed)")
    void upstreamFailureIsFailClosed() {
        cached("0", null);
        when(client.fetchBlockedIds(viewer)).thenThrow(new UpstreamUnavailableException());

        assertThatThrownBy(() -> blockedUsers.hasBlocked(viewer, blocked))
                .isInstanceOf(UpstreamUnavailableException.class);
        verify(values, never()).set(anyString(), anyString(), any(Duration.class));
    }

    @Test
    @DisplayName("Redis 조회 실패도 판정 불가다 — Data 로 우회해 캐시 없는 판정을 만들지 않는다")
    void redisFailureIsFailClosed() {
        when(values.multiGet(any())).thenThrow(new RedisConnectionFailureException("down"));

        assertThatThrownBy(() -> blockedUsers.hasBlocked(viewer, blocked))
                .isInstanceOf(UpstreamUnavailableException.class);
        verifyNoInteractions(client);
    }

    @Test
    @DisplayName("적재 실패는 이번 판정을 막지 않는다 — 판정은 방금 정본에서 받았다")
    void storeFailureDoesNotBlockTheAnswer() {
        cached("0", null);
        when(client.fetchBlockedIds(viewer)).thenReturn(Set.of(blocked));
        doThrow(new RedisConnectionFailureException("down"))
                .when(values).set(anyString(), anyString(), any(Duration.class));

        assertThat(blockedUsers.hasBlocked(viewer, blocked)).isTrue();
    }

    @Test
    @DisplayName("세대 올리기는 INCR + 수명이고, 실패는 삼키지 않는다(사건 재전달로 복구)")
    void advanceGenerationIncrementsAndPropagatesFailure() {
        blockedUsers.advanceGeneration(viewer);
        verify(values).increment(RedisKeys.blockGeneration(viewer));
        verify(redis).expire(eq(RedisKeys.blockGeneration(viewer)), any(Duration.class));

        when(values.increment(RedisKeys.blockGeneration(viewer)))
                .thenThrow(new RedisConnectionFailureException("down"));
        assertThatThrownBy(() -> blockedUsers.advanceGeneration(viewer))
                .isInstanceOf(RedisConnectionFailureException.class);
    }

    private void cached(String generation, String value) {
        when(values.multiGet(List.of(RedisKeys.blockGeneration(viewer), RedisKeys.blockCache(viewer))))
                .thenReturn(Arrays.asList(generation, value));
    }
}
