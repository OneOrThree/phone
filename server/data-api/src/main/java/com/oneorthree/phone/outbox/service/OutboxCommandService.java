package com.oneorthree.phone.outbox.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.IdempotencyRequest;
import com.oneorthree.phone.outbox.dto.IdempotentOutcome;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.repository.CommandIdempotencyRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.CommandIdempotency;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * {@link OutboxCommandPort} 의 구현 — 내구 이벤트·명령 기반의 본체 (A21).
 *
 * <p>세 메서드 모두 {@code Propagation.MANDATORY} 다. 「커밋과 함께 남는다」가 계약이라, 트랜잭션
 * 밖에서 불려 조용히 별도 트랜잭션으로 커밋되면 <b>도메인이 롤백돼도 이벤트만 남는</b> 정확히 반대
 * 방향의 유실이 생긴다. 그래서 그런 호출은 예외로 죽인다.
 *
 * <p><b>외부 호출은 여기서 하지 않는다.</b> 발행은 relay 가 트랜잭션 밖에서 한다 — 명령 트랜잭션 안에서
 * 브로커·HTTP 를 기다리면 그 지연만큼 잠금이 늘어지고, 실패가 도메인 커밋을 되돌린다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OutboxCommandService implements OutboxCommandPort {

    private final EventOutboxRepository eventOutboxRepository;
    private final EventOutboxDeliveryRepository deliveryRepository;
    private final CommandIdempotencyRepository idempotencyRepository;
    private final AggregateVersionAllocator versionAllocator;
    private final Clock clock;

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public EventEnvelope append(OutboxAppendCommand command) {
        Instant now = clock.instant();
        long version = versionAllocator.allocate(command.aggregate());

        EventEnvelope envelope = new EventEnvelope(
                command.eventId(),
                command.schemaVersion(),
                command.type(),
                now,
                command.scheduledAt(),
                command.userId(),
                command.locale(),
                command.subjectId(),
                version,
                command.params());

        EventOutbox saved = eventOutboxRepository.save(EventOutbox.builder()
                .eventId(envelope.eventId())
                .schemaVersion(envelope.schemaVersion())
                .type(envelope.type())
                .occurredAt(envelope.occurredAt())
                .scheduledAt(envelope.scheduledAt())
                .userId(envelope.userId())
                .locale(envelope.locale())
                .subjectId(envelope.subjectId())
                .aggregateType(command.aggregate().type())
                .aggregateId(command.aggregate().id())
                .version(version)
                .params(envelope.params())
                .createdAt(now)
                .build());

        Map<String, Object> envelopeMap = OutboxEnvelopeCodec.toMap(envelope);
        List<EventOutboxDelivery> deliveries = new ArrayList<>();
        for (OutboxDeliveryRequest request : command.deliveries()) {
            deliveries.add(EventOutboxDelivery.builder()
                    .outboxId(saved.getId())
                    .target(request.target())
                    .aggregateType(command.aggregate().type())
                    .aggregateId(command.aggregate().id())
                    .aggregateVersion(version)
                    // payload 가 없으면 정본 봉투 그대로 — 「무엇을 보냈는가」가 행에 남아야 재전달이
                    // 발행 시점의 도메인 상태를 다시 읽지 않는다(그 사이 상태가 바뀌면 다른 것이 나간다).
                    .payload(request.payload() == null ? envelopeMap : request.payload())
                    .endpointKey(request.endpointKey())
                    .attemptCount(0)
                    // 예약 사건은 발송 예정 시각 전에 내보낼 이유가 없다. 즉시 사건은 지금부터.
                    .nextAttemptAt(command.scheduledAt() == null ? now : command.scheduledAt())
                    .createdAt(now)
                    .build());
        }
        deliveryRepository.saveAll(deliveries);

        return envelope;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public long allocateVersion(AggregateRef aggregate) {
        return versionAllocator.allocate(aggregate);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public <T> IdempotentOutcome<T> runIdempotent(
            IdempotencyRequest request, Class<T> responseType, Supplier<T> command) {
        Instant now = clock.instant();
        int claimed = idempotencyRepository.insertClaim(
                request.key(), request.userId(), request.commandType(), request.fingerprint(), now);

        if (claimed == 0) {
            Optional<CommandIdempotency> stored = idempotencyRepository.findById(request.key());
            if (stored.isPresent()) {
                return new IdempotentOutcome<>(replay(stored.get(), request, responseType), true);
            }
            // 선점자가 롤백해 행이 사라졌다 — 이 호출이 그 자리를 이어받는다. 한 번만 다시 시도한다:
            // 여기서 무한 재시도를 돌리면 계속 롤백하는 명령이 요청 스레드를 붙잡는다.
            idempotencyRepository.insertClaim(
                    request.key(), request.userId(), request.commandType(), request.fingerprint(), now);
        }

        T value = command.get();
        // 선점 행은 같은 트랜잭션에서 만들었으므로 반드시 있다. 응답은 지금 채워지고 커밋도 함께다 —
        // 그래서 «커밋된 행 = 응답 있음» 이 성립하고, 재생 경로가 빈 응답을 만날 수 없다.
        CommandIdempotency claim = idempotencyRepository.findById(request.key())
                .orElseThrow(() -> new IllegalStateException(
                        "멱등 선점 행이 같은 트랜잭션에서 사라졌습니다 — key=" + request.key()));
        claim.completeWith(OutboxEnvelopeCodec.toJson(value));
        return new IdempotentOutcome<>(value, false);
    }

    /**
     * 저장된 응답을 되살린다 — 본문 지문이 다르면 재생하지 않고 거부한다.
     *
     * <p>거부가 필요한 이유: 키를 재사용한 <b>별개 명령</b>이 남의 응답을 재생받으면 호출자는 성공
     * 응답을 받는데 아무것도 만들어지지 않는다. 그건 유실과 구분되지 않는다.
     */
    private <T> T replay(CommandIdempotency stored, IdempotencyRequest request, Class<T> responseType) {
        if (!stored.getUserId().equals(request.userId())
                || !stored.getCommandType().equals(request.commandType())
                || !stored.getRequestFingerprint().equals(request.fingerprint())) {
            log.warn("멱등 키 충돌 — key={} commandType={} 저장된 명령={}",
                    request.key(), request.commandType(), stored.getCommandType());
            throw new OutboxException(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        }
        String body = stored.getResponseBody();
        if (body == null) {
            // 커밋된 행은 항상 응답을 갖는다(선점과 저장이 같은 트랜잭션). 여기 오면 그 불변식이
            // 깨진 것이므로 조용히 «재실행»하지 않는다 — 재실행은 곧 중복 생성이다.
            throw new IllegalStateException("멱등 기록에 응답이 없습니다 — key=" + request.key());
        }
        try {
            return OutboxEnvelopeCodec.fromJson(body, responseType);
        } catch (JsonProcessingException e) {
            log.error("멱등 응답 복원 실패 — key={} type={}", request.key(), responseType.getSimpleName(), e);
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
    }
}
