package com.oneorthree.realtime.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.broker.DefaultSubscriptionRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.util.MultiValueMap;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 관문의 구독 기록({@link RealtimeSessionRegistry})과 브로커 레지스트리({@link DefaultSubscriptionRegistry})의 정합 —
 * 관문이 통과시킨 SUBSCRIBE 만 브로커로 가므로, 두 기록이 어긋나면 한 세션이 같은 사건을 두 번 받는다(GROMO-2210).
 *
 * <p>브로커는 같은 id 의 두 번째 등록을 {@code putIfAbsent} 로 무시해 옛 목적지를 유지한다. 관문이 id 의 목적지를
 * 바꿔 끼우면 «id1 은 B» 로 알고 있어 다른 id 의 A 구독을 통과시키는데, 브로커에는 id1 이 여전히 A 라 A 에 둘이 걸린다.
 */
class SubscriptionRegistryConsistencyTest {

    private static final String SESSION = "socket-1";

    private final RealtimeSessionRegistry gate = new RealtimeSessionRegistry();
    private final DefaultSubscriptionRegistry broker = new DefaultSubscriptionRegistry();

    @Test
    @DisplayName("같은 id 로 목적지를 바꾼 구독이 거절되면 그 목적지의 다른 id 구독도 거절돼 브로커에는 처음 id 하나만 남는다")
    void idDestinationChangeLeavesOnlyTheFirstIdOnTheBroker() {
        String destinationA = "/topic/islands/" + UUID.randomUUID() + "/focus";
        String destinationB = "/topic/islands/" + UUID.randomUUID() + "/focus";

        boolean first = subscribeThroughGate("id1", destinationA);
        boolean changed = subscribeThroughGate("id1", destinationB); // 같은 id 의 다른 목적지
        boolean other = subscribeThroughGate("id2", destinationA); // A 는 id1 이 이미 들고 있다

        // 브로커 상태가 이 테스트의 본 단언이다 — 관문이 바꿔 끼우면 id2 가 통과해 A 에 [id2, id1] 둘이 걸린다.
        MultiValueMap<String, String> forA = broker.findSubscriptions(messageTo(destinationA));
        assertThat(forA).as("A 의 구독자는 이 세션 하나").hasSize(1);
        assertThat(forA.get(SESSION)).as("그 세션의 A 구독은 id1 하나 — 두 번 전송되지 않는다").containsExactly("id1");
        assertThat(broker.findSubscriptions(messageTo(destinationB))).as("B 는 거절돼 브로커에 닿지 않았다").isEmpty();
        assertThat(first).isTrue();
        assertThat(changed).as("같은 id 의 다른 목적지는 거절").isFalse();
        assertThat(other).as("다른 id 의 같은 목적지는 거절").isFalse();
    }

    /** 실서비스 인바운드 체인과 같은 순서 — 관문이 통과시킨 SUBSCRIBE 만 브로커 레지스트리에 등록한다. */
    private boolean subscribeThroughGate(String subscriptionId, String destination) {
        if (!gate.subscribe(SESSION, subscriptionId, destination)) {
            return false;
        }
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        accessor.setSessionId(SESSION);
        accessor.setSubscriptionId(subscriptionId);
        accessor.setDestination(destination);
        broker.registerSubscription(MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders()));
        return true;
    }

    private static Message<byte[]> messageTo(String destination) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.MESSAGE);
        accessor.setSessionId(SESSION);
        accessor.setDestination(destination);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }
}
