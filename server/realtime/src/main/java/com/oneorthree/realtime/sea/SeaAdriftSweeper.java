package com.oneorthree.realtime.sea;

import com.oneorthree.realtime.common.redis.RedisKeys;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 떠 있는 채(항해를 끝낸 채) 10분이 지난 사용자를 바다 방에서 내보낸다 (GROMO-2300, 계약 §5 「다중 인스턴스」).
 *
 * <p>{@code @EnableScheduling} 없이 전용 데몬 executor 60초 주기다({@code MovementTicker} 패턴). 인스턴스가 여럿이어도
 * 같은 사용자를 둘이 집을 수 있는데, LEAVE Lua 가 {@code adriftSince} 를 CAS 로 비교하므로 늦은 쪽은 0 을 받고
 * 아무것도 하지 않는다 — 사건({@code sea.member.left{adrift}})은 1 을 받은 쪽만 낸다.
 *
 * <p>고른 뒤 그 사람이 다시 항해를 시작했으면 해시의 {@code adriftSince} 가 바뀌어 있어 LEAVE 가 0 이다 — 읽은 값을
 * 그대로 {@code expectedAdriftSince} 로 넘기는 것이 이 보호의 전부다.
 */
@Component
public class SeaAdriftSweeper {

    static final Duration ADRIFT_LIMIT = Duration.ofMinutes(10);
    private static final long PERIOD_SECONDS = 60;
    private static final Logger LOG = LoggerFactory.getLogger(SeaAdriftSweeper.class);

    private final StringRedisTemplate redis;
    private final SeaRooms seaRooms;
    private final Clock clock;
    private ScheduledExecutorService executor;

    public SeaAdriftSweeper(StringRedisTemplate redis, SeaRooms seaRooms, Clock clock) {
        this.redis = redis;
        this.seaRooms = seaRooms;
        this.clock = clock;
    }

    @PostConstruct
    void start() {
        executor = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "sea-adrift-sweep");
            thread.setDaemon(true);
            return thread;
        });
        executor.scheduleWithFixedDelay(this::sweepSafely, PERIOD_SECONDS, PERIOD_SECONDS, TimeUnit.SECONDS);
    }

    @PreDestroy
    void stop() {
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    /** 예외 하나가 이후 모든 틱을 취소하지 않게 {@code Throwable} 까지 삼킨다. */
    private void sweepSafely() {
        try {
            sweep();
        } catch (Throwable t) {
            LOG.error("바다 떠 있음 정리 실패 — 다음 틱에 다시 한다. reason={}", t.getClass().getSimpleName());
        }
    }

    /** 한 번 훑는다 — 테스트가 직접 부른다. 사용자 하나의 실패는 그 사용자만 건너뛴다. */
    void sweep() {
        long cutoff = clock.millis() - ADRIFT_LIMIT.toMillis();
        Set<ZSetOperations.TypedTuple<String>> due = redis.opsForZSet()
                .rangeByScoreWithScores(RedisKeys.SEA_ADRIFT, Double.NEGATIVE_INFINITY, cutoff);
        if (due == null) {
            return;
        }
        for (ZSetOperations.TypedTuple<String> entry : due) {
            try {
                if (entry.getValue() != null && entry.getScore() != null) {
                    sweepOne(UUID.fromString(entry.getValue()), entry.getScore().longValue());
                }
            } catch (RuntimeException e) {
                LOG.warn("바다 떠 있음 정리 — 한 명 건너뜀. reason={}", e.getClass().getSimpleName());
            }
        }
    }

    /**
     * @param adriftSince 색인에서 <b>고를 때 읽은</b> 점수. 해시에서 다시 읽으면 그사이 바뀐 새 값이 되어 CAS 가 헛돈다 —
     *                    이 값을 그대로 LEAVE 에 넘겨 «고른 뒤 다시 항해했다가 끝낸» 사람을 지키게 한다.
     */
    private void sweepOne(UUID userId, long adriftSince) {
        Object roomId = redis.opsForHash().get(RedisKeys.seaUser(userId), "roomId");
        if (!(roomId instanceof String room)) {
            // 해시가 이미 없다 — 색인에 남은 잔재만 치운다.
            redis.opsForZSet().remove(RedisKeys.SEA_ADRIFT, userId.toString());
            return;
        }
        seaRooms.leave(userId, UUID.fromString(room), SeaRooms.ADRIFT, Long.toString(adriftSince));
    }
}
