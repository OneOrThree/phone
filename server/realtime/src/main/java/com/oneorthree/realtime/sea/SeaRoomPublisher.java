package com.oneorthree.realtime.sea;

import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.config.StompTopics;
import com.oneorthree.realtime.fanout.FanoutTelemetry;
import com.oneorthree.realtime.logging.LogContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Objects;
import java.util.UUID;

/**
 * 바다 방 사건 전송 — 이 JVM 구독자에게 먼저, 그다음 {@code chat:sea:v1} 로 다른 인스턴스에 (GROMO-2300, N20).
 *
 * <p>방 상태는 Redis 공유라 같은 방 구성원이 여러 인스턴스에 흩어져 있다. 로컬로만 보내면 다른 인스턴스에 붙은
 * 구성원은 입퇴장을 못 본다. 반대 방향(남이 보낸 것)은 {@link #onMessage} 가 받아 이 JVM 구독자에게 민다 —
 * 자기 메아리는 거른다({@code RealtimeEventFanoutSubscriber} 와 같은 규율).
 *
 * <p><b>던지지 않는다.</b> 부르는 쪽이 사건 수신 트랜잭션·STOMP 처리 스레드라, 전송 실패가 이미 끝난 Redis 상태
 * 변경을 되돌리거나 다른 일을 끊으면 안 된다. 놓친 사건은 앱이 다음 입장({@code sea.room.assigned})으로 맞춘다.
 */
@Slf4j
@Component
public class SeaRoomPublisher implements MessageListener {

    private final UUID instanceId = UUID.randomUUID();
    private final SimpMessagingTemplate messagingTemplate;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final RealtimeSessionRegistry sessions;

    /** 템플릿을 늦게 받는다 — 이 빈을 쓰는 STOMP 인터셉터가 그 템플릿을 만드는 설정보다 먼저 생긴다. */
    public SeaRoomPublisher(@Lazy SimpMessagingTemplate messagingTemplate, StringRedisTemplate redis,
            ObjectMapper objectMapper, Clock clock, RealtimeSessionRegistry sessions) {
        this.messagingTemplate = messagingTemplate;
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.sessions = sessions;
    }

    /** 방 사건을 전파한다. 스냅샷은 개인 큐, 나머지는 방 토픽으로 보낸다 — 이모트도 이 입구를 쓴다. */
    public void publish(UUID roomId, String type, JsonNode payload) {
        SeaRoomEvent event = SeaRoomEvent.of(type, roomId, clock.instant(), payload);
        String destination = StompTopics.seaRoomTopic(roomId);
        // event_id 를 이 전달 동안 문맥에 둔다(GROMO-2581) — 로컬 구독자의 아웃바운드 작업이 실행기 장식기로 같은 값을 물려받고,
        // wire 의 telemetry 로 다른 인스턴스의 수신 줄까지 같은 사건·원인에 이어진다.
        String eventId = event.eventId().toString();
        try (LogContext scope = LogContext.open().put(LogContext.EVENT_ID, eventId)) {
            try {
                deliverLocal(destination, event);
            } catch (RuntimeException e) {
                log.error("바다 방 사건 로컬 전달 실패 — roomId={} eventId={} type={} reason={}", roomId, event.eventId(),
                        type, e.getClass().getSimpleName());
            }
            try {
                Long receivers = redis.convertAndSend(RedisKeys.SEA_FANOUT_CHANNEL, objectMapper.writeValueAsString(
                        new SeaRoomFanoutEvent(instanceId, destination, event, FanoutTelemetry.capture(eventId))));
                LogContext.info(log, LogContext.FANOUT_PUBLISH, "팬아웃 발행 — channel={} receivers={}",
                        RedisKeys.SEA_FANOUT_CHANNEL, receivers);
            } catch (RuntimeException e) {
                log.error("바다 방 사건 팬아웃 발행 실패 — roomId={} eventId={} type={} reason={}", roomId, event.eventId(),
                        type, e.getClass().getSimpleName());
            }
        }
    }

