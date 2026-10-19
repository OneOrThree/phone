package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import com.oneorthree.realtime.movement.MovementEvent;
import com.oneorthree.realtime.movement.MovementRooms;
import com.oneorthree.realtime.movement.RoomRuntime;
import com.oneorthree.realtime.movement.stomp.MovementRelay.Command;
import com.oneorthree.realtime.movement.stomp.MovementRelay.Frame;
import com.oneorthree.realtime.movement.stomp.MovementRelay.Kind;
import com.oneorthree.realtime.movement.stomp.MovementRelay.Type;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BooleanSupplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 길잡이(GROMO-2339) 한 인스턴스를 실 Redis·실 리스너 컨테이너·실 실행기로 — 소유/비소유 라우팅, 옛 epoch 프레임 폐기,
 * 명령의 epoch 검사, RECHECK 전파·수신, 송신 줄 포화. 다른 인스턴스는 Redis 에 직접 써서(가짜 소유자 값·손으로 만든 봉투)
 * 흉내 낸다. 두 Spring 컨텍스트 왕복은 {@code TwoInstanceMovementTest}.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class MovementClusterTest {

    private static final long TIMEOUT_MS = 10_000;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private RedisConnectionFactory connectionFactory;

    private final ObjectMapper json = JsonMapper.builder().build();
    private final List<Message<?>> sent = Collections.synchronizedList(new ArrayList<>());
    private final BlockingQueue<Command> commands = new LinkedBlockingQueue<>();
    private final UUID island = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();

    private SimpleMeterRegistry meters;
    private MovementPublisher publisher;
    private MovementOwnership ownership;
    private MovementRelay relay;
    private MovementRooms rooms;
    private MovementCluster cluster;
    private MovementSubscriptionListener listener;
    private RedisMessageListenerContainer relayIn;
    private RedisMessageListenerContainer commandSpy;
    private ScheduledExecutorService ticker;

    @BeforeEach
    void setUp() throws Exception {
        meters = new SimpleMeterRegistry();
        MovementOutboundInterceptor completion = new MovementOutboundInterceptor();
        MessageChannel channel = (message, timeout) -> {
            sent.add(message);
            completion.afterMessageHandled(message, null, null, null);
            return true;
        };
        RealtimeSessionRegistry sessions = new RealtimeSessionRegistry();
        publisher = new MovementPublisher(json, sessions, meters, channel);
        ownership = new MovementOwnership(redis, meters, "ct-" + UUID.randomUUID().toString().substring(0, 8), 3000);
        relay = new MovementRelay(true, publisher, ownership, redis, json, meters, MovementRelay.QUEUE_CAPACITY);
        relay.start();
        rooms = new MovementRooms(relay, meters);
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        cluster = new MovementCluster(true, rooms, publisher, ownership, relay, redis, json,
                beans.getBeanProvider(MovementSubscriptionListener.class), meters);
        cluster.init();
        listener = new MovementSubscriptionListener(cluster, publisher, sessions, mock(ChatAccessGuard.class),
                mock(JwtValidator.class), meters, Executors.newSingleThreadScheduledExecutor(),
                Executors.newSingleThreadScheduledExecutor(), 120);
        beans.addBean("listener", listener);

        relayIn = container();
        relayIn.setTaskExecutor(cluster.relayInExecutor());
        relayIn.addMessageListener(cluster, List.of(new ChannelTopic(RedisKeys.MOVEMENT_CMD_CHANNEL),
                new ChannelTopic(RedisKeys.MOVEMENT_FRAMES_CHANNEL)));
        relayIn.afterPropertiesSet();
        relayIn.start();
        commandSpy = container();
        commandSpy.addMessageListener((message, pattern) -> commands.add(json.readValue(message.getBody(),
                Command.class)), new ChannelTopic(RedisKeys.MOVEMENT_CMD_CHANNEL));
        commandSpy.afterPropertiesSet();
        commandSpy.start();
        // start() 는 SUBSCRIBE 확인까지 기다린다 — 그래도 엿듣기 컨테이너가 실제로 듣는지 한 번 확인한다.
        await(() -> {
            command(new Command("probe", null, 0, null, Type.PING, null, null, null, false));
            return commands.stream().anyMatch(c -> "probe".equals(c.originInstanceId()));
        });

        // 운영의 MovementTicker 대신 — 같은 일(방마다 tick)을 20ms 마다. 방의 단일 작성자는 이 스레드다.
        AtomicLong tick = new AtomicLong();
        ticker = Executors.newSingleThreadScheduledExecutor();
        ticker.scheduleAtFixedRate(() -> {
            for (RoomRuntime room : rooms.rooms().values()) {
                room.tick(tick.incrementAndGet());
            }
        }, 0, 20, TimeUnit.MILLISECONDS);
    }

    @AfterEach
    void tearDown() throws Exception {
        ticker.shutdownNow();
        commandSpy.destroy();
        relayIn.destroy();
        cluster.stop();
        relay.stop();
    }

    @Test
    @DisplayName("빈 섬의 첫 명령은 이 인스턴스가 리스를 얻어 로컬 방에서 처리하고, 프레임은 Redis 메아리로만 세션에 닿는다")
    void firstCommandAcquiresAndRunsLocally() throws Exception {
        open("s1");

        cluster.join(island, user, "s1");
        cluster.requestFullState(island, "s1");

        JsonNode first = awaitFor("s1", "FullState");
        assertThat(first.get("actors").get(0).get("userId").stringValue()).isEqualTo(user.toString());
        assertThat(redis.opsForValue().get(RedisKeys.movementOwner(island))).startsWith(ownership.instanceId() + ":");
        assertThat(rooms.rooms()).containsKey(island);
        assertThat(meters.counter("movement.owner.acquire", "trigger", "route").count()).isEqualTo(1);
        assertThat(meters.counter("movement.owner.forward", "type", "JOIN").count()).isZero();
    }

    @Test
    @DisplayName("다른 인스턴스가 소유자면 방을 만들지 않고 cmd 채널로 그 소유자(epoch)에게 보낸다 — 세션 키는 <instanceId>:<sessionId>")
    void nonOwnerForwardsToTheOwner() throws Exception {
        redis.opsForValue().set(RedisKeys.movementOwner(island), "ghost-1:5", Duration.ofMinutes(1));
        open("s1");

        cluster.join(island, user, "s1");

        Command join = awaitCommand(Type.JOIN);
        assertThat(join.ownerInstanceId()).isEqualTo("ghost-1");
        assertThat(join.epoch()).isEqualTo(5);
        assertThat(join.sessionKey()).isEqualTo(ownership.instanceId() + ":s1");
        assertThat(join.userId()).isEqualTo(user);
        assertThat(rooms.rooms()).doesNotContainKey(island);
        assertThat(meters.counter("movement.owner.forward", "type", "JOIN").count()).isEqualTo(1);
    }

    @Test
    @DisplayName("그 섬에서 본 epoch 보다 작은 프레임은 버린다(movement.relay.stale) — 같은 epoch 는 받는다")
    void staleEpochFramesAreDropped() throws Exception {
        redis.opsForValue().set(RedisKeys.movementOwner(island), "ghost-2:100", Duration.ofMinutes(1));
        open("s1");
        String fullState = json.writeValueAsString(new MovementEvent.FullState(1, 1, 50, 10.989, List.of()));
        frame(new Frame("ghost-2", island, 100, Kind.EVENT, ownership.instanceId(), "s1", true, fullState));
        awaitFor("s1", "FullState");

        String arrived = json.writeValueAsString(new MovementEvent.Arrived(user, 1, 7, new MovementEvent.Point(1, 1)));
        frame(new Frame("ghost-old", island, 99, Kind.EVENT, null, null, false, arrived));
        await(() -> meters.counter("movement.relay.stale").count() == 1);
        frame(new Frame("ghost-2", island, 100, Kind.EVENT, null, null, false, arrived));

        assertThat(awaitFor("s1", "Arrived").get("serverTick").asLong()).isEqualTo(7);
        assertThat(bodiesFor("s1")).extracting(b -> b.get("type").stringValue())
                .as("옛 epoch 의 Arrived 는 닿지 않았다").containsExactly("FullState", "Arrived");
    }

    @Test
    @DisplayName("다른 인스턴스가 보낸 명령은 지금 든 리스와 epoch 가 같을 때만 적용한다(forward.stale)")
    void forwardedCommandsNeedTheCurrentEpoch() throws Exception {
        open("s1");
        cluster.join(island, user, "s1"); // 이 인스턴스가 소유자가 된다
        cluster.requestFullState(island, "s1");
        awaitFor("s1", "FullState");
        long epoch = ownership.lease(island).epoch();
        UUID remoteUser = UUID.randomUUID();

        command(new Command("ghost-3", ownership.instanceId(), epoch - 1, island, Type.JOIN, remoteUser,
                "ghost-3:x", null, false));
        await(() -> meters.counter("movement.owner.forward.stale", "reason", "epoch").count() == 1);
        command(new Command("ghost-3", ownership.instanceId(), epoch, island, Type.JOIN, remoteUser,
                "ghost-3:x", null, false));

        JsonNode both = awaitFullStateWith("s1", 2);
        List<String> ids = new ArrayList<>();
        both.get("actors").forEach(actor -> ids.add(actor.get("userId").stringValue()));
        assertThat(ids).containsExactlyInAnyOrder(user.toString(), remoteUser.toString());
    }

    @Test
    @DisplayName("강퇴 재검사는 전원에게 RECHECK 로 알리고, 다른 인스턴스의 RECHECK 는 이 인스턴스 세션을 멈추고 캐시 표시도 옮긴다")
    void recheckIsBroadcastAndAppliedLocally() throws Exception {
        open("s1");

        listener.recheckMembership(island, user);
        Command sentRecheck = awaitCommand(Type.RECHECK);
        assertThat(sentRecheck.originInstanceId()).isEqualTo(ownership.instanceId());
        assertThat(sentRecheck.ownerInstanceId()).as("전원에게").isNull();
        assertThat(sentRecheck.userId()).isEqualTo(user);
        assertThat(sentRecheck.cacheStale()).isFalse();
        assertThat(meters.counter("movement.recheck.suspended").count()).isEqualTo(1);

        command(new Command("ghost-4", null, 0, island, Type.RECHECK, user, null, null, true));
        await(() -> meters.counter("movement.recheck.suspended").count() == 2);
        assertThat(listener.membershipCacheStale(island, user)).as("캐시 삭제 실패 표시도 옮겨 온다").isTrue();
    }

    @Test
    @DisplayName("송신 줄이 차면 막지 않고 버린다 — movement.relay.dropped·queue.depth")
    void saturatedRelayDropsInsteadOfBlocking() {
        SimpleMeterRegistry own = new SimpleMeterRegistry();
        MovementRelay stalled = new MovementRelay(true, publisher, ownership, redis, json, own, 2); // 송신 스레드 없음
        for (int i = 0; i < 3; i++) {
            stalled.publishCommand(new Command("ct", null, 0, island, Type.PING, null, null, null, false));
        }

        assertThat(own.counter("movement.relay.dropped").count()).isEqualTo(1);
        assertThat(own.get("movement.relay.queue.depth").gauge().value()).isEqualTo(2);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private RedisMessageListenerContainer container() {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        return container;
    }

    private void open(String sessionId) {
        publisher.open(island, sessionId, user).subscribeMovement("sub-" + sessionId);
    }

    private void frame(Frame frame) {
        redis.convertAndSend(RedisKeys.MOVEMENT_FRAMES_CHANNEL, json.writeValueAsString(frame));
    }

    private void command(Command command) {
        redis.convertAndSend(RedisKeys.MOVEMENT_CMD_CHANNEL, json.writeValueAsString(command));
    }

    private Command awaitCommand(Type type) throws InterruptedException {
        long deadline = System.currentTimeMillis() + TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            Command next = commands.poll(200, TimeUnit.MILLISECONDS);
            if (next != null && next.type() == type) {
                return next;
            }
        }
        throw new AssertionError(type + " 명령이 오지 않았다");
    }

    private List<JsonNode> bodiesFor(String sessionId) {
        synchronized (sent) {
            return sent.stream()
                    .filter(m -> sessionId.equals(SimpMessageHeaderAccessor.getSessionId(m.getHeaders())))
                    .map(m -> json.readTree((byte[]) m.getPayload()))
                    .toList();
        }
    }

    private JsonNode awaitFor(String sessionId, String type) throws InterruptedException {
        JsonNode[] found = new JsonNode[1];
        await(() -> {
            for (JsonNode body : bodiesFor(sessionId)) {
                if (type.equals(body.get("type").stringValue())) {
                    found[0] = body;
                    return true;
                }
            }
            return false;
        });
        return found[0];
    }

    private JsonNode awaitFullStateWith(String sessionId, int actors) throws InterruptedException {
        JsonNode[] found = new JsonNode[1];
        await(() -> {
            for (JsonNode body : bodiesFor(sessionId)) {
                if ("FullState".equals(body.get("type").stringValue()) && body.get("actors").size() == actors) {
                    found[0] = body;
                    return true;
                }
            }
            return false;
        });
        return found[0];
    }

    private static void await(BooleanSupplier condition) throws InterruptedException {
        long deadline = System.currentTimeMillis() + TIMEOUT_MS;
        while (!condition.getAsBoolean()) {
            if (System.currentTimeMillis() > deadline) {
                throw new AssertionError("조건이 시간 안에 참이 되지 않았다");
            }
            Thread.sleep(20);
        }
    }
}
