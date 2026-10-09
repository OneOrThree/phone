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
 */
@Component
public final class MovementTicker {

    static final String THREAD_NAME = "movement-tick";

    private static final Logger LOG = LoggerFactory.getLogger(MovementTicker.class);

    private final MovementRooms rooms;
    private final Timer tickTimer;
    private final AtomicLong serverTick = new AtomicLong();
    private final AtomicLong delayedTickCount = new AtomicLong();
    private ScheduledExecutorService executor;
    private volatile long lastTickStartedAtMs;

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

    private void runTick() {
        checkDelay();
        tickTimer.record(this::tickAllRooms);
    }

    private void checkDelay() {
        long now = System.currentTimeMillis();
        long previous = lastTickStartedAtMs;
        lastTickStartedAtMs = now;
        long tickMs = MovementRules.DEFAULT.tickMs();
        if (previous != 0 && now - previous > 2 * tickMs) {
            delayedTickCount.incrementAndGet();
            LOG.debug("섬 틱 지연 감지: {}ms(기준 {}ms)", now - previous, tickMs);
        }
    }

    /**
     * 패키지 전용 — 테스트가 스케줄러(50ms 실제 대기) 없이 틱을 바로, 여러 번 빠르게 돌리려고 쓴다.
     *
     * <p>방마다 틱 처리 직후 같은 스레드에서 바로 제거를 시도한다(codex P1) — 모든 방을 다 틱한 뒤
     * 따로 두 번째 루프를 돌리면 "이 방은 비었다"고 본 시점과 실제로 지우는 시점 사이가 다른 방들의
     * 틱 처리 시간만큼 벌어진다. 실제 제거는 {@link MovementRooms#remove} 가 그 순간 {@code
     * isRemovable()} 을 한 번 더 확인해(CAS) 그사이 들어온 명령을 지키므로, 여기서는 그냥 시도한다.
     */
    void tickAllRooms() {
        long tick = serverTick.incrementAndGet();
        for (Map.Entry<UUID, RoomRuntime> entry : rooms.rooms().entrySet()) {
            RoomRuntime room = entry.getValue();
            try {
                room.tick(tick);
            } catch (RuntimeException e) {
                LOG.warn("섬 {} 틱 처리 중 예외 — 이번 틱만 건너뛴다", entry.getKey(), e);
            }
            if (room.isRemovable()) {
                rooms.remove(entry.getKey());
            }
        }
    }
}
