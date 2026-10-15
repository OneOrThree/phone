package com.oneorthree.realtime.fanout;

import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.message.dto.ChatMessageResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.verify;

/**
 * 전달 실패가 «요청»을 실패시키지 않는지.
 *
 * <p>이 메서드가 불릴 때 메시지는 이미 저장·커밋된 뒤다. 그래서 여기서 예외가 올라가면 발신자에게는
 * 「실패」로 보이는데 실제로는 성사된 상태가 된다 — 재전송해도 멱등 키 덕에 중복은 안 생기지만
 * 화면은 계속 실패로 남는다.
 *
 * <p>특히 <b>로컬 전달이 던지면 Redis 발행에 도달조차 못 한다</b>는 점이 중요하다. 한 인스턴스의
 * 브로커 문제가 «전 인스턴스 미전달»로 번지는 경로라, 두 전달을 대칭으로 감싼 것이 맞는지 여기서 본다.
 */
@ExtendWith(MockitoExtension.class)
class ChatFanoutTest {

    @Mock
    private SimpMessagingTemplate messagingTemplate;

    @Mock
    private org.springframework.data.redis.core.StringRedisTemplate redis;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("정상 경로 — 로컬로 밀고 Redis 로도 흘린다")
    void deliversLocallyAndPublishes() {
        ChatFanout fanout = fanout();
        ChatMessageResponse message = message();

        fanout.broadcast(message);

        verify(messagingTemplate).convertAndSend(eq(ChatFanout.topicOf(message.groupId())), eq(message));
        verify(redis).convertAndSend(eq(RedisKeys.FANOUT_CHANNEL), anyString());
    }

    @Test
    @DisplayName("로컬 전달이 실패해도 Redis 발행은 «그대로» 나간다 — 여기서 멈추면 전 인스턴스가 못 받는다")
    void localFailureDoesNotBlockPublish() {
        willThrow(new IllegalStateException("broker down"))
                .given(messagingTemplate).convertAndSend(anyString(), any(Object.class));
        ChatFanout fanout = fanout();

        assertThatCode(() -> fanout.broadcast(message())).doesNotThrowAnyException();

        verify(redis).convertAndSend(eq(RedisKeys.FANOUT_CHANNEL), anyString());
    }

    @Test
    @DisplayName("Redis 발행이 실패해도 요청은 성공이다 — 저장은 이미 끝났다")
    void publishFailureIsSwallowed() {
        willThrow(new org.springframework.dao.QueryTimeoutException("redis down"))
                .given(redis).convertAndSend(anyString(), any(Object.class));
        ChatFanout fanout = fanout();

        assertThatCode(() -> fanout.broadcast(message())).doesNotThrowAnyException();

        // 로컬 구독자는 정상적으로 받았다 — 순서를 뒤집으면 이 보장이 사라진다.
        verify(messagingTemplate).convertAndSend(anyString(), any(Object.class));
    }

    @Test
    @DisplayName("둘 다 실패해도 요청은 성공이다")
    void bothFailuresAreSwallowed() {
        willThrow(new IllegalStateException("broker down"))
                .given(messagingTemplate).convertAndSend(anyString(), any(Object.class));
        willThrow(new org.springframework.dao.QueryTimeoutException("redis down"))
                .given(redis).convertAndSend(anyString(), any(Object.class));

        assertThatCode(() -> fanout().broadcast(message())).doesNotThrowAnyException();
    }

    private ChatFanout fanout() {
        return new ChatFanout(messagingTemplate, redis, objectMapper);
    }

    private static ChatMessageResponse message() {
        return new ChatMessageResponse(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                "안녕", Instant.parse("2026-09-11T00:00:00Z"), UUID.randomUUID());
    }
}
