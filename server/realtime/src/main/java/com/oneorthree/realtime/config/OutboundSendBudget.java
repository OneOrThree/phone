package com.oneorthree.realtime.config;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.binder.jvm.ExecutorServiceMetrics;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageHandler;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.ExecutorChannelInterceptor;
import org.springframework.messaging.support.MessageHandlingRunnable;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.RejectedExecutionHandler;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

import static com.oneorthree.realtime.config.StompTopics.MOVEMENT_TOPIC;

/**
 * 아웃바운드 송신 예산 (GROMO-2340) — {@code clientOutboundChannel} 실행기의 크기·포화 정책과 송신 지표.
 *
 * <h2>왜 유한 큐인가</h2>
 * Spring 기본은 core = CPU×2, max = queue = {@code Integer.MAX_VALUE} 다. 느린 수신자·프레임당 상류 조회가 실행기를
 * 붙잡으면 대기 작업이 끝없이 쌓여(조사: 채팅 50명×10Hz 에서 13,724작업) 힙과 지연이 함께 무너진다. 유한 큐는 그
 * 순간을 «거부»로 드러내 아래 정책으로 넘긴다.
 *
 * <h2>포화 정책 — 프레임을 조용히 빼먹지 않는다</h2>
 * 거부된 프레임의 세션을 1008 {@link #QUEUE_FULL} 로 닫는다 — 종류를 가리지 않는다. 채팅 본문은 DB 에 있으므로 앱은 재연결
 * 뒤 이력 조회로 메우고, 이동은 재구독의 첫 FullState 로 다시 맞춘다(종료가 {@code MovementSubscriptionListener#closed} 로
 * outbox 를 치운다). 세션을 살려 둔 채 한 건을 빼먹으면 채팅은 구멍이, 이동은 순서·상태 어긋남이 남는다.
 *
 * <p><b>가해 세션을 먼저 닫는다.</b> 큐는 전역 하나라 넘친 프레임의 세션이 꼭 가해자는 아니다 — 느린 소켓 하나가 큐를 채우면
 * 멀쩡한 세션이 넘침을 맞는다. 그래서 세션별 대기 프레임 수(실행 중 포함)를 세어 두고, 거부되면 <b>가장 많이 점유한 세션(종료
 * 예약 제외)을 먼저</b> 닫은 뒤 넘친 세션도 닫는다(둘 다 잃은 프레임은 재연결 복구). 세는 곳은 실행기의 작업 장식기다 —
 * 인터셉터의 {@code preSend}/{@code beforeHandle} 쌍은 앞선 인터셉터가 프레임을 버리면 {@code beforeHandle} 이 안 불려 샌다.
 * 장식기는 Spring 이 작업을 실행기에 넣는 «그 순간» 한 번 세고, 작업이 끝나거나 거부되면 반드시 뺀다.
 *
 * <p><b>예외를 던지지 않는다.</b> Spring 7 의 {@code ExecutorSubscribableChannel} 은 거부({@code RejectedExecutionException})를
 * 받으면 그 작업을 <b>보낸 스레드에서 바로 실행</b>한다(종료 중을 가정한 폴백). 던지면 포화 순간의 소켓 쓰기가 브로커·틱
 * 스레드로 넘어가 막힌 소켓이 그 스레드를 잡는다 — 그래서 이동도 {@code MovementOutbox} 의 넘기기 실패 경로로 돌려줄 수
 * 없다(그쪽은 거부를 보지 못한다). 실행기가 종료 중일 때만 던져 그 폴백을 탄다.
 *
 * <h2>종료 예약 = 즉시 전달 차단</h2>
 * 거부된 세션은 {@code closing} 에 들어가는 «그 순간»부터 어떤 프레임도 받지 않는다 — 큐에 넣기 전({@link #preSend})과 이미
 * 큐에 있던 것({@link #beforeHandle}) 두 곳에서 버리고 {@code dropped{reason=closing}} 으로 센다. 실제 소켓 종료가 늦어져도
 * 「거부된 프레임을 빼먹은 채 다음 채팅을 정상처럼 받는」 창이 없다 — 종료가 늦는 동안 그 세션은 조용할 뿐이고, 앱은 종료를
 * 받은 뒤 재연결·이력으로 메운다. 항목은 소켓 종료 경로({@link #closed})가 지운다(종료 시도 뒤 이미 끊겨 있으면 그때도).
 *
 * <p><b>종료 실패는 1회 재시도한다.</b> 첫 close 가 실패하면 예약을 유지한 채(전달 차단 유지) 한 번 더 닫는다. 그래도 실패하면
 * 예약을 풀고 WARN 을 남긴다 — 풀지 않으면 heartbeat 는 사는데 전달만 영구히 막힌 좀비가 된다. 그 대가로 <b>이 경로에서만</b>
 * 이미 버린 프레임 뒤를 정상처럼 받을 수 있다(채팅 한 건 구멍은 앱 sync·이력으로, 이동은 in-flight 워치독 15s 로 복구). 풀린
 * 세션은 다음 거부에서 다시 예약된다.
 *
 * <p>소켓 종료는 전용 2스레드({@code realtime-outbound-close})에서 한다 — 거부는 브로커·인바운드 스레드에서 일어나므로 그
 * 스레드에서 닫지 않는다. close 는 블로킹이다: Spring {@code StandardWebSocketSession.close} → Tomcat 11
 * {@code WsSession.close} → {@code sendCloseMessage} 가 close 프레임을 {@code sendMessageBlock} 으로 쓴다. 1000 이 아닌
 * 코드(여기는 1008)는 {@code ABNORMAL_SESSION_CLOSE_SEND_TIMEOUT}(기본 50ms) 안에 진행 중 쓰기 세마포어·쓰기를 못 끝내면
 * 연결을 끊는다 — 그래서 한 건의 상한은 수십 ms 다. 그래도 밀리면 종료가 늦어질 뿐, 위 차단이 보장을 유지한다.
 *
 * <h2>지표</h2>
 * <ul>
 *   <li>{@code executor.*{name=realtime-outbound}} — {@link ExecutorServiceMetrics} 표준
 *       (큐 깊이 = {@code executor.queued}).</li>
 *   <li>{@code realtime.outbound.dropped{reason=queue_full|session_limit|closing}} — {@code closing} 은 종료 예약된 세션으로
 *       가다 버린 프레임. {@code session_limit} 은 Spring 의 세션 송신
 *       시간({@code send-time-limit-ms})·버퍼({@code send-buffer-size-limit-bytes}) 상한 초과로 닫힌 세션이다. Spring 은 둘을
 *       같은 4500 {@code SESSION_NOT_RELIABLE} 로 닫아 구분할 수 없다(CONNECT 없이 60초 지난 세션 정리도 같은 코드다).</li>
 *   <li>{@code realtime.outbound.closed{selected=offender|overflow}} — 포화로 닫은 세션. {@code offender} 는 최대 점유
 *       세션(먼저), {@code overflow} 는 넘친 프레임의 세션. 최대 점유 세션이 곧 넘친 세션이면 {@code overflow} 만 센다.</li>
 *   <li>{@code realtime.outbound.send{destination_kind=chat|movement|events|sea|other}} — 실행기가 꺼낸 뒤 소켓
 *       핸들러가 프레임을 쓰는 시간. 이 인터셉터가 체인 «맨 뒤»라 전달 직전 인가 시간은 들어가지 않는다.</li>
 * </ul>
 */
