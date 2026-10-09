package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.exception.DomainException;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.config.StompTopics;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import com.oneorthree.realtime.movement.MovementRooms;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
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
 *
 * <h2>강퇴 재검사는 fail-closed 다</h2>
 * {@code island.members.updated}(MEMBER_REMOVED) 커밋 뒤 그 사용자의 이동 세션을 <b>캐시 없이</b> 다시 판정한다
 * ({@link #recheckMembership}). <b>재판정을 예약하는 그 순간</b> 그 세션×섬 전달을 멈추고(suspend) <b>통과로 판정될
 * 때만</b> 재개한다 — 앞선 조회에 밀리거나 조회가 늦는 동안에도 강퇴된 사람에게 FullState·Snapshot 이 새지 않는다.
 * 통과하면 FullState 한 번으로 다시 맞춘다(멈춘 동안의 사건은 버렸다). 판정을 못 내리면(상류 장애) 멈춘 채
 * 1·2·4·8·16초 뒤 다시 판정한다 — 비멤버면 퇴장, 토큰이 죽었으면 1008, 31초 예산을 다 쓰면 1011
 * {@code MEMBERSHIP_UNVERIFIED} 로 닫아 앱이 다시 붙어 구독 관문에서 새로 판정받게 한다. 세대 교체·멈춤과
 * 세대 확인·재개는 {@code rechecks} 의 같은 키 잠금 안에서 한다 — 옛 세대의 통과가 새 사건의 멈춤을 덮지 못한다.
 *
 * <h2>짝 토픽 판정 이어받기의 근거는 이 색인이다</h2>
 * 관문은 이 세션이 그 섬의 <b>살아 있는</b> outbox 를 들고 있을 때만({@link #holdsLiveOutbox}) 멤버십 판정을
 * 건너뛴다 — 레지스트리의 구독 기록이 아니다. 강퇴는 outbox 를 색인에서 떼고 두 토픽의 구독 기록도 지운다. 관문이
 * 이어받은 직후 강퇴가 끼어들 수 있으므로, 관문이 <b>직접 판정한</b> 구독에만 {@link #JUDGED} 헤더가 붙고, 이 처리기는
 * outbox 가 없을 때 그 헤더가 없으면 새로 들이지 않는다.
 *
 * <h2>스레드 둘</h2>
 * 판정·재시도는 전용 단일 스레드 {@code movement-recheck}, 송신 워치독과 <b>모든 소켓 종료</b>는 별도
 * {@code movement-watchdog}(2스레드)다 — 상류 장애로 판정이 줄을 서도 굳은 송신 해제·종료가 돌고, 막힌
 * 클라이언트의 blocking close 가 판정 스레드를 잡지 않는다. 둘 다 틱 스레드·브로커 스케줄러
 * ({@code messageBrokerTaskScheduler}, 하트비트)와 따로다.
 */
@Slf4j
@Component
public class MovementSubscriptionListener implements ChannelInterceptor {

    /**
     * 관문({@code StompAuthChannelInterceptor})이 멤버십을 <b>직접 판정해 통과시킨</b> 이동 SUBSCRIBE 에 붙이는 메시지
     * 헤더(값 {@code Boolean.TRUE}). 클라이언트 헤더는 네이티브 헤더로만 들어오므로 클라이언트가 붙일 수 없다.
     */
    public static final String JUDGED = "movementJudged";

    /** 첫 판정이 실패한 뒤의 재판정 간격(초) — 다 쓰면(총 31초) 1011 로 닫는다. */
    private static final long[] RETRY_DELAYS_SECONDS = {1, 2, 4, 8, 16};

    private static final long SWEEP_PERIOD_SECONDS = 5;

    private static final CloseStatus UNVERIFIED = CloseStatus.SERVER_ERROR.withReason("MEMBERSHIP_UNVERIFIED");

    private final MovementRooms rooms;
    private final MovementPublisher publisher;
    private final RealtimeSessionRegistry sessions;
    private final ChatAccessGuard accessGuard;
    private final JwtValidator jwtValidator;
    private final ScheduledExecutorService scheduler;
    private final ScheduledExecutorService watchdog;
    private final Counter suspendedCount;

    /**
     * sessionId → (islandId → outbox). 이 맵의 {@code compute} 가 세션별 잠금이다 — 람다 안에서 블로킹 금지. 안쪽 맵은
     * 그 잠금 안에서만 고치고, 관문은 잠그지 않고 읽는다({@link #holdsLiveOutbox}).
     */
    private final ConcurrentHashMap<String, Map<UUID, MovementOutbox>> bySession = new ConcurrentHashMap<>();

    /** 진행 중인 재판정 — outbox 당 한 세대. 세대가 바뀌면(새 사건·취소) 늦게 도는 옛 작업은 아무것도 하지 않는다. */
    private final ConcurrentHashMap<MovementOutbox, Recheck> rechecks = new ConcurrentHashMap<>();

    /**
     * ponytail: 판정 풀은 1스레드 — 상류 장애 때 판정이 줄을 서 31초 예산보다 늦게 끝날 수 있다(그동안 멈춰 있어
     * fail-closed). 늘려야 하면 {@code newExecutor(1, …)} 의 크기만 키운다 — 같은 outbox 의 옛·새 작업이 겹쳐도
     * 처치는 세대 비교({@code rechecks} 의 compute/remove/replace)로 한 번뿐이다.
     */
    @Autowired
    public MovementSubscriptionListener(MovementRooms rooms, MovementPublisher publisher,
            RealtimeSessionRegistry sessions, ChatAccessGuard accessGuard, JwtValidator jwtValidator,
            MeterRegistry meterRegistry) {
        this(rooms, publisher, sessions, accessGuard, jwtValidator, meterRegistry, newExecutor(1, "movement-recheck"),
                newExecutor(2, "movement-watchdog"));
    }

    /** 패키지 전용 — 테스트가 두 실행기를 갈아 끼워 실제 대기 없이 한 단계씩 돌린다. */
    MovementSubscriptionListener(MovementRooms rooms, MovementPublisher publisher, RealtimeSessionRegistry sessions,
            ChatAccessGuard accessGuard, JwtValidator jwtValidator, MeterRegistry meterRegistry,
            ScheduledExecutorService scheduler, ScheduledExecutorService watchdog) {
        this.rooms = rooms;
        this.publisher = publisher;
        this.sessions = sessions;
        this.accessGuard = accessGuard;
        this.jwtValidator = jwtValidator;
        this.scheduler = scheduler;
        this.watchdog = watchdog;
        this.suspendedCount = Counter.builder("movement.recheck.suspended")
                .description("강퇴 재검사로 이동 전달을 멈춘 횟수 — 재판정 예약(세션×섬)마다 1, 통과 판정 때만 재개")
                .register(meterRegistry);
    }

    private static ScheduledExecutorService newExecutor(int threads, String name) {
        AtomicInteger sequence = new AtomicInteger();
        ScheduledThreadPoolExecutor executor = new ScheduledThreadPoolExecutor(threads, runnable -> {
            Thread thread = new Thread(runnable, threads == 1 ? name : name + "-" + sequence.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        });
        executor.setRemoveOnCancelPolicy(true);
        return executor;
    }

    /** 송신 워치독({@link MovementPublisher#sweep})을 워치독 실행기에서 5초마다 돌린다. */
    @PostConstruct
    void start() {
        watchdog.scheduleWithFixedDelay(this::sweep, SWEEP_PERIOD_SECONDS, SWEEP_PERIOD_SECONDS, TimeUnit.SECONDS);
    }

    @PreDestroy
    void stop() {
        scheduler.shutdownNow();
        watchdog.shutdownNow();
    }

    private void sweep() {
        try {
            publisher.sweep(System.nanoTime());
        } catch (RuntimeException e) {
            // 주기 작업은 예외 한 번에 영구 취소된다 — 다음 주기를 살린다.
            log.warn("이동 송신 워치독 실패 — reason={}", e.getClass().getSimpleName());
        }
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
        boolean judged = Boolean.TRUE.equals(accessor.getHeader(JUDGED));
        // 세션 잠금 — 람다 안에서 블로킹 금지(방·outbox 등록은 큐에 넣기만 한다).
        bySession.compute(accessor.getSessionId(), (sessionId, held) -> {
            if (!sessions.isConnected(sessionId)) {
                return held; // 정리가 이미 지나간 세션의 늦은 프레임 — 들이면 아무도 내보내지 않는다.
            }
            Map<UUID, MovementOutbox> outboxes = held != null ? held : new ConcurrentHashMap<>();
            MovementOutbox outbox = outboxes.get(islandId);
            if (outbox == null) {
                if (!judged) {
                    // 관문은 살아 있던 outbox 를 근거로 판정을 이어받았는데 그 사이 강퇴됐다 — 판정 없이 새로 들이지 않고,
                    // 구독 기록도 지워 «판정받은 구독»으로 남기지 않는다. 다음 구독은 관문이 처음부터 판정한다.
                    sessions.unsubscribe(sessionId, subscriptionId);
                    return held;
                }
                outbox = publisher.open(islandId, sessionId, principal.userId());
                outboxes.put(islandId, outbox);
            }
            if (snapshot) {
                outbox.subscribeSnapshot(subscriptionId);
                return outboxes;
            }
            outbox.subscribeMovement(subscriptionId);
            // 같은 사용자의 다른 세션(다른 기기)은 actor 를 넘겨준다 — 그쪽엔 더 보내지 않는다(N6). 그 세션의 구독
            // 슬롯·outbox 는 일부러 남긴다: 그 기기가 다시 구독하면 actor 를 되찾고, 해지·종료 때 평소처럼 정리된다.
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
        // 세션 잠금 — 람다 안에서 블로킹 금지.
        bySession.computeIfPresent(sessionId, (id, held) -> {
            held.entrySet().removeIf(entry -> {
                MovementOutbox outbox = entry.getValue();
                if (outbox.unsubscribeMovement(subscriptionId)) {
                    rooms.leave(entry.getKey(), id);
                }
                outbox.unsubscribeSnapshot(subscriptionId);
                if (outbox.hasSubscriptions()) {
                    return false; // snapshot 이 남았으면 재판정도 계속 — 그 전달도 멤버십에 묶여 있다.
                }
                cancelRecheck(outbox);
                publisher.close(entry.getKey(), id);
                return true;
            });
            return held.isEmpty() ? null : held;
        });
    }

    /**
     * 이 세션이 그 섬의 이동 outbox 를 <b>살아 있는 채로</b> 들고 있는가 — 관문이 짝 토픽의 멤버십 판정을 이어받는
     * 근거다(강퇴·해지·종료 뒤엔 false). 멈춘(재판정 중) outbox 도 살아 있다 — 이어받은 구독도 같이 멈춰 있고, 강퇴되면
     * 같이 지워진다. 잠그지 않고 읽는다.
     */
    public boolean holdsLiveOutbox(String sessionId, UUID islandId) {
        Map<UUID, MovementOutbox> held = sessionId == null ? null : bySession.get(sessionId);
        MovementOutbox outbox = held == null ? null : held.get(islandId);
        return outbox != null && !outbox.isClosed();
    }

    /**
     * 소켓 종료 — 그 세션이 든 방 전부에서 퇴장하고 재판정도 취소한다. {@code WebSocketConfig} 가
     * {@link RealtimeSessionRegistry#closed} <b>직후</b>에 부른다(순서가 유령 actor 방지의 전제다, 클래스 설명).
     */
    public void closed(String sessionId) {
        if (sessionId == null) {
            return;
        }
        // 세션 잠금 — 람다 안에서 블로킹 금지.
        bySession.computeIfPresent(sessionId, (id, held) -> {
            held.forEach((islandId, outbox) -> leaveAndClose(islandId, id, outbox));
            return null;
        });
    }

    /**
     * {@code island.members.updated}(MEMBER_REMOVED) 커밋 뒤 부른다(N7) — {@code memberUserId} 의 이동 세션(없으면
     * 섬 전체)을 다시 판정하도록 예약만 한다. 판정은 이동 스케줄러 스레드에서 돈다. 같은 세션에 진행 중인 재판정이
     * 있으면 새 사건 기준으로 처음부터 다시 잰다(예약은 늘 한 개). <b>절대 던지지 않는다</b>.
     */
    public void recheckMembership(UUID islandId, UUID memberUserId) {
        try {
            for (MovementOutbox outbox : publisher.outboxes(islandId)) {
                if (memberUserId == null || memberUserId.equals(outbox.userId())) {
                    restart(outbox, islandId);
                }
            }
        } catch (RuntimeException e) {
            log.warn("이동 멤버십 재검사 예약 실패 — reason={}", e.getClass().getSimpleName());
        }
    }

    /**
     * 전달부터 멈추고 예약한다 — 이 outbox 는 여기서부터 {@code ALLOWED} 판정({@link #resumeIfCurrent})까지 아무것도
     * 보내지 않는다(그 사이 사건은 버리고, 재개 때 FullState 로 다시 맞춘다). 재개는 그 한 곳뿐이라 나머지 처치(퇴장·
     * 1011·1008·취소)는 멈춘 채로 끝난다.
     */
    private void restart(MovementOutbox outbox, UUID islandId) {
        Recheck first = new Recheck(islandId, 0);
        Recheck[] previous = new Recheck[1];
        // 세대 교체와 멈춤을 한 키 잠금 안에서 — 옛 세대의 재개(resumeIfCurrent)와 직렬화돼, 그 사이에 끼어 새 판정 전에
        // 전달이 열리지 않는다. 람다 안에서 블로킹 금지(멈춤은 플래그만 바꾼다).
        rechecks.compute(outbox, (key, current) -> {
            previous[0] = current;
            outbox.suspend();
            return first;
        });
        cancel(previous[0]);
        suspendedCount.increment();
        first.future = scheduler.schedule(() -> judgeAndAct(outbox, first), 0, TimeUnit.SECONDS);
    }

    /**
     * 판정(상류 조회)과 처치(퇴장·재개·종료)를 나눈다 — 처치가 던져도 이 작업은 던지지 않는다. 그 세션 전달은 예약
     * 때부터 멈춰 있어 그대로 멈춘 채 남는다.
     */
    private void judgeAndAct(MovementOutbox outbox, Recheck recheck) {
        if (rechecks.get(outbox) != recheck) {
            return; // 새 사건으로 다시 시작됐거나 해지·종료로 취소됐다.
        }
        if (outbox.isClosed()) {
            rechecks.remove(outbox, recheck); // 예약과 해지가 엇갈렸다 — 이미 아무것도 안 보내는 outbox 다.
            return;
        }
        Verdict verdict = judge(outbox, recheck.islandId);
        try {
            act(outbox, recheck, verdict);
        } catch (RuntimeException e) {
            rechecks.remove(outbox, recheck);
            log.warn("이동 멤버십 재검사 처치 실패 — 그 세션 전달은 멈춘 채 둔다. verdict={} reason={}", verdict,
                    e.getClass().getSimpleName());
        }
    }

    private Verdict judge(MovementOutbox outbox, UUID islandId) {
        ChatPrincipal principal = sessions.find(outbox.sessionId());
        if (principal == null) {
            return Verdict.GONE;
        }
        // 토큰부터 로컬로 본다 — 죽은 토큰을 상류에 물으면 옵션 OFF 에서 「소속 없음」으로 접혀(403 → 빈 집합)
        // 정상 주민이 조용히 퇴장될 수 있다. 죽었으면 소속을 묻지 않고 기존 만료 규칙(1008)으로 간다.
        String bearer = principal.bearer();
        String token = bearer != null && bearer.startsWith("Bearer ") ? bearer.substring(7) : null;
        if (jwtValidator.extractUserId(token).filter(principal.userId()::equals).isEmpty()) {
            return Verdict.UNAUTHORIZED;
        }
        try {
            accessGuard.requireMemberUncached(islandId, principal.userId(), principal.bearer());
            return Verdict.ALLOWED;
        } catch (DomainException e) {
            if (e.getErrorCode() == ChatErrorCode.NOT_A_MEMBER) {
                return Verdict.NOT_A_MEMBER;
            }
            return e.getErrorCode() == CommonErrorCode.UNAUTHORIZED ? Verdict.UNAUTHORIZED : Verdict.UNKNOWN;
        } catch (RuntimeException e) {
            return Verdict.UNKNOWN; // Redis·네트워크 — 「아니오」가 아니라 「모르겠다」.
        }
    }

    private void act(MovementOutbox outbox, Recheck recheck, Verdict verdict) {
        switch (verdict) {
            case ALLOWED -> {
                // 멈춘 동안의 사건은 버렸다 — FullState 한 번으로 다시 맞춘다(그 세션에만, 방 큐 FIFO).
                if (resumeIfCurrent(outbox, recheck) && outbox.hasMovement()) {
                    rooms.requestFullState(recheck.islandId, outbox.sessionId());
                }
            }
            case NOT_A_MEMBER -> {
                if (rechecks.remove(outbox, recheck)) {
                    revoke(recheck.islandId, outbox);
                }
            }
            case UNAUTHORIZED -> {
                // 그 토큰으로는 다시 물어도 같다 — 기존 만료 토큰 규칙대로 1008 로 닫아 앱이 갱신·재연결하게 한다.
                if (rechecks.remove(outbox, recheck)) {
                    closeLater(outbox.sessionId(), CloseStatus.POLICY_VIOLATION.withReason("UNAUTHORIZED"));
                }
            }
            case GONE -> rechecks.remove(outbox, recheck);
            default -> retryOrGiveUp(outbox, recheck);
        }
    }

    /**
     * 그 세대가 아직 현재일 때만 재개하고 세대를 지운다 — 세대 확인과 재개가 {@code rechecks} 의 같은 키 잠금 안이라,
     * 새 사건의 멈춤({@link #restart})은 이 앞이나 뒤에만 온다(뒤면 다시 멈춘다). 람다 안에서 블로킹 금지.
     *
     * @return 재개했으면 true
     */
    private boolean resumeIfCurrent(MovementOutbox outbox, Recheck recheck) {
        boolean[] resumed = new boolean[1];
        rechecks.computeIfPresent(outbox, (key, current) -> {
            if (current != recheck) {
                return current;
            }
            outbox.resume();
            resumed[0] = true;
            return null;
        });
        return resumed[0];
    }

    /** 판정 불가 — 멈춘 채 백오프로 다시 잰다. 예산을 다 쓰면 1011 로 닫는다(워치독 실행기에서). */
    private void retryOrGiveUp(MovementOutbox outbox, Recheck recheck) {
        if (recheck.attempt >= RETRY_DELAYS_SECONDS.length) {
            if (rechecks.remove(outbox, recheck)) {
                log.warn("이동 멤버십 재판정이 {}회 모두 판정 불가 — 세션을 1011 {} 로 닫는다",
                        RETRY_DELAYS_SECONDS.length + 1, UNVERIFIED.getReason());
                closeLater(outbox.sessionId(), UNVERIFIED);
            }
            return;
        }
        Recheck next = new Recheck(recheck.islandId, recheck.attempt + 1);
        if (rechecks.replace(outbox, recheck, next)) {
            next.future = scheduler.schedule(() -> judgeAndAct(outbox, next), RETRY_DELAYS_SECONDS[recheck.attempt],
                    TimeUnit.SECONDS);
        }
    }

    /**
     * 소켓 종료는 워치독 실행기에 넘긴다 — 막힌 클라이언트의 close 는 close 프레임 쓰기에서 오래 묶일 수 있어 판정
     * 스레드를 잡으면 안 된다.
     */
    private void closeLater(String sessionId, CloseStatus status) {
        try {
            watchdog.execute(() -> sessions.close(sessionId, status));
        } catch (RuntimeException e) {
            // 종료 중(실행기 거절) — 그 소켓도 곧 같이 닫힌다.
            log.warn("이동 세션 종료 예약 실패 — status={} reason={}", status, e.getClass().getSimpleName());
        }
    }

    private void revoke(UUID islandId, MovementOutbox outbox) {
        // 세션 잠금 — 람다 안에서 블로킹 금지. 같은 섬에 새로 생긴 다른 outbox 는 건드리지 않는다.
        bySession.computeIfPresent(outbox.sessionId(), (id, held) -> {
            if (held.remove(islandId, outbox)) {
                // 두 토픽의 구독 기록도 지운다 — 남으면 intent 관문을 통과하고, 같은 id 의 재구독이 재전송으로 읽힌다.
                // 다음 구독은 관문이 처음부터 판정한다(이어받을 살아 있는 outbox 도 방금 뗐다).
                sessions.unsubscribeDestinations(id,
                        List.of(StompTopics.movementTopic(islandId), StompTopics.movementSnapshotTopic(islandId)));
                leaveAndClose(islandId, id, outbox);
            }
            return held.isEmpty() ? null : held;
        });
    }

    /** outbox 를 먼저 떼고 나서 퇴장시킨다 — 퇴장이 내는 FullState 가 떠나는 세션에 가지 않는다. */
    private void leaveAndClose(UUID islandId, String sessionId, MovementOutbox outbox) {
        cancelRecheck(outbox);
        boolean joined = outbox.hasMovement();
        publisher.close(islandId, sessionId);
        if (joined) {
            rooms.leave(islandId, sessionId);
        }
    }

    private void cancelRecheck(MovementOutbox outbox) {
        cancel(rechecks.remove(outbox));
    }

    private static void cancel(Recheck recheck) {
        ScheduledFuture<?> future = recheck == null ? null : recheck.future;
        if (future != null) {
            future.cancel(false);
        }
    }

    private enum Verdict { ALLOWED, NOT_A_MEMBER, UNAUTHORIZED, UNKNOWN, GONE }

    /** 재판정 한 세대 — {@code attempt} 0 은 사건 직후, 1~5 는 재시도. */
    private static final class Recheck {

        private final UUID islandId;
        private final int attempt;
        private volatile ScheduledFuture<?> future;

        private Recheck(UUID islandId, int attempt) {
            this.islandId = islandId;
            this.attempt = attempt;
        }
    }
}
