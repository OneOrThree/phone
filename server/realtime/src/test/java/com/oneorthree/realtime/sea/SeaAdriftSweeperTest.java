package com.oneorthree.realtime.sea;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.common.redis.RedisKeys;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.JsonNode;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.reset;
import static org.mockito.ArgumentCaptor.forClass;

/**
 * 떠 있는 채 10분 정리 (GROMO-2300, 계약 §5) — 실제 Redis 에 상태를 심고 {@code sweep()} 을 직접 한 번 돈다
 * (60초를 기다리지 않는다). 방 사건은 발행자 스파이로 관측한다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class SeaAdriftSweeperTest {

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private SeaAdriftSweeper sweeper;

    @MockitoSpyBean
    private SeaRoomPublisher publisher;

    @Test
    @DisplayName("떠 있은 지 11분 → left{adrift} 발행, 해시·구성원·sea:adrift 제거")
    void staleAdriftUserIsSwept() {
        UUID room = UUID.randomUUID();
        UUID user = adrift(room, System.currentTimeMillis() - Duration.ofMinutes(11).toMillis());
        reset(publisher);

        sweeper.sweep();

        var payload = forClass(JsonNode.class);
        verify(publisher).publish(eq(room), eq(SeaRooms.MEMBER_LEFT), payload.capture());
        assertThat(payload.getValue().get("userId").asString()).isEqualTo(user.toString());
        assertThat(payload.getValue().get("reason").asString()).isEqualTo("adrift");
        assertThat(redis.hasKey(RedisKeys.seaUser(user))).isFalse();
        assertThat(redis.opsForSet().isMember(RedisKeys.seaRoomMembers(room), user.toString())).isFalse();
        assertThat(redis.opsForZSet().score(RedisKeys.SEA_ADRIFT, user.toString())).isNull();
    }

    @Test
    @DisplayName("떠 있은 지 1분 → 그대로 둔다")
    void freshAdriftUserIsKept() {
        UUID room = UUID.randomUUID();
        UUID user = adrift(room, System.currentTimeMillis() - Duration.ofMinutes(1).toMillis());
        reset(publisher);

        sweeper.sweep();

        verify(publisher, never()).publish(eq(room), any(), any());
        assertThat(redis.hasKey(RedisKeys.seaUser(user))).isTrue();
        assertThat(redis.opsForZSet().score(RedisKeys.SEA_ADRIFT, user.toString())).isNotNull();
    }

    @Test
    @DisplayName("색인은 11분 전인데 해시의 adriftSince 가 바뀌었다(다시 항해·다시 끝남) → 미삭제, 사건 0건")
    void changedAdriftSinceIsNotSwept() {
        UUID room = UUID.randomUUID();
        UUID user = adrift(room, System.currentTimeMillis() - Duration.ofMinutes(11).toMillis());
        // 색인을 읽은 뒤 그 사람이 다시 항해했다가 방금 끝낸 상황 — 해시만 새 값이고 색인(점수)은 낡은 채로 읽혔다.
        redis.opsForHash().put(RedisKeys.seaUser(user), "adriftSince",
                Long.toString(System.currentTimeMillis()));
        reset(publisher);

        sweeper.sweep();

        verify(publisher, never()).publish(eq(room), any(), any());
        assertThat(redis.hasKey(RedisKeys.seaUser(user))).isTrue();
        assertThat(redis.opsForSet().isMember(RedisKeys.seaRoomMembers(room), user.toString())).isTrue();
    }

    private UUID adrift(UUID room, long adriftSince) {
        UUID user = UUID.randomUUID();
        redis.opsForSet().add(RedisKeys.seaRoomMembers(room), user.toString());
        redis.opsForHash().putAll(RedisKeys.seaUser(user), Map.of("roomId", room.toString(), "state", "adrift",
                "adriftSince", Long.toString(adriftSince), "rev", "1"));
        redis.opsForZSet().add(RedisKeys.SEA_ADRIFT, user.toString(), adriftSince);
        return user;
    }

    @Test
    @DisplayName("해시 없음 — 색인 점수가 고른 값 그대로면 잔재를 지우고, 그사이 바뀌었으면(재입장) 유지한다")
    void orphanIndexIsRemovedOnlyWhenScoreUnchanged() {
        long picked = System.currentTimeMillis() - Duration.ofMinutes(11).toMillis();
        UUID gone = UUID.randomUUID();
        redis.opsForZSet().add(RedisKeys.SEA_ADRIFT, gone.toString(), picked);
        assertThat(sweeper.removeIndexIfUnchanged(gone, picked)).isTrue();
        assertThat(redis.opsForZSet().score(RedisKeys.SEA_ADRIFT, gone.toString())).isNull();

        UUID rejoined = UUID.randomUUID();
        long fresh = System.currentTimeMillis();
        redis.opsForZSet().add(RedisKeys.SEA_ADRIFT, rejoined.toString(), fresh);
        assertThat(sweeper.removeIndexIfUnchanged(rejoined, picked)).isFalse();
        assertThat(redis.opsForZSet().score(RedisKeys.SEA_ADRIFT, rejoined.toString())).isEqualTo((double) fresh);
    }
}