@Slf4j
@Component
public class OutboundSendBudget implements ExecutorChannelInterceptor, RejectedExecutionHandler {

    /** 아웃바운드 큐가 차서 이 세션의 프레임을 버렸다 — 앱은 재연결해 이력으로 메운다. */
    static final CloseStatus QUEUE_FULL = CloseStatus.POLICY_VIOLATION.withReason("OUTBOUND_QUEUE_FULL");

    static final String EXECUTOR_NAME = "realtime-outbound";

    private static final List<String> KINDS = List.of("chat", "movement", "events", "sea", "other");

    private final RealtimeSessionRegistry sessions;
    private final MeterRegistry meterRegistry;
    private final int coreThreads;
    private final int maxThreads;
    private final int queueCapacity;
    private final Counter queueFull;
    private final Counter sessionLimit;
    private final Counter closingDropped;
    private final Counter closedOffender;
    private final Counter closedOverflow;
    /** 세션별 대기(실행 중 포함) 프레임 수 — 0 이 되면 항목을 지운다. */
    private final Map<String, Integer> pending = new ConcurrentHashMap<>();
    private final Map<String, Timer> sendTimers;
    private final ThreadLocal<Long> handleStart = new ThreadLocal<>();
    private final Set<String> closing = ConcurrentHashMap.newKeySet();
    /**
     * 가해자로 예약했고 아직 끝나지 않은 세션(단일 슬롯) — 비어 있을 때만 새 가해자를 고른다. 확인과 점유가 한 번의
     * {@code compareAndSet} 이라 동시 거부가 둘을 고르지 못한다. 가해자의 소켓이 닫히고 큐의 그 프레임이
     * 빠지기 전(close ≤ 50ms, closer 가 막히면 더)에는 큐가 여전히 가득이라, 그동안의 거부마다 «프레임을 잃지 않은 다음
     * 최대 점유 세션»이 연쇄로 가해자가 되는 걸 막는다.
     * ponytail: 한 번에 가해자 하나 — 가해자가 둘 이상 필요한 포화(여럿이 동시에 느림)는 가해자 종료 뒤 다음 거부에서 하나씩
     * 처리된다. 종료가 늦는 동안엔 넘친 세션만 닫힌다. 병렬 선별이 필요하면 점유 비율 기준으로 올린다.
     */
    private final AtomicReference<Offender> offender = new AtomicReference<>();
    /**
     * 슬롯 만료 — close 한 건의 상한은 수십 ms(Tomcat 50ms)이고 closer 가 밀려도 수 초면 끝난다. 그 몇 배인 10초가 지나도
     * {@code closed} 콜백이 없으면(close 는 true 인데 콜백이 영영 안 오는 경우) 슬롯이 영구히 차 가해자 선별이 멈추므로 만료로 본다.
     */
    long offenderTtlNanos = TimeUnit.SECONDS.toNanos(10);
    private final ExecutorService closer = Executors.newFixedThreadPool(2, daemon("realtime-outbound-close"));

