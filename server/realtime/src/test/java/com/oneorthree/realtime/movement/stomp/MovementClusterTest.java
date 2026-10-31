package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.fanout.FanoutTelemetry;
import com.oneorthree.realtime.logging.CapturedLogs;
import com.oneorthree.realtime.logging.LogContext;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import com.oneorthree.realtime.movement.MoveIntent;
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
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInfo;
import org.slf4j.MDC;
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
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
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

    /** 운영과 같은 Boot 매퍼 — 혼합 배포 호환은 이것으로 본다. */
    @Autowired
    private ObjectMapper objectMapper;

    private final ObjectMapper json = JsonMapper.builder().build();
    private final List<Message<?>> sent = Collections.synchronizedList(new ArrayList<>());
    private final BlockingQueue<Command> commands = new LinkedBlockingQueue<>();
    private final UUID island = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();

    private SimpleMeterRegistry meters;
    private RealtimeSessionRegistry sessions;
    private JwtValidator jwtValidator;
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
    void setUp(TestInfo info) throws Exception {
        meters = new SimpleMeterRegistry();
        MovementOutboundInterceptor completion = new MovementOutboundInterceptor();
        MessageChannel channel = (message, timeout) -> {
            sent.add(message);
            completion.afterMessageHandled(message, null, null, null);
            return true;
        };
        sessions = new RealtimeSessionRegistry();
        jwtValidator = mock(JwtValidator.class);
        publisher = new MovementPublisher(json, sessions, meters, channel);
        ownership = new MovementOwnership(redis, meters, "ct-" + UUID.randomUUID().toString().substring(0, 8), 3000);
        relay = new MovementRelay(true, publisher, ownership, redis, json, meters, MovementRelay.QUEUE_CAPACITY,
                MovementRelay.CONTROL_CAPACITY);
        relay.start();
        rooms = new MovementRooms(relay, meters);
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        // fastStale 태그 테스트만 생존 신호 한도를 2초로 줄인다 — 부하 CI 에서도 한도 안에 JOIN 을 관찰할 시간은 두고, sweep 은 1초 감시가 돌린다.
        cluster = info.getTags().contains("fastStale")
                ? new MovementCluster(true, rooms, publisher, ownership, relay, redis, json,
                        beans.getBeanProvider(MovementSubscriptionListener.class), meters, 2000)
                : new MovementCluster(true, rooms, publisher, ownership, relay, redis, json,
                        beans.getBeanProvider(MovementSubscriptionListener.class), meters);
        cluster.init();
        listener = new MovementSubscriptionListener(cluster, publisher, sessions, mock(ChatAccessGuard.class),
                jwtValidator, meters, Executors.newSingleThreadScheduledExecutor(),
                Executors.newSingleThreadScheduledExecutor(), 120);
        beans.addBean("listener", listener);

        relayIn = container();
        relayIn.setTaskExecutor(cluster.relayInExecutor());
        relayIn.addMessageListener(cluster, List.of(new ChannelTopic(RedisKeys.MOVEMENT_CMD_CHANNEL),
                new ChannelTopic(RedisKeys.MOVEMENT_FRAMES_CHANNEL), new ChannelTopic(cluster.ownCmdChannel())));
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
        cluster.destroy();
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
    @DisplayName("다른 인스턴스로 가는 명령은 넣은 스레드의 원인을 telemetry 로 싣는다 — STOMP 프레임의 request_id 는 origin 으로, 강퇴 사건은 event_id·origin 그대로 (GROMO-2581)")
    void forwardedCommandsCarryTheirCause() throws Exception {
        redis.opsForValue().set(RedisKeys.movementOwner(island), "ghost-7:5", Duration.ofMinutes(1));
        open("s1");

        try (LogContext frame = LogContext.open().put(LogContext.REQUEST_ID, "req-move")) {
            cluster.join(island, user, "s1");
        }
        assertThat(awaitCommand(Type.JOIN).telemetry()).isEqualTo(new FanoutTelemetry(1, "req-move", null, null));

        try (LogContext kick = LogContext.open().put(LogContext.EVENT_ID, "evt-kick")
                .put(LogContext.ORIGIN_REQUEST_ID, "req-kick")) {
            listener.recheckMembership(island, user);
        }
        assertThat(awaitCommand(Type.RECHECK).telemetry()).isEqualTo(new FanoutTelemetry(1, "req-kick", null,
                "evt-kick"));
    }

    @Test
    @DisplayName("소유자 쪽 — 받은 명령의 telemetry 를 처리 동안 깔아 적용 실패 줄이 보낸 쪽 원인을 달고, 원인 없는 다음 명령의 줄엔 남지 않는다 (GROMO-2581)")
    void ownerSideFailureLogCarriesTheSendersCause() throws Exception {
        open("s1");
        cluster.join(island, user, "s1"); // 이 인스턴스가 소유자가 된다
        cluster.requestFullState(island, "s1");
        awaitFor("s1", "FullState");
        long epoch = ownership.lease(island).epoch();
        MoveIntent intent = new MoveIntent(1, 1, 1.0, 1.0);

        try (CapturedLogs logs = CapturedLogs.of(MovementCluster.class)) {
            // userId 가 빠진 원격 INTENT(고장 난 발행자) — 방이 받지 못해 던지고, 길잡이가 실패 한 줄을 남긴다.
            command(new Command("ghost-8", ownership.instanceId(), epoch, island, Type.INTENT, null, "ghost-8:x",
                    intent, false, null, new FanoutTelemetry(1, "req-remote", "77", "evt-move")));
            CapturedLogs.Line failed = logs.await(line -> line.message().contains("이동 명령 처리 실패"), 1, TIMEOUT_MS)
                    .get(0);
            assertThat(failed.mdc()).containsEntry("origin_request_id", "req-remote")
                    .containsEntry("origin_trace_id", "77").containsEntry("event_id", "evt-move");
            assertThat(failed.thread()).isEqualTo("movement-cluster");

            command(new Command("ghost-8", ownership.instanceId(), epoch, island, Type.INTENT, null, "ghost-8:y",
                    intent, false));
            List<CapturedLogs.Line> both = logs.await(line -> line.message().contains("이동 명령 처리 실패"), 2,
                    TIMEOUT_MS);
            assertThat(both).hasSize(2);
            assertThat(both.get(1).mdc()).as("relay-in·길잡이 스레드가 앞 명령의 원인을 되돌렸다")
                    .doesNotContainKeys("origin_request_id", "origin_trace_id", "event_id");
        }
    }

    @Test
    @DisplayName("다른 인스턴스의 RECHECK — 재판정 스레드가 그 강퇴 사건의 event_id·원인을 깐 채 판정한다 (GROMO-2581)")
    void remoteRecheckJudgesWithTheKickCause() throws Exception {
        sessions.register("s1", new ChatPrincipal(user, "Bearer t"));
        open("s1");
        AtomicReference<Map<String, String>> atJudgement = new AtomicReference<>();
        given(jwtValidator.extractUserId("t")).willAnswer(invocation -> {
            atJudgement.compareAndSet(null, Map.copyOf(Objects.requireNonNullElse(MDC.getCopyOfContextMap(),
                    Map.<String, String>of())));
            return Optional.of(user);
        });

        command(new Command("ghost-6", null, 0, island, Type.RECHECK, user, null, null, false, null,
                new FanoutTelemetry(1, "req-kick", null, "evt-kick")));

        await(() -> atJudgement.get() != null);
        assertThat(atJudgement.get()).containsEntry("origin_request_id", "req-kick").containsEntry("event_id",
                "evt-kick");
    }

    /** telemetry(GROMO-2581) 이전의 명령 모양 — 지금 운영 중인 인스턴스가 읽는다. */
    private record PreTelemetryCommand(String originInstanceId, String ownerInstanceId, long epoch, UUID islandId,
            Type type, UUID userId, String sessionKey, MoveIntent intent, boolean cacheStale, List<String> sessions) {
    }

    @Test
    @DisplayName("명령 wire 혼합 배포 — 신→구: 새 명령을 옛 모양으로 읽어도 실패 없이 같은 값, 구→신: 옛 JSON 은 telemetry=null, 깨진 telemetry 는 메타데이터만 버린다 (GROMO-2581)")
    void commandWireReadsAcrossVersions() {
        MoveIntent intent = new MoveIntent(3, 1, 2.0, 3.0);
        String newWire = objectMapper.writeValueAsString(new Command("a", "b", 3, island, Type.INTENT, user, "a:s",
                intent, false, null, new FanoutTelemetry(1, "req-1", "77", null)));

        assertThat(newWire).contains("\"telemetry\"").contains("\"originRequestId\":\"req-1\"");
        PreTelemetryCommand old = objectMapper.readValue(newWire, PreTelemetryCommand.class);
        assertThat(old).isEqualTo(new PreTelemetryCommand("a", "b", 3, island, Type.INTENT, user, "a:s", intent, false,
                null));

        String oldWire = objectMapper.writeValueAsString(new PreTelemetryCommand("a", "b", 3, island, Type.JOIN, user,
                "a:s", null, false, null));
        assertThat(objectMapper.readValue(oldWire, Command.class))
                .isEqualTo(new Command("a", "b", 3, island, Type.JOIN, user, "a:s", null, false));
        assertThat(objectMapper.writeValueAsString(new Command("a", "b", 3, island, Type.JOIN, user, "a:s", null,
                false))).doesNotContain("telemetry");
        String broken = newWire.replace("\"originTraceId\":\"77\"", "\"originTraceId\":{\"x\":1}");
        Command parsed = objectMapper.readValue(broken, Command.class);
        assertThat(parsed.telemetry()).isNull();
        assertThat(parsed.intent()).isEqualTo(intent);
    }

    @Test
    @DisplayName("사건 줄이 차도 제어 명령(JOIN 등)은 제어 줄로 나가고 버려지지 않는다 — dropped 는 kind=frame|control 로 나눈다")
    void controlCommandsSurviveAFullFrameQueue() {
        SimpleMeterRegistry own = new SimpleMeterRegistry();
        MovementRelay stalled = new MovementRelay(true, publisher, ownership, redis, json, own, 1, 2); // 송신 스레드 없음
        Frame snapshot = new Frame("ct", island, 1, Kind.SNAPSHOT, null, null, false, "{}");
        stalled.publishFrame(snapshot);
        stalled.publishFrame(snapshot);
        stalled.publishCommand(new Command("ct", "o", 1, island, Type.INTENT, user, "ct:s", null, false));
        stalled.publishCommand(new Command("ct", "o", 1, island, Type.JOIN, user, "ct:s", null, false));
        stalled.publishCommand(new Command("ct", "o", 1, island, Type.FULL_STATE, null, "ct:s", null, false));

        assertThat(own.counter("movement.relay.dropped", "kind", "frame").count()).as("Snapshot·INTENT 만 버린다")
                .isEqualTo(2);
        assertThat(own.counter("movement.relay.dropped", "kind", "control").count()).isZero();
        assertThat(own.get("movement.relay.queue.depth").gauge().value()).isEqualTo(3);

        stalled.publishCommand(new Command("ct", "o", 1, island, Type.LEAVE, null, "ct:s", null, false));
        assertThat(own.counter("movement.relay.dropped", "kind", "control").count())
                .as("제어 줄마저 차면 세고 버린다 — PING 대조가 고친다").isEqualTo(1);
    }

    @Test
    @DisplayName("LEAVE 를 잃어 남은 유령 actor 는 그 인스턴스의 다음 PING(세션 목록) 대조로 사라진다")
    void pingReconciliationRemovesGhostActors() throws Exception {
        UUID remoteUser = becomeOwnerWithRemoteActor("ghost-5", "x");

        command(new Command("ghost-5", null, 0, null, Type.PING, null, null, null, false, List.of()));

        List<String> ids = actorIdsOf(awaitFullStateWith("s1", 1, 2));
        assertThat(ids).as("PING 목록에 없는 ghost-5:x(%s)는 내보냈다", remoteUser).containsExactly(user.toString());
        assertThat(meters.counter("movement.cluster.evict", "reason", "ghost").count()).isEqualTo(1);
    }

    @Test
    @Tag("fastStale")
    @DisplayName("내게 PING 을 안 보내는 인스턴스의 actor 는 sweep 이 내보내고 dead_instance 를 한 번만 센다")
    void sweepEvictsActorsOfAnInstanceThatStoppedPinging() throws Exception {
        becomeOwnerWithRemoteActor("ghost-8", "x");

        List<String> ids = actorIdsOf(awaitFullStateWith("s1", 1, 2));
        assertThat(ids).as("2초 동안 PING 이 없던 ghost-8:x 는 sweep 이 내보냈다").containsExactly(user.toString());
        assertThat(meters.counter("movement.cluster.evict", "reason", "dead_instance").count()).isEqualTo(1);

        Thread.sleep(2200); // 감시가 두 번 더 돈다 — 이미 지운 인스턴스는 다시 세지 않는다
        assertThat(meters.counter("movement.cluster.evict", "reason", "dead_instance").count()).isEqualTo(1);
    }

    @Test
    @DisplayName("남(다른 수신자)에게 간 빈 PING 은 내 방의 그 인스턴스 actor 를 지우지 않고, 내게 온 빈 PING 은 소켓 채널을 타고 지운다")
    void pingForAnotherOwnerIsIgnoredButPingToMeReconciles() throws Exception {
        becomeOwnerWithRemoteActor("ghost-x", "x");

        // 남 앞 PING — 전원 채널로 흘려 보내 onCommand 의 수신자 검사를 탄다(소유자 채널은 아무도 듣지 않으니 거기선 검증이 안 된다).
        long soloStates = bodiesFor("s1").stream().filter(b -> "FullState".equals(b.get("type").stringValue())
                && b.get("actors").size() == 1).count();
        command(new Command("ghost-x", "someone-else", 0, null, Type.PING, null, null, null, false, List.of()));
        // 센티널 — relay-in·submit 이 단일 스레드라 EVICTED(y)가 보이면 앞선 남 앞 PING 은 이미 처리됐다. 소유자 채널을 탄다.
        relay.publishCommand(new Command("ghost-x", ownership.instanceId(), 0, null, Type.PING, null, null, null,
                false, List.of(island + "|x", island + "|y")));
        assertThat(awaitCommand(Type.EVICTED).sessions()).containsExactly(island + "|y");
        assertThat(bodiesFor("s1").stream().filter(b -> "FullState".equals(b.get("type").stringValue())
                && b.get("actors").size() == 1).count()).as("남 앞 PING 은 대조하지 않는다 — x 가 아직 있다")
                .isEqualTo(soloStates);

        // 내 앞 PING — 운영 경로 그대로 relay 가 소유자 채널(chat:movement:cmd:v1:<me>)로 PUBLISH 하고 리스너가 받는다.
        relay.publishCommand(new Command("ghost-x", ownership.instanceId(), 0, null, Type.PING, null, null, null,
                false, List.of()));
        assertThat(actorIdsOf(awaitFullStateWith("s1", 1, (int) soloStates + 1))).as("내 앞 빈 PING 은 유령 actor 를 지운다")
                .containsExactly(user.toString());
    }

    @Test
    @DisplayName("PING 목록엔 있는데 내 방에 없는 세션(JOIN 유실·생존 신호 단절로 제거)은 EVICTED 로 그 인스턴스에 알린다")
    void pingReconciliationReportsMissingSessions() throws Exception {
        becomeOwnerWithRemoteActor("ghost-6", "x");

        command(new Command("ghost-6", null, 0, null, Type.PING, null, null, null, false,
                List.of(island + "|x", island + "|y")));

        Command evicted = awaitCommand(Type.EVICTED);
        assertThat(evicted.ownerInstanceId()).as("받을 인스턴스").isEqualTo("ghost-6");
        assertThat(evicted.sessions()).as("이미 있는 x 는 빼고 빠진 y 만").containsExactly(island + "|y");
        assertThat(meters.counter("movement.cluster.evict", "reason", "missing").count()).isEqualTo(1);
    }

    @Test
    @DisplayName("EVICTED 를 받으면 그 세션을 소유자에게 다시 입장시킨다(JOIN + FULL_STATE)")
    void evictedSessionsRejoinTheOwner() throws Exception {
        redis.opsForValue().set(RedisKeys.movementOwner(island), "ghost-7:9", Duration.ofMinutes(1));
        open("s1");

        command(new Command("ghost-7", ownership.instanceId(), 0, null, Type.EVICTED, null, null, null, false,
                List.of(island + "|s1")));

        Command join = awaitCommand(Type.JOIN);
        assertThat(join.ownerInstanceId()).isEqualTo("ghost-7");
        assertThat(join.sessionKey()).isEqualTo(ownership.instanceId() + ":s1");
        assertThat(awaitCommand(Type.FULL_STATE).sessionKey()).isEqualTo(ownership.instanceId() + ":s1");
    }

    @Test
    @DisplayName("FULL_STATE 요청을 잃어 게이트가 닫힌 세션은 2초 뒤 감시가 다시 요청해 3~4초 안에 열리고 이후 프레임을 받는다(codex r1 P1)")
    void lostFullStateRequestIsRetried() throws Exception {
        open("s1");
        cluster.join(island, user, "s1"); // requestFullState 를 «잃었다» — 게이트는 닫힌 채다

        JsonNode own = awaitFor("s1", "FullState"); // 상한 10초 — 감시 1초 × (기록 1틱 + 2초 대기)면 보통 3초 안
        assertThat(own.get("actors").size()).isEqualTo(1);
        assertThat(meters.counter("movement.fullstate.retry").count()).isGreaterThanOrEqualTo(1);

        command(new Command("ghost-9", ownership.instanceId(), ownership.lease(island).epoch(), island, Type.JOIN,
                UUID.randomUUID(), "ghost-9:z", null, false));
        assertThat(awaitFullStateWith("s1", 2)).as("열린 뒤의 전원 사건도 받는다").isNotNull();
    }

    @Test
    @DisplayName("리스를 잃고 같은 섬을 다시 얻은 뒤 옛 방의 늦은 콜백은 내지 않는다 — 같은 epoch 재획득이어도(stale_room)")
    void staleRoomCallbacksAreNotPublishedAfterReacquire() {
        SimpleMeterRegistry own = new SimpleMeterRegistry();
        MovementOwnership owner = new MovementOwnership(redis, own, "sr-" + UUID.randomUUID().toString()
                .substring(0, 8), 3000);
        MovementRelay stalled = new MovementRelay(true, publisher, owner, redis, json, own, 16, 16); // 송신 스레드 없음
        MovementEvent.FullState state = new MovementEvent.FullState(1, 1, 50, 10.989, List.of());
        long firstEpoch = owner.acquire(island).epoch();
        RoomRuntime.Listener oldRoom = stalled.forRoom(island);

        owner.forget(island); // 상실(로컬) — Redis 키는 아직 내 것
        long secondEpoch = owner.acquire(island).epoch();
        oldRoom.onEvent(island, state, com.oneorthree.realtime.movement.Target.ALL);
        oldRoom.onSnapshot(island, new MovementEvent.Snapshot(1, 1, List.of()));

        assertThat(secondEpoch).as("epoch 만으로는 옛 방을 못 가린다").isEqualTo(firstEpoch);
        assertThat(own.get("movement.relay.queue.depth").gauge().value()).as("발행 0").isZero();
        assertThat(own.counter("movement.routing.failed", "reason", "stale_room").count()).isEqualTo(2);

        stalled.forRoom(island).onEvent(island, state, com.oneorthree.realtime.movement.Target.ALL);
        assertThat(own.get("movement.relay.queue.depth").gauge().value()).as("새 방은 낸다").isEqualTo(1);
        owner.release(island);
    }

    @Test
    @DisplayName("reliable 프레임은 Snapshot 줄이 아니라 제어 줄로 가고, 그마저 차면 버리는 대신 그 섬에 재동기화를 건다(codex r2)")
    void reliableFramesAreNeverSilentlyDropped() {
        SimpleMeterRegistry own = new SimpleMeterRegistry();
        MovementRelay stalled = new MovementRelay(true, publisher, ownership, redis, json, own, 1, 1); // 송신 스레드 없음
        Frame snapshot = new Frame("ct", island, 1, Kind.SNAPSHOT, null, null, false, "{}");
        Frame fullState = new Frame("ct", island, 1, Kind.EVENT, null, null, false, "{}");
        stalled.publishFrame(snapshot);
        stalled.publishFrame(snapshot);
        stalled.publishFrame(fullState); // 사건 줄이 차 있어도 제어 줄로
        stalled.publishFrame(fullState); // 제어 줄도 찼다 — 재동기화 표시

        assertThat(own.counter("movement.relay.dropped", "kind", "frame").count()).as("Snapshot 만 버린다")
                .isEqualTo(1);
        assertThat(own.counter("movement.relay.resync", "reason", "dropped").count()).isEqualTo(1);
        assertThat(own.get("movement.relay.queue.depth").gauge().value()).isEqualTo(2);
        assertThat(stalled.takeResyncs()).containsExactly(island);
        assertThat(stalled.takeResyncs()).as("꺼내면 지운다").isEmpty();
    }

    @Test
    @DisplayName("퇴장 FullState 를 송신 줄에서 잃어도 RESYNC 로 2~3초 안에 남은 세션이 세션 한정 FullState 로 actor 목록을 맞춘다")
    void lostDepartureFullStateIsResynced() throws Exception {
        UUID stayer = user;
        UUID leaver = UUID.randomUUID();
        open("s1");
        publisher.open(island, "s2", leaver).subscribeMovement("sub-s2");
        cluster.join(island, stayer, "s1");
        cluster.requestFullState(island, "s1");
        cluster.join(island, leaver, "s2");
        cluster.requestFullState(island, "s2");
        awaitFullStateWith("s1", 2);

        relay.stop(); // 송신을 멈추고 제어 줄을 채운다 — 이 뒤의 퇴장 FullState 는 줄에 못 들어간다
        while (meters.counter("movement.relay.dropped", "kind", "control").count() == 0) {
            relay.publishCommand(new Command(ownership.instanceId(), null, 0, null, Type.PING, null, null, null,
                    false));
        }
        publisher.close(island, "s2");
        cluster.leave(island, "s2");
        await(() -> meters.counter("movement.relay.resync", "reason", "dropped").count() >= 1);
        int before = bodiesFor("s1").size();
        int fullStatesBefore = (int) bodiesFor("s1").stream()
                .filter(b -> "FullState".equals(b.get("type").stringValue())).count();

        relay.start();
        JsonNode resynced = awaitFullStateWith("s1", 1, fullStatesBefore); // 입장 때의 1명짜리는 건너뛴다(상한 10초)

        assertThat(actorIdsOf(resynced)).containsExactly(stayer.toString());
        assertThat(bodiesFor("s1").subList(before, bodiesFor("s1").size()))
                .as("잃은 전원 FullState 대신 RESYNC 의 세션 한정 FullState 로 맞췄다").isNotEmpty();
    }

    @Test
    @DisplayName("줄에 머무는 사이 리스를 잃은 프레임은 PUBLISH 직전에 버린다(stale_queue) — 발행 0")
    void framesQueuedBeforeLeaseLossAreNotPublished() throws Exception {
        SimpleMeterRegistry own = new SimpleMeterRegistry();
        MovementOwnership owner = new MovementOwnership(redis, own, "sq-" + UUID.randomUUID().toString()
                .substring(0, 8), 3000);
        MovementRelay queued = new MovementRelay(true, publisher, owner, redis, json, own, 16, 16);
        long epoch = owner.acquire(island).epoch();
        queued.publishFrame(new Frame(owner.instanceId(), island, epoch, Kind.EVENT, null, null, false, "{}"));
        queued.publishFrame(new Frame(owner.instanceId(), island, epoch, Kind.SNAPSHOT, null, null, false, "{}"));

        owner.forget(island); // 줄에 있는 동안 리스를 잃었다
        queued.start();
        try {
            await(() -> own.counter("movement.routing.failed", "reason", "stale_queue").count() == 2);
            assertThat(own.timer("movement.relay.lag").count()).as("PUBLISH 0").isZero();
            assertThat(own.counter("movement.relay.resync", "reason", "dropped").count())
                    .as("소유자가 바뀐 것이라 재동기화는 걸지 않는다").isZero();
        } finally {
            queued.stop();
            redis.delete(RedisKeys.movementOwner(island));
        }
    }

    @Test
    @DisplayName("줄에 머무는 사이 상실·재획득이 같은 epoch 로 일어나도 옛 세대 프레임은 PUBLISH 직전에 버린다(세대 비교)")
    void framesQueuedAcrossSameEpochReacquireAreNotPublished() throws Exception {
        SimpleMeterRegistry own = new SimpleMeterRegistry();
        MovementOwnership owner = new MovementOwnership(redis, own, "sg-" + UUID.randomUUID().toString()
                .substring(0, 8), 3000);
        MovementRelay queued = new MovementRelay(true, publisher, owner, redis, json, own, 16, 16);
        long epoch = owner.acquire(island).epoch();
        queued.publishFrame(new Frame(owner.instanceId(), island, epoch, Kind.EVENT, null, null, false, "{}"));

        owner.forget(island); // 상실 → 재획득(키가 아직 내 것이라 같은 epoch)
        assertThat(owner.acquire(island).epoch()).isEqualTo(epoch);
        queued.start();
        try {
            await(() -> own.counter("movement.routing.failed", "reason", "stale_queue").count() == 1);
            assertThat(own.timer("movement.relay.lag").count()).as("PUBLISH 0").isZero();
        } finally {
            queued.stop();
            owner.release(island);
        }
    }

    @Test
    @DisplayName("감시의 한 단계가 던져도 복구 재송 단계(RECHECK 재송)는 돈다")
    void pollStepsAreIsolated() throws Exception {
        SimpleMeterRegistry own = new SimpleMeterRegistry();
        MovementOwnership broken = org.mockito.Mockito.spy(new MovementOwnership(redis, own,
                "ps-" + UUID.randomUUID().toString().substring(0, 8), 3000));
        org.mockito.Mockito.doThrow(new IllegalStateException("갱신 단계 고장")).when(broken).leases();
        MovementRelay small = new MovementRelay(true, publisher, broken, redis, json, own, 16, 1); // 아직 송신 없음
        Command recheck = new Command(broken.instanceId(), null, 0, island, Type.RECHECK, user, null, null, false);
        small.publishCommand(recheck);
        small.publishCommand(recheck); // 제어 줄(1)이 차 재송 표시
        assertThat(own.counter("movement.relay.recheck.retry", "reason", "dropped").count()).isEqualTo(1);
        MovementCluster isolated = new MovementCluster(true, rooms, publisher, broken, small, redis, json,
                new StaticListableBeanFactory().getBeanProvider(MovementSubscriptionListener.class), own);

        isolated.poll(); // 한 틱을 직접 — renew·release-idle 이 던진다. 송신 스레드가 없어 결과가 결정적이다

        // 재송 단계가 돌아 표시를 꺼내 다시 넣었다 — 제어 줄이 아직 차 있어 또 표시된다(2). 단계가 막혔다면 1 그대로다.
        assertThat(own.counter("movement.relay.recheck.retry", "reason", "dropped").count())
                .as("갱신 단계가 던져도 RECHECK 재송 단계가 돌았다").isEqualTo(2);
        assertThat(small.takeRechecks()).containsExactly(recheck);
    }

    @Test
    @DisplayName("잃은 RECHECK 재송 장부는 원인(telemetry)만 다른 같은 재검사를 하나로 합치고 먼저 잃은 것을 남긴다 — 관측이 재송 수를 바꾸지 않는다 (GROMO-2581)")
    void recheckLedgerMergesRegardlessOfTelemetry() {
        SimpleMeterRegistry own = new SimpleMeterRegistry();
        MovementRelay small = new MovementRelay(true, publisher, ownership, redis, json, own, 16, 1); // 아직 송신 없음
        small.publishCommand(new Command(ownership.instanceId(), null, 0, island, Type.RECHECK, user, null, null,
                false)); // 제어 줄(1)을 채운다
        Command first = new Command(ownership.instanceId(), null, 0, island, Type.RECHECK, user, null, null, false,
                null, new FanoutTelemetry(1, "req-kick-1", null, "evt-kick-1"));
        small.publishCommand(first);
        small.publishCommand(new Command(ownership.instanceId(), null, 0, island, Type.RECHECK, user, null, null,
                false, null, new FanoutTelemetry(1, "req-kick-2", null, "evt-kick-2")));

        assertThat(own.counter("movement.relay.recheck.retry", "reason", "dropped").count()).isEqualTo(2);
        assertThat(small.takeRechecks()).as("사건마다 따로 남지 않는다").containsExactly(first);
    }

    @Test
    @DisplayName("종료 인계는 송신 줄을 RELEASE 전에 비운다 — 종료 직전 프레임이 stale_queue 로 버려지지 않고 실제로 나간다")
    void stopFlushesQueuedFramesBeforeRelease() throws Exception {
        BlockingQueue<Frame> frames = new LinkedBlockingQueue<>();
        RedisMessageListenerContainer frameSpy = container();
        frameSpy.addMessageListener((message, pattern) -> frames.add(json.readValue(message.getBody(), Frame.class)),
                new ChannelTopic(RedisKeys.MOVEMENT_FRAMES_CHANNEL));
        frameSpy.afterPropertiesSet();
        frameSpy.start();
        try {
            becomeOwnerWithRemoteActor("ghost-10", "q");
            relay.stop(); // 송신을 멈춘 채 마지막 프레임을 줄에 남긴다
            relay.publishFrame(new Frame(ownership.instanceId(), island, ownership.lease(island).epoch(), Kind.EVENT,
                    null, null, false, "\"last\""));
            relay.start();
            cluster.stop();

            Frame last = null;
            long deadline = System.currentTimeMillis() + TIMEOUT_MS;
            while (last == null && System.currentTimeMillis() < deadline) {
                Frame next = frames.poll(200, TimeUnit.MILLISECONDS);
                if (next != null && "\"last\"".equals(next.payload())) {
                    last = next;
                }
            }
            assertThat(last).as("종료 직전 프레임이 나갔다").isNotNull();
            assertThat(meters.counter("movement.routing.failed", "reason", "stale_queue").count()).isZero();
            assertThat(redis.hasKey(RedisKeys.movementOwner(island))).as("그 뒤 반납").isFalse();
        } finally {
            frameSpy.destroy();
        }
    }

    @Test
    @DisplayName("그 섬에서 본 epoch 보다 작은 RESYNC 는 버린다(forward.stale{epoch}) — 같은 epoch 는 세션을 다시 맞춘다")
    void staleResyncIsIgnored() throws Exception {
        redis.opsForValue().set(RedisKeys.movementOwner(island), "ghost-11:100", Duration.ofMinutes(1));
        open("s1");
        String fullState = json.writeValueAsString(new MovementEvent.FullState(1, 1, 50, 10.989, List.of()));
        frame(new Frame("ghost-11", island, 100, Kind.EVENT, ownership.instanceId(), "s1", true, fullState));
        awaitFor("s1", "FullState");
        commands.clear();

        command(new Command("ghost-old", null, 99, island, Type.RESYNC, null, null, null, false));
        await(() -> meters.counter("movement.owner.forward.stale", "reason", "epoch").count() == 1);
        command(new Command("ghost-11", null, 100, island, Type.RESYNC, null, null, null, false));

        Command request = awaitCommand(Type.FULL_STATE);
        assertThat(request.sessionKey()).isEqualTo(ownership.instanceId() + ":s1");
        assertThat(meters.counter("movement.owner.forward.stale", "reason", "epoch").count())
                .as("옛 RESYNC 1건만 버렸다").isEqualTo(1);
    }

    @Test
    @DisplayName("수명주기 stop 뒤 start(테스트 컨텍스트 일시정지·재개)하면 송신·감시가 다시 서서 이동이 그대로 돈다")
    void lifecycleRestartRestoresWorkers() throws Exception {
        cluster.stop(); // 인계·반납·송신 정지 — Spring 7 은 쉬는 테스트 컨텍스트에 이것을 부른다
        cluster.start();
        open("s1");

        cluster.join(island, user, "s1");
        cluster.requestFullState(island, "s1");

        assertThat(awaitFor("s1", "FullState").get("actors").size()).isEqualTo(1);
        assertThat(cluster.isRunning()).isTrue();
    }

    @Test
    @DisplayName("닫힌 세션(큐 포화 1008·소켓 종료)은 RESYNC·EVICTED 를 받아도 FULL_STATE 재요청·JOIN 이 나가지 않는다")
    void closedSessionsAreSkippedByResyncAndEvicted() throws Exception {
        redis.opsForValue().set(RedisKeys.movementOwner(island), "ghost-c:9", Duration.ofMinutes(1));
        open("s1");
        open("s2");
        // 소켓 종료 경로(afterConnectionClosed → closed)가 outbox 를 닫는 것과 같은 상태 — 섬 목록엔 남은 채 닫힘.
        publisher.outboxes(island).stream().filter(o -> "s1".equals(o.sessionId())).forEach(MovementOutbox::close);
        commands.clear();

        String closedKey = ownership.instanceId() + ":s1";
        // 가드: MovementCluster.eligible() 의 !outbox.isClosed() 가 resyncIsland·rejoinEvicted 둘 다를 막는다.
        command(new Command("ghost-c", null, 0, island, Type.RESYNC, null, null, null, false));
        command(new Command("ghost-c", ownership.instanceId(), 0, null, Type.EVICTED, null, null, null, false,
                List.of(island + "|s1", island + "|s2")));

        // 양성 대조 — 열린 s2 는 다시 입장한다. 이 명령들이 처리된 뒤에도 s1 은 한 건도 없어야 한다.
        assertThat(awaitCommand(Type.JOIN).sessionKey()).isEqualTo(ownership.instanceId() + ":s2");
        Thread.sleep(1500);
        assertThat(commands).as("닫힌 s1 로는 JOIN·FULL_STATE 가 나가지 않는다")
                .noneMatch(c -> closedKey.equals(c.sessionKey()));
    }

    @Test
    @DisplayName("방이 있는 상태(입장·리스 보유)에서 stop 뒤 start 해도 입장·세션 한정 FullState·프레임 전달이 정상이고 리스·방이 다시 선다")
    void lifecycleRestartWithRoomsRestoresState() throws Exception {
        open("s1");
        cluster.join(island, user, "s1");
        cluster.requestFullState(island, "s1");
        awaitFor("s1", "FullState");
        assertThat(ownership.lease(island)).isNotNull();

        cluster.stop(); // 인계·반납
        assertThat(ownership.lease(island)).as("stop 이 리스를 반납했다").isNull();
        cluster.start();
        open("s2");
        cluster.join(island, UUID.randomUUID(), "s2");
        cluster.requestFullState(island, "s2");

        assertThat(awaitFor("s2", "FullState").get("actors").size()).isGreaterThanOrEqualTo(1);
        await(() -> ownership.lease(island) != null && rooms.rooms().containsKey(island));
        String arrived = json.writeValueAsString(new MovementEvent.Arrived(user, 1, 9, new MovementEvent.Point(1, 1)));
        relay.publishFrame(new Frame(ownership.instanceId(), island, ownership.lease(island).epoch(), Kind.EVENT,
                null, null, false, arrived));
        assertThat(awaitFor("s2", "Arrived").get("serverTick").asLong()).isEqualTo(9);
    }

    /** 이 인스턴스가 소유자가 되고(로컬 세션 s1), 다른 인스턴스 세션 {@code <instance>:<sid>} 가 방에 든 상태를 만든다. */
    private UUID becomeOwnerWithRemoteActor(String instance, String sessionId) throws Exception {
        open("s1");
        cluster.join(island, user, "s1");
        cluster.requestFullState(island, "s1");
        awaitFor("s1", "FullState");
        UUID remoteUser = UUID.randomUUID();
        command(new Command(instance, ownership.instanceId(), ownership.lease(island).epoch(), island, Type.JOIN,
                remoteUser, instance + ":" + sessionId, null, false));
        awaitFullStateWith("s1", 2);
        return remoteUser;
    }

    private static List<String> actorIdsOf(JsonNode fullState) {
        List<String> ids = new ArrayList<>();
        fullState.get("actors").forEach(actor -> ids.add(actor.get("userId").stringValue()));
        return ids;
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
        return awaitFullStateWith(sessionId, actors, 0);
    }

    /** {@code skip} 번째 FullState 부터 본다 — 앞선 같은 크기의 FullState 를 건너뛸 때. */
    private JsonNode awaitFullStateWith(String sessionId, int actors, int skip) throws InterruptedException {
        JsonNode[] found = new JsonNode[1];
        await(() -> {
            List<JsonNode> states = bodiesFor(sessionId).stream()
                    .filter(b -> "FullState".equals(b.get("type").stringValue())).toList();
            for (JsonNode body : states.subList(Math.min(skip, states.size()), states.size())) {
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
