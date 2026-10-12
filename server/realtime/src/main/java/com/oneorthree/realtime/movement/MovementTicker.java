package com.oneorthree.realtime.movement;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 50ms(=  {@link MovementRules#DEFAULT} 의 {@code tickMs}) 마다 모든 방을 깨워 걷게 하는 전용 단일 스레드
 * 실행기. STOMP 인바운드 스레드({@code clientInboundChannel})와는 완전히 분리된다(계약 §4) —
 * {@link MovementTickerTest} 가 콜백이 받는 스레드 이름으로 이 분리를 증명한다.
 *
 * <p>이 서비스의 <b>첫 전용 executor</b> 다. {@code scheduleAtFixedRate} 는 본문에서 예외가 한 번만 터져도
 * 이후 모든 틱을 영구히 취소하므로, 방 하나의 예외가 다른 방·다음 틱까지 멈추지 않도록 방마다 try/catch 로 감싼다.
 * {@link #runTick()} 전체도 {@code catch (Throwable)} 로 한 번 더 감싼다(2246 보완11) — 방 단위 가드를
 * 뚫고 올라온 예외(또는 가드 밖의 코드가 던지는 예외)의 마지막 안전망이다.
 */
@Component
public final class MovementTicker {

    static final String THREAD_NAME = "movement-tick";

    /**
     * 연속 catch-up 상한(1초분, tickMs=50 기준) — 넘는 catch-up 실행은 틱 자체(drain·전진·serverTick
     * 증가 없음)를 건너뛴다(2246 보완13). GC·호스트 정지로 몇 분~몇십 분이 밀리면(10분=12,000틱)
     * {@code scheduleAtFixedRate} 가 그 수만큼 연속 호출하는데, 이 상한이 없으면 전부 drain·A* 를
     * 수행해 틱 스레드가 backlog 에 갇힌다.
     */
    private static final int MAX_CATCH_UP_TICKS = 20;

    private static final Logger LOG = LoggerFactory.getLogger(MovementTicker.class);

    private final MovementRooms rooms;
    private final Timer tickTimer;
    private final AtomicLong serverTick = new AtomicLong();
    private final AtomicLong delayedTickCount = new AtomicLong();
    private final AtomicLong skippedSnapshotCount = new AtomicLong();
    private final AtomicLong skippedTickCount = new AtomicLong();
    private ScheduledExecutorService executor;
    private volatile long lastTickStartedAtNanos;
    // movement-tick 스레드(또는 테스트 호출 스레드) 전용 — checkDelay/runTick 밖에서 안 건드려 Atomic 불필요.
    private long catchUpStreak;

    public MovementTicker(MovementRooms rooms, MeterRegistry meterRegistry) {
        this.rooms = rooms;
        this.tickTimer = Timer.builder("movement.tick")
                .description("섬 이동 틱 한 번(모든 방) 처리 시간")
                .register(meterRegistry);
    }

    @PostConstruct
    void start() {
        executor = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, THREAD_NAME);
            thread.setDaemon(true);
            return thread;
        });
        long tickMs = MovementRules.DEFAULT.tickMs();
        executor.scheduleAtFixedRate(this::runTick, tickMs, tickMs, TimeUnit.MILLISECONDS);
    }

    @PreDestroy
    void stop() {
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    /** 측정용(2250) — 지연 감지(2*tickMs 초과) 횟수. */
    long delayedTickCount() {
        return delayedTickCount.get();
    }

    /**
     * 측정용(2250) — catch-up 틱이라 Snapshot 발행을 건너뛴 횟수(codex P2, 2246 보완4). 틱 1회당 1 증가
     * — 그 틱에 방이 몇 개였는지는 세지 않는다.
     */
    long skippedSnapshotCount() {
        return skippedSnapshotCount.get();
    }

    /**
     * 측정용(2246 보완13) — {@link #MAX_CATCH_UP_TICKS} 초과로 틱 자체(drain·전진 포함)를 통째로
     * 건너뛴 횟수. {@link #skippedSnapshotCount} 와 달리 이 경우 방의 serverTick 도 전진하지 않는다.
     */
    long skippedTickCount() {
        return skippedTickCount.get();
    }

    /**
     * 패키지 전용 — {@code scheduleAtFixedRate} 가 직접 돌린다(테스트가 50ms 실제 대기 없이 호출하려고
     * 패키지 전용으로 둔다, 2246 보완11 — 추가된 유일한 시그니처). 본문 전체를 {@code catch (Throwable
     * t)} 로 감싼다 — {@code scheduleAtFixedRate} 는 실행 중 예외(Error 포함)가 한 번만 새도 이후 모든
     * 틱을 영구히 취소하므로, 방 단위 {@link Throwable} 가드({@link #tickAllRooms})가 일부러 다시 던지는
     * VirtualMachineError 까지(또는 그 가드 밖의 {@link #checkDelay} 자체가 던지는 예외까지) 여기서
     * 마지막으로 삼켜야 스케줄이 계속 돈다 — 단, 그 VirtualMachineError 는 로그 뒤 이 메서드도 다시
     * 던진다(2246 보완13, 아래). 방 단위 가드는 그대로 유지한다 — 이건 그걸 대신하지 않고 마지막 안전망이다.
     */
    void runTick() {
        try {
            boolean catchUp = checkDelay();
            if (catchUp && exceedsMaxCatchUp(catchUpStreak)) {
                // MAX_CATCH_UP_TICKS 를 넘는 연속 catch-up — 이번 틱은 통째로 건너뛴다(drain·전진·
                // serverTick 증가 없음, 2246 보완13). 정상 간격 실행이 오면 streak 가 0 으로 리셋되고
                // 그 첫 틱이 쌓인 큐를 평범하게 드레인한다.
                skippedTickCount.incrementAndGet();
                LOG.debug("catch-up {} 회 연속 — MAX_CATCH_UP_TICKS({}) 초과, 이번 틱은 건너뛴다(2246 보완13)",
                        catchUpStreak, MAX_CATCH_UP_TICKS);
                return;
            }
            tickTimer.record(() -> tickAllRooms(!catchUp));
        } catch (Throwable t) {
            LOG.error("섬 틱 처리 중 최상위 예외 — scheduleAtFixedRate 가 영구 취소되지 않도록 삼킨다(2246 보완11)", t);
            if (t instanceof VirtualMachineError && !(t instanceof StackOverflowError)) {
                // OutOfMemoryError 등 치명적 오류는 로그 뒤 다시 던진다(2246 보완13) — "이동만 조용히
                // 멈춘 서비스"보다 프로세스가 죽고 재시작되는 쪽이 낫다. StackOverflowError 는 스택
                // 하나만의 문제라 방 단위 가드(tickAllRooms)에서 이미 격리돼 여기까지 올라오지 않는다.
                throw t;
            }
        }
    }

    /**
     * @return 이번 실행이 catch-up(밀린) 실행인지({@link #isCatchUp}). 같은 호출에서 {@link
     *     #catchUpStreak} 도 갱신한다(2246 보완13) — {@link #runTick} 이 이 값으로 {@link
     *     #exceedsMaxCatchUp} 를 판정해 통째로 건너뛸지 정한다.
     */
    private boolean checkDelay() {
        long now = System.nanoTime();
        long previous = lastTickStartedAtNanos;
        lastTickStartedAtNanos = now;
        long tickNanos = MovementRules.DEFAULT.tickMs() * 1_000_000L;
        if (previous != 0 && now - previous > 2 * tickNanos) {
            delayedTickCount.incrementAndGet();
            LOG.debug("섬 틱 지연 감지: {}ms(기준 {}ms)", (now - previous) / 1_000_000L,
                    MovementRules.DEFAULT.tickMs());
        }
        boolean catchUp = isCatchUp(previous, now, tickNanos);
        catchUpStreak = nextCatchUpStreak(catchUpStreak, catchUp);
        return catchUp;
    }

    /**
     * 패키지 전용 — 순수 함수(단위 테스트용, codex P2, 2246 보완4). 나노초 기준이다(2246 보완11,
     * {@code System.nanoTime()} — {@code currentTimeMillis()} 의 벽시계는 NTP 보정으로 시계가 뒤로
     * 가면 직전 호출보다 작아져 이 판정이 거짓양성(catch-up 으로 오판)이 될 수 있다. {@code nanoTime()}
     * 은 단조 증가만 보장한다). 직전 틱이 시작한 뒤 반 주기(tickNanos/2) 도 지나지 않고 이번 실행이
     * 시작됐으면, {@code scheduleAtFixedRate} 가 밀린 실행을 연속으로 돌리는 중이다 — 그 틱은 Snapshot
     * 발행을 건너뛴다. {@code previousNanos==0}(첫 실행)은 catch-up 이 아니다.
     */
    static boolean isCatchUp(long previousNanos, long nowNanos, long tickNanos) {
        return previousNanos != 0 && nowNanos - previousNanos < tickNanos / 2;
    }

    /**
     * 패키지 전용 — 순수 함수(단위 테스트용, 2246 보완13). catch-up 이면 streak 를 1 늘리고, 정상
     * 간격이면 0 으로 리셋한다 — {@link #checkDelay} 가 이 값으로 {@link #exceedsMaxCatchUp} 를 판정한다.
     */
    static long nextCatchUpStreak(long previousStreak, boolean catchUp) {
        return catchUp ? previousStreak + 1 : 0;
    }

    /**
     * 패키지 전용 — 순수 함수(단위 테스트용, 2246 보완13). {@link #MAX_CATCH_UP_TICKS} 를 넘는 streak
     * 만 true — 그 틱은 {@link #runTick} 이 drain·전진 없이 통째로 건너뛴다.
     */
    static boolean exceedsMaxCatchUp(long catchUpStreak) {
        return catchUpStreak > MAX_CATCH_UP_TICKS;
    }

    /**
     * 패키지 전용 — 테스트가 스케줄러(50ms 실제 대기) 없이 틱을 바로, 여러 번 빠르게 돌리려고 쓴다.
     * {@code tickAllRooms(true)} 위임 — 기존 테스트 호출부를 그대로 보존한다(codex P2, 2246 보완4).
     */
    void tickAllRooms() {
        tickAllRooms(true);
    }

    /**
     * 패키지 전용. {@code publishSnapshot=false} 는 catch-up 틱 전용(codex P2, 2246 보완4) — 방마다
     * 이동은 그대로 전진시키되({@link RoomRuntime#tick(long, boolean)}) Snapshot 발행만 건너뛴다.
     * {@link #skippedSnapshotCount} 는 여기서 틱 1회당 1 증가한다.
     *
     * <p>방마다 틱 처리 직후 같은 스레드에서 바로 제거를 시도한다(codex P1) — 모든 방을 다 틱한 뒤
     * 따로 두 번째 루프를 돌리면 "이 방은 비었다"고 본 시점과 실제로 지우는 시점 사이가 다른 방들의
     * 틱 처리 시간만큼 벌어진다. 실제 제거는 {@link MovementRooms#remove} 가 그 순간 {@code
     * isRemovable()} 을 한 번 더 확인해(CAS) 그사이 들어온 명령을 지키므로, 여기서는 그냥 시도한다.
     *
     * <p>{@code isRemovable()}·{@link MovementRooms#remove} 호출도 {@code room.tick(...)} 과 같은
     * 방 단위 try 안에 있다(2246 보완11) — 둘 중 하나가 던져도 다른 방들의 틱·제거 시도가 이어진다.
     * 예전엔 이 둘이 try 밖이라, 던지면 이 for 문 전체가 멈춰 나머지 방은 이번 사이클에 틱도 못 받았다.
     */
    void tickAllRooms(boolean publishSnapshot) {
        long tick = serverTick.incrementAndGet();
        if (!publishSnapshot) {
            skippedSnapshotCount.incrementAndGet();
        }
        for (Map.Entry<UUID, RoomRuntime> entry : rooms.rooms().entrySet()) {
            RoomRuntime room = entry.getValue();
            try {
                room.tick(tick, publishSnapshot);
                if (room.isRemovable()) {
                    rooms.remove(entry.getKey());
                }
            } catch (Throwable t) {
                // RuntimeException 뿐 아니라 Error(AssertionError 등)도 이 방만 건너뛰어야 한다(2246
                // 보완13) — RuntimeException 만 잡던 예전엔 한 방의 Error 가 이 for 문을 벗어나 뒤
                // 방들이 같은 사이클의 틱을 통째로 놓쳤다. 다만 VirtualMachineError(OutOfMemoryError
                // 등)는 로그 뒤 다시 던진다 — StackOverflowError 는 스택 하나만의 문제라 방 단위
                // 격리를 유지하고 제외한다.
                LOG.warn("섬 {} 틱 처리 중 예외 — 이번 틱만 건너뛴다", entry.getKey(), t);
                if (t instanceof VirtualMachineError && !(t instanceof StackOverflowError)) {
                    throw t;
                }
            }
        }
    }
}
