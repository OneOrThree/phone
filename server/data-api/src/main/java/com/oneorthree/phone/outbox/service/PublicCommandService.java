package com.oneorthree.phone.outbox.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.outbox.dto.IdempotentOutcome;
import com.oneorthree.phone.outbox.dto.PublicCommandReceipt;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * 공개 명령의 영속 결과를 기존 outbox 멱등 포트에 결합한다. 별도 테이블·트랜잭션은 만들지 않는다.
 *
 * <p>주체 활성 검사는 도메인이 제공하며 필요한 행 잠금을 TX 끝까지 유지해야 한다. 재생 권한 검사는
 * 현재 결과 열람 권한을 확인한다. 둘 모두 필수이며 outbox가 상위 User 도메인에 의존하지 않는다.
 * expectedVersion·소유·상태 검사와 실제 쓰기는 command 안의 같은 도메인 잠금 아래 둔다.
 *
 * <p>반환 receipt는 내부 결과다. leave/transfer 후 최소 완료 증거만 허용하는 도메인은 재생 권한
 * 검사로 허용 범위를 확인하고 자신의 공개 DTO 매퍼에서 그 증거만 반환해야 한다. 전체 receipt를
 * 공개 응답으로 직렬화하거나 replayed만 보고 이벤트를 재발행하면 안 된다.
 */
@Service
@RequiredArgsConstructor
public class PublicCommandService {

    private final OutboxCommandPort outboxCommandPort;

    @Transactional(propagation = Propagation.MANDATORY)
    public IdempotentOutcome<PublicCommandReceipt> run(
            PublicCommandRequest request, Runnable activeAuthorization,
            Consumer<PublicCommandReceipt> replayAuthorization, Supplier<PublicCommandResult> command) {
        Objects.requireNonNull(request, "명령은 필수입니다.");
        Objects.requireNonNull(activeAuthorization, "활성 주체 검사 구현은 필수입니다.");
        Objects.requireNonNull(replayAuthorization, "재생 권한 검사 구현은 필수입니다.");
        Objects.requireNonNull(command, "신규 명령 구현은 필수입니다.");
        activeAuthorization.run();
        IdempotentOutcome<JsonNode> outcome = outboxCommandPort.runIdempotent(
                request.storageRequest(), JsonNode.class, () -> {
                    activeAuthorization.run();
                    return encode(PublicCommandReceipt.completed(request, command.get()));
                });
        PublicCommandReceipt receipt = decode(outcome.value());
        if (!request.userId().equals(receipt.userId()) || !request.operation().equals(receipt.operation())
                || !request.key().equals(receipt.key()) || !request.fingerprint().equals(receipt.fingerprint())
                || receipt.data() == null || receipt.events() == null || !receipt.events().isArray()
                || (receipt.httpStatus() != 200 && receipt.httpStatus() != 201)) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
        if (outcome.replayed()) {
            activeAuthorization.run();
            replayAuthorization.accept(receipt);
        }
        return new IdempotentOutcome<>(receipt, outcome.replayed());
    }

    private static JsonNode encode(PublicCommandReceipt receipt) {
        try {
            return OutboxEnvelopeCodec.fromJson(OutboxEnvelopeCodec.toJson(receipt), JsonNode.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("공개 명령 결과 직렬화 실패", e);
        }
    }

    private static PublicCommandReceipt decode(JsonNode tree) {
        // DTO를 먼저 복원하면 미래 버전의 추가/변경 필드가 버전 판정보다 먼저 실패한다.
        JsonNode version = tree == null ? null : tree.get("contractVersion");
        if (version == null || !version.isIntegralNumber() || !version.canConvertToInt() || version.intValue() < 1) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
        if (version.intValue() != 1) {
            throw new OutboxException(OutboxErrorCode.PUBLIC_COMMAND_CONTRACT_UNSUPPORTED);
        }
        try {
            return OutboxEnvelopeCodec.fromJson(tree.toString(), PublicCommandReceipt.class);
        } catch (JsonProcessingException e) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
    }
}

