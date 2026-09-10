package com.oneorthree.chat.fanout;

import com.oneorthree.chat.common.redis.RedisKeys;
import com.oneorthree.chat.message.dto.ChatMessageResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

/**
 * 방금 저장된 메시지를 <b>구독자 전원</b>에게 민다 — 이 인스턴스에 붙은 사람과, 다른 인스턴스에 붙은 사람.
 *
 * <h2>왜 브로커가 아니라 Redis Pub/Sub 인가</h2>
 * STOMP 의 기본 브로커({@code SimpleBroker})는 <b>프로세스 안의 구독자만</b> 안다. 인스턴스를 두 대로
 * 늘리는 순간 A 에 붙은 사람과 B 에 붙은 사람은 서로의 말을 못 듣는다 — 그리고 그 고장은 인스턴스가
 * 한 대인 개발·CI 에서는 절대 재현되지 않는다. 이 클래스가 그 틈을 메운다.
 *
 * <p>Kafka 를 쓰지 않는 이유: 채팅 전파는 <b>지금 접속한 사람에게만 의미 있는</b> 신호라 보존·재생이
 * 필요 없다. 영속은 이미 {@code chat_messages} 가 맡고 있고, 접속하지 않은 사람은 어차피 다음
 * 접속 때 히스토리로 읽는다(채팅에는 푸시가 없다). 보존이 필요 없는 신호에 로그 기반 브로커를 쓰면
 * 운영 부담만 늘어난다.
 *
 * <h2>채널을 그룹별로 쪼개지 않는다</h2>
 * {@code chat:fanout} 하나만 쓴다. 그룹마다 채널을 만들면 인스턴스는 「자기에게 구독자가 있는 그룹」만
 * 골라 SUBSCRIBE 해야 하는데, 그 목록은 사람이 들어오고 나갈 때마다 바뀌어 구독/해지가 끊임없이 돈다.
 * 대가는 각 인스턴스가 자기와 무관한 메시지도 받는다는 것이고, 그건 {@code SimpMessagingTemplate} 이
 * 「그 토픽 구독자 없음」으로 즉시 버린다. 방 수가 커져 이 낭비가 문제가 되면 그때 쪼갠다.
 *
 * <h2>전달 실패는 «둘 다» 삼킨다</h2>
 * 로컬 전달을 먼저 하고 Redis 발행을 나중에 한다. Redis 가 흔들려도 <b>같은 인스턴스에 붙은 사람끼리는
 * 계속 대화가 되고</b>, 못 받은 쪽은 히스토리 조회로 메운다. 순서를 뒤집으면 Redis 장애가 곧 전면 정지다.
 *
 * <p><b>둘 중 어느 쪽이 실패해도 요청을 실패시키지 않는다.</b> 이 메서드가 불리는 시점엔 메시지가
 * 이미 저장·커밋된 뒤라, 여기서 예외를 올리면 발신자에게는 「실패」로 보이는데 실제로는 성사된
 * 상태가 된다 — 앱이 재전송하면 멱등 키 덕에 중복은 안 생기지만, 화면은 계속 실패로 남는다.
 * 로컬 전달만 감싸지 않으면 대칭도 깨진다: 로컬 전달이 던지는 순간 <b>Redis 발행에 도달조차 못 해
 * 다른 인스턴스로도 안 나간다</b>.
 */
@Slf4j
@Component
public class ChatFanout {

    private final SimpMessagingTemplate messagingTemplate;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    /** 이 프로세스의 신원. 되돌아온 자기 발행을 알아보는 데만 쓴다(부팅마다 새로 만들어도 무방하다). */
    private final UUID instanceId = UUID.randomUUID();

    public ChatFanout(SimpMessagingTemplate messagingTemplate, StringRedisTemplate redis,
            ObjectMapper objectMapper) {
        this.messagingTemplate = messagingTemplate;
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    /** 다른 인스턴스가 보낸 것인지 판정하기 위해 구독자가 읽는다. */
    public UUID instanceId() {
        return instanceId;
    }

    /**
     * 로컬 구독자에게 즉시 전달하고, 다른 인스턴스에는 Redis 로 전파한다.
     *
     * @param message 이미 저장이 끝난 메시지. 저장 전에 부르면 「소켓엔 왔는데 새로고침하면 없는」
     *                말이 생긴다
     */
    public void broadcast(ChatMessageResponse message) {
        try {
            deliverLocally(message);
        } catch (RuntimeException e) {
            // 이 인스턴스 구독자만 실시간으로 못 받는다. 저장은 이미 끝났으니 유실이 아니라 지연이고,
            // 무엇보다 여기서 멈추면 아래 Redis 발행에 도달하지 못해 «다른 인스턴스까지» 못 받는다.
            log.error("로컬 전달 실패 — messageId={} groupId={}", message.messageId(), message.groupId(), e);
        }

        try {
            // Jackson 3 은 직렬화 예외가 비검사(JacksonException extends RuntimeException)라
            // 별도 catch 가 필요 없다 — 아래 RuntimeException 이 함께 받는다.
            String payload = objectMapper.writeValueAsString(new ChatFanoutEvent(instanceId, message));
            redis.convertAndSend(RedisKeys.FANOUT_CHANNEL, payload);
        } catch (RuntimeException e) {
            // 다른 인스턴스에 붙은 사람은 이 메시지를 실시간으로 못 받는다. 히스토리에는 남아 있으므로
            // 유실이 아니라 «지연»이다 — 그래서 요청 자체는 실패시키지 않는다.
            log.error("팬아웃 발행 실패 — messageId={} groupId={}", message.messageId(), message.groupId(), e);
        }
    }

    /** 이 프로세스에 붙어 있는 그 방 구독자에게 민다. 구독자가 없으면 조용히 버려진다. */
    void deliverLocally(ChatMessageResponse message) {
        messagingTemplate.convertAndSend(topicOf(message.groupId()), message);
    }

    /**
     * 그 섬의 브로드캐스트 토픽.
     *
     * <p>구독 인가는 {@code StompAuthChannelInterceptor} 가 이 경로 모양을 정규식으로 되읽어
     * 판정한다 — <b>여기를 바꾸면 거기도 같이 바꿔야 한다.</b> 한쪽만 바꾸면 인가가 통째로 빠진 채
     * 동작한다(구독은 되고, 검사만 안 걸린다).
     */
    public static String topicOf(UUID groupId) {
        return "/topic/groups/" + groupId;
    }
}
