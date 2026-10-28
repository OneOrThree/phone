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
 * 반대로 UNSUBSCRIBE 는 두 기록을 함께 지우므로, 해지 뒤 새로 구독하는 길은 막히지 않아야 한다.
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
        assertThat(forA).as("A 의 구독자 맵에 세션 키는 하나 — 결함을 잡는 단언은 아래 containsExactly(\"id1\")").hasSize(1);
        assertThat(forA.get(SESSION)).as("그 세션의 A 구독은 id1 하나 — 두 번 전송되지 않는다").containsExactly("id1");
        assertThat(broker.findSubscriptions(messageTo(destinationB))).as("B 는 거절돼 브로커에 닿지 않았다").isEmpty();
        assertThat(first).isTrue();
        assertThat(changed).as("같은 id 의 다른 목적지는 거절").isFalse();
        assertThat(other).as("다른 id 의 같은 목적지는 거절").isFalse();
    }

    @Test
    @DisplayName("UNSUBSCRIBE 뒤엔 같은 id 로 다른 목적지를, 비워진 목적지엔 다른 id 를 걸 수 있다 — 관문과 브로커 기록이 함께 지워진다")
    void resubscribeAfterUnsubscribeIsNotBlocked() {
        String destinationA = "/topic/islands/" + UUID.randomUUID() + "/focus";
        String destinationB = "/topic/islands/" + UUID.randomUUID() + "/focus";

        boolean first = subscribeThroughGate("id1", destinationA);
        unsubscribeThroughGate("id1");
        boolean changed = subscribeThroughGate("id1", destinationB); // 해지했으니 같은 id 를 새 목적지에
        boolean other = subscribeThroughGate("id2", destinationA); // A 는 더 이상 묶여 있지 않다

        assertThat(first).isTrue();
        assertThat(changed).as("해지 뒤 같은 id 의 다른 목적지는 통과").isTrue();
        assertThat(other).as("해지로 비워진 목적지에 다른 id 는 통과").isTrue();
        assertThat(broker.findSubscriptions(messageTo(destinationA)).get(SESSION))
                .as("A 의 구독자는 id2 하나 — 해지한 id1 이 브로커에 남지 않았다").containsExactly("id2");
        assertThat(broker.findSubscriptions(messageTo(destinationB)).get(SESSION))
                .as("B 의 구독자는 id1 하나").containsExactly("id1");
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
        // 사전 단언 — 프레임 형식이 틀려 registerSubscription 이 조용히 무시되면 브로커 상태 단언이 공회전한다.
        assertThat(broker.findSubscriptions(messageTo(destination))).as("관문이 통과시킨 구독은 브로커에 등록된다").isNotEmpty();
        return true;
    }

    /** UNSUBSCRIBE — 관문의 기록과 브로커 레지스트리를 함께 지운다(실서비스 인바운드 체인과 같다). */
    private void unsubscribeThroughGate(String subscriptionId) {
        gate.unsubscribe(SESSION, subscriptionId);
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.UNSUBSCRIBE);
        accessor.setSessionId(SESSION);
        accessor.setSubscriptionId(subscriptionId);
        broker.unregisterSubscription(MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders()));
    }

    private static Message<byte[]> messageTo(String destination) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.MESSAGE);
        accessor.setSessionId(SESSION);
        accessor.setDestination(destination);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }
}