    /**
     * 그 사용자의 <b>이 JVM</b> 모든 세션 {@code /user/queue/sea} 로 보낸다. ponytail: 다른 인스턴스에 붙은 기기에는 안 간다
     * — 그 기기는 전달 직전 검사에 막혀 조용해지고 다음 sync·enter 로 맞춘다. 실패는 삼킨다.
     *
     * <p><b>세션마다 따로, 세션 id 헤더를 실어 보낸다.</b> 세션을 고르지 않은 {@code convertAndSendToUser} 는
     * {@code UserDestinationMessageHandler} 가 «한 메시지»를 세션 수만큼 다시 보내는데, 인바운드 순서 보존
     * ({@code setPreserveReceiveOrder}) 스레드에서 부르면 {@code OrderedMessageChannelDecorator} 가 첫 전송에서 헤더를
     * 굳혀 둘째 세션부터 {@code IllegalArgumentException(Expected mutable SimpMessageHeaderAccessor)} 로 떨어진다(실측 —
     * 두 기기 중 약 절반이 통지를 못 받았다). 세션 한정 메시지는 재사용이 없다({@code ChatFanout} 의 되돌림과 같은 방식).
     */
    public void publishToUser(UUID userId, UUID roomId, String type, JsonNode payload) {
        SeaRoomEvent event = SeaRoomEvent.of(type, roomId, clock.instant(), payload);
        deliverToUser(userId, event);
    }

    private void deliverToUser(UUID userId, SeaRoomEvent event) {
        for (String sessionId : sessions.sessionIdsOf(userId)) {
            try {
                SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
                headers.setSessionId(sessionId);
                headers.setLeaveMutable(true);
                messagingTemplate.convertAndSendToUser(userId.toString(), "/queue/sea", event,
                        headers.getMessageHeaders());
            } catch (RuntimeException e) {
                log.warn("바다 개인 큐 전달 실패 — roomId={} eventId={} type={} reason={}", event.roomId(), event.eventId(),
                        event.type(), e.getClass().getSimpleName());
            }
        }
    }

    /** 앱은 스냅샷을 개인 큐에서 받는다. 다른 인스턴스의 차단 갱신도 같은 경로로 보낸다. */
    private void deliverLocal(String destination, SeaRoomEvent event) {
        if (SeaRooms.SNAPSHOT.equals(event.type())) {
            for (JsonNode member : event.payload().path("members")) {
                JsonNode userId = member.path("userId");
                if (userId.isString()) {
                    deliverToUser(UUID.fromString(userId.stringValue()), event);
                }
            }
        } else {
            messagingTemplate.convertAndSend(destination, event);
        }
    }

    /**
     * 다른 인스턴스가 흘린 사건을 받는다. 로그 연결(GROMO-2581)은 다른 두 채널(GROMO-2559)과 같다 — 역직렬화 직후 발행 쪽 원인
     * ({@code telemetry})과 사건 {@code event_id} 를 처리 동안 문맥에 두고, 자기 메아리를 포함해 {@code fanout.receive} 한 줄을 남긴다.
     */
    @Override
    public void onMessage(Message message, byte[] pattern) {
        SeaRoomFanoutEvent event;
        try {
            event = objectMapper.readValue(
                    new String(message.getBody(), StandardCharsets.UTF_8), SeaRoomFanoutEvent.class);
        } catch (RuntimeException e) {
            // 예외 객체를 통째로 남기지 않는다 — 역직렬화 메시지에 한마디 같은 사용자 입력 조각이 실린다.
            log.error("바다 방 사건 팬아웃 수신 실패 — 이 건만 버린다. reason={}", e.getClass().getName());
            received("invalid");
            return;
        }
        try (LogContext scope = FanoutTelemetry.install(event.telemetry())) {
            if (event.event() != null) {
                scope.put(LogContext.EVENT_ID, Objects.toString(event.event().eventId(), null));
            }
            received(deliver(event));
        }
    }

    private String deliver(SeaRoomFanoutEvent event) {
        try {
            if (instanceId.equals(event.originInstanceId())) {
                return "self_echo"; // 내가 보낸 것 — 로컬 전달은 publish 에서 끝났다
            }
            deliverLocal(event.destination(), event.event());
            return "delivered";
        } catch (RuntimeException e) {
            log.error("바다 방 사건 팬아웃 수신 실패 — 이 건만 버린다. reason={}", e.getClass().getName());
            return "failed";
        }
    }

    private static void received(String result) {
        LogContext.info(log, LogContext.FANOUT_RECEIVE, "팬아웃 수신 — channel={} result={}",
                RedisKeys.SEA_FANOUT_CHANNEL, result);
    }
}