    /**
     * @param coreThreads 0 이면 CPU×2(Spring 기본)
     * @param maxThreads 0 이면 core 와 같다 — 유한 큐에서 max 를 core 보다 크게 두면 큐가 찬 «뒤»에야 늘어난다
     */
    public OutboundSendBudget(RealtimeSessionRegistry sessions, MeterRegistry meterRegistry,
            @Value("${chat.websocket.outbound.core-threads:0}") int coreThreads,
            @Value("${chat.websocket.outbound.max-threads:0}") int maxThreads,
            @Value("${chat.websocket.outbound.queue-capacity:10000}") int queueCapacity) {
        if (queueCapacity <= 0) {
            throw new IllegalArgumentException("chat.websocket.outbound.queue-capacity 는 1 이상이어야 합니다.");
        }
        this.sessions = sessions;
        this.meterRegistry = meterRegistry;
        this.coreThreads = coreThreads > 0 ? coreThreads : Runtime.getRuntime().availableProcessors() * 2;
        this.maxThreads = Math.max(this.coreThreads, maxThreads);
        this.queueCapacity = queueCapacity;
        this.queueFull = dropped("queue_full");
        this.sessionLimit = dropped("session_limit");
        this.closingDropped = dropped("closing");
        this.closedOffender = closedCounter("offender");
        this.closedOverflow = closedCounter("overflow");
        this.sendTimers = KINDS.stream().collect(Collectors.toUnmodifiableMap(kind -> kind,
                kind -> Timer.builder("realtime.outbound.send").tag("destination_kind", kind)
                        .description("아웃바운드 프레임의 소켓 쓰기 시간").publishPercentileHistogram()
                        .register(meterRegistry)));
    }

    private Counter dropped(String reason) {
        return Counter.builder("realtime.outbound.dropped").tag("reason", reason)
                .description("아웃바운드 예산 초과로 버린 프레임·닫힌 세션").register(meterRegistry);
    }

    private Counter closedCounter(String selected) {
        return Counter.builder("realtime.outbound.closed").tag("selected", selected)
                .description("큐 포화로 닫은 세션 — offender 는 최대 점유 세션, overflow 는 넘친 프레임의 세션").register(meterRegistry);
    }

