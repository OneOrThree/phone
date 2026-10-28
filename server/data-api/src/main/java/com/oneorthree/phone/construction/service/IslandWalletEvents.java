package com.oneorthree.phone.construction.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 섬 공동 지갑의 독립 버전 축 — {@code wallet.updated} 사건의 유일한 발행자다.
 * {@code island.updated}(섬 상태 축)와 <b>일부러 분리</b>한다: 섬 version·지갑 version·외양
 * version 은 각 projection 의 시계라 같은 커밋이라도 같은 숫자를 붙이지 않는다(LLD §4-5).
 */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class IslandWalletEvents {

    public static final String AGGREGATE_TYPE = "ISLAND_WALLET";
    public static final String EVENT_TYPE = "wallet.updated";

    private final OutboxCommandPort outbox;

    /** 실제 공동 차감·적립이 있을 때만 발행한다 — 목표 선택에는 지갑 사건이 없다(C11). */
    public EventEnvelope changed(UUID islandId, UUID actorId, String changeKind) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("changeKind", changeKind);
        params.put("islandId", islandId.toString());
        return outbox.append(new OutboxAppendCommand(UUID.randomUUID().toString(), 1, EVENT_TYPE,
                actorId, null, islandId.toString(), new AggregateRef(AGGREGATE_TYPE, islandId.toString()),
                null, params, List.of(OutboxDeliveryRequest.toRealtime(EVENT_TYPE, null))));
    }
}
