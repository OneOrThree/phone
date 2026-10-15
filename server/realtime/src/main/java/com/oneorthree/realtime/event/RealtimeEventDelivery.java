package com.oneorthree.realtime.event;

import com.oneorthree.realtime.common.redis.RedisKeys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * 섬 사건을 <b>구독자 전원</b>에게 민다 — 이 인스턴스에 붙은 사람과, 다른 인스턴스에 붙은 사람
 * ({@code DisabledRealtimeDelivery} 를 대체한다, GROMO-1765).
 *
 * <h2>왜 Kafka 소비 그룹이 아니라 Redis Pub/Sub 인가</h2>
 * Data 사건은 HTTP({@code POST /internal/events}) 또는 Kafka 로 들어오는데, <b>둘 다 한 인스턴스만</b>
 * 받는다(HTTP 는 로드밸런서가 하나를 고르고, Kafka 는 소비 그룹이 {@code realtime-v1} 하나다). 그대로
 * 두면 다른 인스턴스에 붙은 구독자는 아무것도 못 받는다 — 그리고 <b>그 고장은 인스턴스가 한 대인
 * 개발·CI 에서는 절대 재현되지 않는다</b>.
 *
 * <p>고치는 길은 둘이다. ① Kafka 소비 그룹을 인스턴스별로 갈라 모든 인스턴스가 모든 사건을 받게 하거나,
 * ② 받은 인스턴스가 Redis 로 다시 퍼뜨리거나. <b>②를 쓴다.</b> ①은 HTTP 입구를 고쳐 주지 못해서
 * (HTTP 는 여전히 한 대만 받는다) 결국 ②가 또 필요하고, 인스턴스마다 그룹 이름을 유일하게 만드는 부담과
 * 소비자 그룹 수가 인스턴스 수만큼 늘어나는 운영 비용이 따라온다. ②는 두 입구를 한 번에 덮고, 채팅이
 * 이미 같은 방식으로 돌고 있으며({@code ChatFanout}), LLD §3.1 이 지정한 계약이기도 하다.
 *
 * <h2>수신 자격이 구독 인가보다 좁은 채널</h2>
 * 응원은 「그 섬에서 <b>지금</b> 진행 중인 주민」만 받는다. 그 집합은 발신 때 이미 치른 Data 정본 조회
 * ({@code IslandFocusSessions})에서 그대로 나오므로, <b>추가 조회 없이</b> 메시지 헤더로 실어 전달
 * 직전 판정의 근거로 쓴다({@link #RECIPIENTS_HEADER}). 구독자마다 정본을 다시 묻는 방식(구독자 수 ×
 * HTTP)을 쓰지 않는 이유이고, realtime-events LLD §4.2 의 「배치 권한조회」가 이것이다.
 *
 * <h2>전달 실패는 «둘 다» 삼킨다</h2>
 * 로컬 전달을 먼저 하고 Redis 발행을 나중에 한다 — 순서를 뒤집으면 Redis 장애가 곧 전면 정지다.
 * 어느 쪽이 실패해도 예외를 올리지 않는다: 이 메서드는 {@code InboundEventService} 의 트랜잭션 안에서
 * 불리므로 여기서 던지면 <b>수신 기록까지 롤백돼 relay 가 같은 사건을 계속 재전달한다</b>. 전달은
 * 「지금 붙어 있는 사람에게만 의미 있는」 신호라 복구 정본은 REST 스냅샷이다(realtime-events LLD §6).
 */
@Slf4j
@Component
public class RealtimeEventDelivery implements RealtimeDelivery {

    private final SimpMessagingTemplate messagingTemplate;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    /**
     * 수신 집합을 들고 있는 시간.
     *
     * <p><b>필요한 길이는 밀리초</b>다 — 브로커가 그 사건의 프레임을 전부 펼치고 아웃바운드 채널이
     * 밀어낼 때까지면 충분하다. 그런데도 응원 TTL(3초)의 10배를 잡은 이유는 <b>비대칭</b> 때문이다:
     * 일찍 지우면 정상 응원이 <b>조용히 막히고</b>(fail-closed), 늦게 지우면 손해가 메모리뿐이다.
     * 줄이려면 아웃바운드 채널의 실제 적체 시간을 재고 그보다 크게 잡아라.
     *
     * <p>메시지 «헤더»로 실어 보내는 방법을 먼저 썼다가 되돌렸다: {@code SimpleBrokerMessageHandler} 가
     * 구독자별 메시지를 다시 만드는 과정에서 커스텀 헤더가 살아남지 않아 <b>전원이 fail-closed 로
     * 막혔다</b>(실측). 그래서 집합은 이 프로세스 안에 두고, 프레임에서는 <b>payload 의 eventId</b> 로
     * 되찾는다 — eventId 는 7필드 봉투의 필수 필드라 반드시 실려 있다.
     */
    private static final Duration RECIPIENTS_RETENTION = Duration.ofSeconds(30);

    /** 이 프로세스의 신원. 되돌아온 자기 발행을 알아보는 데만 쓴다. */
    private final UUID instanceId = UUID.randomUUID();

    /**
     * {@code eventId → (수신 집합, 만료)}. 수신 자격이 구독 인가보다 좁은 사건만 들어간다.
     * 클라이언트에는 절대 나가지 않는다.
     */
    private final Map<UUID, Recipients> recipientsByEvent = new ConcurrentHashMap<>();

    /**
     * 만료 순서대로 늘어선 같은 사건들 — <b>정리는 머리만 뗀다</b>.
     *
     * <p>보관 기간이 상수라 <b>삽입 순서 = 만료 순서</b>다. 그래서 앞에서부터 만료된 것만 떼면 되고,
     * 아직 살아 있는 머리를 만나는 순간 멈출 수 있다. 종전에는 넣을 때마다 맵 <b>전체</b>를
     * {@code removeIf} 로 훑었는데, 초당 R건이면 맵에 약 30R건이 남으므로 정리 비용이 O(R²)가 되어
     * <b>정상 부하에서도</b> 전달 경로가 만료 정리에 CPU를 쓴다. 지금은 삽입당 상각 O(1)이다.
     *
     * <p>유휴 상태에서는 다음 응원이 올 때까지 만료 항목이 남는다 — 크기가 마지막 버스트로 묶이므로
     * 별도 주기 청소를 두지 않는다(그걸 두면 스케줄러 하나를 더 운영해야 한다).
     */
    private final Queue<Expiry> expiries = new ConcurrentLinkedQueue<>();

    public RealtimeEventDelivery(SimpMessagingTemplate messagingTemplate, StringRedisTemplate redis,
            ObjectMapper objectMapper, Clock clock) {
        this.messagingTemplate = messagingTemplate;
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    /** 다른 인스턴스가 보낸 것인지 판정하기 위해 구독자가 읽는다. */
    public UUID instanceId() {
        return instanceId;
    }

    @Override
    public void deliver(RealtimeEventEnvelope event, RealtimeAudience audience, String destination) {
        if (!(audience instanceof RealtimeAudience.IslandAudience island)) {
            // 개인 큐(/user/queue/events)는 «아직» 열려 있지 않다 — STOMP 허용목록이 그 목적지를 거절하므로
            // 여기서 보내도 아무도 못 받는다. 조용히 성공한 척하지 않고 명시적으로 거절한다.
            throw new IllegalStateException("개인 이벤트 큐 전달은 아직 활성화되지 않았습니다.");
        }
        try {
            deliverLocally(destination, event, island.recipients());
        } catch (RuntimeException e) {
            // 이 인스턴스 구독자만 실시간으로 못 받는다. 무엇보다 여기서 멈추면 아래 Redis 발행에
            // 도달하지 못해 «다른 인스턴스까지» 못 받는다.
            log.error("섬 사건 로컬 전달 실패 — eventId={} type={}", event.eventId(), event.type().wireName(), e);
        }

        try {
            String payload = objectMapper.writeValueAsString(
                    new RealtimeEventFanoutEvent(instanceId, destination, event, island.recipients()));
            redis.convertAndSend(RedisKeys.EVENT_FANOUT_CHANNEL, payload);
        } catch (RuntimeException e) {
            log.error("섬 사건 팬아웃 발행 실패 — eventId={} type={}", event.eventId(), event.type().wireName(), e);
        }
    }

    /**
     * 이 프로세스에 붙어 있는 그 목적지 구독자에게 민다. 구독자가 없으면 조용히 버려진다.
     *
     * <p>{@code recipients} 가 비어 있지 않으면 헤더로 실어 보낸다 — 브로커는 그대로 구독자 전원에게
     * 펼치고, <b>거르는 것은 전달 직전의 {@code ChatOutboundChannelInterceptor}</b> 다. 여기서 직접
     * 개인 큐로 보내지 않는 이유는 클라이언트 계약이 {@code /topic/islands/{id}/emotes} 구독이기 때문이다.
     */
    void deliverLocally(String destination, RealtimeEventEnvelope event, Set<UUID> recipients) {
        if (!recipients.isEmpty()) {
            // 브로커가 프레임을 펼치기 «전에» 기록해야 한다 — 전달 직전 판정이 이걸 되읽는다.
            remember(event.eventId(), recipients);
        }
        messagingTemplate.convertAndSend(destination, event);
    }

    /**
     * 이 사건을 이 사람에게 내보내도 되는가 — {@code ChatOutboundChannelInterceptor} 가 프레임마다 묻는다.
     *
     * @return 기록이 없거나 만료됐으면 {@code false}. 보호 채널이므로 <b>모르면 거절</b>이다
     */
    public boolean mayReceive(UUID eventId, UUID userId) {
        Recipients recipients = recipientsByEvent.get(eventId);
        return recipients != null && recipients.expiresAt().isAfter(clock.instant())
                && recipients.users().contains(userId);
    }

    private void remember(UUID eventId, Set<UUID> recipients) {
        Instant now = clock.instant();
        recipientsByEvent.put(eventId, new Recipients(recipients, now.plus(RECIPIENTS_RETENTION)));
        expiries.add(new Expiry(eventId, now.plus(RECIPIENTS_RETENTION)));
        evictExpired(now);
    }

    /** 머리에서부터 만료된 것만 뗀다 — 살아 있는 머리를 만나면 즉시 멈춘다. */
    private void evictExpired(Instant now) {
        for (Expiry head = expiries.peek(); head != null && !head.expiresAt().isAfter(now);
                head = expiries.peek()) {
            if (!expiries.remove(head)) {
                // 다른 스레드가 먼저 뗐다 — 그 스레드가 맵도 정리한다.
                continue;
            }
            // 같은 eventId 가 다시 들어왔을 가능성은 없지만(랜덤 UUID), 값을 확인하고 지워
            // 「남의 최신 항목을 지우는」 경로를 아예 만들지 않는다.
            recipientsByEvent.computeIfPresent(head.eventId(),
                    (key, value) -> value.expiresAt().isAfter(now) ? value : null);
        }
    }

    /** 보관 중인 사건 수 — 만료 정리가 실제로 도는지 보는 회귀 전용이다. */
    int retainedEvents() {
        return recipientsByEvent.size();
    }

    private record Recipients(Set<UUID> users, Instant expiresAt) {
    }

    private record Expiry(UUID eventId, Instant expiresAt) {
    }
}
