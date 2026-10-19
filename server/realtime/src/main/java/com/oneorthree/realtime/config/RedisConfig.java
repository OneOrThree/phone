package com.oneorthree.realtime.config;

import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.event.RealtimeEventFanoutSubscriber;
import com.oneorthree.realtime.fanout.ChatFanoutSubscriber;
import com.oneorthree.realtime.movement.stomp.MovementCluster;
import com.oneorthree.realtime.sea.SeaRoomPublisher;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import java.util.List;

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
     * {@code chat:fanout}(채팅)과 {@code chat:events:v1}(섬 사건) 구독을 연다.
     *
     * <p>이 빈이 없으면 다른 인스턴스가 보낸 말·사건이 <b>아무 오류 없이</b> 이 인스턴스에 도착하지
     * 않는다. 인스턴스 한 대짜리 환경에서는 정상으로 보이므로, 이 배선이 빠졌다는 사실은 스케일아웃한
     * 뒤 운영에서야 드러난다({@code TwoInstanceFanoutTest} 가 그 회귀를 잡는다).
     *
     * <p>컨테이너는 하나만 둔다 — 채널마다 컨테이너를 만들면 채널 수만큼 Redis 연결과 스레드 풀이
     * 늘어나는데, 두 채널의 수명과 실패 방식이 같아서 나눌 이유가 없다.
     */
    @Bean
    public RedisMessageListenerContainer chatFanoutListenerContainer(RedisConnectionFactory connectionFactory,
            ChatFanoutSubscriber subscriber, RealtimeEventFanoutSubscriber eventSubscriber,
            SeaRoomPublisher seaSubscriber) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(subscriber, new ChannelTopic(RedisKeys.FANOUT_CHANNEL));
        container.addMessageListener(eventSubscriber, new ChannelTopic(RedisKeys.EVENT_FANOUT_CHANNEL));
        container.addMessageListener(seaSubscriber, new ChannelTopic(RedisKeys.SEA_FANOUT_CHANNEL)); // 바다 방(GROMO-2300)
        return container;
    }

    /**
     * 섬 이동 다중 인스턴스 릴레이(GROMO-2339)의 <b>전용</b> 수신 컨테이너 — 플래그가 켜졌을 때만 생긴다(기본 ON, 값이 없어도
     * ON — 옵트아웃 false 면 SUBSCRIBE 도 없다). 위 컨테이너와 나누는 이유는 순서다: 받은 프레임을 {@link MovementCluster} 의 1스레드 실행기로만 처리해야 소유자가
     * 낸 순서 그대로 세션에 들어간다. 채팅 컨테이너의 실행기를 같이 쓰면 그 순서가 채팅 처리와 섞여 깨진다.
     */
    @Bean
    @ConditionalOnProperty(name = "realtime.movement.multi-instance.enabled", havingValue = "true",
            matchIfMissing = true)
    public RedisMessageListenerContainer movementRelayListenerContainer(RedisConnectionFactory connectionFactory,
            MovementCluster cluster) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.setTaskExecutor(cluster.relayInExecutor());
        container.addMessageListener(cluster, List.of(new ChannelTopic(RedisKeys.MOVEMENT_CMD_CHANNEL),
                new ChannelTopic(RedisKeys.MOVEMENT_FRAMES_CHANNEL)));
        return container;
    }
}