    /**
     * {@code clientOutboundChannel} 실행기. 컨테이너가 빈({@code clientOutboundChannelExecutor})으로 초기화·종료한다 —
     * 여기서 {@code initialize()} 를 부르면 두 번 만들어진다. 지표는 초기화되는 순간 묶는다.
     */
    ThreadPoolTaskExecutor newExecutor() {
        ThreadPoolTaskExecutor executor = new MeteredExecutor(meterRegistry);
        executor.setThreadNamePrefix(EXECUTOR_NAME + "-");
        executor.setCorePoolSize(coreThreads);
        executor.setMaxPoolSize(maxThreads);
        executor.setQueueCapacity(queueCapacity);
        executor.setRejectedExecutionHandler(this);
        executor.setTaskDecorator(this::count);
        return executor;
    }

    /** 작업을 세션별로 센다 — 실행기에 들어가는 순간 +1, 끝나거나({@code run}) 거부되면 -1. */
    private Runnable count(Runnable task) {
        if (!(task instanceof MessageHandlingRunnable handling)) {
            return task;
        }
        String sessionId = SimpMessageHeaderAccessor.getSessionId(handling.getMessage().getHeaders());
        if (sessionId == null) {
            return task;
        }
        pending.merge(sessionId, 1, Integer::sum);
        return new CountedTask(handling, sessionId);
    }

    private void uncount(String sessionId) {
        pending.computeIfPresent(sessionId, (id, n) -> n > 1 ? n - 1 : null);
    }

    /** 장식된 작업 — {@link MessageHandlingRunnable} 을 구현해 {@link #rejectedExecution} 이 메시지를 그대로 읽는다. */
    private final class CountedTask implements MessageHandlingRunnable {

        private final MessageHandlingRunnable delegate;
        private final String sessionId;

        CountedTask(MessageHandlingRunnable delegate, String sessionId) {
            this.delegate = delegate;
            this.sessionId = sessionId;
        }

        @Override
        public Message<?> getMessage() {
            return delegate.getMessage();
        }

        @Override
        public MessageHandler getMessageHandler() {
            return delegate.getMessageHandler();
        }

        @Override
        public void run() {
            try {
                delegate.run();
            } finally {
                uncount(sessionId);
            }
        }
    }

    @Override
    public void rejectedExecution(Runnable task, ThreadPoolExecutor executor) {
        if (executor.isShutdown()) {
            // 종료 중이라 uncount 를 건너뛰어도 무해하다(카운터가 곧 버려진다) — Spring 의 «보낸 스레드에서 실행» 폴백을 탄다.
            throw new RejectedExecutionException("아웃바운드 실행기 종료 중");
        }
        queueFull.increment();
        Message<?> message = task instanceof MessageHandlingRunnable handling ? handling.getMessage() : null;
        String destination = message == null ? null : SimpMessageHeaderAccessor.getDestination(message.getHeaders());
        String sessionId = message == null ? null : SimpMessageHeaderAccessor.getSessionId(message.getHeaders());
        // 이미 종료 예약된 세션의 뒤늦은 거부(같은 세션의 동시 송신이 preSend 를 먼저 통과했다)는 추가 대상을 고르지 않는다 —
        // 고르면 프레임을 잃지 않은 정상 세션이 연쇄로 닫힌다. add 가 원자적이라 동시 거부 중 하나만 fresh 다.
        // 이미 끊긴 세션의 거부도 선별하지 않는다 — 소켓 종료 콜백(closed)이 먼저 끝나 예약이 지워진 뒤 브로커의 DISCONNECT_ACK 가
        // 포화 큐에서 거부되면 «새 거부»로 보여 다른 세션을 가해자로 닫고, 그 종료 ACK 가 또 거부돼 연쇄된다. 끊긴 세션은
        // closing 에 넣지도 않는다(넣으면 closer 가 헛도는 close 를 한다).
        // DISCONNECT_ACK 는 가해자를 고르지 않는다 — WebSocketConfig.afterConnectionClosed 는 super 를 마친 «뒤에야»
        // sessions.closed 를 부르므로 그 사이 거부되면 닫힌 소켓도 isConnected 가 true 라 정상 세션을 가해자로 잘못 고른다.
        // 그렇다고 버리기만 하면 안 된다 — heartbeat 타임아웃 경로는 SimpleBrokerMessageHandler.handleDisconnect 가 브로커 세션을
        // 지운 뒤 DISCONNECT_ACK 를 보내 StompSubProtocolHandler 가 «열린 소켓을 닫게» 한다. 그 ACK 가 거부되면 소켓과
        // 레지스트리 상태가 남으므로 대상 세션 자체는 닫는다(이미 닫힌 소켓이면 closeReserved 가 예약을 풀어 무시와 같다).
        // CONNECT_ACK 등 다른 제어 프레임은 잃으면 앱이 CONNECTED 를 못 받으니 일반 경로로 닫는다.
        boolean leaving = message != null
                && SimpMessageHeaderAccessor.getMessageType(message.getHeaders()) == SimpMessageType.DISCONNECT_ACK;
        boolean fresh = sessionId != null && sessions.isConnected(sessionId) && closing.add(sessionId);
        // 최대 점유자는 넘친 세션을 «포함해» 고른다 — 거부된 프레임도 그 세션이 잡으려 한 몫이라 센 채로 비교하고(장식기가 이미
        // +1 했다), 비교 «뒤에» 뺀다. 동률이면 넘친 세션이 이긴다(정상 세션을 불필요하게 닫지 않는다).
        String heaviest = fresh && !leaving ? heaviest(sessionId) : null;
        if (sessionId != null) {
            uncount(sessionId); // 큐에 못 들어갔다
        }
        if (!fresh) {
            return;
        }
        if (leaving) {
            closedOverflow.increment();
            closer.execute(() -> closeReserved(sessionId));
            return;
        }
        // 최대 점유자가 넘친 세션 자신이면 한 번만 닫는다(overflow). 다르면 가해를 먼저, 넘친 세션을 그 다음에 —
        // 한 작업에서 차례로 닫아 순서를 보장한다.
        List<String> victims = new ArrayList<>(2);
        Offender claimed = heaviest != null && !heaviest.equals(sessionId) ? claimOffender(heaviest) : null;
        if (claimed != null && !closing.add(heaviest)) {
            offender.compareAndSet(claimed, null); // 이미 예약된 세션 — 슬롯을 되돌린다
            claimed = null;
        }
        if (claimed != null) {
            closedOffender.increment();
            victims.add(heaviest);
            log.warn("아웃바운드 큐 포화 — 최대 점유 세션을 닫는다. pending={}", pending.get(heaviest));
        }
        closedOverflow.increment();
        victims.add(sessionId);
        log.warn("아웃바운드 큐 포화 — 프레임을 버린 세션을 닫는다. kind={}", kindOf(destination));
        closer.execute(() -> victims.forEach(this::closeReserved));
    }

