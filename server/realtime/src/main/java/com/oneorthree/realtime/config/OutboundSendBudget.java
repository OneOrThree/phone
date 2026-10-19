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
import org.springframework.messaging.support.ExecutorChannelInterceptor;
import org.springframework.messaging.support.MessageHandlingRunnable;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;

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
    private final Map<String, Timer> sendTimers;
    private final ThreadLocal<Long> handleStart = new ThreadLocal<>();
    private final Set<String> closing = ConcurrentHashMap.newKeySet();
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
        this.sendTimers = KINDS.stream().collect(Collectors.toUnmodifiableMap(kind -> kind,
                kind -> Timer.builder("realtime.outbound.send").tag("destination_kind", kind)
                        .description("아웃바운드 프레임의 소켓 쓰기 시간").publishPercentileHistogram()
                        .register(meterRegistry)));
    }

    private Counter dropped(String reason) {
        return Counter.builder("realtime.outbound.dropped").tag("reason", reason)
                .description("아웃바운드 예산 초과로 버린 프레임·닫힌 세션").register(meterRegistry);
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
        return executor;
    }

    @Override
    public void rejectedExecution(Runnable task, ThreadPoolExecutor executor) {
        if (executor.isShutdown()) {
            throw new RejectedExecutionException("아웃바운드 실행기 종료 중");
        }
        queueFull.increment();
        Message<?> message = task instanceof MessageHandlingRunnable handling ? handling.getMessage() : null;
        String destination = message == null ? null : SimpMessageHeaderAccessor.getDestination(message.getHeaders());
        String sessionId = message == null ? null : SimpMessageHeaderAccessor.getSessionId(message.getHeaders());
        if (sessionId != null && closing.add(sessionId)) {
            log.warn("아웃바운드 큐 포화 — 프레임을 버린 세션을 닫는다. kind={}", kindOf(destination));
            closer.execute(() -> {
                // 정상이면 종료 경로(closed)가 지운다. 이미 끊긴 세션이었으면 그 경로가 먼저 지나갔으니 여기서 지운다.
                boolean closed = sessions.close(sessionId, QUEUE_FULL) || sessions.close(sessionId, QUEUE_FULL);
                if (!closed) {
                    log.warn("아웃바운드 큐 포화 세션 종료가 두 번 실패 — 예약을 푼다. 한 프레임 손실 가능(앱 sync·이력으로 복구)");
                }
                if (!closed || !sessions.isConnected(sessionId)) {
                    closing.remove(sessionId);
                }
            });
        }
    }

    /** 소켓 종료 경로 — 종료 예약을 지우고, Spring 의 세션 송신 상한(시간·버퍼) 초과로 닫힌 세션을 센다. */
    void closed(String sessionId, CloseStatus status) {
        if (sessionId != null) {
            closing.remove(sessionId);
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
