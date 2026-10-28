package com.oneorthree.realtime.sea;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.block.BlockedUsers;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.common.id.UuidV7;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.config.StompTopics;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import com.oneorthree.realtime.sea.client.FriendsClient;
import com.oneorthree.realtime.sea.client.SeaStateClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * 먼바다 방 — 입장·배정·퇴장·Data 사건 중계 (GROMO-2300, 계약 §5 · 결정 N13·N19~N24).
 *
 * <h2>상태는 전부 Redis 다</h2>
 * 이동 방({@code MovementRooms})처럼 JVM 메모리에 두지 않는다 — 인스턴스가 여럿이어도 한 사람은 한 방이고 한 방은
 * 10명이어야 해서, 배정은 Lua 스크립트 하나({@link #JOIN})로 원자적으로 한다. 사용자 해시
 * {@code sea:user:{id}} 의 {@code roomId} 가 소속의 정본이다(구독 관문·전달 직전 검사가 이것을 읽는다).
 *
 * <h2>방 소속은 사용자 단위 하나, 세션은 여럿</h2>
 * 자발 퇴장·UNSUBSCRIBE 는 즉시 퇴장이다. 소켓 종료는 이 JVM 에 같은 사용자의 다른 세션이 없을 때만 퇴장이다 —
 * 다른 인스턴스의 기기는 보지 못하므로, 퇴장 뒤 그 기기는 전달 직전 재검사에 막혀 조용해지고 다음 입장으로 돌아온다.
 *
 * <h2>퇴장은 셋 다 같은 스크립트</h2>
 * 자발 퇴장·소켓 종료·떠 있는 채 10분 정리(GROMO-2300 2/2)가 같은 {@link #LEAVE} 를 쓴다. 인스턴스 둘이 같은 사람을
 * 동시에 내보내도 둘째는 0 을 받아 사건을 내지 않는다.
 */
@Slf4j
@Service
public class SeaRooms {

    /** 방 정원 — 앱은 이 중 5명을 골라 그린다(N15). */
    public static final int SEA_ROOM_CAPACITY = 10;

    /** 퇴장 사유 — {@code sea.member.left.reason}. */
    public static final String LEFT = "left";
    public static final String ADRIFT = "adrift";
    public static final String DISCONNECTED = "disconnected";

    public static final String ASSIGNED = "sea.room.assigned";
    public static final String SNAPSHOT = "sea.room.snapshot";

    /** 사용자 단위 퇴장을 그 사람의 (이 JVM) 모든 세션 {@code /user/queue/sea} 에 알린다 — 다른 기기가 모르게 남지 않게. */
    public static final String ROOM_LEFT = "sea.room.left";
    public static final String MEMBER_JOINED = "sea.member.joined";
    public static final String MEMBER_LEFT = "sea.member.left";
    public static final String MEMBER_UPDATED = "sea.member.updated";

    static final String FOCUSING = "focusing";
    static final Duration TTL = Duration.ofHours(24);

    /** 차단 검사를 하는 후보 방 수 — 방마다 구성원 수만큼 차단 조회가 나가므로 상한을 둔다(N23). */
    static final int BLOCK_CHECKED_CANDIDATES = 3;

    /** 구성원이 바뀌어(-2) 다시 읽고 다시 검사하는 횟수 — 넘으면 다음 후보로. */
    static final int JOIN_RECHECKS = 3;

    /** Data {@code activeSeconds} 의 상한(10년) — 넘으면 불량 params 로 본다(시각 계산 overflow 방지). */
    static final long MAX_ACTIVE_SECONDS = Duration.ofDays(3653).toSeconds();

    private static final long ABORTED = Long.MIN_VALUE;

    private static final String ROOM_ID = "roomId";
    private static final String STATE = "state";
    private static final String REMARK = "remark";
    private static final String NAME = "name";
    private static final String CAT_COLOR = "catColor";
    private static final String SESSION_ID = "sessionId";
    private static final String DESTINATION = "destinationIslandId";
    private static final String SAILING_MINUTES = "sailingMinutes";
    private static final String STARTED_AT = "startedAt";
    private static final String ADRIFT_SINCE = "adriftSince";
    private static final String REV = "rev";

    /**
     * 입장. 1 = 들어갔다(또는 이미 그 방), 0 = 꽉 찼다(그 방을 open 에서 뺀다), -1 = 이미 다른 방에 있다(두 기기 경합),
     * -2 = 구성원이 차단 검사 때 본 집합과 다르다(그사이 누가 들어왔거나 나갔다 — 다시 읽고 다시 검사한다).
     *
     * <p>SET 에는 있는데 해시가 없는 사람(해시만 만료·삭제)은 해시를 다시 써 준다 — 그래야 구독 관문을 통과한다.
     * 항해 없이 들어오면(adriftSince 가 비어 있지 않으면) 10분 정리 색인에도 같은 스크립트 안에서 올린다.
     *
     * <p>개정 번호 {@code rev}({@link #UPDATE} 가 전이마다 올린다)는 <b>다시 1 로 돌아가지 않는다</b> — 해시를 다시 쓸 때
     * {@code max(이전 rev + 1, 서버 시각 µs)} 로 둔다. 1 로 되돌리면 «나갔다가 같은 방에 다시 들어온» 뒤에도 옛 보정의
     * CAS 가 통과한다(ABA). 이전 해시는 LEAVE 가 지우므로 이전 값만으로는 못 막고, 시각 씨앗이 그 경우를 덮는다.
     *
     * <p>KEYS: members, open, user, adrift / ARGV: userId, roomId, capacity, ttlSec, 기대 구성원(정렬·',' 연결),
     * adriftSince(ms)|'', 해시 field/value…
     */
    static final RedisScript<Long> JOIN = new DefaultRedisScript<>(
            "local cur = redis.call('HGET', KEYS[3], 'roomId')\n"
            + "if cur and cur ~= ARGV[2] then return -1 end\n"
            + "local member = redis.call('SISMEMBER', KEYS[1], ARGV[1])\n"
            + "if member == 1 and cur then return 1 end\n"
            + "if member == 0 then\n"
            + "  if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[3]) then\n"
            + "    redis.call('SREM', KEYS[2], ARGV[2]); return 0\n"
            + "  end\n"
            + "  local now = redis.call('SMEMBERS', KEYS[1])\n"
            + "  table.sort(now)\n"
            + "  if table.concat(now, ',') ~= ARGV[5] then return -2 end\n"
            + "  redis.call('SADD', KEYS[1], ARGV[1])\n"
            + "end\n"
            + "redis.call('EXPIRE', KEYS[1], ARGV[4])\n"
            + "local prev = tonumber(redis.call('HGET', KEYS[3], 'rev')) or 0\n"
            + "local t = redis.call('TIME')\n"
            + "local rev = math.max(prev + 1, tonumber(t[1]) * 1000000 + tonumber(t[2]))\n"
            + "redis.call('DEL', KEYS[3])\n"
            + "redis.call('HSET', KEYS[3], 'roomId', ARGV[2], 'rev', string.format('%.0f', rev), unpack(ARGV, 7))\n"
            + "redis.call('EXPIRE', KEYS[3], ARGV[4])\n"
            + "if ARGV[6] ~= '' then redis.call('ZADD', KEYS[4], ARGV[6], ARGV[1])\n"
            + "else redis.call('ZREM', KEYS[4], ARGV[1]) end\n"
            + "if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[3]) then redis.call('SREM', KEYS[2], ARGV[2])\n"
            + "else redis.call('SADD', KEYS[2], ARGV[2]) end\n"
            + "return 1", Long.class);

    /**
     * 퇴장. 1 = 내보냈다, 0 = 그 방에 없거나(이미 나감·다른 방) adriftSince 가 기대값과 다르다(그사이 다시 항해).
     *
     * <p>해시가 아예 없으면(만료·삭제) 그 방 SET 과 {@code sea:adrift} 색인에서 빼고 0 이다 — 사건은 내지 않는다. 안 빼면
     * SET 에만 남은 유령이 정원·후보 크기를 잡아먹고, 색인에 남은 항목은 10분 정리가 매 주기 다시 뽑아 영원히 0 을 받는다.
     * 빈 방이 되면 open 에서도 뺀다. 다른 방에 있는(cur ≠ roomId) 사람은 건드리지 않는다 — 그 색인 항목은 그 방의 것이다.
     *
     * <p>KEYS: members, open, user, adrift / ARGV: userId, roomId, expectedAdriftSince|''
     */
    static final RedisScript<Long> LEAVE = new DefaultRedisScript<>(
            "local cur = redis.call('HGET', KEYS[3], 'roomId')\n"
            + "if not cur then\n"
            + "  redis.call('SREM', KEYS[1], ARGV[1])\n"
            + "  redis.call('ZREM', KEYS[4], ARGV[1])\n"
            + "  if redis.call('SCARD', KEYS[1]) == 0 then\n"
            + "    redis.call('DEL', KEYS[1]); redis.call('SREM', KEYS[2], ARGV[2])\n"
            + "  end\n"
            + "  return 0\n"
            + "end\n"
            + "if cur ~= ARGV[2] then return 0 end\n"
            + "if ARGV[3] ~= '' and redis.call('HGET', KEYS[3], 'adriftSince') ~= ARGV[3] then return 0 end\n"
            + "redis.call('SREM', KEYS[1], ARGV[1]); redis.call('DEL', KEYS[3])\n"
            + "redis.call('ZREM', KEYS[4], ARGV[1])\n"
            + "if redis.call('SCARD', KEYS[1]) == 0 then\n"
            + "  redis.call('DEL', KEYS[1]); redis.call('SREM', KEYS[2], ARGV[2])\n"
            + "else redis.call('SADD', KEYS[2], ARGV[2]) end\n"
            + "return 1", Long.class);

    /**
     * 해시 전이 — 그 방에 아직 있을 때만 고친다(나간 뒤 늦게 온 사건이 수명 없는 해시를 되살리지 않게). 바꿀 때마다
     * {@code rev} 를 1 올린다. {@code expectedRev} 가 비어 있지 않으면 지금 rev 가 그 값일 때만 바꾼다(CAS) — 입장 보정이
     * 그사이 먼저 적용된 Data 사건을 오래된 재조회 결과로 덮어쓰지 않게 한다. Data 사건 자체는 검사 없이 적용한다.
     *
     * <p>KEYS: user, adrift / ARGV: roomId, userId, adrift 연산('add'|'rem'|''), 점수, expectedRev|'', 지울 필드 수 n,
     * 지울 필드 n개, 쓸 field/value…
     */
    static final RedisScript<Long> UPDATE = new DefaultRedisScript<>(
            "if redis.call('HGET', KEYS[1], 'roomId') ~= ARGV[1] then return 0 end\n"
            + "if ARGV[5] ~= '' and redis.call('HGET', KEYS[1], 'rev') ~= ARGV[5] then return 0 end\n"
            + "local n = tonumber(ARGV[6])\n"
            + "for i = 7, 6 + n do redis.call('HDEL', KEYS[1], ARGV[i]) end\n"
            + "if #ARGV > 6 + n then redis.call('HSET', KEYS[1], unpack(ARGV, 7 + n)) end\n"
            + "redis.call('HINCRBY', KEYS[1], 'rev', 1)\n"
            + "if ARGV[3] == 'add' then redis.call('ZADD', KEYS[2], ARGV[4], ARGV[2])\n"
            + "elseif ARGV[3] == 'rem' then redis.call('ZREM', KEYS[2], ARGV[2]) end\n"
            + "return 1", Long.class);

    private static final Set<String> MEMBER_STATUSES = Set.of("sailing", "ended", "remark");

    private final StringRedisTemplate redis;
    private final SeaStateClient seaState;
    private final FriendsClient friends;
    private final BlockedUsers blockedUsers;
    private final SeaRoomPublisher publisher;
    private final RealtimeSessionRegistry sessions;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public SeaRooms(StringRedisTemplate redis, SeaStateClient seaState, FriendsClient friends,
            BlockedUsers blockedUsers, SeaRoomPublisher publisher, RealtimeSessionRegistry sessions,
            ObjectMapper objectMapper, Clock clock) {
        this.redis = redis;
        this.seaState = seaState;
        this.friends = friends;
        this.blockedUsers = blockedUsers;
        this.publisher = publisher;
        this.sessions = sessions;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    /**
     * 먼바다 입장 — 이미 방이 있으면 그 방을 다시 알려 주고({@code joined} 없음, 재연결), 없으면 배정한다.
     *
     * <p>{@code assigned} 에는 {@code roomId} 만 싣는다. 구성원 목록은 앱이 방 토픽을 구독한 «뒤» {@link #snapshot}
     * 으로 받는다 — 구독 전에 목록을 주면 그 사이 입퇴장 사건을 놓친다.
     *
     * @return 그 세션에 보낼 {@code sea.room.assigned}. 세션이 끊겼으면 {@code null}(늦게 처리된 프레임·종료 경합)
     * @throws UpstreamUnavailableException 바다 상태를 Data 에서 못 받았을 때 — 입장 실패
     */
    public SeaRoomEvent enter(UUID userId, String sessionId) {
        if (!sessions.isConnected(sessionId)) {
            return null; // 끊긴 뒤 늦게 처리된 SEND 가 유령 구성원을 만들지 않게
        }
        SeaRoomEvent existing = existingAssignment(userId);
        if (existing != null) {
            return existing;
        }
        SeaStateClient.SeaState state = seaState.fetch(userId);
        Set<UUID> friendIds = friendsOrNone(userId);
        Instant now = clock.instant();
        String adriftSince = state.session() == null ? Long.toString(now.toEpochMilli()) : "";
        List<String> fields = joinFields(state, adriftSince);
        String destination = state.session() == null ? null : state.session().destinationIslandId().toString();

        for (Candidate candidate : candidates(userId, destination, friendIds)) {
            long result = joinChecked(userId, sessionId, candidate, fields, adriftSince);
            if (result == ABORTED) {
                return null;
            }
            if (result == 1) {
                return logEntered(joined(userId, sessionId, candidate.roomId(), state), userId, false,
                        candidate.score());
            }
            if (result == -1) {
                return reconfirm(userId);
            }
        }
        if (!sessions.isConnected(sessionId)) {
            return null;
        }
        UUID fresh = UuidV7.next();
        return join(userId, fresh, "", fields, adriftSince) == 1
                ? logEntered(joined(userId, sessionId, fresh, state), userId, true, 0) : reconfirm(userId);
    }

    /** 운영 추적용 — 「누가 어느 방」. 한마디 원문은 남기지 않는다. */
    private static SeaRoomEvent logEntered(SeaRoomEvent assigned, UUID userId, boolean newRoom, int score) {
        if (assigned != null) {
            log.info("바다 입장 — roomId={} userId={} newRoom={} score={}", assigned.roomId(), userId, newRoom, score);
        }
        return assigned;
    }

    /**
     * 지금 방의 원본 스냅샷 — {@code SEND /app/sea/sync} 의 답. 전달 직전에 수신자별 양방향 차단을 거른다.
     * 방 토픽을 구독한 뒤에 부르므로 그 뒤 사건과 겹칠 수는 있어도 빠지지는 않는다.
     *
     * @throws ChatException {@code NOT_IN_SEA_ROOM} — 방이 없다
     */
    public SeaRoomEvent snapshot(UUID userId) {
        UUID roomId = currentRoom(userId);
        if (roomId == null) {
            throw new ChatException(ChatErrorCode.NOT_IN_SEA_ROOM);
        }
        return snapshotOf(roomId);
    }

    /**
     * {@link #snapshot(UUID)} + <b>그 세션이 방 토픽을 구독 중인가</b> — 계약 §5 「SUB room → sync」 순서를 서버가 강제한다.
     * 구독 전에 받은 스냅샷은 그 뒤 구독까지의 입퇴장을 놓친다.
     *
     * @throws ChatException {@code NOT_IN_SEA_ROOM} — 방이 없거나 이 세션이 그 방 토픽을 구독하지 않았다
     */
    public SeaRoomEvent snapshot(UUID userId, String sessionId) {
        UUID roomId = currentRoom(userId);
        if (roomId == null || sessions.subscriptionIdOf(sessionId, StompTopics.seaRoomTopic(roomId)) == null) {
            throw new ChatException(ChatErrorCode.NOT_IN_SEA_ROOM);
        }
        return snapshotOf(roomId);
    }

    private SeaRoomEvent snapshotOf(UUID roomId) {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("roomId", roomId.toString());
        payload.set("members", membersOf(roomId));
        return SeaRoomEvent.of(SNAPSHOT, roomId, clock.instant(), payload);
    }

    /** 차단·해제 후 같은 방의 모든 기기에 표시를 갱신한다. 방·집중·항해 상태는 바꾸지 않는다. */
    public void refreshBlockVisibility(UUID blockerId) {
        UUID roomId = currentRoom(blockerId);
        if (roomId != null) {
            publisher.publish(roomId, SNAPSHOT, snapshotOf(roomId).payload());
        }
    }

    /** 지금 들어 있는 방에서 나간다. 방이 없으면 아무 일도 없다. */
    public boolean leaveCurrent(UUID userId, String reason) {
        UUID roomId = currentRoom(userId);
        return roomId != null && leave(userId, roomId, reason);
    }

    /**
     * 해시의 {@code roomId}. 없으면 {@code null}. 손상된 값(UUID 아님)이면 로그를 남기고 해시를 지운 뒤 {@code null} —
     * 남겨 두면 JOIN 이 영영 -1(다른 방)을 돌려 입장이 막히고, 예외로 올리면 ERROR 프레임·소켓 종료로 번진다.
     */
    private UUID currentRoom(UUID userId) {
        Object value = redis.opsForHash().get(RedisKeys.seaUser(userId), ROOM_ID);
        if (!(value instanceof String text)) {
            return null;
        }
        UUID roomId = uuidOrNull(text);
        if (roomId == null) {
            log.warn("바다 사용자 해시의 roomId 손상 — 없는 것으로 치우고 진행한다");
            redis.delete(RedisKeys.seaUser(userId));
        }
        return roomId;
    }

    /** 그 방에서 나간다 — 실제로 내보냈을 때만 {@code sea.member.left} 를 낸다. */
    public boolean leave(UUID userId, UUID roomId, String reason) {
        return leave(userId, roomId, reason, "");
    }

    /**
     * @param expectedAdriftSince 비어 있지 않으면 해시의 {@code adriftSince} 가 이 값일 때만 내보낸다 — 10분 정리가
     *                            고른 뒤 그 사람이 다시 항해를 시작했으면 건드리지 않는다. 값은 epoch ms 의 10진 문자열
     */
    public boolean leave(UUID userId, UUID roomId, String reason, String expectedAdriftSince) {
        if (runLeave(userId, roomId, expectedAdriftSince) != 1) {
            return false;
        }
        log.info("바다 퇴장 — roomId={} userId={} reason={}", roomId, userId, reason);
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("userId", userId.toString());
        payload.put("reason", reason);
        publisher.publish(roomId, MEMBER_LEFT, payload);
        ObjectNode notice = objectMapper.createObjectNode();
        notice.put("roomId", roomId.toString());
        notice.put("reason", reason);
        publisher.publishToUser(userId, roomId, ROOM_LEFT, notice);
        return true;
    }

    /**
     * 이 사람이 지금 그 방 소속인가 — 구독 관문과 전달 직전 검사가 프레임마다 묻는다.
     *
     * @throws RuntimeException Redis 실패 — 호출자가 fail-closed 로 접는다
     */
    public boolean isMember(UUID userId, UUID roomId) {
        return roomId.toString().equals(redis.opsForHash().get(RedisKeys.seaUser(userId), ROOM_ID));
    }

    /**
     * 그 방 구성원 전부(≤10)의 표시 — 앱이 이 중 5명을 고른다(N15). 해시가 없는 유령은 LEAVE 의 «해시 없음» 분기로
     * SET·색인에서 치운다(사건 없음). 해시의 {@code roomId} 가 이 방이 아닌 유령도 뺀다.
     * 다른 방 해시를 가리키는 id 는 옛 SET 에 남은 것이라 그 자리에서 SREM 한다(JOIN 의 -1 규칙상
     * 그 사람이 이 방에 정당하게 있을 수 없다).
     */
    public ArrayNode membersOf(UUID roomId) {
        Set<String> ids = redis.opsForSet().members(RedisKeys.seaRoomMembers(roomId));
        List<String> users = ids == null ? List.of() : ids.stream().filter(id -> uuidOrNull(id) != null).toList();
        List<Object> hashes = users.isEmpty() ? List.of() : redis.executePipelined((RedisCallback<Object>) c -> {
            users.forEach(user -> c.hashCommands().hGetAll(bytes(RedisKeys.seaUser(UUID.fromString(user)))));
            return null;
        });
        Instant now = clock.instant();
        ArrayNode members = objectMapper.createArrayNode();
        for (int i = 0; i < users.size(); i++) {
            if (!(hashes.get(i) instanceof Map<?, ?> hash) || hash.isEmpty()) {
                healGhost(roomId, users.get(i)); // 해시가 만료된 유령 — SET 에 남으면 정원을 영구 점유한다
                continue;
            }
            Map<String, String> fields = stringMap(hash);
            if (roomId.toString().equals(fields.get(ROOM_ID))) {
                members.add(member(users.get(i), fields, now));
            } else {
                redis.opsForSet().remove(RedisKeys.seaRoomMembers(roomId), users.get(i));
            }
        }
        return members;
    }

    /** 해시 없는 구성원을 그 방 SET 에서 치운다 — LEAVE 의 «해시 없음» 분기(SREM+ZREM, 빈 방이면 open 제거)를 재사용. */
    private void healGhost(UUID roomId, String userId) {
        UUID user = uuidOrNull(userId);
        if (user != null && runLeave(user, roomId, "") == 0) {
            log.debug("바다 방 유령 구성원 정리 — roomId={} userId={}", roomId, userId);
        }
    }

    /**
     * Data 사건 {@code sea.member.updated} 중계(N19) — {@code user.blocks.updated} 와 같은 내부 제어 사건이다.
     *
     * <p>params 는 관대하게 읽는다: 모르는 status·빠진 필드는 경고만 남기고 끝낸다(400 은 relay 가 그 사용자의 USER 축을
     * 영구 차단해 탈퇴 전파까지 막는다). 바다 방에 없는 사용자면 아무것도 하지 않는다 — 해시도 만들지 않는다.
     * Redis 쓰기 실패만 던진다(수신 기록 롤백 → relay 재전달). 방 사건 발행 실패는 삼킨다.
     */
    public void applyMemberUpdated(JsonNode envelope) {
        String eventId = text(envelope, "eventId");
        UUID userId = uuidOrNull(envelope.get("subjectId"));
        if (userId == null) {
            userId = uuidOrNull(envelope.get("userId"));
        }
        JsonNode params = envelope.get("params");
        String status = params == null || !params.isObject() ? null : text(params, "status");
        if (userId == null || status == null || !MEMBER_STATUSES.contains(status)) {
            log.warn("바다 사건 형식 불량 — 적용하지 않는다. eventId={} userId={} status={}", eventId, userId,
                    clip(status));
            return;
        }
        UUID roomId = currentRoom(userId);
        if (roomId == null) {
            return; // 바다 방에 없다 — no-op
        }
        Transition transition = transition(status, params, instantOrNull(text(envelope, "occurredAt")));
        if (transition == null) {
            log.warn("바다 사건 params 불량 — 적용하지 않는다. eventId={} userId={} status={}", eventId, userId,
                    clip(status));
            return;
        }
        if (runUpdate(userId, roomId.toString(), transition, "") != 1) {
            return; // 그사이 나갔다
        }
        try {
            ObjectNode payload = objectMapper.createObjectNode();
            payload.set("member", memberOf(userId));
            publisher.publish(roomId, MEMBER_UPDATED, payload);
        } catch (RuntimeException e) {
            log.warn("바다 구성원 갱신 발행 실패 — eventId={} reason={}", eventId, e.getClass().getSimpleName());
        }
    }

    /**
     * 소켓 종료 — 이 JVM 에 같은 사용자의 다른 세션이 없을 때만 퇴장이다(N24).
     *
     * <p><b>자기 세션을 레지스트리에서 먼저 뺀 뒤</b> 다른 세션을 센다. 레지스트리의 같은 이벤트 리스너와 순서가 정해져
     * 있지 않아, 두 기기가 거의 동시에 끊기면 서로를 «다른 세션»으로 보고 둘 다 퇴장을 건너뛴다(focusing 유령 24h).
     * 먼저 빼면 둘 중 늦게 판정하는 쪽이 반드시 «다른 세션 없음»을 본다 — 둘 다 보면 LEAVE 가 한 번만 1 이다.
     */
    @EventListener
    public void disconnected(SessionDisconnectEvent event) {
        sessions.disconnected(event); // 멱등 — 레지스트리 자신의 리스너가 또 불러도 같다
        if (!(event.getUser() instanceof ChatPrincipal principal)
                || sessions.hasOtherSession(principal.userId(), event.getSessionId())) {
            return;
        }
        try {
            leaveCurrent(principal.userId(), DISCONNECTED);
        } catch (RuntimeException e) {
            log.warn("소켓 종료 바다 퇴장 실패 — reason={}", e.getClass().getSimpleName());
        }
    }

    // ── 배정 ────────────────────────────────────────────────────────────

    /** 이미 방이 있으면 그 방 그대로. 해시만 남고 방 구성원에 없으면(방 키 만료) 해시를 치우고 새로 배정한다. */
    private SeaRoomEvent existingAssignment(UUID userId) {
        UUID roomId = currentRoom(userId);
        if (roomId == null) {
            return null;
        }
        if (Boolean.TRUE.equals(redis.opsForSet().isMember(RedisKeys.seaRoomMembers(roomId), userId.toString()))) {
            return assigned(roomId);
        }
        runLeave(userId, roomId, "");
        return null;
    }

    /** 다른 기기가 먼저 배정받았다(-1) — 그 방을 알려 준다. 그마저 없으면 판정 불가. */
    private SeaRoomEvent reconfirm(UUID userId) {
        SeaRoomEvent existing = existingAssignment(userId);
        if (existing == null) {
            throw new UpstreamUnavailableException();
        }
        return existing;
    }

    /**
     * JOIN 이 1 을 돌려준 뒤. 그사이 소켓이 끊겼고 이 JVM 에 다른 세션도 없으면 조용히 되돌린다 — {@code joined} 를
     * 내기 전이라 아무도 이 사람을 보지 않았다. 아니면 상태를 한 번 더 맞추고({@link #reconcile}, HTTP) <b>그 뒤에
     * 다시</b> 연결·소속을 확인한 다음에만 {@code joined} 를 낸다 — 재조회 동안 끊겨 종료 리스너가 이미 내보냈으면
     * {@code joined} 가 {@code left} 뒤에 도착해 유령이 생긴다.
     *
     * <p>ponytail: 종료 리스너가 JOIN 전에 돌고 소켓 기록 삭제가 마지막 확인보다 늦으면 그 창(마이크로초)만큼 유령이 남는다 —
     * 10분 정리·24h TTL 이 백스톱이다.
     */
    private SeaRoomEvent joined(UUID userId, String sessionId, UUID roomId, SeaStateClient.SeaState first) {
        if (abandoned(userId, sessionId, roomId)) {
            return null;
        }
        Object rev = redis.opsForHash().get(RedisKeys.seaUser(userId), REV); // JOIN 직후의 개정 — 보정의 CAS 기준
        reconcile(userId, roomId, first, rev instanceof String value ? value : "1");
        if (abandoned(userId, sessionId, roomId) || !isMember(userId, roomId)) {
            return null; // 끊겼거나 이미 내보내졌다(종료 리스너가 left 를 냈다)
        }
        ObjectNode payload = objectMapper.createObjectNode();
        payload.set("member", memberOf(userId));
        publisher.publish(roomId, MEMBER_JOINED, payload);
        convergeAfterJoined(userId, roomId);
        return assigned(roomId);
    }

    /**
     * {@code joined} 발행과 Redis 를 원자로 묶을 수 없다 — 마지막 확인과 발행 사이에 같은 사람의 다른 기기가 LEAVE 를
     * 끝내면 {@code left} 가 {@code joined} 보다 먼저 나간다. 그래서 발행 «뒤»에 한 번 더 보고, 이 방 소속이 아니면
     * {@code left{reason:left}} 를 보정 발행한다 — 구독자는 joined→left 로 수렴하고, 앞선 left 와 겹친 두 번째 left 는
     * 앱에서 없는 사람 제거라 멱등이다. 확인 실패(Redis)는 로그만 — 다음 sync·전달 직전 검사가 맞춘다.
     */
    private void convergeAfterJoined(UUID userId, UUID roomId) {
        try {
            if (isMember(userId, roomId)) {
                return;
            }
            ObjectNode payload = objectMapper.createObjectNode();
            payload.put("userId", userId.toString());
            payload.put("reason", LEFT);
            log.info("바다 보정 left 발행 — joined 뒤 이미 나가 있었다(경합). roomId={} userId={}", roomId, userId);
            publisher.publish(roomId, MEMBER_LEFT, payload);
        } catch (RuntimeException e) {
            log.warn("joined 뒤 소속 재확인 실패 — roomId={} userId={} reason={}", roomId, userId,
                    e.getClass().getSimpleName());
        }
    }

    /** 이 세션이 끊겼고 이 JVM 에 같은 사람의 다른 세션도 없으면 사건 없이 되돌리고 true. */
    private boolean abandoned(UUID userId, String sessionId, UUID roomId) {
        if (sessions.isConnected(sessionId) || sessions.hasOtherSession(userId, sessionId)) {
            return false;
        }
        runLeave(userId, roomId, "");
        return true;
    }

    /**
     * 첫 조회와 JOIN 사이에 온 Data 사건은 «바다 밖 사용자»로 no-op 됐다 — 한 번 더 조회해 세션(끝남·새 시작)이나
     * 한마디가 바뀌었으면 한 전이로 함께 적용한다. JOIN 직후의 {@code rev} 로 CAS 하므로, 재조회가 돌아오는 사이
     * Data 사건이 먼저 적용됐으면(그쪽이 더 최신) 보정은 조용히 건너뛴다. 재조회 실패는 첫 상태로 둔다.
     */
    private void reconcile(UUID userId, UUID roomId, SeaStateClient.SeaState first, String rev) {
        SeaStateClient.SeaState second;
        try {
            second = seaState.fetch(userId);
        } catch (RuntimeException e) {
            log.warn("입장 뒤 바다 상태 재조회 실패 — 첫 상태로 둔다. reason={}", e.getClass().getSimpleName());
            return;
        }
        SeaStateClient.Session before = first.session();
        SeaStateClient.Session after = second.session();
        boolean sessionChanged = !Objects.equals(before == null ? null : before.sessionId(),
                after == null ? null : after.sessionId());
        boolean remarkChanged = !Objects.equals(first.remark(), second.remark())
                || !Objects.equals(first.remarkChangedAt(), second.remarkChangedAt());
        boolean profileChanged = !Objects.equals(first.name(), second.name())
                || !Objects.equals(first.catColor(), second.catColor());
        if (!sessionChanged && !remarkChanged && !profileChanged) {
            return;
        }
        Transition transition;
        if (!sessionChanged) {
            transition = new Transition(new HashMap<>(), new ArrayList<>(), "", "0");
        } else if (after == null) {
            transition = endedTransition(clock.instant());
        } else {
            transition = sailingTransition(after.sessionId().toString(), after.destinationIslandId().toString(),
                    after.sailingMinutes() == null ? null : after.sailingMinutes().toString(), after.startedAt());
        }
        if (remarkChanged) {
            putOrDelete(transition.set(), transition.delete(), REMARK, second.remark());
        }
        if (profileChanged) {
            putOrDelete(transition.set(), transition.delete(), NAME, second.name());
            putOrDelete(transition.set(), transition.delete(), CAT_COLOR, second.catColor());
        }
        if (runUpdate(userId, roomId.toString(), transition, rev) != 1) {
            log.debug("입장 보정 건너뜀 — 그사이 Data 사건이 먼저 적용됐거나 나갔다");
        }
    }

    private SeaRoomEvent assigned(UUID roomId) {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("roomId", roomId.toString());
        return SeaRoomEvent.of(ASSIGNED, roomId, clock.instant(), payload);
    }

    /**
     * 차단 검사를 통과한 후보에 들어간다. 구성원이 그사이 바뀌었으면(-2) 다시 읽어 차단을 다시 보고 재시도한다 —
     * 차단 검사와 JOIN 사이에 차단 상대가 들어오는 경합을 스크립트의 집합 비교가 막는다.
     *
     * @return JOIN 결과(1·0·-1), 다 실패하면 0, 소켓이 끊겼으면 {@link #ABORTED}
     */
    private long joinChecked(UUID userId, String sessionId, Candidate candidate, List<String> fields,
            String adriftSince) {
        List<String> members = candidate.members();
        for (int attempt = 0; attempt < JOIN_RECHECKS; attempt++) {
            if (!sessions.isConnected(sessionId)) {
                return ABORTED;
            }
            long result = join(userId, candidate.roomId(), String.join(",", sorted(members)), fields, adriftSince);
            if (result != -2) {
                return result;
            }
            Set<String> now = redis.opsForSet().members(RedisKeys.seaRoomMembers(candidate.roomId()));
            members = now == null ? List.of() : List.copyOf(now);
            if (members.size() >= SEA_ROOM_CAPACITY || !noBlockBetween(userId, members)) {
                return 0;
            }
        }
        log.info("바다 방 후보 포기 — 구성원이 계속 바뀌었다(-2). roomId={} userId={} attempts={}",
                candidate.roomId(), userId, JOIN_RECHECKS);
        return 0;
    }

    private static List<String> sorted(Collection<String> values) {
        return values.stream().sorted().toList();
    }

    private Set<UUID> friendsOrNone(UUID userId) {
        try {
            return friends.fetchFriendIds(userId);
        } catch (RuntimeException e) {
            log.debug("친구 id 조회 실패 — 친구 없음으로 배정한다. reason={}", e.getClass().getSimpleName());
            return Set.of();
        }
    }

    /**
     * 빈자리 후보 — 점수(친구 있음 2 > 같은 목적지로 항해 중 1 > 0), 동점은 인원 많은 방 우선. 상위
     * {@value #BLOCK_CHECKED_CANDIDATES}개만 차단 검사를 거쳐 돌려준다.
     *
     * <p>ponytail: 열린 방 전부를 매 입장마다 읽는다(파이프라인 2회, O(열린 방 × 10)). 동시 항해자가 수천을 넘어
     * 보이면 목적지별 open 색인으로 나눈다.
     */
    private List<Candidate> candidates(UUID userId, String destination, Set<UUID> friendIds) {
        Set<String> open = redis.opsForSet().members(RedisKeys.SEA_ROOMS_OPEN);
        List<UUID> rooms = open == null ? List.of() : open.stream().map(SeaRooms::uuidOrNull)
                .filter(Objects::nonNull).toList();
        if (rooms.isEmpty()) {
            return List.of();
        }
        List<Object> memberSets = redis.executePipelined((RedisCallback<Object>) c -> {
            rooms.forEach(room -> c.setCommands().sMembers(bytes(RedisKeys.seaRoomMembers(room))));
            return null;
        });
        Map<UUID, List<String>> membersByRoom = new HashMap<>();
        Set<String> everyone = new LinkedHashSet<>();
        for (int i = 0; i < rooms.size(); i++) {
            List<String> members = memberSets.get(i) instanceof Collection<?> set
                    ? set.stream().map(String::valueOf).toList() : List.of();
            membersByRoom.put(rooms.get(i), members);
            members.stream().filter(member -> uuidOrNull(member) != null).forEach(everyone::add);
        }
        List<String> users = List.copyOf(everyone);
        List<Object> infos = users.isEmpty() ? List.of() : redis.executePipelined((RedisCallback<Object>) c -> {
            users.forEach(user -> c.hashCommands().hMGet(bytes(RedisKeys.seaUser(UUID.fromString(user))),
                    bytes(STATE), bytes(DESTINATION)));
            return null;
        });
        Map<String, Integer> scoreByUser = new HashMap<>();
        for (int i = 0; i < users.size(); i++) {
            String user = users.get(i);
            List<?> info = infos.get(i) instanceof List<?> list ? list : List.of();
            boolean sameDestination = destination != null && info.size() == 2
                    && FOCUSING.equals(info.get(0)) && destination.equals(info.get(1));
            UUID id = uuidOrNull(user);
            scoreByUser.put(user, id != null && friendIds.contains(id) ? 2 : sameDestination ? 1 : 0);
        }
        java.util.function.ToIntFunction<UUID> scoreOf = room -> membersByRoom.get(room).stream()
                .mapToInt(user -> scoreByUser.getOrDefault(user, 0)).max().orElse(0);
        Comparator<UUID> byScore = Comparator.comparingInt(scoreOf);
        Comparator<UUID> bySize = Comparator.comparingInt(room -> membersByRoom.get(room).size());
        return rooms.stream()
                .sorted(byScore.thenComparing(bySize).reversed())
                .limit(BLOCK_CHECKED_CANDIDATES)
                .filter(room -> noBlockBetween(userId, membersByRoom.get(room)))
                .map(room -> new Candidate(room, membersByRoom.get(room), scoreOf.applyAsInt(room)))
                .toList();
    }

    /** 차단 검사를 통과한 방과 그때 본 구성원 — JOIN 이 이 집합 그대로인지 원자적으로 대조한다. 점수는 로그용. */
    private record Candidate(UUID roomId, List<String> members, int score) {
    }

    /** 방 구성원 누구와도 어느 쪽 차단이 없는가. 판정 불가면 그 방은 뺀다(fail-closed). */
    private boolean noBlockBetween(UUID userId, List<String> members) {
        try {
            for (String member : members) {
                UUID other = uuidOrNull(member);
                if (other != null && blockedUsers.eitherBlocked(userId, other)) {
                    return false;
                }
            }
            return true;
        } catch (RuntimeException e) {
            log.debug("바다 방 차단 판정 불가 — 그 방을 후보에서 뺀다. reason={}", e.getClass().getSimpleName());
            return false;
        }
    }

    /** 입장 해시 필드(roomId 제외) — 값이 없는 필드는 싣지 않는다. 항해 중이 아니면 처음부터 떠 있다. */
    private static List<String> joinFields(SeaStateClient.SeaState state, String adriftSince) {
        List<String> fields = new ArrayList<>();
        SeaStateClient.Session session = state.session();
        fields.add(STATE);
        fields.add(session == null ? ADRIFT : FOCUSING);
        if (state.remark() != null) {
            fields.add(REMARK);
            fields.add(state.remark());
        }
        if (state.name() != null) {
            fields.add(NAME);
            fields.add(state.name());
        }
        if (state.catColor() != null) {
            fields.add(CAT_COLOR);
            fields.add(state.catColor());
        }
        if (session == null) {
            fields.add(ADRIFT_SINCE);
            fields.add(adriftSince);
            return fields;
        }
        fields.add(SESSION_ID);
        fields.add(session.sessionId().toString());
        fields.add(DESTINATION);
        fields.add(session.destinationIslandId().toString());
        if (session.sailingMinutes() != null) {
            fields.add(SAILING_MINUTES);
            fields.add(session.sailingMinutes().toString());
        }
        fields.add(STARTED_AT);
        fields.add(session.startedAt().toString());
        return fields;
    }

    // ── Data 사건 전이 ──────────────────────────────────────────────────

    private record Transition(Map<String, String> set, List<String> delete, String adriftOp, String score) {
    }

    /**
     * @param occurredAt 사건 발생 시각 — {@code ended} 의 adriftSince 로 쓴다(재전달돼도 같은 값, 멱등). 없으면 지금
     * @return 적용할 전이, params 가 불량이면 {@code null}(어떤 변환 예외도 밖으로 내지 않는다). 불량은 «필드를 지운다»로
     *         읽지 않는다 — 빠졌거나 타입이 틀린 필드는 사건 전체를 버린다
     */
    private Transition transition(String status, JsonNode params, Instant occurredAt) {
        try {
            switch (status) {
                case "sailing" -> {
                    Instant serverNow = instantOrNull(text(params, "serverNow"));
                    JsonNode active = params.get("activeSeconds");
                    JsonNode minutes = params.get(SAILING_MINUTES);
                    if (uuidOrNull(params.get(SESSION_ID)) == null || uuidOrNull(params.get(DESTINATION)) == null
                            || serverNow == null
                            || active == null || !active.isIntegralNumber() || !active.canConvertToLong()
                            || minutes == null || !minutes.isIntegralNumber() || !minutes.canConvertToInt()) {
                        return null;
                    }
                    long activeSeconds = active.longValue();
                    if (activeSeconds < 0 || activeSeconds > MAX_ACTIVE_SECONDS) {
                        return null;
                    }
                    return sailingTransition(text(params, SESSION_ID), text(params, DESTINATION),
                            Integer.toString(minutes.intValue()), serverNow.minusSeconds(activeSeconds));
                }
                case "ended" -> {
                    return endedTransition(occurredAt == null ? clock.instant() : occurredAt);
                }
                default -> { // remark — 키 없음·문자열 아님은 불량, 명시적 null·"" 만 지운다
                    JsonNode remark = params.get(REMARK);
                    if (remark == null || !(remark.isNull() || remark.isString())) {
                        return null;
                    }
                    String value = remark.isNull() || remark.stringValue().isEmpty() ? null : remark.stringValue();
                    Map<String, String> set = new HashMap<>();
                    List<String> delete = new ArrayList<>();
                    putOrDelete(set, delete, REMARK, value);
                    return new Transition(set, delete, "", "0");
                }
            }
        } catch (RuntimeException e) {
            return null; // 시각 overflow 같은 변환 실패 — 불량 params 로 접는다
        }
    }

    private static Transition sailingTransition(String sessionId, String destination, String sailingMinutes,
            Instant startedAt) {
        Map<String, String> set = new HashMap<>();
        List<String> delete = new ArrayList<>();
        set.put(STATE, FOCUSING);
        set.put(SESSION_ID, sessionId);
        set.put(STARTED_AT, startedAt.toString());
        putOrDelete(set, delete, DESTINATION, destination);
        putOrDelete(set, delete, SAILING_MINUTES, sailingMinutes);
        delete.add(ADRIFT_SINCE);
        return new Transition(set, delete, "rem", "0");
    }

    private static Transition endedTransition(Instant at) {
        String since = Long.toString(at.toEpochMilli());
        Map<String, String> set = new HashMap<>();
        set.put(STATE, ADRIFT);
        set.put(ADRIFT_SINCE, since);
        return new Transition(set, new ArrayList<>(), "add", since);
    }

    private static void putOrDelete(Map<String, String> set, List<String> delete, String field, String value) {
        if (value == null) {
            delete.add(field);
        } else {
            set.put(field, value);
        }
    }

    // ── 스크립트 ────────────────────────────────────────────────────────

    private long join(UUID userId, UUID roomId, String expectedMembers, List<String> fields, String adriftSince) {
        List<String> args = new ArrayList<>(List.of(userId.toString(), roomId.toString(),
                Integer.toString(SEA_ROOM_CAPACITY), Long.toString(TTL.toSeconds()), expectedMembers, adriftSince));
        args.addAll(fields);
        Long result = redis.execute(JOIN, keys(userId, roomId), args.toArray());
        return result == null ? 0 : result;
    }

    private long runLeave(UUID userId, UUID roomId, String expectedAdriftSince) {
        Long result = redis.execute(LEAVE, keys(userId, roomId), userId.toString(), roomId.toString(),
                expectedAdriftSince == null ? "" : expectedAdriftSince);
        return result == null ? 0 : result;
    }

    private long runUpdate(UUID userId, String roomId, Transition transition, String expectedRev) {
        List<String> args = new ArrayList<>(List.of(roomId, userId.toString(), transition.adriftOp(),
                transition.score(), expectedRev, Integer.toString(transition.delete().size())));
        args.addAll(transition.delete());
        transition.set().forEach((field, value) -> {
            args.add(field);
            args.add(value);
        });
        Long result = redis.execute(UPDATE, List.of(RedisKeys.seaUser(userId), RedisKeys.SEA_ADRIFT), args.toArray());
        return result == null ? 0 : result;
    }

    private static List<String> keys(UUID userId, UUID roomId) {
        return List.of(RedisKeys.seaRoomMembers(roomId), RedisKeys.SEA_ROOMS_OPEN, RedisKeys.seaUser(userId),
                RedisKeys.SEA_ADRIFT);
    }

    // ── 표시 ────────────────────────────────────────────────────────────

    private ObjectNode memberOf(UUID userId) {
        return member(userId.toString(), stringMap(redis.opsForHash().entries(RedisKeys.seaUser(userId))),
                clock.instant());
    }

    /**
     * {@code member = {userId, state, remark, name, catColor, session | null}}.
     * {@code activeSeconds} 는 저장값이 아니라 지금 계산한다 —
     * 바다 세션은 일시정지가 없어 경과가 곧 벽시계 차다. 떠 있으면 떠오른 시각에서 멈춘다.
     */
    private ObjectNode member(String userId, Map<String, String> hash, Instant now) {
        ObjectNode member = objectMapper.createObjectNode();
        member.put("userId", userId);
        String state = hash.getOrDefault(STATE, ADRIFT);
        member.put("state", state);
        member.put("remark", hash.get(REMARK));
        member.put("name", hash.get(NAME)); // 옛 해시(배포 전 입장)는 null
        member.put("catColor", hash.get(CAT_COLOR));
        Instant startedAt = instantOrNull(hash.get(STARTED_AT));
        if (hash.get(SESSION_ID) == null || startedAt == null) {
            member.putNull("session");
            return member;
        }
        Instant end = now;
        String adriftSince = hash.get(ADRIFT_SINCE);
        if (ADRIFT.equals(state) && adriftSince != null) {
            try {
                end = Instant.ofEpochMilli(Long.parseLong(adriftSince));
            } catch (NumberFormatException e) {
                end = now;
            }
        }
        ObjectNode session = member.putObject("session");
        session.put("sessionId", hash.get(SESSION_ID));
        session.put("destinationIslandId", hash.get(DESTINATION));
        String minutes = hash.get(SAILING_MINUTES);
        Integer sailingMinutes;
        try {
            sailingMinutes = minutes == null ? null : Integer.valueOf(minutes);
        } catch (NumberFormatException e) {
            sailingMinutes = null; // 손상 해시 — ERROR 프레임·소켓 종료로 번지지 않게 비워 둔다
        }
        if (sailingMinutes == null) {
            session.putNull("sailingMinutes");
        } else {
            session.put("sailingMinutes", sailingMinutes);
        }
        session.put("activeSeconds", Math.max(0, Duration.between(startedAt, end).getSeconds()));
        session.put("serverNow", now.toString());
        session.put("startedAt", startedAt.toString());
        return member;
    }

    private static Map<String, String> stringMap(Map<?, ?> raw) {
        Map<String, String> map = new HashMap<>();
        raw.forEach((key, value) -> map.put(String.valueOf(key), value == null ? null : String.valueOf(value)));
        return map;
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    /** 로그에 찍는 외부 값의 길이 상한 — 로그 부풀림·주입 방지. */
    private static String clip(String value) {
        return value == null || value.length() <= 32 ? value : value.substring(0, 32);
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isString() ? value.stringValue() : null;
    }

    private static Instant instantOrNull(String value) {
        try {
            return value == null ? null : Instant.parse(value);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static UUID uuidOrNull(JsonNode node) {
        return node == null || !node.isString() ? null : uuidOrNull(node.stringValue());
    }

    private static UUID uuidOrNull(String value) {
        try {
            return value == null ? null : UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
