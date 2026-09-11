package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.config.OutboxRelayProperties;
import com.oneorthree.phone.outbox.client.OutboxTransport;
import com.oneorthree.phone.outbox.client.OutboxTransportResult;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import lombok.extern.slf4j.Slf4j;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

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
 * <b>① 선행 미전달을 건너뛰지 않는다.</b> 순서 축(=version 을 발급한 aggregate)별로 가장 낮은 미전달
 * 하나만 후보가 된다. 앞 행이 남의 리스에 잡혀 있어도 여전히 미전달이라 앞지르기가 성립하지 않는다.
 *
 * <p><b>② 낡은 워커의 완료 표시를 거부한다.</b> 리스가 만료돼 다른 워커가 재클레임하면 토큰이 바뀌고
 * 옛 워커의 표시는 0행을 갱신한다. 그 경우 새 워커가 다시 보내 <b>중복</b>이 나지만 수신 측이
 * {@code eventId} 멱등이라 안전하다 — 반대로 낡은 표시를 받아 주면 <b>유실</b>이고 복구할 수 없다.
 *
 * <h2>A18 보류</h2>
 * 고갈 처리가 없다. 임계값을 넘으면 경고만 남기고 최대 백오프로 계속 재시도한다 — 행을 지우거나
 * 다른 대상으로 우회(HTTP 폴백)하지 않는다.
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

    /**
     * @param store            트랜잭션 경계
     * @param outboxRepository 봉투 저장소 — 수신자(userId)를 읽는다
     * @param properties       relay 설정
     * @param clock            서버 시계
     * @param transports       대상별 전달 경로. 없는 대상은 이번 틱에서 건너뛴다
     */
    public OutboxRelayService(
            OutboxRelayStore store,
            EventOutboxRepository outboxRepository,
            OutboxRelayProperties properties,
            Clock clock,
            List<OutboxTransport> transports) {
        this.store = store;
        this.outboxRepository = outboxRepository;
        this.properties = properties;
        this.clock = clock;
        for (OutboxTransport transport : transports) {
            this.transports.put(transport.target(), transport);
        }
        this.workerId = resolveWorkerId(properties.getWorkerId());
    }

    /**
     * 한 틱 — 아는 대상마다 선점·전달·표시를 한 번씩 돈다.
     *
     * @return 이번 틱에 전달을 마친 건수
     */
    public int relayOnce() {
        int delivered = 0;
        for (OutboxTarget target : OutboxTarget.values()) {
            if (transports.containsKey(target)) {
                delivered += relayTarget(target);
            }
        }
        return delivered;
    }

    /**
     * 대상 하나를 처리한다.
     *
     * @param target 전달 대상
     * @return 전달을 마친 건수
     */
    public int relayTarget(OutboxTarget target) {
        UUID token = UUID.randomUUID();
        List<EventOutboxDelivery> claimed = store.claim(target, workerId, token);
        int delivered = 0;
        for (EventOutboxDelivery delivery : claimed) {
            if (deliverOne(delivery, token)) {
                delivered += 1;
            }
        }
        return delivered;
    }

    /**
     * 한 건을 <b>트랜잭션 밖에서</b> 내보내고 결과를 표시한다.
     *
     * @return 전달·표시까지 마쳤으면 {@code true}
     */
    private boolean deliverOne(EventOutboxDelivery delivery, UUID token) {
        Optional<EventOutbox> envelope = outboxRepository.findById(delivery.getOutboxId());
        if (envelope.isEmpty()) {
            // FK 가 있어 정상 흐름에선 불가능하다. 조용히 넘기면 그 행이 영원히 재시도되므로 기록한다.
            recordFailure(delivery, token, "봉투가 없습니다 — outboxId=" + delivery.getOutboxId(), false);
            return false;
        }

        OutboxTransport transport = transports.get(delivery.getTarget());
        OutboxTransportResult result;
        try {
            result = transport.send(delivery, envelope.get().getUserId());
        } catch (RuntimeException e) {
            // 전달 경로가 예상 밖으로 던지면 그 예외가 틱을 끊는다 — 같은 틱에 선점한 다른 행들이
            // 표시를 못 받고 리스만 문 채 남는다. «보냈는지 모른다»가 정확한 상태이므로 재시도로 본다
            // (수신 측은 eventId 멱등이라 중복이 안전하다).
            log.error("전달 경로가 예외를 던졌다 — deliveryId={} target={}",
                    delivery.getId(), delivery.getTarget(), e);
            result = OutboxTransportResult.retry(e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        if (result.delivered()) {
            if (store.markDelivered(delivery.getId(), token) == 0) {
                log.warn("낡은 리스의 완료 표시를 거부했다 — deliveryId={} target={}",
                        delivery.getId(), delivery.getTarget());
                return false;
            }
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
     */
    private void recordFailure(EventOutboxDelivery delivery, UUID token, String error, boolean retryable) {
        if (!retryable) {
            log.error("재시도로 풀리지 않는 전달 실패 — deliveryId={} target={} 사유={} (행은 남긴다)",
                    delivery.getId(), delivery.getTarget(), error);
        }
        Instant nextAt = clock.instant().plus(backoffFor(delivery.getAttemptCount()));
        if (store.markFailed(delivery.getId(), token, nextAt, truncate(error)) == 0) {
            log.warn("낡은 리스의 실패 표시를 거부했다 — deliveryId={}", delivery.getId());
            return;
        }
        Integer threshold = properties.getRetry().getMaxAttempts();
        if (threshold != null && delivery.getAttemptCount() >= threshold) {
            // 경고 임계값일 뿐이다. 폐기·DLQ 이동은 A18 이 정할 몫이라 여기서 하지 않는다.
            log.error("전달 시도가 임계값을 넘었다 — deliveryId={} target={} attempts={} 사유={}",
                    delivery.getId(), delivery.getTarget(), delivery.getAttemptCount(), error);
        }
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