    // ponytail: 거부마다 세션 수만큼 훑는다(수천 세션 × 포화 폭풍이면 부담) — 이미 닫는 세션은 closing 으로 빠져 곧 줄어든다.
    // 부담이 측정되면 거부 간격 제한(예: 100ms 1회)을 둔다.
    /**
     * 종료 예약 세션은 제외하되 방금 예약한 넘친 세션 자신은 후보다. 연결이 끊긴 세션도 제외한다 — 소켓은 닫혔는데 closed() 가 아직
     * pending 을 안 지웠거나 closed() 뒤 들어온 프레임이 만든 일시 항목이 뽑히면 아무것도 안 닫고 진짜 가해자를 놓친다.
     */
    private String heaviest(String overflowSessionId) {
        return pending.entrySet().stream()
                .filter(e -> sessions.isConnected(e.getKey()))
                .filter(e -> !closing.contains(e.getKey()) || e.getKey().equals(overflowSessionId))
                .max(Comparator.<Map.Entry<String, Integer>, Integer>comparing(Map.Entry::getValue)
                        .thenComparing(e -> e.getKey().equals(overflowSessionId)))
                .map(Map.Entry::getKey).orElse(null);
    }

    /** 가해자 슬롯 선점 — 비었거나 만료됐을 때만 성공한다(확인과 점유가 한 번의 CAS). */
    Offender claimOffender(String sessionId) {
        Offender current = offender.get();
        long now = System.nanoTime();
        if (current != null && now - current.reservedNanos() < offenderTtlNanos) {
            return null;
        }
        Offender mine = new Offender(sessionId, now);
        return offender.compareAndSet(current, mine) ? mine : null;
    }

    void releaseOffender(String sessionId) {
        Offender current = offender.get();
        if (current != null && current.sessionId().equals(sessionId)) {
            offender.compareAndSet(current, null);
        }
    }

    record Offender(String sessionId, long reservedNanos) {
    }

