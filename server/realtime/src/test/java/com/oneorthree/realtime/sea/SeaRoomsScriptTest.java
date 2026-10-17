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

    /** 지금 구성원을 기대 집합으로 넘긴다 — 정상 경로(차단 검사 뒤 아무도 안 바뀜). */
    private Long join(UUID user, UUID room) {
        java.util.Set<String> now = redis.opsForSet().members(RedisKeys.seaRoomMembers(room));
        return join(user, room, String.join(",", now == null ? List.of() : now.stream().sorted().toList()), "");
    }

    private Long join(UUID user, UUID room, String expected, String adriftSince) {
        List<String> args = new ArrayList<>(List.of(user.toString(), room.toString(),
                Integer.toString(SeaRooms.SEA_ROOM_CAPACITY), "86400", expected, adriftSince, "state", "focusing"));
        return redis.execute(SeaRooms.JOIN, keys(user, room), args.toArray());
    }

    @Test
    @DisplayName("JOIN — 차단 검사 때 본 구성원과 지금 구성원이 다르면 -2 이고 아무것도 쓰지 않는다")
    void joinRejectsChangedMembership() {
        UUID room = UUID.randomUUID();
        UUID first = UUID.randomUUID();
        UUID latecomer = UUID.randomUUID(); // 검사 뒤에 들어온 사람(예: 차단 상대)
        join(first, room);
        String seen = first.toString();
        join(latecomer, room);

        UUID me = UUID.randomUUID();
        assertThat(join(me, room, seen, "")).isEqualTo(-2L);
        assertThat(redis.opsForSet().isMember(RedisKeys.seaRoomMembers(room), me.toString())).isFalse();
        assertThat(redis.hasKey(RedisKeys.seaUser(me))).isFalse();
        assertThat(join(me, UUID.randomUUID(), "", "")).as("새 방은 기대 집합이 빈 문자열").isEqualTo(1L);
    }

    @Test
    @DisplayName("JOIN — SET 에는 있고 해시가 없는 사람은 해시를 복구하고 1, 기대 집합은 보지 않는다")
    void joinRestoresAMissingHash() {
        UUID room = UUID.randomUUID();
        UUID user = UUID.randomUUID();
        join(user, room);
        redis.delete(RedisKeys.seaUser(user));

        assertThat(join(user, room, "anything", "")).isEqualTo(1L);
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(user), "roomId")).isEqualTo(room.toString());
        assertThat(redis.opsForSet().size(RedisKeys.seaRoomMembers(room))).isEqualTo(1L);
    }

    @Test
    @DisplayName("JOIN — adriftSince 가 있으면 같은 스크립트 안에서 sea:adrift 에 올린다")
    void joinIndexesAdriftEntrantsAtomically() {
        UUID user = UUID.randomUUID();
        assertThat(join(user, UUID.randomUUID(), "", "1234")).isEqualTo(1L);
        assertThat(redis.opsForZSet().score(RedisKeys.SEA_ADRIFT, user.toString())).isEqualTo(1234.0);
    }

    @Test
    @DisplayName("입장 — JOIN 직후 소켓이 끊겼고 다른 세션도 없으면 조용히 되돌리고 null(구성원 0·joined 없음)")
    void enterRevertsWhenTheSocketClosedDuringJoin() {
        redis.delete(RedisKeys.SEA_ROOMS_OPEN);
        com.oneorthree.realtime.config.RealtimeSessionRegistry sessions =
                org.mockito.Mockito.mock(com.oneorthree.realtime.config.RealtimeSessionRegistry.class);
        com.oneorthree.realtime.sea.client.SeaStateClient seaState =
                org.mockito.Mockito.mock(com.oneorthree.realtime.sea.client.SeaStateClient.class);
        com.oneorthree.realtime.sea.client.FriendsClient friends =
                org.mockito.Mockito.mock(com.oneorthree.realtime.sea.client.FriendsClient.class);
        SeaRoomPublisher publisher = org.mockito.Mockito.mock(SeaRoomPublisher.class);
        SeaRooms seaRooms = new SeaRooms(redis, seaState, friends,
                org.mockito.Mockito.mock(com.oneorthree.realtime.block.BlockedUsers.class), publisher, sessions,
                new tools.jackson.databind.ObjectMapper(), java.time.Clock.systemUTC());
        UUID user = UUID.randomUUID();
        UUID resident = UUID.randomUUID();
        UUID room = UUID.randomUUID();
        join(resident, room);
        org.mockito.BDDMockito.given(seaState.fetch(user)).willReturn(new com.oneorthree.realtime.sea.client.SeaStateClient
                .SeaState(null, null, null));
        org.mockito.BDDMockito.given(friends.fetchFriendIds(user)).willReturn(java.util.Set.of());
        // 입장 시작·JOIN 직전은 연결, JOIN 직후 끊김
        org.mockito.BDDMockito.given(sessions.isConnected("s")).willReturn(true, true, false);

        assertThat(seaRooms.enter(user, "s")).isNull();
        assertThat(redis.opsForSet().members(RedisKeys.seaRoomMembers(room))).containsExactly(resident.toString());
        assertThat(redis.hasKey(RedisKeys.seaUser(user))).isFalse();
        assertThat(redis.opsForZSet().score(RedisKeys.SEA_ADRIFT, user.toString())).isNull();
        org.mockito.Mockito.verifyNoInteractions(publisher);
    }

    private Long leave(UUID user, UUID room, String adriftSince) {
        return redis.execute(SeaRooms.LEAVE, keys(user, room), user.toString(), room.toString(), adriftSince);
    }

    private static List<String> keys(UUID user, UUID room) {
        return List.of(RedisKeys.seaRoomMembers(room), RedisKeys.SEA_ROOMS_OPEN, RedisKeys.seaUser(user),
                RedisKeys.SEA_ADRIFT);
    }
}
