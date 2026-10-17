package com.oneorthree.realtime.common.redis;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** 응원·바다 이모트의 시도 창 키가 합쳐지지 않게 하는 보험 — 접두어를 정리하다 한 키로 만드는 사고를 막는다. */
class RedisKeysTest {

    @Test
    @DisplayName("같은 userId 라도 바다 이모트 시도 창과 응원 시도 창은 다른 키이고 서로의 접두어가 아니다")
    void seaEmoteAttemptIsDistinctFromIslandEmoteAttempt() {
        UUID user = UUID.randomUUID();

        String sea = RedisKeys.seaEmoteAttempt(user);
        String island = RedisKeys.emoteAttempt(user);

        assertThat(sea).isNotEqualTo(island);
        assertThat(sea).startsWith("lock:chat:sea:emote:try:").doesNotStartWith("lock:chat:emote:");
        assertThat(island).startsWith("lock:chat:emote:try:").doesNotStartWith("lock:chat:sea:emote:");
    }
}
