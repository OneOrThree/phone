package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.config.OutboxRelayProperties;
import com.oneorthree.phone.outbox.client.OutboxTransport;
import com.oneorthree.phone.outbox.client.OutboxTransportResult;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.extern.slf4j.Slf4j;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 미전달 행을 집어 실제로 내보내는 잡 (A21).
 *
 * <h2>세 구간이 분리돼 있다</h2>
 * <ol>
 *   <li><b>선점</b>({@link OutboxRelayStore#claim}, 트랜잭션) — 리스 + 펜싱 토큰을 박는다.
 *   <li><b>전달</b>(여기, 트랜잭션 밖) — 브로커·HTTP 호출. DB 를 잡은 채 외부를 기다리면 그 지연이
 *       그대로 잠금 시간이 된다.
 *   <li><b>표시</b>({@link OutboxRelayStore}, 트랜잭션) — 토큰이 일치할 때만 반영.
 * </ol>
 *
 * <h2>지켜야 하는 두 가지</h2>
 * <b>① 선행 미전달을 건너뛰지 않는다.</b> 순서 축(=version 을 발급한 aggregate)별로 앞쪽 연속 미전달만
 * 후보가 된다. 앞 행이 남의 리스에 잡혀 있어도 여전히 미전달이라 앞지르기가 성립하지 않는다.
 *
 * <p><b>② 낡은 워커의 완료 표시를 거부한다.</b> 리스가 만료돼 다른 워커가 재클레임하면 토큰이 바뀌고
 * 옛 워커의 표시는 0행을 갱신한다. 그 경우 새 워커가 다시 보내 <b>중복</b>이 나지만 수신 측이
 * {@code eventId} 멱등이라 안전하다 — 반대로 낡은 표시를 받아 주면 <b>유실</b>이고 복구할 수 없다.
 *
 * <h2>A18 보류</h2>
 * 고갈 처리가 없다. 시도가 임계값에 닿으면 경고를 한 번 남기고 최대 백오프로 계속 재시도한다 — 행을 지우거나
 * 다른 대상으로 우회(HTTP 폴백)하지 않는다.
 *
 * <h2>지표 (GROMO-2337)</h2>
 * {@code outbox.relay.backlog{target}}·{@code outbox.relay.oldest_pending_age{target}}(초, 도래한 행 기준)
 * 게이지는 틱 시작의 스냅샷 한 쿼리 값을 읽는다 — 스크레이프가 DB 를 치지 않게. 나머지는
 * {@code claim}·{@code send} 타이머, {@code delivered}·{@code failed{retryable}}·{@code released{reason}}
 * 카운터. {@code SCORE} 는 전달 경로가 없어 영구 보류이므로 backlog 가 계속 자라는 것이 정상이다.
 *
 * <h2>축 run·병렬·틱 예산 (GROMO-2338)</h2>
 * 선점은 축마다 앞쪽 {@code run-length} 건을 집는다. 집은 행은 축별로 묶어 실행기에 넘긴다 — <b>축 안은 version
 * 순 순차</b>, 축 사이는 병렬이다. 축 안에서 한 건이 끝나지 못하면(재시도·영구 실패·리스 상실·낡은 표시) 그 축은
 * 거기서 멈추고 나머지를 보내지 않은 채 되돌린다({@code released{predecessor_failed}}) — 뒤 행이 앞 행 실패를
 * 앞지르지 않게. 한 틱은 {@code tick-budget} 안에서 «집은 것이 없을 때까지» 라운드를 반복한다(0 = 한 라운드).
 */
@Slf4j
public class OutboxRelayService {

    /** 백오프 지수의 상한 — {@code 1L << exponent} 가 넘치지 않게 잡는다. */
    private static final int MAX_BACKOFF_EXPONENT = 16;

    /** {@code last_error} 에 남기는 최대 길이. */
    private static final int MAX_ERROR_LENGTH = 1000;

    private final OutboxRelayStore store;
    private final EventOutboxRepository outboxRepository;
    private final OutboxRelayProperties properties;
    private final Clock clock;
    private final Map<OutboxTarget, OutboxTransport> transports = new EnumMap<>(OutboxTarget.class);
    private final String workerId;
    private final MeterRegistry meterRegistry;
    private final Map<OutboxTarget, AtomicLong> backlog = new EnumMap<>(OutboxTarget.class);
    private final Map<OutboxTarget, AtomicLong> oldestPendingAgeSeconds = new EnumMap<>(OutboxTarget.class);
    private final Executor axisExecutor;

    /**
     * @param store            트랜잭션 경계
     * @param outboxRepository 봉투 저장소 — 수신자(userId)를 읽는다
     * @param properties       relay 설정
     * @param clock            서버 시계
     * @param transports       대상별 전달 경로. 없는 대상은 이번 틱에서 건너뛴다
     * @param meterRegistry    relay 지표를 올릴 곳
     * @param axisExecutor     축 작업을 돌릴 실행기 — 운영은 relay 전용 풀, 테스트는 {@code Runnable::run}(인라인·순차)
     */
    public OutboxRelayService(
            OutboxRelayStore store,
            EventOutboxRepository outboxRepository,
            OutboxRelayProperties properties,
            Clock clock,
            List<OutboxTransport> transports,
            MeterRegistry meterRegistry,
            Executor axisExecutor) {
        this.store = store;
        this.outboxRepository = outboxRepository;
        this.properties = properties;
        this.clock = clock;
        for (OutboxTransport transport : transports) {
            this.transports.put(transport.target(), transport);
        }
        this.workerId = resolveWorkerId(properties.getWorkerId());
        this.meterRegistry = meterRegistry;
        this.axisExecutor = axisExecutor;
        for (OutboxTarget target : OutboxTarget.values()) {
            AtomicLong pending = new AtomicLong();
            AtomicLong age = new AtomicLong();
            backlog.put(target, pending);
            oldestPendingAgeSeconds.put(target, age);
            Gauge.builder("outbox.relay.backlog", pending, AtomicLong::get)
                    .tag("target", target.name()).register(meterRegistry);
            Gauge.builder("outbox.relay.oldest_pending_age", age, AtomicLong::get)
                    .tag("target", target.name()).baseUnit("seconds").register(meterRegistry);
            // 증가는 드물다 — 대시보드가 0 으로라도 보이게 미리 등록한다.
            meterRegistry.counter("outbox.relay.released", "target", target.name(), "reason", "overtaking");
            meterRegistry.counter("outbox.relay.released", "target", target.name(), "reason", "predecessor_failed");
        }
    }

    /**
     * 한 틱 — 아는 대상마다 선점·전달·표시를 한 라운드씩, {@code tick-budget} 안에서 집을 것이 없을 때까지 반복한다.
     *
     * <p>라운드 안에서는 모든 대상의 선점을 먼저 하고 축 작업을 한꺼번에 띄운 뒤 다 기다린다 — 대상끼리도 겹쳐 돈다.
     * 예산은 «새 라운드를 시작할지»만 가른다. 시작한 라운드는 끝까지 기다리므로 한 틱은 예산 + 라운드 한 번까지 늘 수 있다.
     *
     * <p><b>한 대상·한 축의 예외가 라운드를 끊지 않는다.</b> 선점이 던진 대상은 그 대상만 건너뛰고, 띄운 축 작업은 예외로
     * 끝난 것까지 전부 기다린 뒤 합산한다. 중간에 빠져나가면 남은 축 작업이 다음 틱과 겹쳐 돌고 전달 건수도 잃는다.
     *
     * @return 이번 틱에 전달을 마친 건수
     */
    public int relayOnce() {
        refreshBacklog();
        Instant deadline = clock.instant().plus(properties.getTickBudget());
        int delivered = 0;
        int claimed;
        do {
            List<Round> rounds = new ArrayList<>();
            for (OutboxTarget target : OutboxTarget.values()) {
                if (!transports.containsKey(target)) {
                    continue;
                }
                try {
                    rounds.add(startRound(target));
                } catch (RuntimeException e) {
                    // 선점·봉투 조회 실패(DB 순단 등) — 이 대상만 이번 라운드를 건너뛴다. 이미 띄운 다른 대상은 아래서 기다린다.
                    log.error("outbox relay 라운드 시작 실패 — target={}", target, e);
                }
            }
            claimed = rounds.stream().mapToInt(Round::claimed).sum();
            for (Round round : rounds) {
                delivered += round.join();
            }
        } while (claimed > 0 && clock.instant().isBefore(deadline));
        return delivered;
    }

    /**
     * 대상 하나를 한 라운드 처리한다.
     *
     * @param target 전달 대상
     * @return 전달을 마친 건수
     */
    public int relayTarget(OutboxTarget target) {
        return startRound(target).join();
    }

    /** 선점하고 축 작업을 실행기에 띄운다 — 기다리지 않는다. */
    private Round startRound(OutboxTarget target) {
        UUID token = UUID.randomUUID();
        // 빈 틱에도 기록하는 것은 의도다 — 선점 쿼리의 틱당 비용을 그대로 보이게 한다.
        List<EventOutboxDelivery> claimed = timer("outbox.relay.claim", target)
                .record(() -> store.claim(target, workerId, token));
        if (claimed.isEmpty()) {
            return new Round(0, List.of());
        }
        // 봉투를 행마다 따로 읽지 않는다(N+1) — 선점한 행의 봉투를 한 번에 읽어 수신자를 찾는다.
        Map<UUID, EventOutbox> envelopes = new HashMap<>();
        outboxRepository.findAllById(claimed.stream().map(EventOutboxDelivery::getOutboxId).distinct().toList())
                .forEach(envelope -> envelopes.put(envelope.getId(), envelope));
        // claim 은 축·version 순으로 돌려준다 — LinkedHashMap 이 축 안 순서를 그대로 지킨다.
        Map<List<String>, List<EventOutboxDelivery>> axes = new LinkedHashMap<>();
        for (EventOutboxDelivery delivery : claimed) {
            axes.computeIfAbsent(List.of(delivery.getAggregateType(), delivery.getAggregateId()),
                    axis -> new ArrayList<>()).add(delivery);
        }
        List<CompletableFuture<Integer>> running = axes.values().stream()
                .map(rows -> CompletableFuture.supplyAsync(() -> deliverAxis(rows, envelopes, token), axisExecutor))
                .toList();
        return new Round(claimed.size(), running);
    }

    /**
     * 한 축의 앞쪽 연속을 version 순으로 보낸다. 한 건이라도 끝나지 못하면 멈추고 나머지를 되돌린다.
     *
     * <p>«끝나지 못함»은 재시도·영구 실패·봉투 없음·리스 상실·낡은 표시 전부다. 어느 쪽이든 그 행은 아직 미전달이거나
     * 남의 손에 있으므로 뒤 행을 보내면 앞지르기다.
     *
     * @return 전달을 마친 건수
     */
    private int deliverAxis(List<EventOutboxDelivery> rows, Map<UUID, EventOutbox> envelopes, UUID token) {
        for (int i = 0; i < rows.size(); i++) {
            EventOutboxDelivery delivery = rows.get(i);
            boolean done;
            try {
                done = deliverOne(delivery, envelopes.get(delivery.getOutboxId()), token);
            } catch (RuntimeException e) {
                // 표시 단계 DB 오류 등 — 축을 멈추고 나머지는 놓는다. 이 행은 리스 만료 뒤 다시 집힌다.
                log.error("축 전달 중 예외 — deliveryId={} target={}", delivery.getId(), delivery.getTarget(), e);
                done = false;
            }
            if (!done) {
                releaseRest(rows.subList(i + 1, rows.size()), token);
                return i;
            }
        }
        return rows.size();
    }

    private void releaseRest(List<EventOutboxDelivery> rest, UUID token) {
        if (rest.isEmpty()) {
            return;
        }
        try {
            int released = store.release(rest.stream().map(EventOutboxDelivery::getId).toList(), token);
            meterRegistry.counter("outbox.relay.released",
                    "target", rest.get(0).getTarget().name(), "reason", "predecessor_failed").increment(released);
        } catch (RuntimeException e) {
            // 놓기에 실패해도 안전하다 — 그 행들은 내 리스를 문 채 남았다가 리스 만료 뒤 앞 행부터 다시 집힌다(보내지 않았으니
            // 순서도 그대로). 다만 시도 수가 1 남는다. 예외를 올리면 라운드의 다른 축 결과까지 잃으므로 로그만 남긴다.
            log.error("선행 실패 뒤 나머지 놓기 실패 — 리스 만료 뒤 재선점된다 count={} target={}",
                    rest.size(), rest.get(0).getTarget(), e);
        }
    }

    /**
     * 한 대상의 한 라운드 — 선점 건수와 띄운 축 작업.
     *
     * @param claimed 선점 건수
     * @param running 축 작업
     */
    private record Round(int claimed, List<CompletableFuture<Integer>> running) {
        /** 모든 축 작업을 기다린 뒤 성공분만 합산한다 — 예외로 끝난 축은 세고 로그로 남긴다. */
        int join() {
            CompletableFuture.allOf(running.toArray(CompletableFuture[]::new)).exceptionally(e -> null).join();
            int delivered = 0;
            int failed = 0;
            for (CompletableFuture<Integer> axis : running) {
                if (axis.isCompletedExceptionally()) {
                    failed += 1;
                } else {
                    delivered += axis.join();
                }
            }
            if (failed > 0) {
                log.error("outbox relay 축 작업 {}개가 예외로 끝났다 — 그 축의 행은 리스 만료 뒤 재선점된다", failed);
            }
            return delivered;
        }
    }

    /**
     * 한 건을 <b>트랜잭션 밖에서</b> 내보내고 결과를 표시한다.
     *
     * @param envelope 이 행의 봉투. {@code null} = 없다
     * @return 전달·표시까지 마쳤으면 {@code true}
     */
    private boolean deliverOne(EventOutboxDelivery delivery, EventOutbox envelope, UUID token) {
        if (envelope == null) {
            // FK 가 있어 정상 흐름에선 불가능하다. 조용히 넘기면 그 행이 영원히 재시도되므로 기록한다.
            recordFailure(delivery, token, "봉투가 없습니다 — outboxId=" + delivery.getOutboxId(), false);
            return false;
        }

        OutboxTransport transport = transports.get(delivery.getTarget());
        if (!store.renewLease(delivery.getId(), token)) {
            log.warn("전송 전 리스를 잃어 건너뛴다 — deliveryId={} target={}",
                    delivery.getId(), delivery.getTarget());
            return false;
        }
        OutboxTransportResult result;
        Timer.Sample sending = Timer.start(meterRegistry);
        try {
            result = transport.send(delivery, envelope.getUserId());
        } catch (RuntimeException e) {
            // 전달 경로가 예상 밖으로 던지면 그 예외가 틱을 끊는다 — 같은 틱에 선점한 다른 행들이
            // 표시를 못 받고 리스만 문 채 남는다. «보냈는지 모른다»가 정확한 상태이므로 재시도로 본다
            // (수신 측은 eventId 멱등이라 중복이 안전하다).
            log.error("전달 경로가 예외를 던졌다 — deliveryId={} target={}",
                    delivery.getId(), delivery.getTarget(), e);
            result = OutboxTransportResult.retry(e.getClass().getSimpleName() + ": " + e.getMessage());
        } finally {
            sending.stop(timer("outbox.relay.send", delivery.getTarget()));
        }

        if (result.delivered()) {
            if (store.markDelivered(delivery.getId(), token) == 0) {
                log.warn("낡은 리스의 완료 표시를 거부했다 — deliveryId={} target={}",
                        delivery.getId(), delivery.getTarget());
                return false;
            }
            meterRegistry.counter("outbox.relay.delivered", "target", delivery.getTarget().name()).increment();
            return true;
        }

        recordFailure(delivery, token, result.error(), result.retryable());
        return false;
    }

    /**
     * 실패를 기록하고 다음 시도 시각을 민다.
     *
     * <p>백오프는 시도 횟수에 대한 지수 증가이고 {@code maxBackoff} 에서 멈춘다. <b>멈추는 것은
     * 증가뿐</b>이다 — 재시도 자체는 계속된다(A18 보류).
     *
     * <p>ERROR 로그는 같은 행에서 반복하지 않는다 — 영구 실패는 사유가 바뀔 때만, 임계값 경고는 시도 수가 임계값에 닿는
     * 한 번만 남긴다. 재시도마다 세는 것은 {@code outbox.relay.failed} 카운터다.
     */
    private void recordFailure(EventOutboxDelivery delivery, UUID token, String error, boolean retryable) {
        String reason = truncate(error);
        Instant nextAt = clock.instant().plus(backoffFor(delivery.getAttemptCount()));
        if (store.markFailed(delivery.getId(), token, nextAt, reason) == 0) {
            log.warn("낡은 리스의 실패 표시를 거부했다 — deliveryId={}", delivery.getId());
            return;
        }
        meterRegistry.counter("outbox.relay.failed",
                "target", delivery.getTarget().name(), "retryable", String.valueOf(retryable)).increment();
        // lastError 는 선점 시점 값 = 직전에 기록된 실패 사유라서 같은 영구 실패를 다시 적지 않는다.
        if (!retryable && !Objects.equals(reason, delivery.getLastError())) {
            log.error("재시도로 풀리지 않는 전달 실패 — deliveryId={} target={} 사유={} (행은 남긴다)",
                    delivery.getId(), delivery.getTarget(), error);
        }
        Integer threshold = properties.getRetry().getMaxAttempts();
        // 시도 수는 선점이 올리고 실패 기록 뒤에는 줄지 않아 행마다 임계값에 한 번만 닿는다.
        // ponytail: 임계 번째 시도가 실패 기록 없이 끝나면(리스 상실·재배포·표시 실패) 이 경고는 뜨지 않는다 —
        // outbox.relay.failed 카운터가 매 재시도를 센다. 놓치면 안 되면 마지막 경고 시도 수를 행에 저장한다.
        if (threshold != null && delivery.getAttemptCount() == threshold) {
            // 경고 임계값일 뿐이다. 폐기·DLQ 이동은 A18 이 정할 몫이라 여기서 하지 않는다.
            log.error("전달 시도가 임계값에 닿았다 — deliveryId={} target={} attempts={} 사유={}",
                    delivery.getId(), delivery.getTarget(), delivery.getAttemptCount(), error);
        }
    }

    /**
     * 게이지가 읽는 미전달 스냅샷을 갱신한다. 지표 실패가 전달을 막으면 안 되므로 예외는 삼킨다.
     */
    private void refreshBacklog() {
        Map<OutboxTarget, long[]> seen = new EnumMap<>(OutboxTarget.class);
        try {
            for (Object[] row : store.pendingSnapshot()) {
                long age = row[2] == null ? 0 : ((Number) row[2]).longValue();
                seen.put(OutboxTarget.valueOf((String) row[0]), new long[] {((Number) row[1]).longValue(), age});
            }
        } catch (RuntimeException e) {
            // 게이지가 얼어붙은 채 정상처럼 보이지 않게 카운터로 알린다.
            meterRegistry.counter("outbox.relay.snapshot.failed").increment();
            log.warn("outbox relay 미전달 스냅샷 실패 — 이번 틱 게이지는 직전 값을 유지한다", e);
            return;
        }
        for (OutboxTarget target : OutboxTarget.values()) {
            long[] value = seen.getOrDefault(target, new long[] {0, 0});
            backlog.get(target).set(value[0]);
            oldestPendingAgeSeconds.get(target).set(value[1]);
        }
    }

    private Timer timer(String name, OutboxTarget target) {
        return meterRegistry.timer(name, "target", target.name());
    }

    private Duration backoffFor(int attemptCount) {
        Duration initial = properties.getRetry().getInitialBackoff();
        Duration max = properties.getRetry().getMaxBackoff();
        // attemptCount 는 선점 시점에 이미 증가했으므로 첫 실패가 1 이다.
        int exponent = Math.min(Math.max(attemptCount - 1, 0), MAX_BACKOFF_EXPONENT);
        Duration candidate = initial.multipliedBy(1L << exponent);
        return candidate.compareTo(max) > 0 ? max : candidate;
    }

    private static String truncate(String error) {
        if (error == null) {
            return null;
        }
        return error.length() <= MAX_ERROR_LENGTH ? error : error.substring(0, MAX_ERROR_LENGTH);
    }

    private static String resolveWorkerId(String configured) {
        if (configured != null && !configured.isBlank()) {
            return configured;
        }
        String host = System.getenv("HOSTNAME");
        String base = host == null || host.isBlank() ? "relay" : host;
        return base.length() <= 60 ? base : base.substring(0, 60);
    }

    /**
     * @return relay 가 실제로 배선한 대상들 — 「켰는데 아무 데도 안 간다」를 배선 테스트로 잡는다
     */
    public Set<OutboxTarget> knownTargets() {
        return Set.copyOf(transports.keySet());
    }

    /**
     * @return 이 워커의 리스 소유자 이름
     */
    public String workerId() {
        return workerId;
    }
}
