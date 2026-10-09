package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.common.exception.DomainException;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.config.StompTopics;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import com.oneorthree.realtime.movement.MovementRooms;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;

/**
 * 이동 구독의 수명 — movement 구독 = 방 입장, UNSUBSCRIBE·소켓 종료 = 퇴장(N6), 주민 사건 = 멤버십 재검사(N7).
 *
 * <h2>왜 {@code SessionSubscribeEvent} 가 아니라 인바운드 인터셉터인가</h2>
 * 이 서비스는 {@code setPreserveReceiveOrder(true)} 라 인바운드가 {@code OrderedMessageChannelDecorator} 를 탄다.
 * 그 데코레이터의 {@code send} 는 프레임을 큐에 넣고 <b>항상 true</b> 를 돌려주므로, Spring 은 관문
 * ({@code StompAuthChannelInterceptor})이 그 SUBSCRIBE 를 <b>거절했더라도</b>, 심지어 관문이 아직 돌기도 전에
 * {@code SessionSubscribeEvent} 를 발행한다. 그 이벤트로 입장시키면 비멤버도 방에 들어가 다른 주민에게
 * FullState 가 나간다. 그래서 인바운드 채널에서 <b>관문 바로 뒤</b>({@code WebSocketConfig})에 서서, 관문이
 * 통과시킨 프레임만, 세션의 수신 순서 그대로 본다.
 *
 * <h2>소켓 종료와의 경합 — 유령 actor</h2>
 * 순서 보존 큐에 남은 SUBSCRIBE 는 소켓이 닫히고 정리가 끝난 <b>뒤에도</b> 처리될 수 있다(종료 쪽 DISCONNECT 는
 * 그 큐를 거치지 않는다). 그때 입장시키면 아무도 내보내지 않는 actor 가 방에 영영 남는다. 그래서 구독 처리와
 * 종료 정리를 <b>세션별 {@code compute} 하나로 직렬화</b>하고, 구독 쪽은 그 안에서
 * {@link RealtimeSessionRegistry#isConnected} 를 본다. 정리는 {@code WebSocketConfig} 가 소켓 기록을 지운
 * <b>직후</b>({@link #closed}) 돌므로, 정리보다 늦은 구독은 반드시 «끊긴 세션»을 보고 물러난다.
 */
@Slf4j
@Component
public class MovementSubscriptionListener implements ChannelInterceptor {

    private final MovementRooms rooms;
    private final MovementPublisher publisher;
    private final RealtimeSessionRegistry sessions;
    private final ChatAccessGuard accessGuard;

    /** sessionId → (islandId → outbox). 이 맵의 {@code compute} 가 세션별 잠금이다. */
    private final ConcurrentHashMap<String, Map<UUID, MovementOutbox>> bySession = new ConcurrentHashMap<>();

    public MovementSubscriptionListener(MovementRooms rooms, MovementPublisher publisher,
            RealtimeSessionRegistry sessions, ChatAccessGuard accessGuard) {
        this.rooms = rooms;
        this.publisher = publisher;
        this.sessions = sessions;
        this.accessGuard = accessGuard;
    }

