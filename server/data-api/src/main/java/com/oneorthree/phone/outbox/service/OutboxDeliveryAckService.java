package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.Optional;
import java.util.UUID;

/**
 * {@link OutboxDeliveryAckPort} 의 구현 — 조건은 전부 질의 안에 있다.
 *
 * <p>서비스가 조회해 검사한 뒤 갱신하는 모양으로 쓰지 않는 것은 의도다. 그러면 검사와 갱신 사이에
 * 상태가 바뀔 수 있고, 무엇보다 <b>검사를 빠뜨린 호출 경로가 하나만 생겨도</b> 남의 전달을 닫을 수
 * 있게 된다. 소유·대상·미전달 세 조건을 한 UPDATE 에 박아 두면 그 구멍 자체가 없다.
 *
 * <p>{@code relay} 설정과 무관하게 항상 살아 있다 — 빠른 경로는 relay 가 꺼진 기동에서도 동작해야
 * 한다(오히려 그때가 유일한 전달 경로다).
 */
@Service
@RequiredArgsConstructor
public class OutboxDeliveryAckService implements OutboxDeliveryAckPort {

    private final EventOutboxDeliveryRepository deliveryRepository;
    private final Clock clock;
    private final EventOutboxRepository outboxRepository;

    @Override
    @Transactional
    public AckOutcome acknowledgeNotificationDelivery(UUID callerUserId, String eventId) {
        if (callerUserId == null || eventId == null || eventId.isBlank()) {
            throw new OutboxException(OutboxErrorCode.OUTBOX_DELIVERY_NOT_FOUND);
        }
        UUID outboxId = outboxRepository.findByEventId(eventId)
                .orElseThrow(() -> new OutboxException(OutboxErrorCode.OUTBOX_DELIVERY_NOT_FOUND)).getId();
        return acknowledgeNotificationDelivery(callerUserId, outboxId);
    }

    @Override
    @Transactional
    public AckOutcome acknowledgeNotificationDelivery(UUID callerUserId, UUID outboxId) {
        if (callerUserId == null || outboxId == null) {
            throw new OutboxException(OutboxErrorCode.OUTBOX_DELIVERY_NOT_FOUND);
        }

        int marked = deliveryRepository.markNotificationDeliveredByOwner(
                outboxId, callerUserId, clock.instant());
        if (marked == 1) {
            return AckOutcome.MARKED;
        }

        // 0행의 이유는 셋이다 — 없음 · 남의 것 · 이미 닫힘. 앞의 둘은 호출자에게 구분해 줄 수 없다
        // (남의 명령 id 로 「있는지 없는지」를 알아낼 수 있으면 그 자체가 노출이다). 이 조회도 같은
        // 소유·대상 조건을 지고 있어, 남의 행을 보고 「이미 닫혔다」고 답하지 않는다.
        Optional<EventOutboxDelivery> owned =
                deliveryRepository.findOwnedNotificationDelivery(outboxId, callerUserId);
        if (owned.isPresent() && owned.get().getDeliveredAt() != null) {
            return AckOutcome.ALREADY_MARKED;
        }
        throw new OutboxException(OutboxErrorCode.OUTBOX_DELIVERY_NOT_FOUND);
    }
}
