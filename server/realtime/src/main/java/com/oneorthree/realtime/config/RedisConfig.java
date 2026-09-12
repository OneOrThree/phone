package com.oneorthree.realtime.config;

import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.fanout.ChatFanoutSubscriber;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

/**
 * Redis 배선.
 *
 * <p>{@code StringRedisTemplate} 은 Boot 오토컨피그가 준다 — 값이 전부 문자열(집합 원소·JSON 문자열)
 * 이라 직렬화기를 갈아 끼울 이유가 없다. 여기서 손으로 만드는 건 Pub/Sub 리스너 컨테이너 하나다.
 *
 * <p><b>리스너 컨테이너는 별도 스레드에서 돈다.</b> 그래서 여기서 받은 메시지를 처리하는 코드
 * ({@code ChatFanoutSubscriber})는 요청 스코프 빈이나 {@code SecurityContext} 같은 요청 문맥에
 * 기대면 안 된다 — 그 문맥이 없다.
 */
@Configuration
public class RedisConfig {

    /**
     * {@code chat:fanout} 구독을 연다.
     *
     * <p>이 빈이 없으면 다른 인스턴스가 보낸 말이 <b>아무 오류 없이</b> 이 인스턴스에 도착하지 않는다.
     * 인스턴스 한 대짜리 환경에서는 정상으로 보이므로, 이 배선이 빠졌다는 사실은 스케일아웃한 뒤
     * 운영에서야 드러난다({@code ChatFanoutIntegrationTest} 가 그 회귀를 잡는다).
     */
    @Bean
    public RedisMessageListenerContainer chatFanoutListenerContainer(RedisConnectionFactory connectionFactory,
            ChatFanoutSubscriber subscriber) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(subscriber, new ChannelTopic(RedisKeys.FANOUT_CHANNEL));
        return container;
    }
}
