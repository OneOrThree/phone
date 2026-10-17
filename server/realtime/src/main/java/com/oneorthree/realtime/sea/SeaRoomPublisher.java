package com.oneorthree.realtime.sea;

import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.config.StompTopics;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
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

    /** 템플릿을 늦게 받는다 — 이 빈을 쓰는 STOMP 인터셉터가 그 템플릿을 만드는 설정보다 먼저 생긴다. */
    public SeaRoomPublisher(@Lazy SimpMessagingTemplate messagingTemplate, StringRedisTemplate redis,
            ObjectMapper objectMapper, Clock clock) {
        this.messagingTemplate = messagingTemplate;
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    /** 그 방 토픽으로 사건 하나를 보낸다 — realtime-b(이모트)도 이것을 부른다. */
    public void publish(UUID roomId, String type, JsonNode payload) {
        SeaRoomEvent event = SeaRoomEvent.of(type, roomId, clock.instant(), payload);
        String destination = StompTopics.seaRoomTopic(roomId);
        try {
            messagingTemplate.convertAndSend(destination, event);
        } catch (RuntimeException e) {
            log.error("바다 방 사건 로컬 전달 실패 — type={} reason={}", type, e.getClass().getSimpleName());
        }
        try {
            redis.convertAndSend(RedisKeys.SEA_FANOUT_CHANNEL,
                    objectMapper.writeValueAsString(new SeaRoomFanoutEvent(instanceId, destination, event)));
        } catch (RuntimeException e) {
            log.error("바다 방 사건 팬아웃 발행 실패 — type={} reason={}", type, e.getClass().getSimpleName());
        }
    }

    /**
     * 그 사용자의 <b>이 JVM</b> 모든 세션 {@code /user/queue/sea} 로 보낸다({@code convertAndSendToUser} 는 세션을 고르지
     * 않으면 그 사용자의 세션 전부다). ponytail: 다른 인스턴스에 붙은 기기에는 안 간다 — 그 기기는 전달 직전 검사에
     * 막혀 조용해지고 다음 sync·enter 로 맞춘다. 실패는 삼킨다.
     */
    public void publishToUser(UUID userId, UUID roomId, String type, JsonNode payload) {
        try {
            messagingTemplate.convertAndSendToUser(userId.toString(), "/queue/sea",
                    SeaRoomEvent.of(type, roomId, clock.instant(), payload));
        } catch (RuntimeException e) {
            log.warn("바다 개인 큐 전달 실패 — type={} reason={}", type, e.getClass().getSimpleName());
        }
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            SeaRoomFanoutEvent event = objectMapper.readValue(
                    new String(message.getBody(), StandardCharsets.UTF_8), SeaRoomFanoutEvent.class);
            if (instanceId.equals(event.originInstanceId())) {
                return; // 내가 보낸 것 — 로컬 전달은 publish 에서 끝났다
            }
            messagingTemplate.convertAndSend(event.destination(), event.event());
        } catch (Exception e) {
            // 예외 객체를 통째로 남기지 않는다 — 역직렬화 메시지에 한마디 같은 사용자 입력 조각이 실린다.
            log.error("바다 방 사건 팬아웃 수신 실패 — 이 건만 버린다. reason={}", e.getClass().getName());
        }
    }
}
