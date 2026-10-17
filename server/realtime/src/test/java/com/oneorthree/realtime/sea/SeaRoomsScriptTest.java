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

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 바다 방 Lua 두 개의 규칙 (GROMO-2300, 계약 §5) — 실제 Redis 에서 스크립트만 직접 돌린다.
 * 배선(소켓·사건)은 {@code SeaRoomIntegrationTest} 가 본다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class SeaRoomsScriptTest {

    @Autowired
    private StringRedisTemplate redis;

    @Test
    @DisplayName("JOIN — 10번째가 들어오면 방이 open 에서 빠지고, 11번째는 0(그리고 방은 open 에 없다)")
    void joinRespectsCapacity() {
        UUID room = UUID.randomUUID();
        for (int i = 0; i < SeaRooms.SEA_ROOM_CAPACITY - 1; i++) {
            assertThat(join(UUID.randomUUID(), room)).isEqualTo(1L);
        }
        assertThat(redis.opsForSet().isMember(RedisKeys.SEA_ROOMS_OPEN, room.toString())).isTrue();

        assertThat(join(UUID.randomUUID(), room)).isEqualTo(1L);
        assertThat(redis.opsForSet().isMember(RedisKeys.SEA_ROOMS_OPEN, room.toString())).isFalse();

        redis.opsForSet().add(RedisKeys.SEA_ROOMS_OPEN, room.toString()); // 낡은 open 항목
        UUID eleventh = UUID.randomUUID();
        assertThat(join(eleventh, room)).isEqualTo(0L);
        assertThat(redis.opsForSet().size(RedisKeys.seaRoomMembers(room))).isEqualTo(10L);
        assertThat(redis.opsForSet().isMember(RedisKeys.SEA_ROOMS_OPEN, room.toString())).isFalse();
        assertThat(redis.hasKey(RedisKeys.seaUser(eleventh))).isFalse();
    }

    @Test
    @DisplayName("JOIN — 같은 방 재입장은 1(중복 없음), 다른 방에 이미 있으면 -1(두 기기 경합)")
    void joinIsIdempotentAndDetectsAnotherRoom() {
        UUID user = UUID.randomUUID();
        UUID room = UUID.randomUUID();
        UUID other = UUID.randomUUID();

        assertThat(join(user, room)).isEqualTo(1L);
        assertThat(join(user, room)).isEqualTo(1L);
        assertThat(redis.opsForSet().size(RedisKeys.seaRoomMembers(room))).isEqualTo(1L);
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(user), "state")).isEqualTo("focusing");
        assertThat(redis.getExpire(RedisKeys.seaUser(user))).isPositive();

        assertThat(join(user, other)).isEqualTo(-1L);
        assertThat(redis.hasKey(RedisKeys.seaRoomMembers(other))).isFalse();
    }

    @Test
    @DisplayName("LEAVE — roomId·adriftSince 가 다르면 0, 맞으면 1 이고 빈 방은 DEL·open 에서 뺀다")
    void leaveChecksRoomAndAdriftSince() {
        UUID user = UUID.randomUUID();
        UUID stays = UUID.randomUUID();
        UUID room = UUID.randomUUID();
        join(user, room);
        join(stays, room);
        redis.opsForHash().put(RedisKeys.seaUser(user), "adriftSince", "1000");
        redis.opsForZSet().add(RedisKeys.SEA_ADRIFT, user.toString(), 1000);

        assertThat(leave(user, UUID.randomUUID(), "")).isEqualTo(0L);
        assertThat(leave(user, room, "999")).as("그사이 다시 항해했다").isEqualTo(0L);
        assertThat(leave(user, room, "1000")).isEqualTo(1L);
        assertThat(redis.hasKey(RedisKeys.seaUser(user))).isFalse();
        assertThat(redis.opsForZSet().score(RedisKeys.SEA_ADRIFT, user.toString())).isNull();
        assertThat(redis.opsForSet().isMember(RedisKeys.SEA_ROOMS_OPEN, room.toString())).isTrue();
        assertThat(leave(user, room, "")).as("두 번째 퇴장은 0 — 사건도 한 번").isEqualTo(0L);

        assertThat(leave(stays, room, "")).isEqualTo(1L);
        assertThat(redis.hasKey(RedisKeys.seaRoomMembers(room))).isFalse();
        assertThat(redis.opsForSet().isMember(RedisKeys.SEA_ROOMS_OPEN, room.toString())).isFalse();
    }

    private Long join(UUID user, UUID room) {
        List<String> args = new ArrayList<>(List.of(user.toString(), room.toString(),
                Integer.toString(SeaRooms.SEA_ROOM_CAPACITY), "86400", "state", "focusing"));
        return redis.execute(SeaRooms.JOIN, keys(user, room), args.toArray());
    }

    private Long leave(UUID user, UUID room, String adriftSince) {
        return redis.execute(SeaRooms.LEAVE, keys(user, room), user.toString(), room.toString(), adriftSince);
    }

    private static List<String> keys(UUID user, UUID room) {
        return List.of(RedisKeys.seaRoomMembers(room), RedisKeys.SEA_ROOMS_OPEN, RedisKeys.seaUser(user),
                RedisKeys.SEA_ADRIFT);
    }
}
