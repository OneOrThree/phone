package com.oneorthree.phone.group.service;

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
 * 공개 섬 «상태» 의 독립 버전 (GROMO-1759, 섬 소속 HLD §5).
 *
 * <p>{@link IslandMembershipEvents}(주민 목록 축)와 <b>일부러 분리</b>한다. HLD §5 가 "버전은 공개 섬
 * 상태, 주민 목록, 요청 자원, 초대 epoch, 개인 현재 context 를 구분한다"고 했고, 두 축을 한
 * aggregate 에 얹으면 이름이 바뀔 때마다 주민 목록 버전이 뛰어 구독자가 멤버 목록을 헛되이 다시
 * 읽는다.
 *
 * <p>data-api 의 <b>첫 {@code island.updated} 발행자</b> 다 — 종전에는 realtime 의
 * {@code RealtimeEventType.ISLAND_UPDATED} 가 이름만 알고 있고 producer 가 없었다.
 */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class IslandStateEvents {

    public static final String AGGREGATE_TYPE = "ISLAND";
    public static final String EVENT_TYPE = "island.updated";

    private final OutboxCommandPort outbox;

    /** 섬이 새로 생겼다. 정보 변경도 같은 사건 이름을 쓰되 {@code changeKind} 로 가른다. */
    public EventEnvelope created(UUID islandId, UUID actorId) {
        return append(islandId, actorId, "CREATED");
    }

    /**
     * 생성 이후의 섬 상태 변경 — 건설 목표 변경·시설 착공/완공도 같은 사건 이름을 쓰고
     * {@code changeKind} 로 가른다(GROMO-1767). 발행한 envelope 를 돌려주는 이유는
     * {@code IslandMembershipEvents#changed} 와 같다 — 멱등 명령이 receipt 에 같은 사건을 저장한다.
     */
    public EventEnvelope changed(UUID islandId, UUID actorId, String changeKind) {
        return append(islandId, actorId, changeKind);
    }

    private EventEnvelope append(UUID islandId, UUID actorId, String changeKind) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("changeKind", changeKind);
        params.put("islandId", islandId.toString());
        // version 은 append 가 잠금 아래 한 번만 발급한다. params 에 추정 버전을 중복 저장하지 않는다.
        return outbox.append(new OutboxAppendCommand(UUID.randomUUID().toString(), 1, EVENT_TYPE,
                actorId, null, islandId.toString(), new AggregateRef(AGGREGATE_TYPE, islandId.toString()),
                null, params, List.of(OutboxDeliveryRequest.toRealtime(EVENT_TYPE, null))));
    }
}