    private void closeReserved(String sessionId) {
        // 정상이면 종료 경로(closed)가 지운다. 이미 끊긴 세션이었으면 그 경로가 먼저 지나갔으니 여기서 지운다.
        boolean closed = sessions.close(sessionId, QUEUE_FULL) || sessions.close(sessionId, QUEUE_FULL);
        if (!closed) {
            log.warn("아웃바운드 큐 포화 세션 종료가 두 번 실패 — 예약을 푼다. 한 프레임 손실 가능(앱 sync·이력으로 복구)");
        }
        if (!closed || !sessions.isConnected(sessionId)) {
            closing.remove(sessionId);
            releaseOffender(sessionId);
        }
    }

    /** 소켓 종료 경로 — 종료 예약을 지우고, Spring 의 세션 송신 상한(시간·버퍼) 초과로 닫힌 세션을 센다. */
    void closed(String sessionId, CloseStatus status) {
        if (sessionId != null) {
            closing.remove(sessionId);
            releaseOffender(sessionId);
            pending.remove(sessionId);
        }
        if (status != null && status.equalsCode(CloseStatus.SESSION_NOT_RELIABLE)) {
            sessionLimit.increment();
        }
    }

    /** 종료 예약된 세션의 프레임은 큐에 넣지 않는다. */
    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        return closingSession(message) ? null : message;
    }

    @Override
    public Message<?> beforeHandle(Message<?> message, MessageChannel channel, MessageHandler handler) {
        if (closingSession(message)) {
            return null; // 예약 전에 큐에 들어간 프레임
        }
        handleStart.set(System.nanoTime());
        return message;
    }

    private boolean closingSession(Message<?> message) {
        if (closing.isEmpty()) {
            return false;
        }
        String sessionId = SimpMessageHeaderAccessor.getSessionId(message.getHeaders());
        if (sessionId != null && closing.contains(sessionId)) {
            closingDropped.increment();
            return true;
        }
        return false;
    }

    /** 세션의 대기 프레임 수 — 회귀 전용. */
    int pendingOf(String sessionId) {
        return pending.getOrDefault(sessionId, 0);
    }

    /** 종료 예약 중인가 — 회귀 전용. */
    boolean isClosing(String sessionId) {
        return closing.contains(sessionId);
    }

    @Override
    public void afterMessageHandled(Message<?> message, MessageChannel channel, MessageHandler handler,
            Exception ex) {
        Long start = handleStart.get();
        handleStart.remove();
        if (start != null) {
            sendTimers.get(kindOf(SimpMessageHeaderAccessor.getDestination(message.getHeaders())))
                    .record(System.nanoTime() - start, TimeUnit.NANOSECONDS);
        }
    }

    /** 목적지의 종류 — 지표 태그 값. 목적지 없는 제어 프레임(CONNECTED·ERROR·heartbeat)은 {@code other}. */
    static String kindOf(String destination) {
        if (destination == null) {
            return "other";
        }
        if (MOVEMENT_TOPIC.matcher(destination).matches()) {
            return "movement";
        }
        if (destination.startsWith("/topic/sea/") || destination.startsWith("/queue/sea")
                || destination.startsWith("/user/queue/sea")) {
            return "sea";
        }
        if (destination.startsWith("/topic/islands/")) {
            return "events";
        }
        if (destination.startsWith("/topic/groups/") || destination.startsWith("/queue/duplicates")
                || destination.startsWith("/user/queue/duplicates")) {
            return "chat";
        }
        return "other";
    }

    private static ThreadFactory daemon(String name) {
        return runnable -> {
            Thread thread = new Thread(runnable, name);
            thread.setDaemon(true);
            return thread;
        };
    }

    /** 초기화되는 순간의 내부 풀에 {@link ExecutorServiceMetrics} 를 묶는다(초기화 전에는 풀이 없다). */
    private static final class MeteredExecutor extends ThreadPoolTaskExecutor {

        private static final long serialVersionUID = 1L;

        private final transient MeterRegistry registry;

        MeteredExecutor(MeterRegistry registry) {
            this.registry = registry;
        }

        @Override
        protected ExecutorService initializeExecutor(ThreadFactory threadFactory,
                RejectedExecutionHandler rejectedExecutionHandler) {
            ExecutorService service = super.initializeExecutor(threadFactory, rejectedExecutionHandler);
            new ExecutorServiceMetrics(service, EXECUTOR_NAME, List.of()).bindTo(registry);
            return service;
        }
    }
}
