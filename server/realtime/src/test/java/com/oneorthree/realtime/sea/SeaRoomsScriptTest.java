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

    @Autowired
    private SeaRooms seaRooms;

    @Test
    @DisplayName("membersOf — 해시가 만료된 유령은 SET 에서 치워져 정원이 풀리고 새 입장이 된다")
    void membersOfHealsGhost() {
        UUID room = UUID.randomUUID();
        UUID ghost = UUID.randomUUID();
        join(ghost, room);
        for (int i = 0; i < SeaRooms.SEA_ROOM_CAPACITY - 1; i++) {
            join(UUID.randomUUID(), room);
        }
        redis.delete(RedisKeys.seaUser(ghost)); // 사용자 해시 TTL 만료
        assertThat(redis.opsForSet().size(RedisKeys.seaRoomMembers(room))).isEqualTo(10L);

        assertThat(seaRooms.membersOf(room)).hasSize(9);

        assertThat(redis.opsForSet().isMember(RedisKeys.seaRoomMembers(room), ghost.toString())).isFalse();
        assertThat(redis.opsForSet().size(RedisKeys.seaRoomMembers(room))).isEqualTo(9L);
        assertThat(join(UUID.randomUUID(), room)).as("11번째가 아니라 정상 입장").isEqualTo(1L);
    }

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

    @Test
    @DisplayName("UPDATE — expectedRev 가 다르면 0·불변, 같으면 적용하고 rev+1, 비어 있으면 검사 없이 적용")
    void updateIsACompareAndSetOnRev() {
        UUID user = UUID.randomUUID();
        UUID room = UUID.randomUUID();
        join(user, room);
        long rev = rev(user);
        assertThat(rev).as("시각 씨앗 — 1 로 시작하지 않는다").isGreaterThan(1L);

        assertThat(update(user, room, "7", "remark", "늦은 보정")).isEqualTo(0L);
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(user), "remark")).isNull();
        assertThat(rev(user)).isEqualTo(rev);

        assertThat(update(user, room, Long.toString(rev), "remark", "보정")).isEqualTo(1L);
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(user), "remark")).isEqualTo("보정");
        assertThat(rev(user)).isEqualTo(rev + 1);

        assertThat(update(user, room, "", "remark", "사건")).as("Data 사건은 CAS 없이").isEqualTo(1L);
        assertThat(rev(user)).isEqualTo(rev + 2);
        assertThat(update(user, UUID.randomUUID(), "", "remark", "남의 방")).isEqualTo(0L);
    }

    @Test
    @DisplayName("[r1-7] JOIN — rev 는 다시 1 로 돌아가지 않는다: 해시 복구는 이전+1, 나갔다 같은 방 재입장도 이전보다 크다")
    void joinNeverResetsRev() throws Exception {
        UUID user = UUID.randomUUID();
        UUID room = UUID.randomUUID();
        join(user, room);
        long first = rev(user);
        update(user, room, "", "remark", "x");
        update(user, room, "", "remark", "y");
        redis.opsForHash().delete(RedisKeys.seaUser(user), "roomId"); // 해시 손상 → 복구 경로(cur 없음, SET 에는 있음)
        assertThat(join(user, room, "", "")).isEqualTo(1L);
        assertThat(rev(user)).as("이전(+2) 위로").isGreaterThan(first + 2);

        long beforeLeave = rev(user);
        assertThat(leave(user, room, "")).isEqualTo(1L);
        Thread.sleep(2);
        assertThat(join(user, room)).isEqualTo(1L);
        assertThat(rev(user)).as("ABA — 옛 보정의 CAS 가 통과하지 않는다").isNotEqualTo(beforeLeave).isGreaterThan(first);
    }

    @Test
    @DisplayName("[r1-7] LEAVE — 해시가 없으면 roomId 비교 없이 SET 에서 빼고 0, 빈 방이면 open 에서도 뺀다")
    void leaveClearsSetOnlyGhosts() {
        UUID ghost = UUID.randomUUID();
        UUID room = UUID.randomUUID();
        join(ghost, room);
        redis.delete(RedisKeys.seaUser(ghost));
        redis.opsForZSet().add(RedisKeys.SEA_ADRIFT, ghost.toString(), 1000); // 10분 정리 색인에 남은 항목

        assertThat(leave(ghost, room, "1000")).as("사건은 내지 않는다").isEqualTo(0L);
        assertThat(redis.opsForZSet().score(RedisKeys.SEA_ADRIFT, ghost.toString()))
                .as("정리가 같은 항목을 영원히 다시 뽑지 않게 색인에서도 뺀다").isNull();
        assertThat(redis.hasKey(RedisKeys.seaRoomMembers(room))).isFalse();
        assertThat(redis.opsForSet().isMember(RedisKeys.SEA_ROOMS_OPEN, room.toString())).isFalse();
    }

    @Test
    @DisplayName("[r1-1] joined 발행과 소속 확인 사이에 다른 기기의 LEAVE 가 끼면 left{left} 를 보정 발행한다")
    void lateJoinedIsFollowedByACorrectiveLeft() {
        redis.delete(RedisKeys.SEA_ROOMS_OPEN);
        Fixture f = new Fixture();
        UUID user = UUID.randomUUID();
        org.mockito.BDDMockito.given(f.seaState.fetch(user)).willReturn(
                new com.oneorthree.realtime.sea.client.SeaStateClient.SeaState(null, null, null));
        org.mockito.BDDMockito.given(f.friends.fetchFriendIds(user)).willReturn(java.util.Set.of());
        org.mockito.BDDMockito.given(f.sessions.isConnected("s")).willReturn(true);
        java.util.concurrent.atomic.AtomicReference<UUID> joinedRoom = new java.util.concurrent.atomic.AtomicReference<>();
        // joined 발행 «순간» 다른 기기가 LEAVE 를 끝낸다(그 기기의 left 는 이미 나갔다고 친다)
        org.mockito.BDDMockito.willAnswer(invocation -> {
            UUID room = invocation.getArgument(0);
            joinedRoom.set(room);
            leave(user, room, "");
            return null;
        }).given(f.publisher).publish(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.eq(SeaRooms.MEMBER_JOINED), org.mockito.ArgumentMatchers.any());

        assertThat(f.seaRooms.enter(user, "s")).isNotNull();

        org.mockito.ArgumentCaptor<tools.jackson.databind.JsonNode> payload =
                org.mockito.ArgumentCaptor.forClass(tools.jackson.databind.JsonNode.class);
        org.mockito.Mockito.verify(f.publisher).publish(org.mockito.ArgumentMatchers.eq(joinedRoom.get()),
                org.mockito.ArgumentMatchers.eq(SeaRooms.MEMBER_LEFT), payload.capture());
        assertThat(payload.getValue().get("userId").stringValue()).isEqualTo(user.toString());
        assertThat(payload.getValue().get("reason").stringValue()).isEqualTo(SeaRooms.LEFT);
    }

    @Test
    @DisplayName("[r1-2] 두 세션 종료 사건이 차례로 와도(레지스트리 리스너보다 먼저) 퇴장 1회·left{disconnected} 1건")
    void twoSessionDisconnectsLeaveExactlyOnce() {
        Fixture f = new Fixture(new com.oneorthree.realtime.config.RealtimeSessionRegistry());
        UUID user = UUID.randomUUID();
        UUID room = UUID.randomUUID();
        join(user, room);
        com.oneorthree.realtime.auth.ChatPrincipal principal =
                new com.oneorthree.realtime.auth.ChatPrincipal(user, "Bearer t");
        f.sessions.register("a", principal);
        f.sessions.register("b", principal);

        f.seaRooms.disconnected(disconnect("a", principal));
        f.seaRooms.disconnected(disconnect("b", principal));

        org.mockito.Mockito.verify(f.publisher, org.mockito.Mockito.times(1)).publish(
                org.mockito.ArgumentMatchers.eq(room), org.mockito.ArgumentMatchers.eq(SeaRooms.MEMBER_LEFT),
                org.mockito.ArgumentMatchers.any());
        assertThat(redis.hasKey(RedisKeys.seaUser(user))).isFalse();
    }

    @Test
    @DisplayName("[r3-3] 차단 검사 뒤 구성원이 계속 바뀌어 -2 를 3회 소진하면 그 후보를 포기하고 새 방으로 간다")
    void exhaustedMembershipChangesFallBackToANewRoom() {
        redis.delete(RedisKeys.SEA_ROOMS_OPEN);
        Fixture f = new Fixture();
        UUID user = UUID.randomUUID();
        UUID busy = UUID.randomUUID();
        join(UUID.randomUUID(), busy);
        org.mockito.BDDMockito.given(f.seaState.fetch(user)).willReturn(
                new com.oneorthree.realtime.sea.client.SeaStateClient.SeaState(null, null, null));
        org.mockito.BDDMockito.given(f.friends.fetchFriendIds(user)).willReturn(java.util.Set.of());
        org.mockito.BDDMockito.given(f.sessions.isConnected("s")).willReturn(true);
        // 차단 판정을 할 때마다 누군가 그 방에 들어온다 — JOIN 이 볼 때마다 집합이 다르다(-2)
        org.mockito.BDDMockito.given(f.blockedUsers.eitherBlocked(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any())).willAnswer(invocation -> {
                    redis.opsForSet().add(RedisKeys.seaRoomMembers(busy), UUID.randomUUID().toString());
                    return false;
                });

        SeaRoomEvent assigned = f.seaRooms.enter(user, "s");

        assertThat(assigned).isNotNull();
        assertThat(assigned.roomId()).isNotEqualTo(busy);
        assertThat(redis.opsForSet().isMember(RedisKeys.seaRoomMembers(busy), user.toString())).isFalse();
    }

    private static org.springframework.web.socket.messaging.SessionDisconnectEvent disconnect(String sessionId,
            java.security.Principal user) {
        return new org.springframework.web.socket.messaging.SessionDisconnectEvent(new Object(),
                org.springframework.messaging.support.MessageBuilder.withPayload(new byte[0]).build(), sessionId,
                org.springframework.web.socket.CloseStatus.NORMAL, user);
    }

    /** 실 Redis + 목 경계로 만든 SeaRooms. */
    private final class Fixture {
        final com.oneorthree.realtime.config.RealtimeSessionRegistry sessions;
        final com.oneorthree.realtime.sea.client.SeaStateClient seaState =
                org.mockito.Mockito.mock(com.oneorthree.realtime.sea.client.SeaStateClient.class);
        final com.oneorthree.realtime.sea.client.FriendsClient friends =
                org.mockito.Mockito.mock(com.oneorthree.realtime.sea.client.FriendsClient.class);
        final SeaRoomPublisher publisher = org.mockito.Mockito.mock(SeaRoomPublisher.class);
        final com.oneorthree.realtime.block.BlockedUsers blockedUsers =
                org.mockito.Mockito.mock(com.oneorthree.realtime.block.BlockedUsers.class);
        final SeaRooms seaRooms;

        Fixture() {
            this(org.mockito.Mockito.mock(com.oneorthree.realtime.config.RealtimeSessionRegistry.class));
        }

        Fixture(com.oneorthree.realtime.config.RealtimeSessionRegistry sessions) {
            this.sessions = sessions;
            this.seaRooms = new SeaRooms(redis, seaState, friends, blockedUsers, publisher, sessions,
                    new tools.jackson.databind.ObjectMapper(), java.time.Clock.systemUTC());
        }
    }

    private long rev(UUID user) {
        return Long.parseLong((String) redis.opsForHash().get(RedisKeys.seaUser(user), "rev"));
    }

    private Long update(UUID user, UUID room, String expectedRev, String field, String value) {
        return redis.execute(SeaRooms.UPDATE, List.of(RedisKeys.seaUser(user), RedisKeys.SEA_ADRIFT),
                room.toString(), user.toString(), "", "0", expectedRev, "0", field, value);
    }

    private Long leave(UUID user, UUID room, String adriftSince) {
        return redis.execute(SeaRooms.LEAVE, keys(user, room), user.toString(), room.toString(), adriftSince);
    }

    private static List<String> keys(UUID user, UUID room) {
        return List.of(RedisKeys.seaRoomMembers(room), RedisKeys.SEA_ROOMS_OPEN, RedisKeys.seaUser(user),
                RedisKeys.SEA_ADRIFT);
    }
}