    /** 관문이 통과시킨 SUBSCRIBE·UNSUBSCRIBE 만 여기 온다(관문이 null 을 돌려주면 체인이 멈춘다). */
    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getSessionId() == null) {
            return message;
        }
        if (StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
            subscribed(accessor);
        } else if (StompCommand.UNSUBSCRIBE.equals(accessor.getCommand())) {
            unsubscribed(accessor.getSessionId(), accessor.getSubscriptionId());
        }
        return message;
    }

    private void subscribed(StompHeaderAccessor accessor) {
        String destination = accessor.getDestination();
        Matcher topic = destination == null ? null : StompTopics.MOVEMENT_TOPIC.matcher(destination);
        if (topic == null || !topic.matches() || !(accessor.getUser() instanceof ChatPrincipal principal)) {
            return;
        }
        String subscriptionId = accessor.getSubscriptionId();
        if (subscriptionId == null) {
            return; // id 없는 구독은 UNSUBSCRIBE·종료 정리로 찾을 수 없다 — 들이면 내보낼 길이 없다.
        }
        UUID islandId = UUID.fromString(topic.group(1));
        boolean snapshot = topic.group(2) != null;
        bySession.compute(accessor.getSessionId(), (sessionId, held) -> {
            if (!sessions.isConnected(sessionId)) {
                return held; // 정리가 이미 지나간 세션의 늦은 프레임 — 들이면 아무도 내보내지 않는다.
            }
            Map<UUID, MovementOutbox> outboxes = held != null ? held : new HashMap<>();
            MovementOutbox outbox = outboxes.computeIfAbsent(islandId,
                    id -> publisher.open(id, sessionId, principal.userId()));
            if (snapshot) {
                outbox.subscribeSnapshot(subscriptionId);
                return outboxes;
            }
            outbox.subscribeMovement(subscriptionId);
            // 같은 사용자의 다른 세션(다른 기기)은 actor 를 넘겨준다 — 그쪽엔 더 보내지 않는다(N6).
            for (MovementOutbox other : publisher.outboxes(islandId)) {
                if (other != outbox && other.userId().equals(principal.userId())) {
                    other.supersede();
                }
            }
            // join 다음 requestFullState — 방 큐가 FIFO 라 이 세션의 첫 FullState 가 자기 actor 를 담는다.
            rooms.join(islandId, principal.userId(), sessionId);
            rooms.requestFullState(islandId, sessionId);
            return outboxes;
        });
    }

    private void unsubscribed(String sessionId, String subscriptionId) {
        bySession.computeIfPresent(sessionId, (id, held) -> {
            held.entrySet().removeIf(entry -> {
                MovementOutbox outbox = entry.getValue();
                if (outbox.unsubscribeMovement(subscriptionId)) {
                    rooms.leave(entry.getKey(), id);
                }
                outbox.unsubscribeSnapshot(subscriptionId);
                if (outbox.hasSubscriptions()) {
                    return false;
                }
                publisher.close(entry.getKey(), id);
                return true;
            });
            return held.isEmpty() ? null : held;
        });
    }

    /**
     * 소켓 종료 — 그 세션이 든 방 전부에서 퇴장. {@code WebSocketConfig} 가 {@link RealtimeSessionRegistry#closed}
     * <b>직후</b>에 부른다(순서가 유령 actor 방지의 전제다, 클래스 설명).
     */
    public void closed(String sessionId) {
        if (sessionId == null) {
            return;
        }
        bySession.computeIfPresent(sessionId, (id, held) -> {
            held.forEach((islandId, outbox) -> leaveAndClose(islandId, id, outbox));
            return null;
        });
    }

    /**
     * {@code island.members.updated} 를 받은 섬의 이동 세션 멤버십을 다시 본다(N7) — 비멤버로 확정된 세션은 방에서
     * 내보내고 더 보내지 않는다(구독 자체는 끊지 않는다, 1단계). 판정을 못 내리면(상류 장애) 남긴다 — 일시 장애로
     * 섬 사람 전원을 내보내지 않는다.
     *
     * <p>멤버십 조회(Redis·HTTP)는 세션 잠금 <b>밖</b>에서 한다. 이 메서드는 던지지 않는다 — 호출자
     * ({@code InboundEventService})의 수신 기록 트랜잭션을 되돌리면 안 된다.
     */
    public void recheckMembership(UUID islandId) {
        for (MovementOutbox outbox : publisher.outboxes(islandId)) {
            ChatPrincipal principal = sessions.find(outbox.sessionId());
            if (principal == null) {
                continue; // 이미 끊긴 세션 — 소켓 종료 정리가 맡는다.
            }
            try {
                accessGuard.requireMember(islandId, principal.userId(), principal.bearer());
            } catch (DomainException e) {
                if (e.getErrorCode() == ChatErrorCode.NOT_A_MEMBER) {
                    revoke(islandId, outbox.sessionId());
                } else {
                    log.debug("이동 멤버십 재검사 보류 — code={}", e.getErrorCode().name());
                }
            } catch (RuntimeException e) {
                log.warn("이동 멤버십 재검사 실패 — 남겨 둔다. reason={}", e.getClass().getSimpleName());
            }
        }
    }

    private void revoke(UUID islandId, String sessionId) {
        bySession.computeIfPresent(sessionId, (id, held) -> {
            MovementOutbox outbox = held.remove(islandId);
            if (outbox != null) {
                leaveAndClose(islandId, id, outbox);
            }
            return held.isEmpty() ? null : held;
        });
    }

    /** outbox 를 먼저 떼고 나서 퇴장시킨다 — 퇴장이 내는 FullState 가 떠나는 세션에 가지 않는다. */
    private void leaveAndClose(UUID islandId, String sessionId, MovementOutbox outbox) {
        boolean joined = outbox.hasMovement();
        publisher.close(islandId, sessionId);
        if (joined) {
            rooms.leave(islandId, sessionId);
        }
    }
}
